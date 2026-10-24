function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function money(value) {
  return "₹" + Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function printFinancialReport({ groupName, members, expenses, balances, settlements, budget, month }) {
  const popup = window.open("", "_blank", "width=920,height=760");
  if (!popup) throw new Error("Your browser blocked the report window. Allow pop-ups for this site and try again.");

  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const categoryTotals = {};
  expenses.forEach((expense) => {
    const key = expense.category || "Other";
    categoryTotals[key] = (categoryTotals[key] || 0) + Number(expense.amount || 0);
  });
  const categoryRows = Object.entries(categoryTotals).map(([category, amount]) =>
    "<tr><td>" + escapeHtml(category) + "</td><td>" + money(amount) + "</td><td>" + (total ? Math.round(amount / total * 100) : 0) + "%</td></tr>"
  ).join("");
  const expenseRows = expenses.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).map((expense) => {
    const splitNames = (expense.splits || []).map((split) => {
      const person = members.find((member) => member.id === split.memberId);
      return person ? person.name : split.memberId;
    }).join(", ");
    const payer = members.find((member) => member.id === expense.paidBy);
    return "<tr><td>" + escapeHtml(expense.date || "") + "</td><td>" + escapeHtml(expense.name) + "</td><td>" + escapeHtml(expense.category) + "</td><td>" + escapeHtml(payer ? payer.name : expense.paidBy) + "</td><td>" + money(expense.amount) + "</td><td>" + escapeHtml(splitNames) + "</td></tr>";
  }).join("");
  const balanceRows = members.map((member) => {
    const balance = balances[member.id] || { balance: 0 };
    const label = balance.balance > 0.005 ? "Gets back" : balance.balance < -0.005 ? "Owes" : "Settled";
    return "<tr><td>" + escapeHtml(member.name) + "</td><td>" + escapeHtml(label) + "</td><td>" + money(Math.abs(balance.balance || 0)) + "</td></tr>";
  }).join("");
  const settlementRows = settlements.map((settlement) => {
    const from = members.find((member) => member.id === settlement.from);
    const to = members.find((member) => member.id === settlement.to);
    return "<tr><td>" + escapeHtml(from ? from.name : settlement.from) + "</td><td>" + escapeHtml(to ? to.name : settlement.to) + "</td><td>" + money(settlement.amount) + "</td></tr>";
  }).join("");

  popup.document.write("<!doctype html><html><head><meta charset='utf-8'><title>" + escapeHtml(groupName) + " — HostelSplit report</title><style>" +
    "body{font-family:Arial,sans-serif;color:#172033;margin:32px;line-height:1.45}h1{margin:0 0 4px}h2{margin:26px 0 10px;font-size:17px}p{color:#667085}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:22px 0}.metric{border:1px solid #dfe4ec;border-radius:10px;padding:14px}.metric small{display:block;color:#667085}.metric strong{display:block;font-size:20px;margin-top:5px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px;border-bottom:1px solid #e4e7ec;text-align:left;vertical-align:top}th{background:#f4f6fa}.foot{margin-top:28px;color:#667085;font-size:11px}@media print{body{margin:12mm}.no-print{display:none}}" +
    "</style></head><body>");
  popup.document.write("<h1>HostelSplit report</h1><p>" + escapeHtml(groupName) + " · " + escapeHtml(month || "All expenses") + " · Generated " + escapeHtml(new Date().toLocaleDateString("en-IN")) + "</p>");
  popup.document.write("<div class='metrics'><div class='metric'><small>Total expenses</small><strong>" + money(total) + "</strong></div><div class='metric'><small>Members</small><strong>" + members.length + "</strong></div><div class='metric'><small>Monthly budget</small><strong>" + (Number(budget) > 0 ? money(budget) : "Not set") + "</strong></div></div>");
  popup.document.write("<h2>Member balances</h2><table><thead><tr><th>Member</th><th>Status</th><th>Balance</th></tr></thead><tbody>" + (balanceRows || "<tr><td colspan='3'>No members</td></tr>") + "</tbody></table>");
  popup.document.write("<h2>Category breakdown</h2><table><thead><tr><th>Category</th><th>Amount</th><th>Share of spend</th></tr></thead><tbody>" + (categoryRows || "<tr><td colspan='3'>No expenses</td></tr>") + "</tbody></table>");
  popup.document.write("<h2>Expenses</h2><table><thead><tr><th>Date</th><th>Expense</th><th>Category</th><th>Paid by</th><th>Amount</th><th>Split members</th></tr></thead><tbody>" + (expenseRows || "<tr><td colspan='6'>No expenses</td></tr>") + "</tbody></table>");
  popup.document.write("<h2>Suggested settlement transfers</h2><table><thead><tr><th>From</th><th>To</th><th>Amount</th></tr></thead><tbody>" + (settlementRows || "<tr><td colspan='3'>Everyone is settled</td></tr>") + "</tbody></table>");
  popup.document.write("<div class='foot'>Prepared by HostelSplit. This report summarizes recorded expenses and is not proof of payment.</div><script>window.addEventListener('load',function(){setTimeout(function(){window.print()},250)})<" + "/script></body></html>");
  popup.document.close();
}
