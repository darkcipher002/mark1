/* PropFlow KE — Personal account: profile, avatar (canvas 256x256 WebP), password */
(function () {
  const $ = (id) => document.getElementById(id);
  let user = null, filled = false;

  PF.boot((u) => {
    user = u;
    $("p-email").value = u.email || "";
    PF.onProfile(fill);
  });

  function fill(p) {
    renderAvatar(p);
    if (!p) return;
    $("hello-name").textContent = getFirstName(p, user);
    if (!filled) { // don't clobber what the user is typing
      filled = true;
      const parts = (p.fullName || user.displayName || "").trim().split(/\s+/);
      $("p-first").value = p.firstName || capitalize(parts[0] || "");
      $("p-last").value = p.lastName != null ? p.lastName : parts.slice(1).join(" ");
      $("p-phone").value = (p.phone || "").replace(/^\+254/, "0");
      $("p-business").value = p.businessName || "";
    }
    $("plan-name").textContent = p.plan === "trial" ? "Free trial" : (p.plan || "Free trial");
    if (p.trialEndsAt) { const d = Math.ceil((new Date(p.trialEndsAt) - new Date()) / 86400000); $("plan-sub").textContent = d > 0 ? `${d} day${d === 1 ? "" : "s"} left` : "Trial ended"; }
  }
  function renderAvatar(p) {
    const box = $("avatar-box");
    box.innerHTML = p && p.avatar ? `<img src="${p.avatar}" alt="Your photo" class="w-full h-full object-cover"/>` : `<span class="text-2xl font-semibold text-brand-700">${esc(getInitials((p && p.fullName) || user.displayName || user.email))}</span>`;
    $("avatar-remove").classList.toggle("hidden", !(p && p.avatar));
  }

  /* ---- profile ---- */
  $("profile-form").onsubmit = async (e) => {
    e.preventDefault();
    const first = capitalize($("p-first").value), last = $("p-last").value.trim().split(/\s+/).map(capitalize).join(" "), business = $("p-business").value.trim();
    const phoneRaw = $("p-phone").value.replace(/\s+/g, "");
    if (!first) return showToast("First name is required", "error");
    if (phoneRaw && !/^(?:\+?254|0)?[17]\d{8}$/.test(phoneRaw)) return showToast("Enter a valid Kenyan phone number", "error");
    const btn = $("profile-save"); btn.disabled = true;
    try {
      const fullName = `${first} ${last}`.trim();
      await db.collection("users").doc(user.uid).set({ firstName: first, lastName: last, fullName, phone: phoneRaw ? "+" + PF.msisdn(phoneRaw) : null, businessName: business || null, updatedAt: PF.ts() }, { merge: true });
      user.updateProfile({ displayName: fullName }).catch(() => {});
      showToast(`Saved — hello, ${first}`, "success");
    } catch (err) { showToast("Could not save: " + err.message, "error"); }
    finally { btn.disabled = false; }
  };

  /* ---- avatar ---- */
  function toSquareWebP(file, size = 256) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error("Choose an image file"));
      if (file.size > 15 * 1024 * 1024) return reject(new Error("Image is too large (max 15MB)"));
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement("canvas"); c.width = c.height = size;
        const x = c.getContext("2d"), s = Math.min(img.width, img.height);
        x.imageSmoothingQuality = "high";
        x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        let out = c.toDataURL("image/webp", 0.82);
        if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", 0.82); // Safari fallback
        resolve(out);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read that image")); };
      img.src = url;
    });
  }
  $("avatar-input").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = await toSquareWebP(f);
      await db.collection("users").doc(user.uid).set({ avatar: data, updatedAt: PF.ts() }, { merge: true });
      showToast("Profile photo updated", "success");
    } catch (err) { showToast(err.message, "error"); }
    e.target.value = "";
  };
  $("avatar-remove").onclick = () => PF.fire(db.collection("users").doc(user.uid).set({ avatar: null, updatedAt: PF.ts() }, { merge: true }), "Photo removed");

  /* ---- password ---- */
  $("pw-form").onsubmit = async (e) => {
    e.preventDefault();
    const cur = $("pw-cur").value, nw = $("pw-new").value, cf = $("pw-conf").value;
    if (!cur) return showToast("Enter your current password", "error");
    if (nw.length < 8) return showToast("New password must be at least 8 characters", "error");
    if (nw !== cf) return showToast("New passwords do not match", "error");
    if (nw === cur) return showToast("Choose a different password", "error");
    const btn = $("pw-save"); btn.disabled = true;
    try {
      await user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, cur));
      await user.updatePassword(nw);
      $("pw-form").reset(); showToast("Password changed", "success");
    } catch (err) {
      const m = { "auth/wrong-password": "Current password is incorrect.", "auth/invalid-credential": "Current password is incorrect.", "auth/too-many-requests": "Too many attempts. Try again later.", "auth/weak-password": "Password is too weak.", "auth/requires-recent-login": "Please sign in again, then retry." };
      showToast(m[err.code] || err.message, "error");
    } finally { btn.disabled = false; }
  };
  document.querySelectorAll("[data-eye]").forEach((b) => (b.onclick = () => { const i = $(b.dataset.eye); i.type = i.type === "password" ? "text" : "password"; b.textContent = i.type === "password" ? "Show" : "Hide"; }));
  $("signout-btn").onclick = handleLogout;
})();
