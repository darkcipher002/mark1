/**
 * PropFlow KE — app shell (sidebar, top bar, profile pill, modals, confirm dialog).
 * A page declares:  <body data-page="tenants" data-title="Tenants">  <div id="page">…</div>
 * and optionally    <template id="header-actions">…buttons…</template>
 */
(function () {
  const PF = (window.PF = window.PF || {});
  const I = {
    today: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
    properties: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    tenants: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    payments: "M2 8a2 2 0 012-2h16a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8zm0 2h20M6 15h4",
    maintenance: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
    account: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
    sms: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
  };
  const ico = (k) => `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="${I[k]}"/></svg>`;
  const NAV = [["today", "/dashboard", "Today"], ["properties", "/properties", "Properties"], ["tenants", "/tenants", "Tenants"], ["payments", "/payments", "Rent & payments"], ["maintenance", "/maintenance", "Maintenance"]];

  function avatarHTML(profile, cls) {
    const name = profile ? profile.fullName || profile.firstName : "";
    if (profile && profile.avatar) return `<img src="${profile.avatar}" alt="" class="${cls} object-cover"/>`;
    return `<div class="${cls} bg-brand-100 text-brand-700 flex items-center justify-center font-semibold text-xs">${esc(getInitials(name || "…"))}</div>`;
  }

  function build() {
    const body = document.body;
    const active = body.dataset.page, title = body.dataset.title || "";
    const page = document.getElementById("page");
    const tpl = document.getElementById("header-actions");
    const showAI = !!window.AI;

    const shell = document.createElement("div");
    shell.className = "flex min-h-screen";
    shell.innerHTML = `
    <aside id="sidebar" class="fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-[var(--line)] -translate-x-full lg:translate-x-0 transition-transform duration-200 flex flex-col">
      <a href="/dashboard" class="flex items-center gap-3 px-5 h-16 border-b border-[var(--line)]">
        <div class="w-9 h-9 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold">P</div>
        <div><div class="font-bold text-[15px] leading-tight">PropFlow KE</div><div class="text-[11px] text-gray-400">Your places, together</div></div>
      </a>
      <nav class="flex-1 overflow-y-auto px-3 py-3 space-y-0.5" aria-label="Main">
        ${NAV.map(([k, href, label], i) => (i === 1 ? '<div class="pt-4 pb-1 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Manage your places</div>' : "") + `<a href="${href}" class="nav-item ${active === k ? "active" : ""}" ${active === k ? 'aria-current="page"' : ""}>${ico(k)}${label}</a>`).join("")}
        <div class="pt-4 pb-1 px-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">You</div>
        <a href="/account" class="nav-item ${active === "account" ? "active" : ""}">${ico("account")}Personal account</a>
      </nav>
      <div class="p-3 border-t border-[var(--line)] space-y-2">
        ${showAI ? `<button id="sb-mpesa" class="btn btn-soft w-full">${ico("sms").replace("<svg", '<svg class="w-4 h-4"')} Quick Confirm M-Pesa</button>` : ""}
        <a href="/account" class="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition">
          <span id="sb-avatar">${avatarHTML(PF.profile, "w-9 h-9 rounded-full")}</span>
          <div class="min-w-0"><div id="sb-name" class="text-sm font-semibold truncate">${esc((PF.profile && PF.profile.fullName) || "…")}</div><div class="text-[11px] text-gray-400">Personal account</div></div>
        </a>
        <button id="sb-logout" class="w-full py-2 text-sm text-gray-500 hover:text-red-600 transition">Sign out</button>
      </div>
    </aside>
    <div id="sidebar-overlay" class="fixed inset-0 bg-black/30 z-30 hidden lg:hidden"></div>
    <div class="flex-1 lg:ml-64 min-w-0">
      <header class="sticky top-0 z-20 bg-white/85 backdrop-blur border-b border-[var(--line)] h-16 flex items-center justify-between gap-3 px-4 sm:px-6">
        <div class="flex items-center gap-2 min-w-0">
          <button id="sb-toggle" class="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100" aria-label="Open menu"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg></button>
          <h1 class="text-[15px] font-semibold truncate">${esc(title)}</h1>
        </div>
        <div class="flex items-center gap-2">
          <div id="header-actions-slot" class="flex items-center gap-2"></div>
          <a href="/account" id="hdr-pill" class="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border border-[var(--line)] hover:bg-gray-50 transition" title="Personal account">
            <span id="hdr-avatar">${avatarHTML(PF.profile, "w-7 h-7 rounded-full")}</span>
            <span id="hdr-name" class="text-sm font-medium hidden sm:inline">${esc(getFirstName(PF.profile, { email: "" }) === "there" ? "Account" : getFirstName(PF.profile))}</span>
          </a>
        </div>
      </header>
      <main id="main" class="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto"></main>
    </div>`;
    body.insertBefore(shell, page);
    shell.querySelector("#main").appendChild(page);
    page.classList.add("page-in");
    if (tpl) { shell.querySelector("#header-actions-slot").appendChild(tpl.content.cloneNode(true)); tpl.remove(); }

    const toggle = () => { document.getElementById("sidebar").classList.toggle("-translate-x-full"); document.getElementById("sidebar-overlay").classList.toggle("hidden"); };
    PF.toggleSidebar = window.toggleSidebar = toggle;
    shell.querySelector("#sb-toggle").onclick = toggle;
    shell.querySelector("#sidebar-overlay").onclick = toggle;
    shell.querySelector("#sb-logout").onclick = handleLogout;
    const mp = shell.querySelector("#sb-mpesa"); if (mp) mp.onclick = () => window.AI.openMpesaModal();

    if (!document.getElementById("toast-container")) { const c = document.createElement("div"); c.id = "toast-container"; c.className = "fixed top-4 right-4 z-[200] space-y-2 pointer-events-none"; body.appendChild(c); }

    PF.onProfile(paintProfile);
  }

  function paintProfile(p) {
    const set = (id, html, text) => { const el = document.getElementById(id); if (!el) return; if (text != null) el.textContent = text; else el.innerHTML = html; };
    set("sb-avatar", avatarHTML(p, "w-9 h-9 rounded-full"));
    set("hdr-avatar", avatarHTML(p, "w-7 h-7 rounded-full"));
    set("sb-name", null, p.fullName || getFirstName(p));
    set("hdr-name", null, getFirstName(p));
    document.querySelectorAll("[data-first-name]").forEach((el) => (el.textContent = getFirstName(p)));
  }

  /* ---- modals ---- */
  PF.openModal = function (id) { const m = document.getElementById(id); if (m) { m.classList.add("open"); m.setAttribute("aria-hidden", "false"); const f = m.querySelector("input:not([type=hidden]):not([disabled]),select,textarea"); if (f && window.innerWidth > 640) setTimeout(() => f.focus(), 30); } };
  PF.closeModal = function (id) { const m = document.getElementById(id); if (m) { m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); } };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".modal.open").forEach((m) => m.classList.remove("open")); });
  document.addEventListener("mousedown", (e) => { if (e.target.classList && e.target.classList.contains("modal")) e.target.classList.remove("open"); });

  /** Promise-based confirm dialog (replaces window.confirm). */
  PF.confirm = function ({ title = "Are you sure?", message = "", confirmText = "Confirm", danger = false } = {}) {
    return new Promise((resolve) => {
      const m = document.createElement("div");
      m.className = "modal open"; m.style.zIndex = 90;
      m.innerHTML = `<div class="sheet max-w-sm p-6" role="alertdialog" aria-modal="true"><h3 class="text-lg font-semibold">${esc(title)}</h3><p class="text-sm text-gray-600 mt-2 whitespace-pre-line">${esc(message)}</p>
        <div class="flex gap-3 mt-6"><button class="btn flex-1" data-x="0">Cancel</button><button class="btn flex-1 ${danger ? "btn-danger" : "btn-brand"}" data-x="1">${esc(confirmText)}</button></div></div>`;
      const done = (v) => { m.remove(); resolve(v); };
      m.addEventListener("click", (e) => { const x = e.target.closest("[data-x]"); if (x) done(x.dataset.x === "1"); else if (e.target === m) done(false); });
      document.body.appendChild(m);
      m.querySelector('[data-x="1"]').focus();
    });
  };

  /** Skeleton helper: n placeholder rows */
  PF.skeletonRows = (n = 4, h = "h-16") => Array.from({ length: n }, () => `<div class="skel ${h} w-full"></div>`).join("");
  PF.emptyState = (icon, title, text, action = "") => `<div class="empty"><div class="ico"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" d="${I[icon] || I.properties}"/></svg></div><h3 class="font-semibold">${esc(title)}</h3><p class="text-sm text-gray-500 mt-1 max-w-sm">${esc(text)}</p>${action ? `<div class="mt-5">${action}</div>` : ""}</div>`;
  PF.pill = (ev) => `<span class="pill pill-${ev.tone}">${ev.status === "OVERDUE" ? "OVERDUE" : ev.status === "DUE_SOON" ? "DUE SOON" : "PAID"}</span>`;

  PF.boot = function (cb) {
    requireAuth((user) => {
      PF.startProfile(user);
      let n = 0; const go = () => { if (++n === 2) PF.startNotify(user); };
      ["/js/push.js", "/js/notify.js"].forEach((src) => { const sc = document.createElement("script"); sc.src = src; sc.onload = go; document.head.appendChild(sc); });
      return cb && cb(user);
    });
  };

  build();

  /* ---- PWA: offline shell + install prompt ---- */
  const DEV = ["localhost", "127.0.0.1"].includes(location.hostname);
  if ("serviceWorker" in navigator) {
    if (DEV) { // local development: no offline cache, and remove any worker left from earlier runs so edits show instantly
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())); if (window.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)));
    } else addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }
  let deferred = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; const c = document.getElementById("install-card"); if (c) c.classList.remove("hidden"); });
  addEventListener("appinstalled", () => { const c = document.getElementById("install-card"); if (c) c.classList.add("hidden"); });
  document.addEventListener("click", async (e) => { if (e.target && e.target.id === "install-btn" && deferred) { deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; } });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone && !matchMedia("(display-mode: standalone)").matches;
  if (ios) addEventListener("DOMContentLoaded", () => { const c = document.getElementById("install-card"), t = document.getElementById("install-text"), b = document.getElementById("install-btn"); if (c && t) { t.textContent = "On iPhone: tap the Share button in Safari, then “Add to Home Screen”."; if (b) b.remove(); c.classList.remove("hidden"); } });
})();
