/* PropFlow KE — Firebase bootstrap, shared helpers & performance layer */
const firebaseConfig = {
  apiKey: "AIzaSyDhakDIUgpD5OlJi2I0DE0axe8J7DYN9X4",
  authDomain: "isproj-f0bf2.firebaseapp.com",
  projectId: "isproj-f0bf2",
  storageBucket: "isproj-f0bf2.firebasestorage.app",
  messagingSenderId: "916554340072",
  appId: "1:916554340072:web:2b258a64c309258864db5d",
  measurementId: "G-4YK4CPH63G"
};

// Public (publishable) Paystack key — safe in the browser. The SECRET key lives only in Cloud Functions.
const PAYSTACK_PUBLIC_KEY = "pk_live_48b4fa868492ff7b8639123afebf3e6b606185ed";

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

/* ---- Zero-lag: IndexedDB offline persistence (multi-tab) -> cache-first reads & optimistic writes ---- */
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* multi-tab/unsupported: continue online-only */ });
} catch (e) { /* ignore */ }
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});

/* ---- safe session cache ---- */
const SS = {
  get(k, d = null) { try { const v = sessionStorage.getItem("pf:" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { sessionStorage.setItem("pf:" + k, JSON.stringify(v)); } catch (e) { /* quota/private mode */ } },
  del(k) { try { sessionStorage.removeItem("pf:" + k); } catch (e) {} }
};

/* ---- formatting ---- */
function formatKsh(n) {
  n = Number(n) || 0;
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return "KSh " + n.toLocaleString("en-KE", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function getInitials(name) {
  if (!name) return "?";
  return String(name).trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function capitalize(s) { s = String(s || "").trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ""; }

/** First name only: profile.firstName -> fullName -> displayName -> email local part (mark.yego -> Mark). */
function getFirstName(profile, user) {
  profile = profile || {}; user = user || (typeof auth !== "undefined" ? auth.currentUser : null) || {};
  const raw = profile.firstName || (profile.fullName || "").trim().split(/\s+/)[0] ||
    (user.displayName || "").trim().split(/\s+/)[0] ||
    String(profile.email || user.email || "").split("@")[0].split(/[._\-+\d]+/)[0] || "";
  return capitalize(raw) || "there";
}
function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function showToast(msg, type = "info") {
  let c = document.getElementById("toast-container");
  if (!c) {
    c = document.createElement("div");
    c.id = "toast-container";
    c.className = "fixed top-4 right-4 z-[200] space-y-2 pointer-events-none";
    document.body.appendChild(c);
  }
  const colors = { success: "#10b981", error: "#ef4444", info: "#3b82f6" };
  const t = document.createElement("div");
  t.className = "toast pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl bg-white shadow-lg border border-gray-100 max-w-sm";
  t.style.borderLeft = "4px solid " + (colors[type] || colors.info);
  t.setAttribute("role", "status");
  t.innerHTML = `<div class="text-sm text-gray-800 flex-1">${esc(msg)}</div><button aria-label="Dismiss" class="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>`;
  t.querySelector("button").onclick = () => t.remove();
  c.appendChild(t);
  setTimeout(() => t.remove(), type === "error" ? 6500 : 4000);
}

/** Authenticated call to our Cloud Functions API (/api/**). */
async function apiCall(path, body, method = "POST") {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : "";
  const res = await fetch("/api" + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-json */ }
  if (!res.ok) { const err = new Error((data && data.error) || "Request failed (" + res.status + ")"); err.status = res.status; throw err; }
  return data;
}

/** Creates users/{uid} when missing (first login). Runs in the background — never blocks navigation. */
async function ensureUserProfile(user) {
  if (!user || !user.uid) return null;
  const ref = db.collection("users").doc(user.uid);
  try {
    const snap = await ref.get();
    if (snap.exists) return { id: snap.id, ...snap.data() };
    const trialEnds = new Date(); trialEnds.setDate(trialEnds.getDate() + 60);
    const full = user.displayName || (user.email ? user.email.split("@")[0].replace(/[._-]+/g, " ") : "Landlord");
    const parts = full.split(/\s+/);
    const profile = {
      uid: user.uid, fullName: full, firstName: capitalize(parts[0]), lastName: parts.slice(1).map(capitalize).join(" "),
      email: user.email || null, phone: null, businessName: null, unitsRange: null, role: "landlord", plan: "trial",
      trialEndsAt: firebase.firestore.Timestamp.fromDate(trialEnds),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      onboardingCompleted: false
    };
    await ref.set(profile);
    return { id: user.uid, ...profile };
  } catch (err) {
    console.error("ensureUserProfile failed:", err);
    return null;
  }
}

/** Resolves as soon as Firebase knows the user (usually from local persistence, ~instant). */
function requireAuth(cb) {
  auth.onAuthStateChanged((user) => {
    if (!user) { SS.del("profile"); window.location.replace("/"); return; }
    // tenants have their own app — they never see (or load) the landlord side
    user.getIdTokenResult().then((r) => {
      if (r.claims && r.claims.role === "tenant") { window.location.replace("/tenant/"); return; }
      ensureUserProfile(user); // background
      if (typeof cb === "function") Promise.resolve(cb(user)).catch((e) => console.error(e));
    }).catch(() => { ensureUserProfile(user); if (typeof cb === "function") Promise.resolve(cb(user)).catch((e) => console.error(e)); });
  });
}

async function handleLogout() {
  try { if (window.PFPush) await Promise.race([PFPush.disable(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
  try { await auth.signOut(); } catch (e) {}
  try { sessionStorage.clear(); } catch (e) {}
  window.location.replace("/");
}

Object.assign(window, { SS, formatKsh, esc, showToast, getInitials, getGreeting, getFirstName, capitalize,
  requireAuth, handleLogout, ensureUserProfile, apiCall, firebaseConfig, PAYSTACK_PUBLIC_KEY });
