const assert = require("assert");
const B = require("../public/js/billing.js");
const d = (s) => B.parseISO(s);
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok -", name); };

t("cycle 1 is due on move-in day, then monthly", () => {
  assert.equal(B.toISO(B.dueDate("2026-11-14", 1)), "2026-11-14");
  assert.equal(B.toISO(B.dueDate("2026-11-14", 2)), "2026-12-14");
  assert.equal(B.toISO(B.dueDate("2026-11-14", 4)), "2027-02-14");
});
t("31st clamps to month end (incl. leap year)", () => {
  assert.equal(B.toISO(B.dueDate("2026-01-31", 2)), "2026-02-28");
  assert.equal(B.toISO(B.dueDate("2026-01-31", 3)), "2026-03-31");
  assert.equal(B.toISO(B.dueDate("2027-12-31", 3)), "2028-02-29");
  assert.equal(B.toISO(B.dueDate("2026-01-31", 4)), "2026-04-30");
});
const L = { move_in_date: "2026-10-14", rent: 8500 };
const P0 = { amount: 8500, paidAt: "2026-10-14" }; // first month paid at move-in, alongside the deposit
const ev = (pays, day) => B.evaluate(L, [P0, ...pays], d(day));
t("right after move-in (first month paid) -> PAID", () => {
  const e = ev([], "2026-10-20");
  assert.equal(e.status, "PAID");
});
t("3 days before due -> DUE_SOON", () => {
  const e = ev([], "2026-11-11");
  assert.equal(e.status, "DUE_SOON"); assert.equal(e.daysUntil, 3); assert.equal(e.owed, 8500);
  assert.equal(ev([], "2026-11-10").status, "PAID");
});
t("due today -> DUE_SOON (not overdue)", () => {
  const e = ev([], "2026-11-14");
  assert.equal(e.status, "DUE_SOON"); assert.equal(e.daysUntil, 0);
});
t("day after due -> OVERDUE, 4 days example", () => {
  const e = ev([], "2026-11-18");
  assert.equal(e.status, "OVERDUE"); assert.equal(e.daysLate, 4); assert.equal(e.owed, 8500);
  assert.equal(e.label, "4 days overdue — KSh 8,500");
});
t("partial payment reduces amount owed, days keep counting", () => {
  const e = ev([{ amount: 3000 }], "2026-11-18");
  assert.equal(e.owed, 5500); assert.equal(e.daysLate, 4);
});
t("full payment -> PAID, next cycle not locked until paid", () => {
  const e = ev([{ amount: 8500 }], "2026-11-18");
  assert.equal(e.status, "PAID"); assert.equal(e.locked, false); assert.equal(e.maxPayable, 8500);
});
t("paying next cycle locks it (no duplicate billing)", () => {
  const e = ev([{ amount: 17000 }], "2026-11-18");
  assert.equal(e.locked, true); assert.equal(e.maxPayable, 0); assert.equal(e.status, "PAID");
});
t("early payer inside 3-day window stays PAID", () => {
  const e = ev([{ amount: 8500 }], "2026-11-12");
  assert.equal(e.status, "PAID");
});
t("deposit & failed payments never count as rent", () => {
  const e = ev([{ amount: 8500, type: "DEPOSIT" }, { amount: 8500, status: "failed" }], "2026-11-18");
  assert.equal(e.status, "OVERDUE");
});
t("multi-month arrears", () => {
  const e = ev([], "2027-01-20");
  assert.equal(e.owed, 8500 * 3); assert.equal(e.daysLate, 67);
});
t("ledger running balance + deposit memo", () => {
  const rows = B.ledger(L, [{ amount: 8500, type: "DEPOSIT", paidAt: "2026-10-14" }, P0, { amount: 8500, paidAt: "2026-11-15" }], d("2026-11-20"));
  assert.equal(rows.length, 5);
  assert.equal(rows[0].kind, "DEPOSIT"); assert.equal(rows[0].balance, 0);
  assert.deepEqual(rows.slice(1).map((r) => r.balance), [8500, 0, 8500, 0]);
});
t("move-in day: unpaid first month is due today; paid first month is locked", () => {
  assert.equal(B.evaluate(L, [], d("2026-10-14")).status, "DUE_SOON");
  const e = B.evaluate(L, [P0], d("2026-10-14"));
  assert.equal(e.status, "PAID"); assert.equal(e.locked, true);
  assert.equal(B.toISO(B.evaluate(L, [P0], d("2026-10-15")).nextDue), "2026-11-14");
});
t("catalog prices & whole-house totals", () => {
  assert.equal(B.wholeHouseRent("3BR_TIERED"), 25500);
  assert.equal(B.wholeHouseRent("2BR_FIXED"), 18000);
});
console.log(`\n${n} passed`);

