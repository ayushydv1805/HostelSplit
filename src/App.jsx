import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [showCreate, setShowCreate] = useState(false);
 // const [darkMode, setDarkMode] = useState(false);
 //const [paidSettlements, setPaidSettlements] = useState([]);
 const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState([]);
  const [newMember, setNewMember] = useState("");
  const [groupCreated, setGroupCreated] = useState(false);
const [showExpense, setShowExpense] = useState(false);
const [expenseName, setExpenseName] = useState("");
const [expenseAmount, setExpenseAmount] = useState("");
const [paidBy, setPaidBy] = useState("");
const [selectedMembers, setSelectedMembers] = useState([]);
const [expenses, setExpenses] = useState([]);
const [paidSettlements, setPaidSettlements] = useState([]);
const [darkMode, setDarkMode] = useState(false);
const [expenseCategory, setExpenseCategory] = useState("Food");
const [searchExpense, setSearchExpense] = useState("");
const [editingExpense, setEditingExpense] = useState(null);
useEffect(() => {
  const savedData = localStorage.getItem("splitbill-data");

  if (savedData) {
    const data = JSON.parse(savedData);

    setGroupName(data.groupName || "");
    setMembers(data.members || []);
    setExpenses(data.expenses || []);
setPaidSettlements(data.paidSettlements || []);
    if (data.groupName) {
      setGroupCreated(true);
    }
  }
}, []);
useEffect(() => {
  localStorage.setItem("darkMode", darkMode);
}, [darkMode]);
useEffect(() => {
  if (groupCreated) {
   localStorage.setItem(
  "splitbill-data",
  JSON.stringify({
    groupName,
    members,
    expenses,
    paidSettlements
  })
);
  }
}, [
  groupCreated,
  groupName,
  members,
  expenses,
  paidSettlements
]);
const getBalances = () => {
  const balances = {};

  members.forEach((member) => {
    balances[member] = {
      paid: 0,
      share: 0,
      balance: 0
    };
  });
const getMemberSpent = (memberName) => {
  return expenses
    .filter((expense) => expense.paidBy === memberName)
    .reduce(
      (total, expense) => total + Number(expense.amount),
      0
    );
};
  expenses.forEach((expense) => {
    const share =
      expense.amount / expense.members.length;

    if (balances[expense.paidBy]) {
      balances[expense.paidBy].paid += expense.amount;
    }

    expense.members.forEach((member) => {
      if (balances[member]) {
        balances[member].share += share;
      }
    });
  });

  Object.keys(balances).forEach((member) => {
    balances[member].balance =
      balances[member].paid -
      balances[member].share;
  });

  return balances;
};
const getSettlements = () => {
  const balances = {};

  members.forEach((member) => {
    balances[member] = 0;
  });

  expenses.forEach((expense) => {
    const share = expense.amount / expense.members.length;

    expense.members.forEach((member) => {
      balances[member] -= share;
    });

    balances[expense.paidBy] += expense.amount;
  });

  const creditors = [];
  const debtors = [];

  Object.entries(balances).forEach(([name, balance]) => {
    if (balance > 0.01) {
      creditors.push({
        name,
        amount: balance
      });
    } else if (balance < -0.01) {
      debtors.push({
        name,
        amount: -balance
      });
    }
  });

  const settlements = [];

  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(
      debtors[i].amount,
      creditors[j].amount
    );

    settlements.push({
      from: debtors[i].name,
      to: creditors[j].name,
      amount: Math.round(amount)
    });

    debtors[i].amount -= amount;
    creditors[j].amount -= amount;

    if (debtors[i].amount < 0.01) {
      i++;
    }

    if (creditors[j].amount < 0.01) {
      j++;
    }
  }

  return settlements;
};
const getMemberSpent = (memberName) => {
  return expenses
    .filter((expense) => expense.paidBy === memberName)
    .reduce(
      (total, expense) => total + Number(expense.amount),
      0
    );
};
const getCategoryTotals = () => {
  const totals = {};

  expenses.forEach((expense) => {
    const category = expense.category || "Other";

    if (!totals[category]) {
      totals[category] = 0;
    }

    totals[category] += Number(expense.amount);
  });

  return totals;
};
const getChartGradient = () => {
  const totals = getCategoryTotals();

  const total = Object.values(totals).reduce(
    (sum, amount) => sum + amount,
    0
  );

  if (total === 0) {
    return "#e5e7eb 0deg 360deg";
  }

  const colors = {
    Food: "#635bff",
    Travel: "#22c55e",
    Hotel: "#f59e0b",
    Shopping: "#ec4899",
    Entertainment: "#8b5cf6",
    Other: "#ef4444"
  };

  let currentDegree = 0;

  return Object.entries(totals)
    .map(([category, amount]) => {
      const degree = (amount / total) * 360;

      const start = currentDegree;
      const end = currentDegree + degree;

      currentDegree = end;

      return `${colors[category] || colors.Other} ${start}deg ${end}deg`;
    })
    .join(", ");
};
  // DASHBOARD
  if (groupCreated) {
    return (
      <div className="dashboard">

        <nav className="navbar">
          <div className="logo">
            <span>💸</span> SplitBill
          </div>
<div className="nav-actions">

  <button
  className="theme-btn"
  onClick={() => setDarkMode(!darkMode)}
>
  {darkMode ? "☀️" : "🌙"}
</button>

  <button
    className="clear-btn"
    onClick={() => {
      const confirmClear = window.confirm(
        "Are you sure you want to delete this group and all expenses?"
      );

      if (confirmClear) {
        localStorage.removeItem("splitbill-data");

        setGroupName("");
        setMembers([]);
        setExpenses([]);
        setGroupCreated(false);
      }
    }}
  >
    🗑️ Clear Group
  </button>

</div>
        </nav>

        <main className="dashboard-content">

          <div className="dashboard-header">
            <div>
              <span className="badge">
                💰 YOUR GROUP
              </span>

              <h1>{groupName}</h1>

              <p>
                {members.length} members · Start adding expenses
              </p>
            </div>

            <button
  className="primary-btn"
  onClick={() => setShowExpense(true)}
>
  + Add Expense
</button>
          </div>

          <div className="stats-grid">

            <div className="stat-card">
  <span>⚡</span>
  <small>Settlements</small>
  <h2>{getSettlements().length}</h2>
</div>

            <div className="stat-card">
              <span>👥</span>
              <small>Members</small>
              <h2>{members.length}</h2>
            </div>

            <div className="stat-card">
              <span>⚡</span>
              <small>Settlements</small>
              <h2>0</h2>
            </div>

          </div>
<div className="members-card analytics-card">

  <div className="section-title">
    <h2>📊 Expense Analytics</h2>
    <span>By Category</span>
  </div>

  {Object.entries(getCategoryTotals()).length === 0 ? (
    <p className="analytics-empty">
      Add expenses to see your spending breakdown.
    </p>
  ) : (
    <>
      <div className="analytics-total">
        <small>Total Spent</small>
        <h2>
          ₹
          {Object.values(getCategoryTotals()).reduce(
            (total, amount) => total + amount,
            0
          )}
        </h2>
      </div>
<div className="analytics-chart">

  <div
  className="donut-chart"
  style={{
    background: `conic-gradient(${getChartGradient()})`
  }}
>
    <div className="donut-center">
      <small>Total</small>
      <b>
        ₹
        {Object.values(getCategoryTotals()).reduce(
          (total, amount) => total + amount,
          0
        )}
      </b>
    </div>
  </div>

  <div className="chart-legend">

    <div>
      <span className="legend-dot food-dot"></span>
      Food
    </div>

    <div>
      <span className="legend-dot travel-dot"></span>
      Travel
    </div>

    <div>
      <span className="legend-dot hotel-dot"></span>
      Hotel
    </div>

    <div>
      <span className="legend-dot other-dot"></span>
      Other
    </div>

  </div>

</div>
      <div className="category-list">

        {Object.entries(getCategoryTotals()).map(
          ([category, amount]) => {

            const total = Object.values(
              getCategoryTotals()
            ).reduce(
              (sum, value) => sum + value,
              0
            );

            const percentage =
              total > 0
                ? Math.round((amount / total) * 100)
                : 0;

            return (
              <div
                className="category-item"
                key={category}
              >

                <div className="category-info">

                  <span>
                    {category === "Food" && "🍔"}
                    {category === "Travel" && "🚕"}
                    {category === "Hotel" && "🏨"}
                    {category === "Shopping" && "🛍️"}
                    {category === "Entertainment" && "🎬"}
                    {category === "Other" && "📦"}
                  </span>

                  <div>
                    <b>{category}</b>

                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${percentage}%`
                        }}
                      />
                    </div>

                    <small>
                      {percentage}% of total
                    </small>
                  </div>

                </div>

                <strong>
                  ₹{Math.round(amount)}
                </strong>

              </div>
            );
          }
        )}

      </div>
    </>
  )}

</div>

  
            

          <div className="members-card">

            <div className="section-title">
              <h2>Group Members</h2>
              <span>
                {members.length} people
              </span>
            </div>

            {members.map((member, index) => (
              <div
                className="dashboard-member"
                key={index}
              >

                <div className="member-avatar">
                  {member.charAt(0).toUpperCase()}
                </div>

                <div>
  <b>{member}</b>

  <small>
    ₹{Math.round(getMemberSpent(member))} spent
  </small>
</div>

<strong>
  ₹{Math.round(getMemberSpent(member))}
</strong>

              </div>
            ))}

          </div>
          <div className="members-card balance-card">

  <div className="section-title">
    <h2>💰 Member Balances</h2>
    <span>Live calculation</span>
  </div>

  {members.map((member, index) => {
    const balance = getBalances()[member];

    return (
      <div className="balance-item" key={index}>

        <div className="member-avatar">
          {member.charAt(0).toUpperCase()}
        </div>

        <div className="balance-info">
          <b>{member}</b>

          <div className="balance-details">
            <span>
              Paid ₹{Math.round(balance.paid)}
            </span>

            <span>
              Share ₹{Math.round(balance.share)}
            </span>
          </div>
        </div>

        <div
          className={
            balance.balance > 0.01
              ? "balance-positive"
              : balance.balance < -0.01
              ? "balance-negative"
              : "balance-zero"
          }
        >
          {balance.balance > 0.01
            ? `Gets ₹${Math.round(balance.balance)}`
            : balance.balance < -0.01
            ? `Owes ₹${Math.round(
                Math.abs(balance.balance)
              )}`
            : "Settled"}
        </div>

      </div>
    );
  })}

</div>
{expenses.length > 0 && (
  <div className="members-card expenses-section">
{getSettlements().length > 0 && (
  <div className="members-card settlement-card">

    <div className="section-title">
      <h2>⚡ Smart Settlement</h2>

      <span>
        {getSettlements().length} payments
      </span>
    </div>

    <p className="settlement-subtitle">
      Minimum payments needed to settle everyone.
    </p>

    {getSettlements().map((settlement, index) => (
      <div
        className="settlement-item"
        key={index}
      >

        <div className="settlement-person">
          <div className="member-avatar">
            {settlement.from.charAt(0).toUpperCase()}
          </div>

          <b>{settlement.from}</b>
        </div>

        <div className="settlement-arrow">
          →
        </div>

        <div className="settlement-person">
          <div className="member-avatar">
            {settlement.to.charAt(0).toUpperCase()}
          </div>

          <b>{settlement.to}</b>
        </div>

        <strong>
          ₹{settlement.amount}
        </strong>
<strong>₹{Math.round(settlement.amount)}</strong>
<button
  className="paid-btn"
  onClick={() => {
    setPaidSettlements([
      ...paidSettlements,
      index
    ]);
  }}
  disabled={paidSettlements.includes(index)}
>
  {paidSettlements.includes(index)
    ? "✓ Paid"
    : "Mark as Paid"}
</button>
      </div>
    ))}

  </div>
)}
    <div className="section-title">
      <div className="expenses-header">
  <h2>Recent Expenses</h2>

  <input
    type="text"
    className="expense-search"
    placeholder="🔎 Search expenses..."
    value={searchExpense}
    onChange={(e) => setSearchExpense(e.target.value)}
  />
</div>
      <span>{expenses.length} expenses</span>
    </div>

    {expenses
  .filter((expense) =>
    expense.name
      .toLowerCase()
      .includes(searchExpense.toLowerCase())
  )
  .map((expense, index) => (
      <div className="expense-item" key={index}>

        <div className="expense-icon">
          🧾
        </div>

        <div className="expense-info">

  <b>{expense.name}</b>
<small className="expense-category">
  {expense.category}
</small>
  <small>
    {expense.category} · {expense.paidBy} paid ₹{expense.amount}
  </small>

  <small>
    Split between {expense.members.length} people
  </small>

</div>
        <div className="expense-actions">

  <div className="expense-amount">
    ₹{expense.amount}
  </div>
<button
  className="delete-btn"
  onClick={() => {
    setExpenses(
      expenses.filter((_, i) => i !== index)
    );
  }}
>
  🗑 Delete
</button>
<button
  className="edit-expense-btn"
  onClick={() => setEditingExpense(index)}
>
  ✏️
</button>
  <button
    className="delete-expense-btn"
    onClick={() => {
      const updatedExpenses = expenses.filter(
        (_, i) => i !== index
      );

      setExpenses(updatedExpenses);
    }}
  >
    🗑️
  </button>

</div>

      </div>
    ))}

  </div>
)}
          <div className="empty-expense">

            <div className="empty-icon">
              🧾
            </div>

            <h2>No expenses yet</h2>

            <p>
              Add your first expense and SplitBill will
              automatically calculate everyone's share.
            </p>

            <button
  className="primary-btn"
  onClick={() => setShowExpense(true)}
>
  + Add First Expense
</button>
          </div>

                </main>

        {/* EXPENSE MODAL */}

        {showExpense && (
          <div className="modal-overlay">

            <div className="modal">

              <button
                className="close-btn"
                onClick={() => setShowExpense(false)}
              >
                ✕
              </button>

              <h2>Add Expense</h2>

              <p>
                Add an expense and split it with your group.
              </p>

              <input
                type="text"
                placeholder="Expense name e.g. Dinner"
                value={expenseName}
                onChange={(e) => setExpenseName(e.target.value)}
              />

              <input
                type="number"
                placeholder="Amount ₹"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
              />
<h3>Category</h3>

<select
  value={expenseCategory}
  onChange={(e) => setExpenseCategory(e.target.value)}
>
  <option value="Food">🍔 Food</option>
  <option value="Travel">🚕 Travel</option>
  <option value="Hotel">🏨 Hotel</option>
  <option value="Shopping">🛍️ Shopping</option>
  <option value="Entertainment">🎬 Entertainment</option>
  <option value="Other">📦 Other</option>
</select>
              <h3>Paid by</h3>

              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
              >
                <option value="">Select person</option>

                {members.map((member, index) => (
                  <option key={index} value={member}>
                    {member}
                  </option>
                ))}
              </select>

              <h3>Split between</h3>

              <div className="split-members">

                {members.map((member, index) => (
                  <label key={index}>

                    <input
                      type="checkbox"
                      checked={selectedMembers.includes(member)}
                      onChange={() => {
                        if (selectedMembers.includes(member)) {
                          setSelectedMembers(
                            selectedMembers.filter(
                              (m) => m !== member
                            )
                          );
                        } else {
                          setSelectedMembers([
                            ...selectedMembers,
                            member
                          ]);
                        }
                      }}
                    />

                    {member}

                  </label>
                ))}

              </div>

              <button
                className="primary-btn full-btn"
                onClick={() => {

                  if (
                    expenseName.trim() !== "" &&
                    Number(expenseAmount) > 0 &&
                    paidBy !== "" &&
                    selectedMembers.length > 0
                  ) {

                    const newExpense = {
                      name: expenseName,
                      amount: Number(expenseAmount),
                      paidBy: paidBy,
                      category: expenseCategory,
                      members: selectedMembers,
                      share:
                        Number(expenseAmount) /
                        selectedMembers.length
                    };

                    setExpenses([
                      ...expenses,
                      newExpense
                    ]);

                    setExpenseName("");
                    setExpenseAmount("");
                    setPaidBy("");
                    setExpenseCategory("Food");
                    setSelectedMembers([]);
                    setShowExpense(false);
                  }

                }}
              >
                Add Expense →
              </button>

            </div>

          </div>
        )}
{editingExpense !== null && (
  <div className="modal-overlay">
    <div className="modal">

      <button
        className="close-btn"
        onClick={() => setEditingExpense(null)}
      >
        ✕
      </button>

      <h2>Edit Expense</h2>

      <p>
        Update the expense details.
      </p>

      <input
        type="text"
        placeholder="Expense name"
        value={expenses[editingExpense]?.name || ""}
        onChange={(e) => {
          const updatedExpenses = [...expenses];

          updatedExpenses[editingExpense] = {
            ...updatedExpenses[editingExpense],
            name: e.target.value
          };

          setExpenses(updatedExpenses);
        }}
      />

      <input
        type="number"
        placeholder="Amount"
        value={expenses[editingExpense]?.amount || ""}
        onChange={(e) => {
          const updatedExpenses = [...expenses];

          updatedExpenses[editingExpense] = {
            ...updatedExpenses[editingExpense],
            amount: Number(e.target.value)
          };

          setExpenses(updatedExpenses);
        }}
      />

      <button
  className="primary-btn full-btn"
  onClick={() => {
    const expense = expenses[editingExpense];

    if (
      expense.name.trim() === "" ||
      Number(expense.amount) <= 0
    ) {
      alert("Please enter a valid expense name and amount.");
      return;
    }

    setEditingExpense(null);
  }}
>
  Save Changes →
</button>

    </div>
  </div>
)}
      </div>
    );
  }

  // HOME PAGE
  return (
    <div className={darkMode ? "app dark" : "app"}>

      <nav className="navbar">

        <div className="logo">
          <span>💸</span> SplitBill
        </div>

        <button
  className="theme-btn"
  onClick={() => setDarkMode(!darkMode)}
>
  {darkMode ? "☀️" : "🌙"}
</button>

      </nav>

      <main className="hero">

        <div className="hero-content">

          <span className="badge">
            ✨ Smart Expense Sharing
          </span>

          <h1>
            Split expenses.
            <br />
            <span>Stay friends.</span>
          </h1>

          <p>
            Easily divide bills, track group expenses and
            know exactly who owes whom.
          </p>

          <div className="buttons">

            <button
              className="primary-btn"
              onClick={() => setShowCreate(true)}
            >
              + Create New Group
            </button>

            <button className="secondary-btn">
              Explore Demo
            </button>

          </div>

        </div>

        <div className="expense-card">

          <div className="card-header">

            <div>
              <small>TRIP EXPENSES</small>
              <h2>Manali Trip 🏔️</h2>
            </div>

            <span className="members">
              4 members
            </span>

          </div>

          <div className="total">
            <small>Total spent</small>
            <h1>₹8,450</h1>
          </div>

          <div className="expense-row">

            <div className="person">

              <div className="avatar">
                A
              </div>

              <div>
                <b>Ayush</b>
                <small>Paid ₹3,200</small>
              </div>

            </div>

            <span>₹3,200</span>

          </div>

          <div className="expense-row">

            <div className="person">

              <div className="avatar">
                R
              </div>

              <div>
                <b>Rahul</b>
                <small>Paid ₹2,750</small>
              </div>

            </div>

            <span>₹2,750</span>

          </div>

          <div className="expense-row">

            <div className="person">

              <div className="avatar">
                A
              </div>

              <div>
                <b>Aman</b>
                <small>Paid ₹2,500</small>
              </div>

            </div>

            <span>₹2,500</span>

          </div>

          <div className="settlement">
            <span>⚡ Settlement</span>
            <b>2 payments needed</b>
          </div>

        </div>

      </main>

      <section className="features">

        <div>
          <span>⚡</span>
          <h3>Smart Settlement</h3>
          <p>
            Minimum payments to settle everyone.
          </p>
        </div>

        <div>
          <span>📊</span>
          <h3>Track Expenses</h3>
          <p>
            See exactly where your money goes.
          </p>
        </div>

        <div>
          <span>🔒</span>
          <h3>100% Private</h3>
          <p>
            Your data stays in your browser.
          </p>
        </div>

      </section>

      {/* CREATE GROUP MODAL */}

      {showCreate && (
        <div className="modal-overlay">

          <div className="modal">

            <button
              className="close-btn"
              onClick={() => setShowCreate(false)}
            >
              ✕
            </button>

            <h2>
              Create New Group
            </h2>

            <p>
              Create a group and add your friends.
            </p>

            <input
              type="text"
              placeholder="Group name e.g. Manali Trip"
              value={groupName}
              onChange={(e) =>
                setGroupName(e.target.value)
              }
            />

            <h3>
              Add Members
            </h3>

            <div className="member-input">

              <input
                type="text"
                placeholder="Friend's name"
                value={newMember}
                onChange={(e) =>
                  setNewMember(e.target.value)
                }
              />

              <button
                className="add-member-btn"
                onClick={() => {

                  if (newMember.trim() !== "") {

                    setMembers([
                      ...members,
                      newMember.trim()
                    ]);

                    setNewMember("");
                  }

                }}
              >
                +
              </button>

            </div>

            <div className="member-list">

              {members.map((member, index) => (

                <div
                  className="member-item"
                  key={index}
                >

                  <span>
                    👤 {member}
                  </span>

                  <button
                    onClick={() =>
                      setMembers(
                        members.filter(
                          (_, i) => i !== index
                        )
                      )
                    }
                  >
                    ✕
                  </button>

                </div>

              ))}

            </div>

            <button
              className="primary-btn full-btn"
              onClick={() => {

                if (
                  groupName.trim() !== "" &&
                  members.length > 0
                ) {
                  setGroupCreated(true);
                  setShowCreate(false);
                }

              }}
            >
              Create Group →
            </button>

          </div>

        </div>
      )}

    </div>
  );
}

export default App;