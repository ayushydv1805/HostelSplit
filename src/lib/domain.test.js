import test from "node:test";
import assert from "node:assert/strict";
import { allocateSplits, calculateBalances, calculateSettlements, normalizeAmount } from "./domain.js";

const closeTo = (actual, expected, message = "") => {
  assert.ok(Math.abs(actual - expected) < 0.001, message || `expected ${actual} to be close to ${expected}`);
};

test("normalizes valid currency to cents and rejects invalid values", () => {
  assert.equal(normalizeAmount("12.349"), 12.35);
  assert.equal(normalizeAmount("0.01"), 0.01);
  assert.equal(normalizeAmount("0"), null);
  assert.equal(normalizeAmount("-3.00"), null);
  assert.equal(normalizeAmount("not money"), null);
  assert.equal(normalizeAmount("1e100"), null);
});

test("equal split allocates remainder pennies deterministically", () => {
  const shares = allocateSplits(10, ["a", "b", "c"], "equal", {});
  assert.deepEqual(shares, [
    { memberId: "a", amount: 3.34 },
    { memberId: "b", amount: 3.33 },
    { memberId: "c", amount: 3.33 },
  ]);
  closeTo(shares.reduce((sum, share) => sum + share.amount, 0), 10);
});

test("equal split rejects empty or invalid expenses", () => {
  assert.throws(() => allocateSplits(10, [], "equal", {}), /at least one person/);
  assert.throws(() => allocateSplits(0, ["a"], "equal", {}), /valid amount/);
});

test("exact split requires the selected shares to sum to the total", () => {
  assert.deepEqual(
    allocateSplits(15, ["a", "b", "c"], "exact", { a: "5", b: "4.25", c: "5.75" }),
    [
      { memberId: "a", amount: 5 },
      { memberId: "b", amount: 4.25 },
      { memberId: "c", amount: 5.75 },
    ],
  );
  assert.throws(() => allocateSplits(15, ["a", "b"], "exact", { a: "5", b: "5" }), /add up exactly/);
  assert.throws(() => allocateSplits(15, ["a", "b"], "exact", { a: "5" }), /valid non-negative/);
});

test("percentage split rounds cents while preserving the exact total", () => {
  const shares = allocateSplits(10, ["a", "b", "c"], "percentage", { a: "33.33", b: "33.33", c: "33.34" });
  assert.deepEqual(shares, [
    { memberId: "a", amount: 3.33 },
    { memberId: "b", amount: 3.33 },
    { memberId: "c", amount: 3.34 },
  ]);
  closeTo(shares.reduce((sum, share) => sum + share.amount, 0), 10);
  assert.throws(() => allocateSplits(10, ["a", "b"], "percentage", { a: "25", b: "25" }), /100%/);
});

test("balances use paid and share cents without floating point drift", () => {
  const members = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const expenses = [{
    amount: 10,
    paidBy: "a",
    splits: [
      { memberId: "a", amount: 3.34 },
      { memberId: "b", amount: 3.33 },
      { memberId: "c", amount: 3.33 },
    ],
  }];
  const balances = calculateBalances(members, expenses, []);
  assert.equal(balances.a.balance, 6.66);
  assert.equal(balances.b.balance, -3.33);
  assert.equal(balances.c.balance, -3.33);
});

test("minimum settlement plan clears member balances with exact cents", () => {
  const balances = {
    a: { balance: 6.66 },
    b: { balance: -3.33 },
    c: { balance: -3.33 },
  };
  const settlements = calculateSettlements(balances);
  assert.deepEqual(settlements, [
    { from: "b", to: "a", amount: 3.33 },
    { from: "c", to: "a", amount: 3.33 },
  ]);
  const remaining = { a: 6.66, b: -3.33, c: -3.33 };
  settlements.forEach(({ from, to, amount }) => {
    remaining[from] = Math.round((remaining[from] + amount) * 100) / 100;
    remaining[to] = Math.round((remaining[to] - amount) * 100) / 100;
  });
  assert.deepEqual(remaining, { a: 0, b: 0, c: 0 });
});

test("paid settlements reduce the outstanding debt in member balances", () => {
  const members = [{ id: "payer" }, { id: "receiver" }];
  const expenses = [{
    amount: 100,
    paidBy: "receiver",
    splits: [
      { memberId: "payer", amount: 50 },
      { memberId: "receiver", amount: 50 },
    ],
  }];
  const balances = calculateBalances(members, expenses, [
    { from: "payer", to: "receiver", amount: 20, status: "paid" },
  ]);
  assert.equal(balances.payer.balance, -30);
  assert.equal(balances.receiver.balance, 30);
});

test("settlement result contains no zero-value transfers", () => {
  const result = calculateSettlements({
    a: { balance: 0.004 },
    b: { balance: -0.004 },
    c: { balance: 0 },
  });
  assert.deepEqual(result, []);
});
