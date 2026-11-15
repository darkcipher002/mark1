/** PropFlow KE — single serverless entry: routes every /api/** request. */
const crypto = require("crypto");
const C = require("./core.js");
const { B, httpErr, send, db, authAdmin, FV } = C;

const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = "meta/llama-3.1-8b-instruct";
const ROUTES = {};
const route = (m, p, fn) => (ROUTES[m + " " + p] = fn);

/* =============================== landlord: payments & AI =============================== */
route("POST", "/paystack/verify", async (req, res, ctx) => {
  const user = await C.landlord(req);
  const ref = String(ctx.body.reference || ""); if (!ref) throw httpErr(400, "reference required");
  const tx = await C.paystack("/transaction/verify/" + encodeURIComponent(ref), "GET");
  const lease = await db().collection("leases").doc((tx.metadata || {}).lease_id || "x").get();
  if (!lease.exists || lease.data().ownerId !== user.uid) throw httpErr(403, "Not your transaction");
  return send(res, 200, { payment: await C.recordPaystack(tx) });
});

route("POST", "/paystack/webhook", async (req, res, ctx) => {
  const hash = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "").update(ctx.raw).digest("hex");
  if (!req.headers["x-paystack-signature"] || req.headers["x-paystack-signature"] !== hash) throw httpErr(401, "bad signature");
  if (ctx.body.event === "charge.success") await C.recordPaystack(ctx.body.data);
  return send(res, 200, { ok: true });
});

route("POST", "/ai/chat", async (req, res, ctx) => {
  await C.landlord(req);
  const { messages, temperature, max_tokens } = ctx.body;
  if (!Array.isArray(messages) || !messages.length || messages.length > 6) throw httpErr(400, "Invalid messages");
  if (!process.env.NVIDIA_API_KEY) throw httpErr(503, "AI is not configured on the server.");
  const clean = messages.map((m) => ({ role: ["system", "user", "assistant"].includes(m.role) ? m.role : "user", content: String(m.content || "").slice(0, 2000) }));
  const r = await fetch(NIM_URL, { method: "POST", headers: { Authorization: "Bearer " + process.env.NVIDIA_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ model: NIM_MODEL, messages: clean, temperature: Math.min(Math.max(Number(temperature) || 0, 0), 1), max_tokens: Math.min(Number(max_tokens) || 300, 400), stream: false }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw httpErr(502, String(j.detail || j.error || "AI service error"));
  return send(res, 200, { content: (((j.choices || [])[0] || {}).message || {}).content || "" });
});

/* =============================== public pay link / QR (no login) =============================== */
async function leaseFromToken(l, t) {
  const snap = await db().collection("leases").doc(String(l || "x")).get();
  const lease = snap.exists ? snap.data() : null;
  if (!(lease && lease.status === "ACTIVE" && C.safeEq(String(t || ""), lease.payToken))) throw httpErr(404, "This payment link is not valid.");
  const { ev, amount } = await C.evalLease(snap.id, lease);
  const owner = (await db().collection("users").doc(lease.ownerId).get()).data() || {};
  return { id: snap.id, lease, ev, amount, owner };
}
async function publicPay(req, res, ctx, kind) {
  const { l, t, reference } = ctx.body;
  const x = await leaseFromToken(l, t);
  if (kind === "info") return send(res, 200, { first: String(x.lease.tenantName || "").split(/\s+/)[0], business: x.owner.businessName || "PropFlow KE", house: x.lease.houseLabel, room: x.lease.roomLabels, status: x.ev.status, label: x.ev.label, amount: x.amount, locked: x.ev.locked, nextDue: B.toISO(x.ev.nextDue) });
  if (kind === "init") {
    if (!(x.amount > 0)) throw httpErr(400, "Nothing is due right now — your rent is paid.");
    const data = await C.paystack("/transaction/initialize", "POST", { email: C.emailFor(x.lease), amount: Math.round(x.amount * 100), currency: "KES", reference: C.payRef(),
      callback_url: `${C.originOf(req)}/pay/?l=${encodeURIComponent(l)}&t=${encodeURIComponent(t)}`,
      metadata: { lease_id: x.id, room_id: (x.lease.roomIds || []).join(","), billing_cycle: x.ev.targetCycleKey, owner_id: x.lease.ownerId, tenant_name: x.lease.tenantName } });
    return send(res, 200, { url: data.authorization_url });
  }
  const tx = await C.paystack("/transaction/verify/" + encodeURIComponent(String(reference || "")), "GET");
  if ((tx.metadata || {}).lease_id !== x.id) throw httpErr(403, "That payment does not belong to this link.");
  const p = await C.recordPaystack(tx);
  return send(res, 200, { ok: true, amount: p.amount, reference: p.provider_ref, date: p.paidAt });
}
route("POST", "/public/pay-info", (a, b, c) => publicPay(a, b, c, "info"));
route("POST", "/public/pay-init", (a, b, c) => publicPay(a, b, c, "init"));
route("POST", "/public/pay-verify", (a, b, c) => publicPay(a, b, c, "verify"));

/* =============================== landlord: tenant portal access =============================== */
route("POST", "/landlord/tenant-login", async (req, res, ctx) => {
  const user = await C.landlord(req);
  const snap = await db().collection("leases").doc(String(ctx.body.leaseId || "x")).get();
  if (!snap.exists || snap.data().ownerId !== user.uid) throw httpErr(404, "Tenancy not found");
  const lease = snap.data();
  if (lease.status !== "ACTIVE") throw httpErr(400, "This tenancy has ended.");
  const email = String(ctx.body.email || lease.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw httpErr(400, "Add the tenant's email address first — it is their sign-in name.");
  const password = C.nationalPhone(lease.phone);
  if (password.length < 6) throw httpErr(400, "The tenant's phone number is not valid.");
  let u, created = false;
  try { u = await authAdmin().getUserByEmail(email); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  if (u) {
    const acct = await db().collection("tenantAccounts").doc(u.uid).get();
    if (!acct.exists) throw httpErr(409, "That email is already registered to a different account. Use another email for this tenant.");
    u = await authAdmin().updateUser(u.uid, { password, disabled: false, displayName: lease.tenantName });
  } else { u = await authAdmin().createUser({ email, password, displayName: lease.tenantName, disabled: false }); created = true; }
  await authAdmin().setCustomUserClaims(u.uid, { role: "tenant", ownerId: user.uid, tenantId: lease.tenantId, leaseId: snap.id });
  await authAdmin().revokeRefreshTokens(u.uid);
  const first = String(lease.tenantName || "").trim().split(/\s+/)[0] || "";
  await db().collection("tenantAccounts").doc(u.uid).set({ uid: u.uid, ownerId: user.uid, tenantId: lease.tenantId, leaseId: snap.id, email, firstName: first, fullName: lease.tenantName, phone: lease.phone || null, active: true, mustChangePassword: true, createdAt: FV().serverTimestamp() }, { merge: true });
  await snap.ref.set({ email, portalUid: u.uid, portalEmail: email, portalActive: true }, { merge: true });
  return send(res, 200, { ok: true, created, email });
});

route("POST", "/landlord/tenant-deactivate", async (req, res, ctx) => {
  const user = await C.landlord(req);
  const snap = await db().collection("leases").doc(String(ctx.body.leaseId || "x")).get();
  if (!snap.exists || snap.data().ownerId !== user.uid) throw httpErr(404, "Tenancy not found");
  if (snap.data().portalUid) await C.deactivateAccount(snap.data().portalUid, snap.id);
  return send(res, 200, { ok: true });
});

/* =============================== tenant portal =============================== */
function iso(d) { return d ? B.toISO(d) : null; }
route("POST", "/tenant/me", async (req, res) => {
  const t = await C.requireTenant(req, { allowMustChange: true });
  if (t.acct.mustChangePassword) return send(res, 200, { mustChangePassword: true, first: t.acct.firstName });
  const { ev, pays } = await C.evalLease(t.leaseId, t.lease);
  const owner = (await db().collection("users").doc(t.lease.ownerId).get()).data() || {};
  const today = C.nairobiToday(), k = Math.max(1, B.pastDueCount(t.lease.move_in_date, new Date(today.getTime() + 86400000)));
  const start = B.dueDate(t.lease.move_in_date, k), end = new Date(B.dueDate(t.lease.move_in_date, k + 1).getTime() - 86400000);
  const notes = await db().collection("tenantNotifications").where("uid", "==", t.uid).get();
  const unread = notes.docs.filter((d) => !d.data().read).length;
  const payments = pays.sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt))).map((p) => ({ id: p.id, amount: p.amount, type: p.type || "RENT", paidAt: p.paidAt, billing_cycle: p.billing_cycle || null, provider: p.provider || null, provider_ref: p.provider_ref || null, mpesa_receipt: p.mpesa_receipt || null, status: p.status || "success" }));
  const l = t.lease;
  return send(res, 200, {
    mustChangePassword: false, first: t.acct.firstName, email: t.acct.email, unread,
    landlord: { business: owner.businessName || "PropFlow KE" },
    lease: { id: t.leaseId, tenantName: l.tenantName, phone: l.phone, propertyName: l.propertyName, houseLabel: l.houseLabel, roomLabels: l.roomLabels, mode: l.mode, rent: l.rent, deposit: l.deposit, depositStatus: l.depositStatus || null, move_in_date: l.move_in_date, billingDay: l.billingDay },
    ev: { status: ev.status, tone: ev.tone, label: ev.label, owed: ev.owed, nextBalance: ev.nextBalance, nextDue: iso(ev.nextDue), daysUntil: ev.daysUntil, daysLate: ev.daysLate, locked: ev.locked, maxPayable: ev.maxPayable },
    period: { start: iso(start), end: iso(end) }, payments
  });
});

route("POST", "/tenant/set-password", async (req, res, ctx) => {
  const t = await C.requireTenant(req, { allowMustChange: true });
  const pw = String(ctx.body.newPassword || "");
  if (pw.length < 8) throw httpErr(400, "Use at least 8 characters.");
  if (pw === C.nationalPhone(t.lease.phone) || pw === String(t.lease.phone || "")) throw httpErr(400, "Choose a password different from your phone number.");
  await authAdmin().updateUser(t.uid, { password: pw });
  await db().collection("tenantAccounts").doc(t.uid).set({ mustChangePassword: false, passwordChangedAt: FV().serverTimestamp() }, { merge: true });
  return send(res, 200, { ok: true });
});

route("POST", "/tenant/pay-init", async (req, res) => {
  const t = await C.requireTenant(req);
  const { ev, amount } = await C.evalLease(t.leaseId, t.lease);
  if (!(amount > 0)) throw httpErr(400, "Nothing is due right now — your rent is paid.");
  const data = await C.paystack("/transaction/initialize", "POST", { email: t.acct.email, amount: Math.round(amount * 100), currency: "KES", reference: C.payRef(),
    callback_url: `${C.originOf(req)}/tenant/`, metadata: { lease_id: t.leaseId, room_id: (t.lease.roomIds || []).join(","), billing_cycle: ev.targetCycleKey, owner_id: t.lease.ownerId, tenant_name: t.lease.tenantName } });
  return send(res, 200, { url: data.authorization_url });
});

route("POST", "/tenant/pay-verify", async (req, res, ctx) => {
  const t = await C.requireTenant(req);
  const tx = await C.paystack("/transaction/verify/" + encodeURIComponent(String(ctx.body.reference || "")), "GET");
  if ((tx.metadata || {}).lease_id !== t.leaseId) throw httpErr(403, "That payment does not belong to your account.");
  const p = await C.recordPaystack(tx);
  return send(res, 200, { ok: true, amount: p.amount, reference: p.provider_ref });
});

route("POST", "/tenant/notifications", async (req, res, ctx) => {
  const t = await C.requireTenant(req, { allowMustChange: true });
  const snap = await db().collection("tenantNotifications").where("uid", "==", t.uid).get();
  if (ctx.body.markRead) await Promise.all(snap.docs.filter((d) => !d.data().read).map((d) => d.ref.update({ read: true })));
  const items = snap.docs.map((d) => { const x = d.data(); return { id: d.id, title: x.title, body: x.body, type: x.type, read: ctx.body.markRead ? true : !!x.read, at: x.createdAt && x.createdAt.toDate ? x.createdAt.toDate().toISOString() : null }; })
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 40);
  return send(res, 200, { items });
});

/* =============================== push subscriptions (both sides) =============================== */
route("GET", "/push/key", async (req, res) => send(res, 200, { key: process.env.VAPID_PUBLIC_KEY || null }));
route("POST", "/push/subscribe", async (req, res, ctx) => {
  const u = await C.bearer(req);
  if (u.role === "tenant") await C.requireTenant(req, { allowMustChange: true });
  const s = ctx.body.subscription;
  if (!s || !s.endpoint || !s.keys) throw httpErr(400, "Invalid subscription");
  const id = crypto.createHash("sha256").update(s.endpoint).digest("hex").slice(0, 40);
  await db().collection("pushSubs").doc(id).set({ uid: u.uid, role: u.role === "tenant" ? "tenant" : "landlord", endpoint: s.endpoint, keys: s.keys, createdAt: FV().serverTimestamp() });
  return send(res, 200, { ok: true });
});
route("POST", "/push/unsubscribe", async (req, res, ctx) => {
  const u = await C.bearer(req);
  const ep = (ctx.body.endpoint || ""); if (ep) await db().collection("pushSubs").doc(crypto.createHash("sha256").update(ep).digest("hex").slice(0, 40)).delete().catch(() => {});
  return send(res, 200, { ok: true, uid: u.uid });
});

/* =============================== daily cron: reminders, digests, cleanup, backup =============================== */
route("GET", "/cron/daily", async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw httpErr(500, "Set CRON_SECRET in Vercel environment variables.");
  if (!C.safeEq(req.headers.authorization || "", "Bearer " + secret)) throw httpErr(401, "Unauthorized");
  return send(res, 200, await dailyJob());
});

async function once(key) { try { await db().collection("notifLog").doc(key.replace(/[^\w:-]/g, "_")).create({ at: FV().serverTimestamp() }); return true; } catch (e) { return false; } }

async function dailyJob() {
  const today = C.nairobiToday(), day = B.toISO(today);
  const stats = { leases: 0, tenantNotes: 0, landlordNotes: 0, deactivated: 0 };
  const leases = await db().collection("leases").where("status", "==", "ACTIVE").get();
  const digest = {}; // ownerId -> {due:[], late:[]}
  for (const d of leases.docs) {
    const lease = d.data(); stats.leases++;
    const { ev } = await C.evalLease(d.id, lease);
    const dg = (digest[lease.ownerId] = digest[lease.ownerId] || { due: 0, late: 0, owed: 0, names: [] });
    let key = null, title, body;
    const where = `${lease.houseLabel || ""} · ${lease.roomLabels || ""}`;
    if (ev.status === "OVERDUE") {
      const n = ev.daysLate; dg.late++; dg.owed += ev.owed; dg.names.push(String(lease.tenantName).split(" ")[0]);
      if ([1, 3, 7, 14, 21, 30].includes(n) || (n > 30 && n % 7 === 0)) {
        key = `${d.id}:${ev.targetCycleKey}:late${n}`; title = `Rent is ${n} day${n === 1 ? "" : "s"} overdue`; body = `${B.fmt(ev.owed)} for ${where}. Tap to pay now.`;
        if (n === 1 && (await once(`L:${key}`))) { await C.notifyLandlord(lease.ownerId, { type: "late", title: `${lease.tenantName} is overdue`, body: `${B.fmt(ev.owed)} · ${where}`, url: "/tenants", tag: "late-" + d.id }); stats.landlordNotes++; }
      }
    } else if (ev.status === "DUE_SOON" || (ev.nextBalance > 0 && [7].includes(ev.daysUntil))) {
      if (ev.nextBalance > 0) { dg.due++; }
      const n = ev.daysUntil;
      if ([7, 3, 0].includes(n)) { key = `${d.id}:${ev.nextDueKey}:d${n}`; title = n === 0 ? "Rent is due today" : `Rent due in ${n} days`; body = `${B.fmt(ev.nextBalance)} for ${where} is due ${n === 0 ? "today" : "on " + B.fmtDate(ev.nextDue)}. Tap to pay.`; }
    }
    if (key && lease.portalUid && (await once(`T:${key}`))) { await C.notifyTenant(lease.portalUid, d.id, { type: "due", title, body, tag: "due-" + d.id }); stats.tenantNotes++; }
  }
  for (const [owner, g] of Object.entries(digest)) {
    if (!g.due && !g.late) continue;
    if (!(await once(`D:${owner}:${day}`))) continue;
    const parts = []; if (g.late) parts.push(`${g.late} overdue (${B.fmt(g.owed)})`); if (g.due) parts.push(`${g.due} due within a week`);
    await C.notifyLandlord(owner, { type: "digest", title: "Rent today", body: parts.join(" · "), url: "/dashboard", tag: "digest-" + day }); stats.landlordNotes++;
  }
  // deactivate portal accounts whose tenancy ended
  const ended = await db().collection("leases").where("portalActive", "==", true).get();
  for (const d of ended.docs) if (d.data().status === "ENDED" && d.data().portalUid) { await C.deactivateAccount(d.data().portalUid, d.id); stats.deactivated++; }
  // prune old notifications (90 days)
  const cutoff = new Date(Date.now() - 90 * 86400000);
  for (const col of ["notifications", "tenantNotifications"]) { const old = await db().collection(col).where("createdAt", "<", cutoff).get(); await Promise.all(old.docs.map((x) => x.ref.delete())); }
  // best-effort nightly backup to Cloud Storage (skipped if Storage isn't enabled)
  try {
    const bucket = C.admin.storage().bucket(); const users = await db().collection("users").select("email").get();
    for (const u of users.docs) {
      const out = { app: "PropFlow KE", exportedAt: new Date().toISOString(), uid: u.id, collections: {} };
      for (const c of ["properties", "houses", "rooms", "leases", "tenants", "payments", "maintenance"]) { const s = await db().collection(c).where("ownerId", "==", u.id).get(); out.collections[c] = s.docs.map((x) => ({ id: x.id, ...JSON.parse(JSON.stringify(x.data())) })); }
      await bucket.file(`backups/${day}/${u.id}.json`).save(JSON.stringify(out), { contentType: "application/json" });
    }
    stats.backup = "ok";
  } catch (e) { stats.backup = "skipped: " + (e.message || "").slice(0, 80); }
  return stats;
}

/* =============================== dispatcher =============================== */
module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "http://x");
    const path = url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/";
    const fn = ROUTES[req.method + " " + path];
    if (!fn) return send(res, ROUTES["POST " + path] || ROUTES["GET " + path] ? 405 : 404, { error: "Unknown API route: " + path });
    const ctx = req.method === "GET" ? { body: {}, raw: "" } : await C.readBody(req).then((b) => ({ body: b.json, raw: b.raw }));
    return await fn(req, res, ctx);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error("api error", req.url, e);
    return send(res, e.status || 500, { error: e.status ? e.message : "Server error. Please try again.", code: e.code });
  }
};
module.exports.ROUTES = ROUTES;
module.exports.dailyJob = dailyJob;
