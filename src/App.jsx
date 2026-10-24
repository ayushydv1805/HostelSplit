import { useCallback, useEffect, useMemo, useState } from "react";
import {
  callRpc,
  clearCachedSession,
  cloudConfigured,
  deleteRows,
  getCachedSession,
  getCurrentUser,
  getReceiptUrl,
  insertRows,
  refreshSession,
  requestPasswordReset,
  selectRows,
  signIn,
  signOut,
  signUp,
  updateRows,
  uploadReceipt,
} from "./lib/supabaseRest.js";
import { compressReceiptImage, fileToDataUrl, readReceipt } from "./lib/receiptOcr.js";
import { printFinancialReport } from "./lib/reports.js";
import { allocateSplits, calculateBalances, calculateSettlements, normalizeAmount } from "./lib/domain.js";
import "./App.css";

const LOCAL_KEY = "hostelsplit-v2";
const LEGACY_KEY = "hostelsplit-data";
const LEGACY_BACKUP_KEY = "hostelsplit-data-backup";
const CATEGORIES = ["Food", "Travel", "Hotel", "Shopping", "Entertainment", "Utilities", "Supplies", "Other"];
const CATEGORY_ICONS = {
  Food: "🍔", Travel: "🚕", Hotel: "🏨", Shopping: "🛍️", Entertainment: "🎬",
  Utilities: "💡", Supplies: "🧻", Other: "📦",
};
const today = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + month + "-" + day;
};

function makeId() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function money(value, currency) {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return "₹" + amount.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
}

function normalizeMembers(rawMembers) {
  const unique = new Set();
  return (Array.isArray(rawMembers) ? rawMembers : []).map((value) => {
    if (typeof value === "string") {
      const name = value.trim().replace(/\s+/g, " ");
      return { id: name, name, role: "member" };
    }
    if (!value || typeof value !== "object") return null;
    const name = String(value.display_name || value.name || "").trim().replace(/\s+/g, " ");
    const id = String(value.user_id || value.id || name).trim();
    return name && id ? { id, name, role: value.role || "member" } : null;
  }).filter((member) => {
    if (!member) return false;
    const key = member.id.toLowerCase();
    if (unique.has(key)) return false;
    unique.add(key);
    return true;
  });
}

function normalizeExpense(raw, members) {
  if (!raw || typeof raw !== "object") return null;
  const amount = normalizeAmount(raw.amount);
  const memberIds = new Set(members.map((member) => member.id));
  const name = String(raw.name || "").trim();
  const paidBy = String(raw.paidBy || raw.paid_by || "");
  let splits = Array.isArray(raw.splits) ? raw.splits : [];
  if (!splits.length && Array.isArray(raw.members) && raw.members.length) {
    const ids = raw.members.map((member) => typeof member === "string" ? member : member.id).filter((id) => memberIds.has(id));
    if (amount !== null && ids.length) {
      const cents = Math.round(amount * 100);
      splits = ids.map((memberId, index) => ({
        memberId,
        amount: Math.floor(cents / ids.length) / 100 + (index < cents % ids.length ? 0.01 : 0),
      }));
    }
  }
  splits = splits.filter((split) => split && memberIds.has(String(split.memberId || split.user_id || "")))
    .map((split) => {
      const rawShare = Number(split.amount != null ? split.amount : split.share_amount);
      if (!Number.isFinite(rawShare) || rawShare < 0 || !Number.isSafeInteger(Math.round(rawShare * 100))) return null;
      return {
        memberId: String(split.memberId || split.user_id),
        amount: Math.round(rawShare * 100) / 100,
      };
    });
  if (splits.some((split) => !split)) return null;
  const splitTotalCents = splits.reduce((sum, split) => sum + Math.round(split.amount * 100), 0);
  if (!name || amount === null || !memberIds.has(paidBy) || splits.length === 0 || splitTotalCents !== Math.round(amount * 100)) return null;
  return {
    id: String(raw.id || makeId()),
    name,
    amount,
    paidBy,
    category: CATEGORIES.includes(raw.category) ? raw.category : "Other",
    splitType: ["equal", "exact", "percentage"].includes(raw.splitType || raw.split_type) ? (raw.splitType || raw.split_type) : "equal",
    date: String(raw.date || raw.expense_date || today()).slice(0, 10),
    splits,
    receiptDataUrl: raw.receiptDataUrl || "",
    receiptPath: raw.receiptPath || raw.receipt_path || "",
    receiptText: raw.receiptText || raw.receipt_text || "",
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
  };
}

function loadLocalData() {
  try {
    let saved = localStorage.getItem(LOCAL_KEY);
    if (!saved) {
      const legacy = localStorage.getItem(LEGACY_KEY) || localStorage.getItem(LEGACY_BACKUP_KEY);
      if (legacy) {
        const old = JSON.parse(legacy);
        const oldMembers = normalizeMembers(old.members);
        const migrated = {
          group: old.groupName ? { id: "local-" + makeId(), name: old.groupName, currency: "INR", monthly_budget: 0, source: "local" } : null,
          members: oldMembers,
          expenses: (old.expenses || []).map((expense) => normalizeExpense({
            ...expense,
            paidBy: expense.paidBy,

          }, oldMembers)).filter(Boolean),
          settlements: [],
          budgets: [],
        };
        localStorage.setItem(LOCAL_KEY, JSON.stringify(migrated));
        return migrated;
      }
      return { group: null, members: [], expenses: [], settlements: [], budgets: [] };
    }
    const data = JSON.parse(saved);
    const members = normalizeMembers(data.members);
    return {
      group: data.group && typeof data.group.name === "string" ? { ...data.group, source: "local" } : null,
      members,
      expenses: (Array.isArray(data.expenses) ? data.expenses : []).map((expense) => normalizeExpense(expense, members)).filter(Boolean),
      settlements: Array.isArray(data.settlements) ? data.settlements : [],
      budgets: Array.isArray(data.budgets) ? data.budgets : [],
    };
  } catch {
    return { group: null, members: [], expenses: [], settlements: [], budgets: [] };
  }
}

function firstError(error, fallback) {
  return error && error.message ? error.message : fallback;
}

function AuthScreen({ onBack, onComplete }) {
  const [view, setView] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (view !== "reset" && password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      if (view === "signin") {
        const session = await signIn(email, password);
        const user = await getCurrentUser(session);
        onComplete(session, user);
      } else if (view === "signup") {
        if (!displayName.trim()) throw new Error("Enter your name.");
        const result = await signUp(email, password, displayName);
        if (result.session) {
          const user = await getCurrentUser(result.session);
          onComplete(result.session, user);
        } else {
          setNotice("Account created. Check your email to confirm your address, then sign in.");
          setView("signin");
        }
      } else {
        await requestPasswordReset(email);
        setNotice("If the account exists, Supabase will send a password-reset email.");
        setView("signin");
      }
    } catch (caught) {
      setError(firstError(caught, "Authentication failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <nav className="navbar"><a className="brand" href="#" onClick={(event) => { event.preventDefault(); onBack(); }}><span className="brand-mark">H</span> HostelSplit</a><span className="live-pill"><span /> Secure cloud mode</span></nav>
      <main className="auth-layout">
        <section className="auth-story">
          <span className="eyebrow">SHARED EXPENSES, LESS AWKWARDNESS</span>
          <h1>Roommates on the same page.</h1>
          <p>Keep group expenses, receipts, budgets and settlements synced across everyone’s devices.</p>
          <div className="auth-points"><span>✓ Shared group access</span><span>✓ Flexible split rules</span><span>✓ Receipt and budget tracking</span></div>
        </section>
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card-icon">✦</div>
          <h2>{view === "signin" ? "Welcome back" : view === "signup" ? "Create your account" : "Reset password"}</h2>
          <p>{view === "signin" ? "Sign in to open your shared groups." : view === "signup" ? "Start a group with your hostel friends." : "We’ll email you a password reset link."}</p>
          {view === "signup" && <label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required placeholder="e.g. Ayush Yadav" /></label>}
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" /></label>
          {view !== "reset" && <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={view === "signin" ? "current-password" : "new-password"} minLength={8} required placeholder="At least 8 characters" /></label>}
          {error && <div className="alert error">{error}</div>}
          {notice && <div className="alert success">{notice}</div>}
          <button className="btn primary full" type="submit" disabled={busy}>{busy ? "Please wait…" : view === "signin" ? "Sign in" : view === "signup" ? "Create account" : "Send reset link"}</button>
          <div className="auth-links">
            {view === "signin" && <button type="button" onClick={() => setView("reset")}>Forgot password?</button>}
            <button type="button" onClick={() => { setView(view === "signup" ? "signin" : "signup"); setError(""); setNotice(""); }}>{view === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}</button>
          </div>
          <button type="button" className="btn secondary full" onClick={onBack}>Continue offline instead</button>
          <small className="muted tiny">Cloud access requires the database schema from supabase/schema.sql and valid Vite environment variables.</small>
        </form>
      </main>
    </div>
  );
}

function EmptyState({ icon, title, body, action }) {
  return <div className="empty-state"><div className="empty-icon">{icon || "✦"}</div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

function App() {
  const [initialLocal] = useState(loadLocalData);
  const [localMode, setLocalMode] = useState(!cloudConfigured);
  const [session, setSession] = useState(() => cloudConfigured ? getCachedSession() : null);
  const [user, setUser] = useState(null);
  const [cloudGroups, setCloudGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState("");
  const [group, setGroup] = useState(initialLocal.group);
  const [members, setMembers] = useState(initialLocal.members);
  const [expenses, setExpenses] = useState(initialLocal.expenses);
  const [settlements, setSettlements] = useState(initialLocal.settlements || []);
  const [budgets, setBudgets] = useState(initialLocal.budgets || []);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem("hostelsplit-theme") === "dark"; } catch { return false; }
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [groupListVersion, setGroupListVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState(new Date().toISOString().slice(0, 7));
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [initialMembersInput, setInitialMembersInput] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState("");
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [categoryBudgetName, setCategoryBudgetName] = useState("Food");
  const [categoryBudgetInput, setCategoryBudgetInput] = useState("");
  const [showMemberForm, setShowMemberForm] = useState(false);
  const [memberInput, setMemberInput] = useState("");
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [expenseForm, setExpenseForm] = useState({
    name: "", amount: "", paidBy: "", category: "Food", date: today(),
    splitType: "equal", selectedMembers: [], splitValues: {},
    receiptFile: null, receiptDataUrl: "", receiptPath: "", receiptText: "", suggestedAmount: null,
  });

  const hasSession = Boolean(session);
  const cloudSession = cloudConfigured && !localMode && Boolean(session && user);
  const isCloud = cloudSession && Boolean(group && group.source === "cloud");

  useEffect(() => {
    try {
      localStorage.setItem("hostelsplit-theme", darkMode ? "dark" : "light");
      document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    } catch {
      // Theme preference is optional.
    }
  }, [darkMode]);

  useEffect(() => {
    if (localMode || !cloudConfigured || !hasSession) return undefined;
    let active = true;
    const verifySession = async () => {
      try {
        const refreshed = await refreshSession();
        if (active) setSession(refreshed);
        if (refreshed && active) {
          const currentUser = await getCurrentUser(refreshed);
          if (active) setUser(currentUser);
        } else if (active) {
          setUser(null);
        }
      } catch (caught) {
        if (active) {
          clearCachedSession();
          setSession(null);
          setUser(null);
          setError("Your cloud session expired. Please sign in again. " + firstError(caught, ""));
        }
      }
    };
    verifySession();
    return () => { active = false; };
  }, [localMode, hasSession]);

  useEffect(() => {
    if (!cloudSession) {
      setCloudGroups([]);
      setActiveGroupId("");
      if (!isCloud && group && group.source === "cloud") {
        setGroup(initialLocal.group);
        setMembers(initialLocal.members);
        setExpenses(initialLocal.expenses);
        setSettlements(initialLocal.settlements || []);
        setBudgets(initialLocal.budgets || []);
      }
      return undefined;
    }
    let active = true;
    const loadGroups = async () => {
      setLoadingData(true);
      try {
        const rows = await selectRows("groups", {
          select: "id,name,invite_code,currency,monthly_budget,created_by,created_at",
          order: "created_at.desc",
        }, session);
        if (!active) return;
        setCloudGroups(Array.isArray(rows) ? rows : []);
        setActiveGroupId((current) => current && rows.some((item) => item.id === current) ? current : "");
      } catch (caught) {
        if (active) setError("Could not load shared groups: " + firstError(caught, "Check the SQL schema and Supabase API settings."));
      } finally {
        if (active) setLoadingData(false);
      }
    };
    loadGroups();
    return () => { active = false; };
  }, [cloudSession, session, groupListVersion]);

  const activeMonthStart = (monthFilter || new Date().toISOString().slice(0, 7)) + "-01";
  const loadCloudData = useCallback(async (groupId, activeSession, options = {}) => {
    if (!groupId || !activeSession) return;
    const silent = Boolean(options.silent);
    if (!silent) setLoadingData(true);
    if (!silent) setError("");
    try {
      const selectedGroups = await selectRows("groups", {
        select: "id,name,invite_code,currency,monthly_budget,created_by,created_at",
        id: "eq." + groupId,
      }, activeSession);
      if (!selectedGroups || !selectedGroups[0]) throw new Error("That group is no longer available to this account.");
      const loadedGroup = { ...selectedGroups[0], source: "cloud" };
      const [memberRows, expenseRows, settlementRows, budgetRows] = await Promise.all([
        selectRows("group_members", { select: "user_id,display_name,role,joined_at", group_id: "eq." + groupId, order: "joined_at.asc" }, activeSession),
        selectRows("expenses", { select: "*,expense_splits(user_id,share_amount)", group_id: "eq." + groupId, order: "expense_date.desc,created_at.desc" }, activeSession),
        selectRows("settlements", { select: "*", group_id: "eq." + groupId, order: "created_at.desc" }, activeSession),
        selectRows("budgets", { select: "*", group_id: "eq." + groupId, order: "month.desc" }, activeSession),
      ]);
      const loadedMembers = normalizeMembers(memberRows);
      const loadedExpenses = (expenseRows || []).map((expense) => normalizeExpense({
        ...expense,
        paidBy: expense.paid_by,
        date: expense.expense_date,
        splitType: expense.split_type,
        receiptPath: expense.receipt_path,
        receiptText: expense.receipt_text,
        splits: (expense.expense_splits || []).map((split) => ({ memberId: split.user_id, amount: Number(split.share_amount) })),
      }, loadedMembers)).filter(Boolean);
      const loadedSettlements = (settlementRows || []).map((settlement) => ({
        id: settlement.id,
        from: settlement.from_user,
        to: settlement.to_user,
        amount: Number(settlement.amount),
        status: settlement.status,
        note: settlement.note || "",
        date: settlement.paid_at || settlement.created_at,
        createdAt: settlement.created_at,
      }));
      setGroup(loadedGroup);
      setMembers(loadedMembers);
      setExpenses(loadedExpenses);
      setSettlements(loadedSettlements);
      setBudgets(Array.isArray(budgetRows) ? budgetRows : []);
      setActiveGroupId(groupId);
      setLastSyncAt(new Date().toISOString());
    } catch (caught) {
      if (!silent) setError("Could not load this group: " + firstError(caught, "Check Supabase schema, table exposure and row-level security."));
    } finally {
      if (!silent) setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (!cloudSession || !activeGroupId || !session) return undefined;
    let active = true;
    const load = async () => {
      await loadCloudData(activeGroupId, session);
      if (!active) return;
    };
    load();
    return () => { active = false; };
  }, [cloudSession, activeGroupId, session, loadCloudData]);

  useEffect(() => {
    if (!cloudSession || !activeGroupId || !session) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || busy || showExpenseForm || showBudgetForm || showGroupForm) return;
      loadCloudData(activeGroupId, session, { silent: true });
    }, 20000);
    return () => window.clearInterval(timer);
  }, [cloudSession, activeGroupId, session, loadCloudData, busy, showExpenseForm, showBudgetForm, showGroupForm]);

  useEffect(() => {
    if (isCloud || !group || group.source === "cloud") return;
    const snapshot = { group, members, expenses, settlements, budgets };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(snapshot));
      // Keep old backup data out of the new storage path; Clear Group removes both.
    } catch {
      setError("Browser storage is full. Export your expenses and remove a receipt image or large browser data before continuing.");
    }
  }, [isCloud, group, members, expenses, settlements, budgets]);

  const balances = useMemo(() => calculateBalances(members, expenses, settlements), [members, expenses, settlements]);
  const recommendedSettlements = useMemo(() => calculateSettlements(balances), [balances]);
  const currency = group && group.currency ? group.currency : "INR";
  const totalSpent = useMemo(() => expenses.reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const monthlyExpenses = useMemo(() => monthFilter ? expenses.filter((expense) => String(expense.date).slice(0, 7) === monthFilter) : expenses, [expenses, monthFilter]);
  const monthlyTotal = useMemo(() => monthlyExpenses.reduce((sum, expense) => sum + expense.amount, 0), [monthlyExpenses]);
  const categoryTotals = useMemo(() => {
    const result = {};
    expenses.forEach((expense) => { result[expense.category] = (result[expense.category] || 0) + expense.amount; });
    return result;
  }, [expenses]);
  const monthlyCategoryTotals = useMemo(() => {
    const result = {};
    monthlyExpenses.forEach((expense) => { result[expense.category] = (result[expense.category] || 0) + expense.amount; });
    return result;
  }, [monthlyExpenses]);
  const overallBudgetRecord = budgets.find((item) => item.category === "All" && item.month === activeMonthStart);
  const overallBudget = overallBudgetRecord ? Number(overallBudgetRecord.amount || 0) : 0;
  const selectedCategoryBudget = budgets.find((item) => item.category === categoryBudgetName && item.month === activeMonthStart);
  const isGroupOwner = !isCloud || Boolean(user && (group.created_by === user.id || members.some((member) => member.id === user.id && member.role === "owner")));
  const filteredExpenses = useMemo(() => {
    const search = query.trim().toLowerCase();
    return expenses.filter((expense) => {
      const member = members.find((item) => item.id === expense.paidBy);
      const text = [expense.name, expense.category, member ? member.name : expense.paidBy, expense.receiptText].join(" ").toLowerCase();
      const matchSearch = !search || text.includes(search);
      const matchCategory = categoryFilter === "All" || expense.category === categoryFilter;
      const matchMonth = !monthFilter || String(expense.date).slice(0, 7) === monthFilter;
      return matchSearch && matchCategory && matchMonth;
    });
  }, [expenses, members, query, categoryFilter, monthFilter]);

  const settleCurrentGroup = () => {
    setGroup(null);
    setActiveGroupId("");
    setMembers([]);
    setExpenses([]);
    setSettlements([]);
    setBudgets([]);
  };

  const onAuthComplete = (newSession, newUser) => {
    setLocalMode(false);
    setSession(newSession);
    setUser(newUser);
    setGroup(null);
    setMembers([]);
    setExpenses([]);
    setSettlements([]);
    setBudgets([]);
    setActiveGroupId("");
    setError("");
    setNotice("Signed in successfully.");
  };

  const handleLogout = async () => {
    await signOut();
    setSession(null);
    setUser(null);
    setCloudGroups([]);
    setActiveGroupId("");
    settleCurrentGroup();
    setNotice("You have been signed out.");
  };

  const handleCreateGroup = async (event) => {
    event.preventDefault();
    const name = groupNameInput.trim();
    if (!name) { setError("Enter a group name."); return; }
    const parsedNames = initialMembersInput.split(",").map((item) => item.trim()).filter(Boolean);
    if (!cloudSession && new Set(parsedNames.map((item) => item.toLowerCase())).size < 2) {
      setError("Add at least two different members, separated by commas.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (cloudSession) {
        const created = await insertRows("groups", [{
          name,
          created_by: user.id,
          currency: "INR",
          monthly_budget: 0,
        }], session);
        if (!created || !created[0]) throw new Error("The group was not created.");
        await insertRows("group_members", [{
          group_id: created[0].id,
          user_id: user.id,
          display_name: user.user_metadata && user.user_metadata.display_name ? user.user_metadata.display_name : String(user.email || "Owner").split("@")[0],
          role: "owner",
        }], session);
        setShowGroupForm(false);
        setGroupNameInput("");
        await loadCloudGroupsAfterCreate(created[0].id);
        setNotice("Group created. Share its invite code with other signed-in HostelSplit users.");
      } else {
        const localMembers = normalizeMembers([...new Set(parsedNames.map((item) => item.replace(/\s+/g, " ")))]);
        setGroup({ id: "local-" + makeId(), name, currency: "INR", monthly_budget: 0, source: "local" });
        setMembers(localMembers);
        setExpenses([]);
        setSettlements([]);
        setBudgets([]);
        setShowGroupForm(false);
        setGroupNameInput("");
        setInitialMembersInput("");
        setNotice("Your local group is ready.");
      }
    } catch (caught) {
      setError("Could not create the group: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const loadCloudGroupsAfterCreate = async (createdId) => {
    const rows = await selectRows("groups", {
      select: "id,name,invite_code,currency,monthly_budget,created_by,created_at",
      order: "created_at.desc",
    }, session);
    setCloudGroups(Array.isArray(rows) ? rows : []);
    const selected = Array.isArray(rows) ? rows.find((item) => item.id === createdId) : null;
    if (selected) {
      setGroup({ ...selected, source: "cloud" });
      setMembers([{ id: user.id, name: user.user_metadata && user.user_metadata.display_name ? user.user_metadata.display_name : String(user.email || "Owner").split("@")[0], role: "owner" }]);
      setExpenses([]);
      setSettlements([]);
      setBudgets([]);
    }
    setActiveGroupId(createdId);
  };

  const handleJoinGroup = async (event) => {
    event.preventDefault();
    if (!inviteCodeInput.trim()) { setError("Enter your invite code."); return; }
    setBusy(true);
    setError("");
    try {
      const result = await callRpc("join_hostelsplit_group", { p_invite_code: inviteCodeInput.trim().toUpperCase() }, session);
      const joinedId = Array.isArray(result) ? result[0] : result;
      setInviteCodeInput("");
      const rows = await selectRows("groups", { select: "id,name,invite_code,currency,monthly_budget,created_by,created_at", order: "created_at.desc" }, session);
      setCloudGroups(Array.isArray(rows) ? rows : []);
      setActiveGroupId(joinedId);
      setNotice("You joined the group successfully.");
    } catch (caught) {
      setError("Could not join group: " + firstError(caught, "Check the code and try again."));
    } finally {
      setBusy(false);
    }
  };

  const changeGroup = (id) => {
    const selected = cloudGroups.find((item) => item.id === id);
    if (selected) setGroup({ ...selected, source: "cloud" });
    setMembers([]);
    setExpenses([]);
    setSettlements([]);
    setBudgets([]);
    setError("");
    setNotice("");
    setActiveGroupId(id);
  };

  const clearGroup = async () => {
    const message = isCloud && !isGroupOwner
      ? "Leave this group on this account? Its expenses and history will remain for the other members."
      : "Delete this group and all its expenses, budgets and settlements? This cannot be undone.";
    if (!window.confirm(message)) return;
    setBusy(true);
    try {
      if (isCloud) {
        if (isGroupOwner) {
          await deleteRows("groups", { id: "eq." + group.id }, session);
        } else {
          await deleteRows("group_members", { group_id: "eq." + group.id, user_id: "eq." + user.id }, session);
        }
        setCloudGroups((current) => current.filter((item) => item.id !== group.id));
        setActiveGroupId("");
        settleCurrentGroup();
      } else {
        localStorage.removeItem(LOCAL_KEY);
        localStorage.removeItem(LEGACY_KEY);
        localStorage.removeItem(LEGACY_BACKUP_KEY);
        settleCurrentGroup();
      }
      setNotice("Group deleted.");
    } catch (caught) {
      setError("Could not " + (isCloud && !isGroupOwner ? "leave this group: " : "delete this group: ") + firstError(caught, "Check your group permissions and try again."));
    } finally {
      setBusy(false);
    }
  };

  const openNewExpense = (expense) => {
    if (expense) {
      const values = {};
      expense.splits.forEach((split) => {
        values[split.memberId] = expense.splitType === "percentage"
          ? String(Math.round(split.amount / expense.amount * 10000) / 100)
          : String(split.amount);
      });
      setEditingExpenseId(expense.id);
      setExpenseForm({
        name: expense.name,
        amount: String(expense.amount),
        paidBy: expense.paidBy,
        category: expense.category,
        date: expense.date || today(),
        splitType: expense.splitType || "equal",
        selectedMembers: expense.splits.map((split) => split.memberId),
        splitValues: values,
        receiptFile: null,
        receiptDataUrl: expense.receiptDataUrl || "",
        receiptPath: expense.receiptPath || "",
        receiptText: expense.receiptText || "",
        suggestedAmount: null,
      });
    } else {
      setEditingExpenseId("");
      setExpenseForm({
        name: "", amount: "", paidBy: members[0] ? members[0].id : "",
        category: "Food", date: today(), splitType: "equal",
        selectedMembers: members.map((member) => member.id),
        splitValues: {}, receiptFile: null, receiptDataUrl: "", receiptPath: "", receiptText: "", suggestedAmount: null,
      });
    }
    setShowExpenseForm(true);
    setError("");
  };

  const toggleSplitMember = (memberId) => {
    setExpenseForm((current) => {
      const selected = current.selectedMembers.includes(memberId)
        ? current.selectedMembers.filter((item) => item !== memberId)
        : [...current.selectedMembers, memberId];
      const values = { ...current.splitValues };
      if (!selected.includes(memberId)) delete values[memberId];
      return { ...current, selectedMembers: selected, splitValues: values };
    });
  };

  const updateExpenseField = (field, value) => {
    setExpenseForm((current) => ({ ...current, [field]: value }));
  };

  const handleReceipt = async (file) => {
    if (!file) return;
    setReceiptBusy(true);
    setOcrProgress(0);
    setError("");
    try {
      const compressed = await compressReceiptImage(file);
      const dataUrl = await fileToDataUrl(compressed);
      setExpenseForm((current) => ({ ...current, receiptFile: compressed, receiptDataUrl: dataUrl }));
      try {
        const extraction = await readReceipt(compressed, setOcrProgress);
        setExpenseForm((current) => ({
          ...current,
          receiptFile: compressed,
          receiptDataUrl: dataUrl,
          receiptText: extraction.text,
          suggestedAmount: extraction.suggestedAmount,
          amount: current.amount || (extraction.suggestedAmount ? String(extraction.suggestedAmount) : ""),
        }));
        setNotice(extraction.suggestedAmount
          ? "Receipt scanned. Suggested total: " + money(extraction.suggestedAmount, currency) + " — verify it before saving."
          : "Receipt text extracted. Check it and enter the expense total manually.");
      } catch (ocrError) {
        setNotice("Receipt attached, but OCR could not read it: " + firstError(ocrError, "try a clearer image."));
      }
    } catch (caught) {
      setError(firstError(caught, "Could not process the receipt."));
    } finally {
      setReceiptBusy(false);
      setOcrProgress(0);
    }
  };

  const handleSaveExpense = async (event) => {
    event.preventDefault();
    const amount = normalizeAmount(expenseForm.amount);
    if (!expenseForm.name.trim() || amount === null || !members.some((member) => member.id === expenseForm.paidBy)) {
      setError("Enter an expense name, valid positive amount, and a current group member who paid.");
      return;
    }
    let splits;
    try {
      splits = allocateSplits(amount, expenseForm.selectedMembers, expenseForm.splitType, expenseForm.splitValues);
    } catch (caught) {
      setError(firstError(caught, "Check the split values."));
      return;
    }
    if (splits.some((split) => !members.some((member) => member.id === split.memberId))) {
      setError("A selected split member is no longer in this group.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      let receiptPath = expenseForm.receiptPath || "";
      if (isCloud && expenseForm.receiptFile) {
        const safeName = makeId() + ".jpg";
        receiptPath = user.id + "/" + group.id + "/" + safeName;
        await uploadReceipt(receiptPath, expenseForm.receiptFile, session);
      }
      const expense = {
        id: editingExpenseId || makeId(),
        name: expenseForm.name.trim(),
        amount,
        paidBy: expenseForm.paidBy,
        category: CATEGORIES.includes(expenseForm.category) ? expenseForm.category : "Other",
        splitType: expenseForm.splitType,
        date: expenseForm.date || today(),
        splits,
        receiptDataUrl: isCloud ? "" : expenseForm.receiptDataUrl,
        receiptPath,
        receiptText: expenseForm.receiptText || "",
        createdAt: new Date().toISOString(),
      };

      if (isCloud) {
        const payload = {
          group_id: group.id,
          name: expense.name,
          amount: expense.amount,
          paid_by: expense.paidBy,
          category: expense.category,
          split_type: expense.splitType,
          expense_date: expense.date,
          receipt_path: expense.receiptPath || null,
          receipt_text: expense.receiptText || null,
          created_by: user.id,
        };
        let expenseId = expense.id;
        if (editingExpenseId) {
          await updateRows("expenses", { id: "eq." + editingExpenseId }, payload, session);
          await deleteRows("expense_splits", { expense_id: "eq." + editingExpenseId }, session);
        } else {
          const createdRows = await insertRows("expenses", [payload], session);
          expenseId = createdRows && createdRows[0] ? createdRows[0].id : "";
          if (!expenseId) throw new Error("The expense was saved without an ID. Reload the group and check it before trying again.");
        }
        await insertRows("expense_splits", splits.map((split) => ({
          expense_id: expenseId,
          user_id: split.memberId,
          share_amount: split.amount,
        })), session);
        await loadCloudData(group.id, session);
      } else {
        setExpenses((current) => editingExpenseId
          ? current.map((item) => item.id === editingExpenseId ? expense : item)
          : [expense, ...current]);
      }
      setShowExpenseForm(false);
      setEditingExpenseId("");
      setNotice(editingExpenseId ? "Expense updated." : "Expense added.");
    } catch (caught) {
      setError("Could not save expense: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const deleteExpense = async (expense) => {
    if (!window.confirm("Delete the expense “" + expense.name + "”?")) return;
    setBusy(true);
    try {
      if (isCloud) {
        await deleteRows("expenses", { id: "eq." + expense.id }, session);
        await loadCloudData(group.id, session);
      } else {
        setExpenses((current) => current.filter((item) => item.id !== expense.id));
      }
      setNotice("Expense deleted.");
    } catch (caught) {
      setError("Could not delete the expense: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const recordSettlement = async (settlement) => {
    const payer = members.find((item) => item.id === settlement.from);
    const receiver = members.find((item) => item.id === settlement.to);
    if (!payer || !receiver) return;
    setBusy(true);
    try {
      const entry = {
        id: makeId(), from: settlement.from, to: settlement.to,
        amount: settlement.amount, status: "paid", date: new Date().toISOString(),
        note: "Marked paid from smart settlement",
      };
      if (isCloud) {
        const rows = await insertRows("settlements", [{
          group_id: group.id,
          from_user: entry.from,
          to_user: entry.to,
          amount: entry.amount,
          status: "paid",
          paid_at: entry.date,
          note: entry.note,
          created_by: user.id,
        }], session);
        if (rows && rows[0]) entry.id = rows[0].id;
      }
      setSettlements((current) => [entry, ...current]);
      setNotice(payer.name + " → " + receiver.name + " recorded as paid.");
    } catch (caught) {
      setError("Could not record settlement: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const undoSettlement = async (settlement) => {
    if (!window.confirm("Mark this settlement as cancelled? This changes the current balances but keeps the history.")) return;
    setBusy(true);
    try {
      if (isCloud) {
        await updateRows("settlements", { id: "eq." + settlement.id }, { status: "cancelled" }, session);
      }
      setSettlements((current) => current.map((item) => item.id === settlement.id ? { ...item, status: "cancelled" } : item));
      setNotice("Settlement cancelled; balances recalculated.");
    } catch (caught) {
      setError("Could not update the settlement: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const saveBudgets = async (event) => {
    event.preventDefault();
    const overall = Number(budgetInput || 0);
    const categoryAmount = Number(categoryBudgetInput || 0);
    if (!Number.isFinite(overall) || overall < 0 || !Number.isFinite(categoryAmount) || categoryAmount < 0) {
      setError("Budgets must be valid non-negative amounts.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const monthDate = activeMonthStart;
      if (isCloud) {
        await updateRows("groups", { id: "eq." + group.id }, { monthly_budget: Math.round(overall * 100) / 100 }, session);
        await insertRows("budgets", [
          { group_id: group.id, month: monthDate, category: "All", amount: Math.round(overall * 100) / 100, created_by: user.id },
          { group_id: group.id, month: monthDate, category: categoryBudgetName, amount: Math.round(categoryAmount * 100) / 100, created_by: user.id },
        ], session, "group_id,month,category");
        const rows = await selectRows("groups", { select: "id,name,invite_code,currency,monthly_budget,created_by,created_at", id: "eq." + group.id }, session);
        if (rows && rows[0]) setGroup({ ...rows[0], source: "cloud" });
        const budgetsData = await selectRows("budgets", { select: "*", group_id: "eq." + group.id, order: "month.desc" }, session);
        setBudgets(budgetsData || []);
      } else {
        setGroup((current) => current ? { ...current, monthly_budget: Math.round(overall * 100) / 100 } : current);
        setBudgets((current) => {
          const withoutCurrent = current.filter((item) => !(item.month === monthDate && (item.category === "All" || item.category === categoryBudgetName)));
          return [...withoutCurrent,
            { id: makeId(), month: monthDate, category: "All", amount: Math.round(overall * 100) / 100 },
            { id: makeId(), month: monthDate, category: categoryBudgetName, amount: Math.round(categoryAmount * 100) / 100 },
          ];
        });
      }
      setShowBudgetForm(false);
      setNotice("Budgets saved for " + monthFilter + ".");
    } catch (caught) {
      setError("Could not save budgets: " + firstError(caught, "Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event) => {
    event.preventDefault();
    const name = memberInput.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (members.some((member) => member.name.toLowerCase() === name.toLowerCase())) {
      setError("That member already exists.");
      return;
    }
    if (isCloud) {
      setError("Shared cloud groups only include users who sign in and join with the group's invite code. Share the code below instead.");
      return;
    }
    setMembers((current) => [...current, { id: name, name, role: "member" }]);
    setMemberInput("");
    setShowMemberForm(false);
  };

  const exportCsv = () => {
    if (!expenses.length) { setError("Add an expense before exporting."); return; }
    const escape = (value) => {
      let cell = String(value == null ? "" : value);
      if (/^\\s*[=+@-]/.test(cell)) cell = "'" + cell;
      return '"' + cell.replace(/"/g, '""') + '"';
    };
    const rows = [
      ["Date", "Expense", "Amount", "Currency", "Paid by", "Category", "Split type", "Split member", "Share", "Receipt OCR text"],
    ];
    expenses.forEach((expense) => {
      const payer = members.find((member) => member.id === expense.paidBy);
      expense.splits.forEach((split) => {
        const member = members.find((item) => item.id === split.memberId);
        rows.push([expense.date, expense.name, expense.amount, currency, payer ? payer.name : expense.paidBy, expense.category, expense.splitType, member ? member.name : split.memberId, split.amount, expense.receiptText]);
      });
    });
    const csv = "\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = (group.name || "hostelsplit").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + "-expenses.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openReceipt = async (expense) => {
    if (expense.receiptDataUrl) {
      window.open(expense.receiptDataUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (isCloud && expense.receiptPath) {
      try {
        const url = await getReceiptUrl(expense.receiptPath, session);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (caught) {
        setError("Could not open receipt: " + firstError(caught, "Please try again."));
      }
      return;
    }
    setError("This receipt is not available in this browser.");
  };

  const exportPdf = () => {
    try {
      const reportExpenses = expenses.filter((expense) => !monthFilter || expense.date.slice(0, 7) === monthFilter);
      const reportSettlements = settlements.filter((item) => item.status === "paid" && (!monthFilter || String(item.date || item.createdAt || "").slice(0, 7) === monthFilter));
      const reportBalances = calculateBalances(members, reportExpenses, reportSettlements);
      printFinancialReport({
        groupName: group ? group.name : "HostelSplit",
        members,
        expenses: reportExpenses,
        balances: reportBalances,
        settlements: calculateSettlements(reportBalances),
        budget: overallBudget,
        month: monthFilter || "All months",
      });
    } catch (caught) {
      setError(firstError(caught, "Could not open the report."));
    }
  };

  const switchOffline = () => {
    setLocalMode(true);
    setSession(null);
    setUser(null);
    setActiveGroupId("");
    setError("");
    setNotice("Offline mode selected. Data is stored only in this browser.");
  };

  if (cloudConfigured && !localMode && (!session || !user)) {
    return <AuthScreen onBack={switchOffline} onComplete={onAuthComplete} />;
  }

  if (cloudSession && !activeGroupId) {
    return (
      <div className={"app " + (darkMode ? "dark" : "")}>
        <nav className="navbar"><a className="brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark">H</span> HostelSplit</a><div className="nav-actions"><button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">{darkMode ? "☀️" : "🌙"}</button><span className="user-chip">{user.email}</span><button className="btn secondary" onClick={handleLogout}>Sign out</button></div></nav>
        <main className="page-shell">
          <header className="page-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h1>Shared groups</h1><p>Choose a group or make a fresh one for your hostel room, trip or flat.</p></div><span className="secure-tag">☁ Synced with Supabase</span></header>
          {error && <div className="alert error">{error}</div>}
          {notice && <div className="alert success">{notice}</div>}
          {loadingData ? <div className="loading-card">Loading your groups…</div> : <div className="groups-grid">
            {cloudGroups.map((item) => <button className="group-tile" key={item.id} onClick={() => changeGroup(item.id)}><span className="group-tile-icon">⌂</span><strong>{item.name}</strong><small>Invite code: {item.invite_code}</small><span className="tile-arrow">Open group →</span></button>)}
            <button className="group-tile create-tile" onClick={() => { setShowGroupForm(true); setError(""); }}><span className="group-tile-icon">＋</span><strong>Create a group</strong><small>Start tracking expenses together.</small><span className="tile-arrow">New workspace →</span></button>
          </div>}
          <form className="join-card" onSubmit={handleJoinGroup}><div><h2>Join with invite code</h2><p>Ask a group owner for the code, then join from your own account.</p></div><div className="join-controls"><input value={inviteCodeInput} onChange={(event) => setInviteCodeInput(event.target.value.toUpperCase())} placeholder="E.g. A1B2C3D4" maxLength={10} aria-label="Invite code" /><button className="btn primary" type="submit" disabled={busy}>Join group</button></div></form>
        </main>
        {showGroupForm && <div className="modal-backdrop"><form className="modal" onSubmit={handleCreateGroup}><button type="button" className="close-button" onClick={() => setShowGroupForm(false)} aria-label="Close">×</button><span className="eyebrow">NEW WORKSPACE</span><h2>Create a shared group</h2><p>Friends can join from their own accounts using a private invite code.</p><label>Group name<input value={groupNameInput} onChange={(event) => setGroupNameInput(event.target.value)} autoFocus required maxLength={100} placeholder="e.g. Hostel Room 603" /></label>{error && <div className="alert error">{error}</div>}<button className="btn primary full" disabled={busy}>{busy ? "Creating…" : "Create group"}</button></form></div>}
      </div>
    );
  }

  if (!group) {
    return (
      <div className={"app " + (darkMode ? "dark" : "")}>
        <nav className="navbar"><a className="brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark">H</span> HostelSplit</a><div className="nav-actions"><button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">{darkMode ? "☀️" : "🌙"}</button>{cloudSession ? <button className="btn secondary" onClick={handleLogout}>Sign out</button> : cloudConfigured && <button className="btn secondary" onClick={() => { setLocalMode(false); setSession(getCachedSession()); }}>Cloud login</button>}</div></nav>
        <main className="welcome-shell">
          {!cloudConfigured && <div className="cloud-setup-banner"><div><strong>Cloud login is not connected yet</strong><span>This deployment is using browser-only storage. Add a dedicated Supabase project URL and publishable key, apply <code>supabase/schema.sql</code>, then redeploy to enable cloud accounts and cross-device sync.</span></div><a href="https://github.com/ayushydv1805/HostelSplit#enable-cloud-mode" target="_blank" rel="noreferrer">Cloud setup guide ↗</a></div>}
          <section className="welcome-copy"><span className="eyebrow">SMART HOSTEL EXPENSE SHARING</span><h1>Split expenses.<br /><span>Keep friendships.</span></h1><p>Know who paid, what everyone owes, and how to settle up with fewer payments. Now with custom splits, receipt scanning, budgets and downloadable reports.</p><div className="welcome-actions"><button className="btn primary large" onClick={() => { setShowGroupForm(true); setGroupNameInput(""); setError(""); }}>＋ Create a group</button><button className="btn secondary large" onClick={() => { setGroup({ id: "demo-" + makeId(), name: "Manali Trip", currency: "INR", monthly_budget: 12000, source: "local" }); const demoMembers = normalizeMembers(["Ayush", "Rahul", "Aman", "Ansh"]); setMembers(demoMembers); setExpenses([{ id: makeId(), name: "Hotel", amount: 4800, paidBy: "Ayush", category: "Hotel", splitType: "equal", date: today(), splits: [{ memberId: "Ayush", amount: 1200 }, { memberId: "Rahul", amount: 1200 }, { memberId: "Aman", amount: 1200 }, { memberId: "Ansh", amount: 1200 }] }, { id: makeId(), name: "Dinner", amount: 1850, paidBy: "Rahul", category: "Food", splitType: "equal", date: today(), splits: [{ memberId: "Ayush", amount: 462.5 }, { memberId: "Rahul", amount: 462.5 }, { memberId: "Aman", amount: 462.5 }, { memberId: "Ansh", amount: 462.5 }] }, { id: makeId(), name: "Taxi", amount: 1200, paidBy: "Aman", category: "Travel", splitType: "equal", date: today(), splits: [{ memberId: "Ayush", amount: 300 }, { memberId: "Rahul", amount: 300 }, { memberId: "Aman", amount: 300 }, { memberId: "Ansh", amount: 300 }] }]); setSettlements([]); setBudgets([]); setNotice("Demo loaded. Try adding an expense or exporting the report."); }}>Explore demo</button></div><div className="trust-row"><span>✓ Local-first privacy</span><span>✓ Minimum-payment settlement</span><span>✓ CSV + PDF reports</span></div></section>
          <section className="welcome-visual"><div className="visual-top"><span className="visual-dot" /><span className="visual-dot" /><span className="visual-dot" /><span className="visual-label">GROUP OVERVIEW</span></div><div className="visual-total"><small>Trip expenses</small><strong>₹8,450</strong><span className="positive-text">● Tracked by category</span></div><div className="visual-bars"><span style={{ width: "78%" }} /><span style={{ width: "48%" }} /><span style={{ width: "29%" }} /></div><div className="visual-members"><span className="avatar">A</span><span className="avatar alt">R</span><span className="avatar yellow">A</span><span className="avatar green">A</span><div><strong>4 members</strong><small>One clear balance sheet</small></div></div><div className="visual-settle"><span>⚡</span><div><strong>Smart settlement</strong><small>Minimum transfers, less confusion</small></div><span className="settle-arrow">→</span></div></section>
          <section className="feature-grid"><div><span>◎</span><h3>Flexible splits</h3><p>Equal shares, exact amounts or percentages.</p></div><div><span>▧</span><h3>Receipt scanner</h3><p>Attach an image and use OCR to suggest the total.</p></div><div><span>↗</span><h3>Budgets and reports</h3><p>Track monthly limits and export CSV or print-ready PDF.</p></div></section>
        </main>
        {error && <div className="floating-message error">{error}</div>}
        {notice && <div className="floating-message success">{notice}</div>}
        {showGroupForm && <div className="modal-backdrop"><form className="modal" onSubmit={handleCreateGroup}><button type="button" className="close-button" onClick={() => setShowGroupForm(false)} aria-label="Close">×</button><span className="eyebrow">NEW GROUP</span><h2>Create your group</h2><p>{cloudSession ? "A private invite code will be created so other users can join." : "Start a local group on this device. Add at least two members."}</p><label>Group name<input value={groupNameInput} onChange={(event) => setGroupNameInput(event.target.value)} required autoFocus maxLength={100} placeholder="e.g. Hostel Room 603" /></label>{!cloudSession && <label>Members, separated by commas<input value={initialMembersInput} onChange={(event) => setInitialMembersInput(event.target.value)} required placeholder="e.g. Ayush, Rahul, Aman" /></label>}{error && <div className="alert error">{error}</div>}<button className="btn primary full" disabled={busy}>{busy ? "Creating…" : "Create group"}</button></form></div>}
      </div>
    );
  }

  const pendingCount = recommendedSettlements.length;
  const paidSettlementCount = settlements.filter((item) => item.status === "paid").length;
  const monthlyBudgetUsage = overallBudget > 0 ? monthlyTotal / overallBudget * 100 : 0;

  return (
    <div className={"app " + (darkMode ? "dark" : "")}>
      <nav className="navbar">
        <a className="brand" href="#" onClick={(event) => event.preventDefault()}><span className="brand-mark">H</span> HostelSplit</a>
        <div className="nav-actions">
          {isCloud && <span className="secure-tag desktop-only">☁ Synced</span>}
          <button className="icon-button" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">{darkMode ? "☀️" : "🌙"}</button>
          {isCloud && <button className="btn secondary desktop-only" onClick={() => { setActiveGroupId(""); setGroup(null); setGroupListVersion((value) => value + 1); }}>All groups</button>}
          {isCloud && <button className="btn secondary desktop-only" onClick={handleLogout}>Sign out</button>}
          <button className="btn secondary" onClick={clearGroup} disabled={busy}>{isCloud && !isGroupOwner ? "Leave group" : "Delete group"}</button>
        </div>
      </nav>
      <main className="page-shell">
        {!cloudConfigured && <div className="cloud-setup-banner dashboard-cloud-banner"><div><strong>Local-only mode</strong><span>Your group is saved in this browser only. Configure Supabase to sign in and synchronize the same group across devices.</span></div><a href="https://github.com/ayushydv1805/HostelSplit#enable-cloud-mode" target="_blank" rel="noreferrer">Enable cloud sync ↗</a></div>}
        <header className="page-heading">
          <div><span className="eyebrow">{isCloud ? "SHARED WORKSPACE" : "LOCAL WORKSPACE"}</span><h1>{group.name}</h1><p>{members.length} members · {expenses.length} expenses · Updated as you go</p></div>
          <div className="heading-actions"><button className="btn secondary" onClick={exportCsv}>↓ Export CSV</button><button className="btn secondary" onClick={exportPdf}>▤ Save PDF</button><button className="btn primary" onClick={() => openNewExpense()}>＋ Add expense</button></div>
        </header>
        {isCloud && <div className="invite-banner"><div><span className="invite-icon">↗</span><div><strong>Invite your group</strong><small>Share this code with a signed-in user to join the same live group.</small></div></div><div className="invite-code">{group.invite_code}<button onClick={() => { navigator.clipboard?.writeText(group.invite_code || "").then(() => setNotice("Invite code copied."), () => setNotice("Invite code: " + group.invite_code)); }} aria-label="Copy invite code">⧉</button></div></div>}
        {error && <div className="alert error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss">×</button></div>}
        {notice && <div className="alert success" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
        {loadingData && <div className="loading-strip">Refreshing shared group data…</div>}
        <section className="stats-grid">
          <article className="stat-card"><div className="stat-top"><span>Total recorded</span><span className="stat-icon purple">↗</span></div><strong>{money(totalSpent, currency)}</strong><small>Across all group expenses</small></article>
          <article className="stat-card"><div className="stat-top"><span>This month</span><span className="stat-icon blue">▦</span></div><strong>{money(monthlyTotal, currency)}</strong><small>{monthlyExpenses.length} expenses in {monthFilter}</small></article>
          <article className="stat-card"><div className="stat-top"><span>Members</span><span className="stat-icon green">♙</span></div><strong>{members.length}</strong><small>{paidSettlementCount} payments marked paid</small></article>
          <article className="stat-card"><div className="stat-top"><span>Payments to settle</span><span className="stat-icon amber">⇄</span></div><strong>{pendingCount}</strong><small>Minimum transfers currently suggested</small></article>
        </section>

        <section className="dashboard-grid">
          <div className="panel">
            <div className="section-heading"><div><h2>Member balances</h2><p>What each person has paid versus their fair share.</p></div><span className="section-symbol">◉</span></div>
            <div className="member-balance-list">
              {members.map((member) => {
                const balance = balances[member.id] || { paid: 0, share: 0, balance: 0 };
                const label = balance.balance > 0.005 ? "Gets back" : balance.balance < -0.005 ? "Owes" : "Settled";
                return <div className="balance-row" key={member.id}><span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span><div className="balance-member"><strong>{member.name}{member.id === (user && user.id) ? " (you)" : ""}</strong><small>Paid {money(balance.paid, currency)} · Share {money(balance.share, currency)}</small></div><div className={"balance-number " + (balance.balance > 0.005 ? "positive-text" : balance.balance < -0.005 ? "negative-text" : "muted")}>{label}<strong>{money(Math.abs(balance.balance), currency)}</strong></div></div>;
              })}
              {!members.length && <EmptyState title="No members yet" body="Add members to start splitting group expenses." />}
            </div>
            {!isCloud && <button className="btn secondary small-button" onClick={() => setShowMemberForm((value) => !value)}>{showMemberForm ? "Close member form" : "＋ Add member"}</button>}
            {showMemberForm && <form className="inline-form" onSubmit={addMember}><input value={memberInput} onChange={(event) => setMemberInput(event.target.value)} placeholder="Member name" required maxLength={80} /><button className="btn primary">Add</button></form>}
          </div>

          <div className="panel">
            <div className="section-heading"><div><h2>Smart settlement</h2><p>Suggested payments to bring everyone close to zero.</p></div><span className="section-symbol">⇄</span></div>
            {recommendedSettlements.length ? <div className="settlement-list">{recommendedSettlements.map((item, index) => {
              const from = members.find((member) => member.id === item.from);
              const to = members.find((member) => member.id === item.to);
              return <div className="settlement-row" key={item.from + "-" + item.to + "-" + index}><div className="settlement-route"><span className="avatar">{(from ? from.name : "?").slice(0, 1)}</span><strong>{from ? from.name : "Member"}</strong><span className="route-arrow">→</span><span className="avatar receiver">{(to ? to.name : "?").slice(0, 1)}</span><strong>{to ? to.name : "Member"}</strong></div><div className="settlement-footer"><strong>{money(item.amount, currency)}</strong><button className="btn primary small-button" onClick={() => recordSettlement(item)} disabled={busy}>Mark paid</button></div></div>;
            })}</div> : <EmptyState icon="✓" title="Everyone is settled" body="There are no pending transfers based on the expenses and recorded payments." />}
          </div>

          <div className="panel budget-panel">
            <div className="section-heading"><div><h2>Monthly budget</h2><p>Monitor the current month and category limits.</p></div>{isGroupOwner ? <button className="text-button" onClick={() => { setBudgetInput(String(overallBudget || "")); setCategoryBudgetInput(String(selectedCategoryBudget?.amount || "")); setShowBudgetForm(true); }}>Edit budgets</button> : <span className="muted tiny">Owner-managed</span>}</div>
            <div className="budget-summary"><div><small>Spent in {monthFilter}</small><strong>{money(monthlyTotal, currency)}</strong></div><div className="budget-target"><small>Budget</small><strong>{overallBudget > 0 ? money(overallBudget, currency) : "Not set"}</strong></div></div>
            {overallBudget > 0 ? <><div className="progress-track"><div className={"progress-fill " + (monthlyBudgetUsage > 100 ? "over-budget" : "")} style={{ width: Math.min(100, monthlyBudgetUsage) + "%" }} /></div><div className="budget-foot"><span>{Math.round(monthlyBudgetUsage)}% used</span><strong className={monthlyBudgetUsage > 100 ? "negative-text" : "positive-text"}>{monthlyBudgetUsage > 100 ? money(monthlyTotal - overallBudget, currency) + " over" : money(overallBudget - monthlyTotal, currency) + " left"}</strong></div></> : <EmptyState icon="◎" title="Set a spending limit" body="Set a group budget and optional category limits to keep costs under control." action={<button className="btn secondary" onClick={() => { setBudgetInput(""); setCategoryBudgetInput(""); setShowBudgetForm(true); }}>Set budget</button>} />}
            <div className="mini-category-list">{CATEGORIES.filter((category) => monthlyCategoryTotals[category]).slice(0, 4).map((category) => {
              const limit = budgets.find((item) => item.category === category && item.month === activeMonthStart);
              const amount = monthlyCategoryTotals[category] || 0;
              return <div className="mini-category" key={category}><span>{CATEGORY_ICONS[category]} {category}</span><strong>{money(amount, currency)}</strong><small>{limit && Number(limit.amount) > 0 ? " / " + money(limit.amount, currency) : ""}</small></div>;
            })}</div>
          </div>

          <div className="panel analytics-panel">
            <div className="section-heading"><div><h2>Spending breakdown</h2><p>Category totals across this group.</p></div><span className="section-symbol">◔</span></div>
            {totalSpent > 0 ? <div className="analytics-list">{Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([category, amount]) => <div className="analytics-row" key={category}><div className="analytics-label"><span>{CATEGORY_ICONS[category] || "📦"} {category}</span><strong>{money(amount, currency)}</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: (amount / totalSpent * 100) + "%" }} /></div><small>{Math.round(amount / totalSpent * 100)}% of total</small></div>)}</div> : <EmptyState icon="◔" title="No spending data yet" body="Add a group expense to see the breakdown." />}
          </div>
        </section>

        <section className="panel expenses-panel">
          <div className="section-heading expenses-heading"><div><h2>Expenses</h2><p>Search the ledger, filter a month, and edit or remove entries.</p></div><button className="btn primary" onClick={() => openNewExpense()}>＋ Add expense</button></div>
          <div className="expense-filters"><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search expenses" placeholder="Search name, category, payer or receipt text…" /><select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)} aria-label="Filter by month"><option value="">All months</option>{Array.from(new Set(expenses.map((expense) => expense.date.slice(0, 7)))).sort().reverse().map((month) => <option key={month} value={month}>{month}</option>)}<option value={new Date().toISOString().slice(0, 7)}>{new Date().toISOString().slice(0, 7)} (current)</option></select><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="Filter by category"><option value="All">All categories</option>{CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}</select></div>
          {filteredExpenses.length ? <div className="expense-table">
            <div className="expense-table-head"><span>Expense</span><span>Paid by</span><span>Date</span><span>Amount</span><span>Actions</span></div>
            {filteredExpenses.map((expense) => {
              const payer = members.find((member) => member.id === expense.paidBy);
              return <div className="expense-table-row" key={expense.id}><div className="expense-name-cell"><span className="expense-icon">{CATEGORY_ICONS[expense.category] || "📦"}</span><div><strong>{expense.name}</strong><small>{expense.category} · {expense.splits.length} split members · {expense.splitType}</small>{expense.receiptPath || expense.receiptDataUrl ? <button className="text-button receipt-link" onClick={() => openReceipt(expense)}>▧ View receipt</button> : null}</div></div><span className="payer-cell">{payer ? payer.name : expense.paidBy}</span><span className="date-cell">{expense.date}</span><strong className="amount-cell">{money(expense.amount, currency)}</strong><div className="row-actions"><button className="icon-action" onClick={() => openNewExpense(expense)} aria-label={"Edit " + expense.name}>✎</button><button className="icon-action danger-action" onClick={() => deleteExpense(expense)} aria-label={"Delete " + expense.name} disabled={busy}>×</button></div></div>;
            })}
          </div> : <EmptyState icon="▤" title={expenses.length ? "No matching expenses" : "No expenses yet"} body={expenses.length ? "Try changing the search or filters." : "Add your first expense to see who owes whom."} action={<button className="btn primary" onClick={() => openNewExpense()}>Add first expense</button>} />}
        </section>

        <section className="panel history-panel">
          <div className="section-heading"><div><h2>Settlement history</h2><p>Recorded payments stay here even after balances change.</p></div><span className="section-symbol">◷</span></div>
          {settlements.length ? <div className="history-list">{settlements.slice().sort((a, b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || ""))).map((item) => {
            const from = members.find((member) => member.id === item.from);
            const to = members.find((member) => member.id === item.to);
            return <div className="history-row" key={item.id}><span className={"history-status " + (item.status === "paid" ? "done" : item.status === "cancelled" ? "cancelled" : "pending")}>{item.status === "paid" ? "✓" : item.status === "cancelled" ? "×" : "…"}</span><div className="history-detail"><strong>{from ? from.name : item.from} → {to ? to.name : item.to}</strong><small>{item.note || "Settlement"} · {String(item.date || item.createdAt || "").slice(0, 10)}</small></div><strong>{money(item.amount, currency)}</strong>{item.status === "paid" && <button className="text-button" onClick={() => undoSettlement(item)}>Undo</button>}</div>;
          })}</div> : <EmptyState icon="◷" title="No settlements recorded" body="When someone pays a suggested transfer, it will appear here." />}
        </section>

        {isCloud && <section className="panel cloud-members-panel"><div className="section-heading"><div><h2>Group members</h2><p>Only signed-in users who have joined the invite code are included.</p></div></div><div className="cloud-member-chips">{members.map((member) => <span className="member-chip" key={member.id}><span className="avatar">{member.name.slice(0, 1)}</span><span>{member.name}</span>{member.role === "owner" && <small>Owner</small>}</span>)}</div></section>}
        <footer className="app-footer"><span>HostelSplit</span><span>{isCloud ? "Cloud-synced group · Supabase row security enabled" : "Offline group · saved in this browser"}</span><span>Expenses are records, not money transfers.</span></footer>
      </main>

      {showExpenseForm && <div className="modal-backdrop"><form className="modal expense-modal" onSubmit={handleSaveExpense}>
        <button type="button" className="close-button" onClick={() => setShowExpenseForm(false)} aria-label="Close">×</button>
        <span className="eyebrow">{editingExpenseId ? "UPDATE LEDGER" : "NEW TRANSACTION"}</span><h2>{editingExpenseId ? "Edit expense" : "Add an expense"}</h2><p>Choose who paid, the people sharing it and how the amount should be split.</p>
        <div className="form-grid"><label className="span-2">Expense name<input value={expenseForm.name} onChange={(event) => updateExpenseField("name", event.target.value)} required maxLength={180} placeholder="e.g. groceries, electricity, dinner" autoFocus /></label><label>Amount ({currency})<input type="number" value={expenseForm.amount} onChange={(event) => updateExpenseField("amount", event.target.value)} min="0.01" step="0.01" required placeholder="0.00" /></label><label>Date<input type="date" value={expenseForm.date} onChange={(event) => updateExpenseField("date", event.target.value)} max="2099-12-31" required /></label><label>Category<select value={expenseForm.category} onChange={(event) => updateExpenseField("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_ICONS[category]} {category}</option>)}</select></label><label>Paid by<select value={expenseForm.paidBy} onChange={(event) => updateExpenseField("paidBy", event.target.value)} required>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label></div>
        <div className="split-section"><div className="split-section-head"><div><h3>Split among</h3><small>Select the people who share this cost.</small></div><label>Split rule<select value={expenseForm.splitType} onChange={(event) => updateExpenseField("splitType", event.target.value)}><option value="equal">Equal split</option><option value="exact">Exact amounts</option><option value="percentage">Percentages</option></select></label></div>
          <div className="split-choice-list">{members.map((member) => <label className="split-choice" key={member.id}><input type="checkbox" checked={expenseForm.selectedMembers.includes(member.id)} onChange={() => toggleSplitMember(member.id)} /><span className="avatar">{member.name.slice(0, 1).toUpperCase()}</span><strong>{member.name}</strong>{expenseForm.splitType !== "equal" && expenseForm.selectedMembers.includes(member.id) && <input className="split-value" type="number" min="0" step={expenseForm.splitType === "percentage" ? "0.01" : "0.01"} value={expenseForm.splitValues[member.id] || ""} onChange={(event) => setExpenseForm((current) => ({ ...current, splitValues: { ...current.splitValues, [member.id]: event.target.value } }))} placeholder={expenseForm.splitType === "percentage" ? "%" : "₹"} aria-label={"Split for " + member.name} />}</label>)}</div>
          {expenseForm.splitType === "percentage" && <small className="hint-text">Percentages must add up to 100%. Amounts are rounded to the nearest paise.</small>}
          {expenseForm.splitType === "exact" && <small className="hint-text">The exact amounts must add up to the expense total.</small>}
        </div>
        <div className="receipt-section"><div><h3>Receipt scan <span className="optional-tag">Optional</span></h3><small>Attach a receipt image. OCR runs in your browser and may need manual correction.</small></div><label className="upload-button">▧ {receiptBusy ? "Scanning…" : "Choose receipt"}<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={(event) => handleReceipt(event.target.files && event.target.files[0])} disabled={receiptBusy} /></label></div>
        {receiptBusy && <div className="ocr-progress"><div className="progress-track"><div className="progress-fill" style={{ width: ocrProgress + "%" }} /></div><small>{ocrProgress ? "Reading text " + ocrProgress + "%" : "Preparing receipt…"}</small></div>}
        {(expenseForm.receiptDataUrl || expenseForm.receiptPath) && <div className="receipt-preview">{expenseForm.receiptDataUrl && <img src={expenseForm.receiptDataUrl} alt="Selected receipt preview" />}{expenseForm.receiptPath && !expenseForm.receiptDataUrl && <span className="receipt-placeholder">▧ Receipt attached to cloud group</span>}<div><strong>{expenseForm.suggestedAmount ? "Suggested total: " + money(expenseForm.suggestedAmount, currency) : "Receipt attached"}</strong>{expenseForm.suggestedAmount && <button type="button" className="text-button" onClick={() => updateExpenseField("amount", String(expenseForm.suggestedAmount))}>Use suggested amount</button>}{expenseForm.receiptText && <details><summary>Extracted text preview</summary><p>{expenseForm.receiptText.slice(0, 1200)}</p></details>}</div><button type="button" className="text-button danger-text" onClick={() => setExpenseForm((current) => ({ ...current, receiptFile: null, receiptDataUrl: "", receiptPath: "", receiptText: "", suggestedAmount: null }))}>Remove</button></div>}
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setShowExpenseForm(false)}>Cancel</button><button type="submit" className="btn primary" disabled={busy || receiptBusy}>{busy ? "Saving…" : editingExpenseId ? "Save changes" : "Save expense"}</button></div>
      </form></div>}

      {showBudgetForm && <div className="modal-backdrop"><form className="modal" onSubmit={saveBudgets}><button type="button" className="close-button" onClick={() => setShowBudgetForm(false)} aria-label="Close">×</button><span className="eyebrow">BUDGET SETTINGS · {monthFilter || "ALL MONTHS"}</span><h2>Monthly spending limits</h2><p>Overall budget plus one category budget for the selected month.</p><label>Group monthly budget ({currency})<input type="number" min="0" step="0.01" value={budgetInput} onChange={(event) => setBudgetInput(event.target.value)} placeholder="0 means no limit" /></label><label>Category<select value={categoryBudgetName} onChange={(event) => { setCategoryBudgetName(event.target.value); const record = budgets.find((item) => item.category === event.target.value && item.month === activeMonthStart); setCategoryBudgetInput(record ? String(record.amount) : ""); }}>{CATEGORIES.filter((category) => category !== "All").map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label>{categoryBudgetName} budget ({currency})<input type="number" min="0" step="0.01" value={categoryBudgetInput} onChange={(event) => setCategoryBudgetInput(event.target.value)} placeholder="0 means no limit" /></label>{error && <div className="alert error">{error}</div>}<div className="modal-actions"><button type="button" className="btn secondary" onClick={() => setShowBudgetForm(false)}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? "Saving…" : "Save budgets"}</button></div></form></div>}
    </div>
  );
}

export default App;
