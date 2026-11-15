/* PropFlow KE service worker — app shell + offline. Data itself is cached by Firestore (IndexedDB). */
const V = "pf-v4";
const SHELL = ["/", "/dashboard/", "/properties/", "/tenants/", "/payments/", "/maintenance/", "/account/", "/forgot-password/", "/tenant/", "/privacy/", "/terms/", "/offline.html",
  "/css/tailwind.css", "/css/app.css", "/manifest.json", "/tenant/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png",
  ...["firebase-config", "billing", "store", "payments", "ai-automation", "tenancy", "export", "receipts", "pdf-ledger", "shell", "auth", "dashboard", "properties", "tenants", "payments-page", "maintenance", "account", "access", "push", "notify", "tenant", "vendor/qrcode"].map((n) => `/js/${n}.js`)];
const CDN = /^https:\/\/(www\.gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com)\//;

self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/") || url.hostname.endsWith("googleapis.com") && url.pathname.includes("/v1") || url.hostname.includes("firestore") || url.hostname.includes("identitytoolkit") || url.hostname.includes("securetoken")) return;
  if (req.mode === "navigate") { // network first so deploys show immediately, cache fallback offline
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(V).then((ch) => ch.put(req, c)); return r; })
      .catch(() => caches.match(req).then((m) => m || caches.match(url.pathname.endsWith("/") ? url.pathname : url.pathname + "/")).then((m) => m || caches.match("/offline.html"))));
    return;
  }
  if (url.origin === location.origin || CDN.test(req.url)) { // stale-while-revalidate
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r && (r.ok || r.type === "opaque")) { const c = r.clone(); caches.open(V).then((ch) => ch.put(req, c)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});

/* ---- push notifications ---- */
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: "PropFlow", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "PropFlow", { body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", tag: d.tag || undefined, data: { url: d.url || "/" }, renotify: !!d.tag }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close(); const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (new URL(c.url).pathname.startsWith(new URL(url, location.origin).pathname) && "focus" in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
