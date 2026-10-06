import { useEffect, useMemo, useState } from "react";
import "./App.css";

const STORAGE_KEY = "hostelsplit-data";
const THEME_KEY = "hostelsplit-theme";
const CATEGORIES = ["Food", "Travel", "Hotel", "Shopping", "Entertainment", "Other"];
const CATEGORY_ICONS = { Food: "🍔", Travel: "🚕", Hotel: "🏨", Shopping: "🛍️", Entertainment: "🎬", Other: "📦" };

const emptyExpense = { name: "", amount: "", paidBy: "", category: "Food", members: [] };

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadSavedData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return {
      groupName: typeof data.groupName === "string" ? data.groupName : "",
      members: Array.isArray(data.members) ? data.members : [],
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      paidSettlements: Array.isArray(data.paidSettlements) ? data.paidSettlements : [],
    };
  } catch {
    return null;
  }
}

function App() {
  const [saved] = useState(loadSavedData);
  const [groupName, setGroupName] = useState(saved?.groupName || "");
  const [members, setMembers] = useState(saved?.members || []);
  const [expenses, setExpenses] = useState(saved?.expenses || []);
  const [paidSettlements, setPaidSettlements] = useState(saved?.paidSettlements || []);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
  const [showCreate, setShowCreate] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [newMember, setNewMember] = useState("");
  const [searchExpense, setSearchExpense] = useState("");
  const [expenseForm, setExpenseForm] = useState(emptyExpense);

  const groupCreated = Boolean(groupName.trim() && members.length);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light");
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  useEffect(() => {
    if (groupCreated) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ groupName, members, expenses, paidSettlements }));
    }
  }, [groupCreated, groupName, members, expenses, paidSettlements]);

  const totalSpent = useMemo(() => expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0), [expenses]);

  const balances = useMemo(() => {
    const result = Object.fromEntries(members.map((member) => [member, { paid: 0, share: 0, balance: 0 }]));
    expenses.forEach((expense) => {
      const amount = Number(expense.amount || 0);
      const splitMembers = Array.isArray(expense.members) ? expense.members.filter((m) => result[m]) : [];
      if (!splitMembers.length) return;
      if (result[expense.paidBy]) result[expense.paidBy].paid += amount;
      const share = amount / splitMembers.length;
      splitMembers.forEach((member) => { result[member].share += share; });
    });
    Object.values(result).forEach((item) => { item.balance = item.paid - item.share; });
    return result;
  }, [members, expenses]);

  const settlements = useMemo(() => {
    const debtors = Object.entries(balances).filter(([, b]) => b.balance < -0.005).map(([name, b]) => ({ name, amount: -b.balance }));
    const creditors = Object.entries(balances).filter(([, b]) => b.balance > 0.005).map(([name, b]) => ({ name, amount: b.balance }));
    const result = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].amount, creditors[j].amount);
      result.push({ from: debtors[i].name, to: creditors[j].name, amount: Math.round(amount * 100) / 100 });
      debtors[i].amount -= amount;
      creditors[j].amount -= amount;
      if (debtors[i].amount < 0.005) i += 1;
      if (creditors[j].amount < 0.005) j += 1;
    }
    return result;
  }, [balances]);

  const categoryTotals = useMemo(() => {
    const totals = {};
    expenses.forEach((expense) => {
      const category = expense.category || "Other";
      totals[category] = (totals[category] || 0) + Number(expense.amount || 0);
    });
    return totals;
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    const query = searchExpense.trim().toLowerCase();
    return expenses
      .map((expense, index) => ({ expense, index }))
      .filter(({ expense }) => !query || `${expense.name} ${expense.category} ${expense.paidBy}`.toLowerCase().includes(query));
  }, [expenses, searchExpense]);

  const openNewExpense = () => {
    setExpenseForm({ ...emptyExpense, paidBy: members[0] || "", members: [...members] });
    setShowExpense(true);
  };

  const toggleSplitMember = (member) => {
    setExpenseForm((current) => ({
      ...current,
      members: current.members.includes(member) ? current.members.filter((m) => m !== member) : [...current.members, member],
    }));
  };

  const saveExpense = () => {
    const amount = Number(expenseForm.amount);
    if (!expenseForm.name.trim() || !Number.isFinite(amount) || amount <= 0 || !expenseForm.paidBy || !expenseForm.members.length) {
      window.alert("Enter an expense name, valid amount, payer and at least one person to split with.");
      return;
    }
    const expense = { id: makeId(), name: expenseForm.name.trim(), amount, paidBy: expenseForm.paidBy, category: expenseForm.category, members: [...expenseForm.members] };
    setExpenses((current) => [...current, expense]);
    setExpenseForm(emptyExpense);
    setShowExpense(false);
  };

  const openEdit = (expense) => {
    setEditingExpense({ ...expense, amount: String(expense.amount), members: [...expense.members] });
  };

  const saveEdit = () => {
    if (!editingExpense?.name.trim() || Number(editingExpense.amount) <= 0 || !editingExpense.paidBy || !editingExpense.members.length) {
      window.alert("Please enter valid expense details.");
      return;
    }
    setExpenses((current) => current.map((expense) => expense.id === editingExpense.id ? { ...editingExpense, name: editingExpense.name.trim(), amount: Number(editingExpense.amount) } : expense));
    setEditingExpense(null);
  };

  const deleteExpense = (id) => setExpenses((current) => current.filter((expense) => expense.id !== id));

  const addMember = () => {
    const name = newMember.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (members.some((member) => member.toLowerCase() === name.toLowerCase())) {
      window.alert("That member is already in the group.");
      return;
    }
    setMembers((current) => [...current, name]);
    setNewMember("");
  };

  const removeMember = (member) => {
    if (expenses.some((expense) => expense.paidBy === member || expense.members.includes(member))) {
      window.alert("This member is used by an existing expense. Delete or edit those expenses first.");
      return;
    }
    setMembers((current) => current.filter((item) => item !== member));
  };

  const createGroup = () => {
    if (!groupName.trim() || members.length < 2) {
      window.alert("Add a group name and at least 2 members.");
      return;
    }
    setGroupName(groupName.trim());
    setShowCreate(false);
  };

  const clearGroup = () => {
    if (!window.confirm("Delete this group and all its expenses? This cannot be undone.")) return;
    localStorage.removeItem(STORAGE_KEY);
    setGroupName("");
    setMembers([]);
    setExpenses([]);
    setPaidSettlements([]);
    setSearchExpense("");
  };

  const settlementKey = (settlement) => `${settlement.from}|${settlement.to}|${settlement.amount.toFixed(2)}`;
  const togglePaid = (settlement) => {
    const key = settlementKey(settlement);
    setPaidSettlements((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  };

  const startDemo = () => {
    setGroupName("Manali Trip");
    setMembers(["Ayush", "Rahul", "Aman", "Ansh"]);
    setExpenses([
      { id: makeId(), name: "Hotel", amount: 4800, paidBy: "Ayush", category: "Hotel", members: ["Ayush", "Rahul", "Aman", "Ansh"] },
      { id: makeId(), name: "Dinner", amount: 1850, paidBy: "Rahul", category: "Food", members: ["Ayush", "Rahul", "Aman", "Ansh"] },
      { id: makeId(), name: "Taxi", amount: 1200, paidBy: "Aman", category: "Travel", members: ["Ayush", "Rahul", "Aman", "Ansh"] },
      { id: makeId(), name: "Tickets", amount: 600, paidBy: "Ansh", category: "Entertainment", members: ["Ayush", "Rahul", "Ansh"] },
    ]);
    setPaidSettlements([]);
  };

  if (groupCreated) {
    const paidCount = settlements.filter((s) => paidSettlements.includes(settlementKey(s))).length;
    return (
      <div className={`app dashboard-app ${darkMode ? "dark" : ""}`}>
        <nav className="navbar">
          <button className="brand-button" onClick={() => setGroupName("")}><span>💸</span> HostelSplit</button>
          <div className="nav-actions">
            <button className="icon-btn" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">{darkMode ? "☀️" : "🌙"}</button>
            <button className="danger-btn" onClick={clearGroup}>🗑 Clear Group</button>
          </div>
        </nav>

        <main className="dashboard-content">
          <header className="dashboard-header">
            <div><span className="badge">💰 YOUR GROUP</span><h1>{groupName}</h1><p>{members.length} members · {expenses.length} expenses</p></div>
            <button className="primary-btn" onClick={openNewExpense}>＋ Add Expense</button>
          </header>

          <section className="stats-grid">
            <div className="stat-card"><span>💰</span><small>Total Spent</small><h2>{money(totalSpent)}</h2></div>
            <div className="stat-card"><span>👥</span><small>Members</small><h2>{members.length}</h2></div>
            <div className="stat-card"><span>⚡</span><small>Pending Payments</small><h2>{Math.max(0, settlements.length - paidCount)}</h2></div>
          </section>

          <section className="two-column">
            <div className="panel">
              <div className="section-title"><div><h2>💰 Member Balances</h2><span>Live calculation</span></div></div>
              {members.map((member) => {
                const balance = balances[member] || { paid: 0, share: 0, balance: 0 };
                return <div className="balance-item" key={member}>
                  <div className="member-avatar">{member.charAt(0).toUpperCase()}</div>
                  <div className="balance-info"><b>{member}</b><small>Paid {money(balance.paid)} · Share {money(balance.share)}</small></div>
                  <strong className={balance.balance > 0.005 ? "positive" : balance.balance < -0.005 ? "negative" : "neutral"}>{balance.balance > 0.005 ? `Gets ${money(balance.balance)}` : balance.balance < -0.005 ? `Owes ${money(Math.abs(balance.balance))}` : "Settled"}</strong>
                </div>;
              })}
            </div>

            <div className="panel analytics-panel">
              <div className="section-title"><div><h2>📊 Expense Analytics</h2><span>By category</span></div></div>
              {totalSpent === 0 ? <div className="empty-state small"><div>📊</div><p>Add expenses to see your spending breakdown.</p></div> : <>
                <div className="analytics-total"><small>Total spent</small><strong>{money(totalSpent)}</strong></div>
                <div className="category-list">
                  {Object.entries(categoryTotals).map(([category, amount]) => <div className="category-item" key={category}>
                    <span className="category-icon">{CATEGORY_ICONS[category] || "📦"}</span><div className="category-info"><b>{category}</b><div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, (amount / totalSpent) * 100)}%` }} /></div><small>{Math.round((amount / totalSpent) * 100)}%</small></div><strong>{money(amount)}</strong>
                  </div>)}
                </div>
              </>}
            </div>
          </section>

          {settlements.length > 0 && <section className="panel settlement-card">
            <div className="section-title"><div><h2>⚡ Smart Settlement</h2><span>Minimum payments needed to settle everyone</span></div><span>{settlements.length} payments</span></div>
            {settlements.map((settlement) => { const key = settlementKey(settlement); const paid = paidSettlements.includes(key); return <div className={`settlement-item ${paid ? "is-paid" : ""}`} key={key}>
              <div className="settlement-person"><div className="member-avatar">{settlement.from[0]}</div><b>{settlement.from}</b></div><span className="arrow">→</span><div className="settlement-person"><div className="member-avatar">{settlement.to[0]}</div><b>{settlement.to}</b></div><strong>{money(settlement.amount)}</strong><button className="paid-btn" onClick={() => togglePaid(settlement)}>{paid ? "✓ Paid" : "Mark as Paid"}</button>
            </div>; })}
          </section>}

          <section className="panel">
            <div className="section-title expenses-title"><div><h2>🧾 Recent Expenses</h2><span>{expenses.length} expenses</span></div><input className="expense-search" value={searchExpense} onChange={(e) => setSearchExpense(e.target.value)} placeholder="🔎 Search expenses..." /></div>
            {filteredExpenses.length === 0 ? <div className="empty-state"><div>🧾</div><h3>{expenses.length ? "No matching expenses" : "No expenses yet"}</h3><p>{expenses.length ? "Try another search." : "Add your first expense and HostelSplit will calculate everyone's share."}</p>{!expenses.length && <button className="primary-btn" onClick={openNewExpense}>＋ Add First Expense</button>}</div> : <div className="expense-list">
              {filteredExpenses.map(({ expense }) => <div className="expense-item" key={expense.id}>
                <div className="expense-icon">{CATEGORY_ICONS[expense.category] || "🧾"}</div><div className="expense-info"><b>{expense.name}</b><small>{expense.category} · {expense.paidBy} paid {money(expense.amount)}</small><small>Split between {expense.members.length} people</small></div><strong className="expense-amount">{money(expense.amount)}</strong><div className="expense-actions"><button className="ghost-btn" onClick={() => openEdit(expense)}>✏️ Edit</button><button className="ghost-btn danger-text" onClick={() => deleteExpense(expense.id)}>🗑 Delete</button></div>
              </div>)}
            </div>}
          </section>

          <section className="panel members-panel"><div className="section-title"><div><h2>👥 Group Members</h2><span>Manage people in this group</span></div></div><div className="member-management">{members.map((member) => <div className="member-chip" key={member}><span>{member}</span><button onClick={() => removeMember(member)} aria-label={`Remove ${member}`}>×</button></div>)}</div></section>
        </main>

        {showExpense && <ExpenseModal form={expenseForm} setForm={setExpenseForm} members={members} onClose={() => setShowExpense(false)} onSave={saveExpense} toggleMember={toggleSplitMember} />}
        {editingExpense && <ExpenseModal title="Edit Expense" form={editingExpense} setForm={setEditingExpense} members={members} onClose={() => setEditingExpense(null)} onSave={saveEdit} toggleMember={(member) => setEditingExpense((current) => ({ ...current, members: current.members.includes(member) ? current.members.filter((m) => m !== member) : [...current.members, member] }))} />}
      </div>
    );
  }

  return (
    <div className={`app ${darkMode ? "dark" : ""}`}>
      <nav className="navbar"><button className="brand-button"><span>💸</span> HostelSplit</button><button className="icon-btn" onClick={() => setDarkMode((value) => !value)} aria-label="Toggle theme">{darkMode ? "☀️" : "🌙"}</button></nav>
      <main className="hero">
        <div className="hero-content"><span className="badge">✨ Smart Hostel Expense Sharing</span><h1>Split expenses.<br /><span>Stay friends.</span></h1><p>Track hostel, trip and daily group expenses, calculate fair shares and settle up with the minimum number of payments.</p><div className="buttons"><button className="primary-btn" onClick={() => setShowCreate(true)}>＋ Create New Group</button><button className="secondary-btn" onClick={startDemo}>▶ Explore Demo</button></div><div className="trust-row"><span>🔒 Browser-only data</span><span>⚡ Smart settlement</span><span>📊 Expense analytics</span></div></div>
        <div className="hero-card"><div className="card-header"><div><small>TRIP EXPENSES</small><h2>Manali Trip 🏔️</h2></div><span className="members">4 members</span></div><div className="total"><small>Total spent</small><h2>{money(8450)}</h2></div><div className="demo-row"><span><b>Ayush</b><small>Paid ₹3,200</small></span><strong>₹3,200</strong></div><div className="demo-row"><span><b>Rahul</b><small>Paid ₹2,750</small></span><strong>₹2,750</strong></div><div className="demo-row"><span><b>Aman</b><small>Paid ₹2,500</small></span><strong>₹2,500</strong></div><div className="settlement-preview">⚡ <span>Smart Settlement</span><b>2 payments needed</b></div></div>
      </main>
      <section className="features"><div><span>⚡</span><h3>Smart Settlement</h3><p>Reduce the number of payments needed to settle the group.</p></div><div><span>📊</span><h3>Track Expenses</h3><p>Search, edit and understand spending by category.</p></div><div><span>🔒</span><h3>100% Private</h3><p>Your group data stays in your browser using local storage.</p></div></section>
      {showCreate && <div className="modal-overlay"><div className="modal"><button className="close-btn" onClick={() => setShowCreate(false)}>×</button><h2>Create New Group</h2><p>Create a group and add your hostel friends.</p><input autoFocus value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name e.g. Hostel Room 603" /><h3>Add Members</h3><div className="member-input"><input value={newMember} onChange={(e) => setNewMember(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMember()} placeholder="Friend's name" /><button className="add-member-btn" onClick={addMember}>＋</button></div><div className="member-list">{members.map((member) => <div className="member-item" key={member}><span>👤 {member}</span><button onClick={() => removeMember(member)}>×</button></div>)}</div><button className="primary-btn full-btn" onClick={createGroup}>Create Group →</button><small className="hint">Add at least 2 members to start splitting.</small></div></div>}
    </div>
  );
}

function ExpenseModal({ title = "Add Expense", form, setForm, members, onClose, onSave, toggleMember }) {
  return <div className="modal-overlay"><div className="modal"><button className="close-btn" onClick={onClose}>×</button><h2>{title}</h2><p>{title === "Add Expense" ? "Add an expense and choose who shares it." : "Update the expense details."}</p><input autoFocus value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} placeholder="Expense name e.g. Dinner" /><input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))} placeholder="Amount ₹" /><label className="field-label">Category<select value={form.category} onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_ICONS[category]} {category}</option>)}</select></label><label className="field-label">Paid by<select value={form.paidBy} onChange={(e) => setForm((current) => ({ ...current, paidBy: e.target.value }))}><option value="">Select person</option>{members.map((member) => <option key={member} value={member}>{member}</option>)}</select></label><div className="field-label">Split between<div className="split-members">{members.map((member) => <label className="check-row" key={member}><input type="checkbox" checked={form.members.includes(member)} onChange={() => toggleMember(member)} />{member}</label>)}</div></div><button className="primary-btn full-btn" onClick={onSave}>{title === "Add Expense" ? "Add Expense →" : "Save Changes →"}</button></div></div>;
}

export default App;
