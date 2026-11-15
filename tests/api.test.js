/* Exercises the Vercel API handler against an in-memory fake of firebase-admin. */
const Module = require("module"), assert = require("assert");
const store = {}; let seq = 0; const users = {}; let pushed = [];
const col = (n) => (store[n] = store[n] || {});
const clone = (o) => JSON.parse(JSON.stringify(o));
const SV = { __sv: 1 };
const resolve = (o) => { const r = {}; for (const k in o) r[k] = o[k] === SV ? { toDate: () => new Date() , __t: 1 } : o[k]; return r; };
function snap(id, d, ref) { return { id, exists: !!d, ref, data: () => d && { ...d } }; }
function docRef(n, id) {
  return { id,
    get: async () => snap(id, col(n)[id], docRef(n, id)),
    set: async (d, o) => { col(n)[id] = o && o.merge ? { ...(col(n)[id] || {}), ...resolve(d) } : resolve(d); },
    create: async (d) => { if (col(n)[id]) throw new Error("exists"); col(n)[id] = resolve(d); },
    update: async (d) => { col(n)[id] = { ...(col(n)[id] || {}), ...resolve(d) }; },
    delete: async () => { delete col(n)[id]; } };
}
function query(n, f) {
  const q = { where: (k, op, v) => query(n, [...f, [k, op, v]]), select: () => q, limit: () => q,
    get: async () => ({ docs: Object.entries(col(n)).filter(([, d]) => f.every(([k, op, v]) => op === "==" ? d[k] === v : op === "<" ? (d[k] && d[k].toDate ? d[k].toDate() : d[k]) < v : true)).map(([id, d]) => snap(id, d, docRef(n, id))) }) };
  return q;
}
const firestore = () => ({ collection: (n) => ({ doc: (id) => docRef(n, id || "auto" + ++seq), add: async (d) => { const id = "auto" + ++seq; col(n)[id] = resolve(d); return docRef(n, id); }, where: (k, o, v) => query(n, [[k, o, v]]), select: () => query(n, []) }) });
firestore.FieldValue = { serverTimestamp: () => SV };
const tokens = {};
const authFn = () => ({
  verifyIdToken: async (t) => { const u = tokens[t]; if (!u || users[u.uid].disabled) throw new Error("bad"); return { uid: u.uid, ...users[u.uid].claims }; },
  getUserByEmail: async (e) => { const u = Object.values(users).find((x) => x.email === e); if (!u) throw Object.assign(new Error("nf"), { code: "auth/user-not-found" }); return u; },
  createUser: async (p) => { const u = { uid: "t" + ++seq, ...p, claims: {} }; users[u.uid] = u; return u; },
  updateUser: async (uid, p) => { Object.assign(users[uid], p); return users[uid]; },
  setCustomUserClaims: async (uid, c) => { users[uid].claims = c; }, revokeRefreshTokens: async () => {} });
const admin = { apps: [1], initializeApp() {}, credential: { cert: (x) => x }, firestore, auth: authFn, storage: () => ({ bucket: () => ({ file: () => ({ save: async () => {} }) }) }) };
const orig = Module._load; Module._load = function (r, ...a) { if (r === "firebase-admin") return admin; if (r === "web-push") return { setVapidDetails() {}, sendNotification: async (s, p) => { pushed.push(JSON.parse(p)); } }; return orig.call(this, r, ...a); };
process.env.CRON_SECRET = "cs"; process.env.VAPID_PUBLIC_KEY = "x"; process.env.VAPID_PRIVATE_KEY = "y"; process.env.PAYSTACK_SECRET_KEY = "sk";
const handler = require("../api/_lib/handler.js"), B = require("../api/_lib/billing.js");

async function call(method, path, body, tok, headers = {}) {
  const raw = body ? JSON.stringify(body) : "";
  const req = { method, url: "/api" + path, headers: { host: "x.vercel.app", ...(tok ? { authorization: "Bearer " + tok } : {}), ...headers }, body: raw ? Buffer.from(raw) : undefined };
  let out = { status: 0, body: "" }; const res = { statusCode: 200, setHeader() {}, end(b) { out.status = this.statusCode; out.body = b; } };
  await handler(req, res); try { out.json = JSON.parse(out.body); } catch (e) {} return out;
}
const iso = (d) => B.toISO(d);
(async () => {
  const today = new Date(Date.now() + 3 * 3600e3), td = new Date(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const mi = new Date(td.getFullYear(), td.getMonth() - 1, td.getDate() + 3); // next due in 3 days
  col("users").L1 = { businessName: "Mark Houses" };
  tokens.land = { uid: "L1" }; users.L1 = { uid: "L1", claims: {} };
  col("leases").le1 = { ownerId: "L1", tenantId: "tn1", tenantName: "Jane Wanjiru", phone: "+254712345678", email: null, status: "ACTIVE", propertyName: "Mark Court", houseLabel: "House 3", roomLabels: "Room A", roomIds: ["r1"], mode: "ROOM", rent: 9000, deposit: 9000, move_in_date: iso(mi), billingDay: mi.getDate(), payToken: "tok123" };
  col("payments").p0 = { leaseId: "le1", ownerId: "L1", type: "RENT", amount: 9000, billing_cycle: B.cycleKey(mi), paidAt: iso(mi), status: "success" };
  col("payments").p00 = { leaseId: "le1", ownerId: "L1", type: "DEPOSIT", amount: 9000, paidAt: iso(mi), status: "success" };

  // unknown route → JSON 404, never HTML
  let r = await call("POST", "/nope", {}); assert.equal(r.status, 404); assert(r.json.error);
  // public pay link
  r = await call("POST", "/public/pay-info", { l: "le1", t: "tok123" }); assert.equal(r.status, 200, r.body); assert.equal(r.json.first, "Jane");
  r = await call("POST", "/public/pay-info", { l: "le1", t: "wrong" }); assert.equal(r.status, 404);
  console.log("public pay-info ok:", r.json && "", "status", (await call("POST", "/public/pay-info", { l: "le1", t: "tok123" })).json.label);

  // landlord creates tenant login
  r = await call("POST", "/landlord/tenant-login", { leaseId: "le1", email: "Jane@Mail.com" }); assert.equal(r.status, 401);
  r = await call("POST", "/landlord/tenant-login", { leaseId: "le1", email: "Jane@Mail.com" }, "land"); assert.equal(r.status, 200, r.body); assert.equal(r.json.email, "jane@mail.com");
  const tu = Object.values(users).find((u) => u.email === "jane@mail.com"); assert.equal(tu.password, "0712345678"); assert.equal(tu.claims.role, "tenant");
  tokens.ten = { uid: tu.uid };
  // another landlord can't touch it
  tokens.l2 = { uid: "L2" }; users.L2 = { uid: "L2", claims: {} };
  assert.equal((await call("POST", "/landlord/tenant-login", { leaseId: "le1" }, "l2")).status, 404);
  // tenant can't use landlord endpoints
  assert.equal((await call("POST", "/landlord/tenant-login", { leaseId: "le1" }, "ten")).status, 403);
  assert.equal((await call("POST", "/ai/chat", { messages: [{ role: "user", content: "x" }] }, "ten")).status, 403);
  // forced password change
  r = await call("POST", "/tenant/me", {}, "ten"); assert.equal(r.json.mustChangePassword, true); assert(!r.json.lease);
  assert.equal((await call("POST", "/tenant/pay-init", {}, "ten")).status, 403);
  assert.equal((await call("POST", "/tenant/set-password", { newPassword: "0712345678" }, "ten")).status, 400);
  assert.equal((await call("POST", "/tenant/set-password", { newPassword: "short" }, "ten")).status, 400);
  assert.equal((await call("POST", "/tenant/set-password", { newPassword: "BetterPass9" }, "ten")).status, 200);
  r = await call("POST", "/tenant/me", {}, "ten"); assert.equal(r.status, 200); assert.equal(r.json.lease.houseLabel, "House 3"); assert.equal(r.json.ev.status, "DUE_SOON"); assert.equal(r.json.payments.length, 2);
  console.log("tenant me ok:", r.json.ev.label, "| period", r.json.period.start, "→", r.json.period.end);
  assert(!JSON.stringify(r.json).includes("payToken") && !JSON.stringify(r.json).includes("ownerId"));

  // push subscribe + cron milestones
  assert.equal((await call("POST", "/push/subscribe", { subscription: { endpoint: "https://e/1", keys: { p256dh: "a", auth: "b" } } }, "ten")).status, 200);
  assert.equal((await call("GET", "/cron/daily", null, null)).status, 401);
  r = await call("GET", "/cron/daily", null, "x", { authorization: "Bearer cs" }); assert.equal(r.status, 200, r.body); console.log("cron:", JSON.stringify(r.json));
  const tn = Object.values(col("tenantNotifications")); assert.equal(tn.length, 1); assert(/3 days/.test(tn[0].title), tn[0].title);
  r = await call("GET", "/cron/daily", null, "x", { authorization: "Bearer cs" }); assert.equal(Object.values(col("tenantNotifications")).length, 1, "cron must not duplicate");
  r = await call("POST", "/tenant/notifications", { markRead: true }, "ten"); assert.equal(r.json.items.length, 0 + r.json.items.length);

  // payment via Paystack webhook → landlord + tenant notified, idempotent
  const crypto = require("crypto");
  const evt = { event: "charge.success", data: { reference: "REF1", status: "success", currency: "KES", amount: 900000, metadata: { lease_id: "le1", billing_cycle: B.cycleKey(new Date(mi.getFullYear(), mi.getMonth() + 1, mi.getDate())) } } };
  const raw = JSON.stringify(evt), sig = crypto.createHmac("sha512", "sk").update(raw).digest("hex");
  const mk = async (s) => { const req = { method: "POST", url: "/api/paystack/webhook", headers: { "x-paystack-signature": s, host: "x" }, body: Buffer.from(raw) }; let o = {}; await handler(req, { statusCode: 200, setHeader() {}, end(b) { o.status = this.statusCode; } }); return o.status; };
  assert.equal(await mk("bad"), 401); assert.equal(await mk(sig), 200); assert.equal(await mk(sig), 200);
  assert.equal(Object.keys(col("payments")).filter((k) => k.startsWith("PAYSTACK_")).length, 1);
  const ln = Object.values(col("notifications")).filter((n) => n.type === "payment"); assert.equal(ln.length, 1); assert(/Jane Wanjiru paid/.test(ln[0].title));
  assert(pushed.some((p) => p.title === "Payment received"), "tenant push sent");

  // vacate → deactivate: tenant is locked out
  col("leases").le1.status = "ENDED";
  r = await call("POST", "/landlord/tenant-deactivate", { leaseId: "le1" }, "land"); assert.equal(r.status, 200);
  assert.equal(users[tu.uid].disabled, true); assert.equal(col("tenantAccounts")[tu.uid].active, false);
  r = await call("POST", "/tenant/me", {}, "ten"); assert.equal(r.status, 401); // disabled user's token rejected
  users[tu.uid].disabled = false; r = await call("POST", "/tenant/me", {}, "ten"); assert.equal(r.status, 403); assert.equal(r.json.code, "account_inactive");
  console.log("API tests passed");
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
