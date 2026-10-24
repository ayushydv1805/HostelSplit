export function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  return cents / 100;
}

export function allocateSplits(amount, selectedIds, splitType = "equal", splitValues = {}) {
  const normalized = normalizeAmount(amount);
  const totalCents = normalized === null ? 0 : Math.round(normalized * 100);
  const selected = Array.isArray(selectedIds) ? [...new Set(selectedIds)] : [];

  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || selected.length === 0) {
    throw new Error("Choose at least one person and enter a valid amount.");
  }
  if (!["equal", "exact", "percentage"].includes(splitType)) {
    throw new Error("Choose a supported split type.");
  }

  if (splitType === "equal") {
    const base = Math.floor(totalCents / selected.length);
    const remainder = totalCents % selected.length;
    return selected.map((memberId, index) => ({
      memberId,
      amount: (base + (index < remainder ? 1 : 0)) / 100,
    }));
  }

  const values = selected.map((memberId) => {
    const raw = splitValues && Object.hasOwn(splitValues, memberId) ? splitValues[memberId] : undefined;
    const value = Number(raw);
    if (raw === undefined || raw === "" || !Number.isFinite(value) || value < 0) {
      throw new Error("Every selected member needs a valid non-negative split value.");
    }
    return value;
  });

  if (splitType === "exact") {
    const cents = values.map((value) => Math.round(value * 100));
    if (cents.some((value) => !Number.isSafeInteger(value))) {
      throw new Error("One of the split amounts is too large.");
    }
    const sum = cents.reduce((total, value) => total + value, 0);
    if (sum !== totalCents) {
      throw new Error("The custom amounts must add up exactly to the expense total.");
    }
    return selected.map((memberId, index) => ({ memberId, amount: cents[index] / 100 }));
  }

  const totalPercent = values.reduce((total, value) => total + value, 0);
  if (!Number.isFinite(totalPercent) || Math.abs(totalPercent - 100) > 0.005) {
    throw new Error("Custom percentages must add up to 100%.");
  }
  const rawCents = values.map((value) => totalCents * value / 100);
  const cents = rawCents.map(Math.floor);
  let remainder = totalCents - cents.reduce((total, value) => total + value, 0);
  const order = rawCents.map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) cents[order[index % order.length].index] += 1;
  return selected.map((memberId, index) => ({ memberId, amount: cents[index] / 100 }));
}

export function calculateBalances(members, expenses, settlements = []) {
  const balanceCents = Object.fromEntries((members || []).map((member) => [
    member.id,
    { paid: 0, share: 0, balance: 0, _paidCents: 0, _shareCents: 0 },
  ]));
  (expenses || []).forEach((expense) => {
    const amountCents = Math.round(Number(expense.amount || 0) * 100);
    if (balanceCents[expense.paidBy] && Number.isSafeInteger(amountCents)) {
      balanceCents[expense.paidBy]._paidCents += amountCents;
    }
    (expense.splits || []).forEach((split) => {
      const cents = Math.round(Number(split.amount || 0) * 100);
      if (balanceCents[split.memberId] && Number.isSafeInteger(cents)) {
        balanceCents[split.memberId]._shareCents += cents;
      }
    });
  });
  (settlements || []).filter((settlement) => settlement.status === "paid").forEach((settlement) => {
    const cents = Math.round(Number(settlement.amount || 0) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return;
    if (balanceCents[settlement.from]) balanceCents[settlement.from]._paidCents += cents;
    if (balanceCents[settlement.to]) balanceCents[settlement.to]._paidCents -= cents;
  });
  Object.values(balanceCents).forEach((item) => {
    item.paid = item._paidCents / 100;
    item.share = item._shareCents / 100;
    item.balance = (item._paidCents - item._shareCents) / 100;
    delete item._paidCents;
    delete item._shareCents;
  });
  return balanceCents;
}

export function calculateSettlements(balances) {
  const debtors = Object.entries(balances || {})
    .filter(([, balance]) => balance.balance < -0.005)
    .map(([id, balance]) => ({ id, cents: Math.round(-balance.balance * 100) }));
  const creditors = Object.entries(balances || {})
    .filter(([, balance]) => balance.balance > 0.005)
    .map(([id, balance]) => ({ id, cents: Math.round(balance.balance * 100) }));
  const result = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const cents = Math.min(debtors[debtorIndex].cents, creditors[creditorIndex].cents);
    if (cents > 0) {
      result.push({
        from: debtors[debtorIndex].id,
        to: creditors[creditorIndex].id,
        amount: cents / 100,
      });
    }
    debtors[debtorIndex].cents -= cents;
    creditors[creditorIndex].cents -= cents;
    if (debtors[debtorIndex].cents <= 0) debtorIndex += 1;
    if (creditors[creditorIndex].cents <= 0) creditorIndex += 1;
  }
  return result;
}
