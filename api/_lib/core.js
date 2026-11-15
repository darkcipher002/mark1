/** PropFlow KE — shared server helpers (Vercel serverless). */
const admin = require("firebase-admin");
const crypto = require("crypto");
const B = require("./billing.js");
let webpush = null; try { webpush = require("web-push"); } catch (e) { /* optional */ }

const httpErr = (status, message, code) => Object.assign(new Error(message), { status, code });
const send = (res, status, body) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(body)); };

/* ---------- Firebase Admin (service account from env) ---------- */
function init() {
  if (admin.apps.length) return;
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT || (process.env.FIREBASE_SERVICE_ACCOUNT_B64 ? Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, "base64").toString("utf8") : "");
  if (!raw) throw httpErr(500, "Server is not configured: add FIREBASE_SERVICE_ACCOUNT in Vercel → Settings → Environment Variables.", "not_configured");
  let sa; try { sa = JSON.parse(raw); } catch (e) { throw httpErr(500, "FIREBASE_SERVICE_ACCOUNT is not valid JSON.", "not_configured"); }
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  admin.initializeApp({ credential: admin.credential.cert(sa), storageBucket: process.env.FIREBASE_STORAGE_BUCKET || (sa.project_id ? sa.project_id + ".firebasestorage.app" : undefined) });
}
const db = () => { init(); return admin.firestore(); };
const authAdmin = () => { init(); return admin.auth(); };
const FV = () => admin.firestore.FieldValue;

/* ---------- request helpers ---------- */
async function readBody(req) {
  let raw;
  if (req.body !== undefined && req.body !== null) {
    raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  } else {
    const chunks = []; for await (const c of req) chunks.push(Buffer.from(c)); raw = Buffer.concat(chunks).toString("utf8");
  }
  let json = {}; try { json = raw ? JSON.parse(raw) : {}; } catch (e) { json = {}; }
  return { raw, json };
}
async function bearer(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw httpErr(401, "Sign in required", "unauthenticated");
  try { return await authAdmin().verifyIdToken(token, true); }
  catch (e) { throw httpErr(401, "Your session has expired. Please sign in again.", "unauthenticated"); }
}
/** A landlord = any signed-in user that is NOT a tenant. */
async function landlord(req) { const u = await bearer(req); if (u.role === "tenant") throw httpErr(403, "Not allowed", "forbidden"); return u; }

const nairobiToday = () => { const n = new Date(Date.now() + 3 * 3600 * 1000); return new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
const todayISO = () => B.toISO(nairobiToday());
const nationalPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.startsWith("254") ? "0" + d.slice(3) : d.length === 9 ? "0" + d : d; };
const originOf = (req) => (req.headers.origin && /^https?:/.test(req.headers.origin) ? req.headers.origin : `https://${req.headers["x-forwarded-host"] || req.headers.host}`);
const safeEq = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/* ---------- Paystack ---------- */
async function paystack(path, method, body) {
  const key = process.env.PAYSTACK_SECRET_KEY; if (!key) throw httpErr(500, "Payments are not configured: add PAYSTACK_SECRET_KEY on the server.", "not_configured");
  const r = await fetch("https://api.paystack.co" + path, { method, headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw httpErr(502, j.message || "Paystack error");
  return j.data;
}
const payRef = () => `PF_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
const emailFor = (lease) => lease.email || `${String(lease.phone || "").replace(/\D/g, "") || "tenant"}@tenants.propflow.ke`;

/* ---------- billing for a lease ---------- */
async function evalLease(leaseId, lease) {
  const pays = (await db().collection("payments").where("leaseId", "==", leaseId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const ev = B.evaluate({ ...lease, id: leaseId }, pays, nairobiToday());
  const amount = ev.locked ? 0 : ev.owed > 0 ? ev.owed : ev.nextBalance;
  return { ev, pays, amount };
}

/* ---------- web push + notifications ---------- */
const pushReady = () => !!(webpush && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
async function pushToUid(uid, payload) {
  if (!pushReady()) return 0;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@propflow.app", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  const subs = await db().collection("pushSubs").where("uid", "==", uid).get(); let n = 0;
  await Promise.all(subs.docs.map(async (d) => {
    const s = d.data();
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 86400 }); n++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await d.ref.delete().catch(() => {}); }
  }));
  return n;
}
async function notifyLandlord(ownerId, n) {
  try {
    await db().collection("notifications").add({ ownerId, type: n.type || "info", title: n.title, body: n.body || "", url: n.url || "/dashboard", read: false, createdAt: FV().serverTimestamp() });
    await pushToUid(ownerId, { title: n.title, body: n.body || "", url: n.url || "/dashboard", tag: n.tag });
  } catch (e) { console.error("notifyLandlord", e.message); }
}
async function notifyTenant(uid, leaseId, n) {
  if (!uid) return;
  try {
    await db().collection("tenantNotifications").add({ uid, leaseId, type: n.type || "info", title: n.title, body: n.body || "", url: "/tenant/", read: false, createdAt: FV().serverTimestamp() });
    await pushToUid(uid, { title: n.title, body: n.body || "", url: "/tenant/", tag: n.tag });
  } catch (e) { console.error("notifyTenant", e.message); }
}

/* ---------- record a verified Paystack transaction (idempotent) ---------- */
async function recordPaystack(tx) {
  const md = tx.metadata || {};
  if (tx.status !== "success") throw httpErr(400, "Transaction not successful");
  if (tx.currency !== "KES") throw httpErr(400, "Unexpected currency");
  if (!md.lease_id) throw httpErr(400, "Transaction has no lease_id metadata");
  const leaseSnap = await db().collection("leases").doc(md.lease_id).get();
  if (!leaseSnap.exists) throw httpErr(404, "Lease not found");
  const lease = leaseSnap.data();
  const id = "PAYSTACK_" + String(tx.reference).replace(/[^\w-]/g, "");
  const ref = db().collection("payments").doc(id);
  const existing = await ref.get();
  if (existing.exists) return { id, ...existing.data(), duplicate: true };
  const doc = {
    ownerId: lease.ownerId, leaseId: leaseSnap.id, tenantId: lease.tenantId, tenantName: lease.tenantName,
    propertyId: lease.propertyId || null, houseId: lease.houseId || null, houseLabel: lease.houseLabel || null, roomIds: lease.roomIds || [],
    amount: tx.amount / 100, currency: "KES", type: "RENT", provider: "PAYSTACK", provider_ref: tx.reference, mpesa_receipt: null,
    status: "success", billing_cycle: md.billing_cycle || null, paidAt: todayISO(), verified: true, note: "Paystack payment",
    method: "paystack", reference: tx.reference, createdAt: FV().serverTimestamp()
  };
  await ref.set(doc);
  const amt = B.fmt(doc.amount);
  await notifyLandlord(lease.ownerId, { type: "payment", title: `${lease.tenantName} paid ${amt}`, body: `${lease.houseLabel || ""} · ${lease.roomLabels || ""} — received via Paystack`, url: "/payments", tag: "pay-" + id });
  await notifyTenant(lease.portalUid, leaseSnap.id, { type: "payment", title: "Payment received", body: `We received ${amt}. Thank you!`, tag: "pay-" + id });
  return { id, ...doc };
}

/* ---------- tenant accounts ---------- */
async function requireTenant(req, { allowMustChange = false } = {}) {
  const u = await bearer(req);
  if (u.role !== "tenant") throw httpErr(403, "This area is for tenants.", "forbidden");
  const acctRef = db().collection("tenantAccounts").doc(u.uid), acct = await acctRef.get();
  if (!acct.exists || !acct.data().active) throw httpErr(403, "This account is no longer active.", "account_inactive");
  const a = acct.data();
  const leaseSnap = await db().collection("leases").doc(a.leaseId).get();
  if (!leaseSnap.exists || leaseSnap.data().status !== "ACTIVE") { await deactivateAccount(u.uid, a.leaseId).catch(() => {}); throw httpErr(403, "This account is no longer active.", "account_inactive"); }
  if (a.mustChangePassword && !allowMustChange) throw httpErr(403, "Please set a new password to continue.", "password_change_required");
  return { uid: u.uid, acct: a, leaseId: a.leaseId, lease: leaseSnap.data() };
}
async function deactivateAccount(uid, leaseId) {
  try { await authAdmin().updateUser(uid, { disabled: true }); await authAdmin().revokeRefreshTokens(uid); } catch (e) { /* user may be gone */ }
  await db().collection("tenantAccounts").doc(uid).set({ active: false, deactivatedAt: FV().serverTimestamp() }, { merge: true });
  if (leaseId) await db().collection("leases").doc(leaseId).set({ portalActive: false }, { merge: true });
  const subs = await db().collection("pushSubs").where("uid", "==", uid).get(); await Promise.all(subs.docs.map((d) => d.ref.delete()));
}

module.exports = { admin, B, httpErr, send, db, authAdmin, FV, readBody, bearer, landlord, nairobiToday, todayISO, nationalPhone, originOf, safeEq,
  paystack, payRef, emailFor, evalLease, pushReady, pushToUid, notifyLandlord, notifyTenant, recordPaystack, requireTenant, deactivateAccount };
