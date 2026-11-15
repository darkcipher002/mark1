/** PropFlow KE — Web Push client (shared by the landlord app and the tenant app). */
(function () {
  const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const b64 = (s) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function reg() { return navigator.serviceWorker.getRegistration().then((r) => r || navigator.serviceWorker.ready); }
  async function state() {
    if (!supported()) return "unsupported";
    if (Notification.permission === "denied") return "blocked";
    try { const r = await reg(); const s = r && (await r.pushManager.getSubscription()); return s && Notification.permission === "granted" ? "on" : "off"; } catch (e) { return "off"; }
  }
  async function enable() {
    if (!supported()) throw new Error("This browser can't show notifications. On iPhone, first add the app to your Home Screen.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notifications are blocked. Allow them in your browser or phone settings, then try again.");
    const r = await reg(); if (!r) throw new Error("The app isn't ready yet — reload and try again.");
    const { key } = await (await fetch("/api/push/key")).json().catch(() => ({}));
    if (!key) throw new Error("Push alerts aren't set up on the server yet.");
    let sub = await r.pushManager.getSubscription();
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
    await apiCall("/push/subscribe", { subscription: sub.toJSON() });
    return true;
  }
  async function disable() {
    try { const r = await reg(); const s = r && (await r.pushManager.getSubscription()); if (s) { await apiCall("/push/unsubscribe", { endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe(); } } catch (e) {}
  }
  /** Quietly re-register an existing subscription (keeps it linked to the signed-in account). */
  async function refresh() { try { if ((await state()) === "on") { const r = await reg(); const s = await r.pushManager.getSubscription(); await apiCall("/push/subscribe", { subscription: s.toJSON() }); } } catch (e) {} }
  window.PFPush = { supported, state, enable, disable, refresh };
})();
