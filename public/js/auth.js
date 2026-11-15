let redirecting = false;

auth.onAuthStateChanged((user) => {
  if (redirecting) return;
  const path = window.location.pathname;
  if (user && (path === "/" || path === "/index.html" || path.endsWith("/public/") || path.endsWith("/public"))) {
    redirecting = true;
    user.getIdTokenResult().then((r) => window.location.replace(r.claims && r.claims.role === "tenant" ? "/tenant/" : "/dashboard")).catch(() => window.location.replace("/dashboard"));
  }
});

function setLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const text = btn.querySelector(".btn-text");
  const loader = btn.querySelector(".btn-loader");
  btn.disabled = on;
  if (text) text.classList.toggle("hidden", on);
  if (loader) loader.classList.toggle("hidden", !on);
}

function togglePassword(inputId, btn) {
  const input = document.getElementById(inputId);
  const open = btn.querySelector(".eye-open");
  const closed = btn.querySelector(".eye-closed");
  if (input.type === "password") {
    input.type = "text";
    if (open) open.classList.add("hidden");
    if (closed) closed.classList.remove("hidden");
  } else {
    input.type = "password";
    if (open) open.classList.remove("hidden");
    if (closed) closed.classList.add("hidden");
  }
}

function switchTab(tab) {
  const login = document.getElementById("form-login");
  const reg = document.getElementById("form-register");
  const tLogin = document.getElementById("tab-login");
  const tReg = document.getElementById("tab-register");
  if (tab === "login") {
    login.classList.remove("hidden");
    reg.classList.add("hidden");
    tLogin.className = "tab-btn flex-1 py-2.5 text-sm font-semibold rounded-lg bg-white text-gray-900 shadow-sm";
    tReg.className = "tab-btn flex-1 py-2.5 text-sm font-semibold rounded-lg text-gray-500";
  } else {
    login.classList.add("hidden");
    reg.classList.remove("hidden");
    tReg.className = "tab-btn flex-1 py-2.5 text-sm font-semibold rounded-lg bg-white text-gray-900 shadow-sm";
    tLogin.className = "tab-btn flex-1 py-2.5 text-sm font-semibold rounded-lg text-gray-500";
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  if (!email || !password) return showToast("Enter email and password", "error");

  setLoading("login-btn", true);
  try {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const tk = await cred.user.getIdTokenResult();
    if (tk.claims && tk.claims.role === "tenant") { redirecting = true; window.location.replace("/tenant/"); return; }
    // Ensure users/{uid} exists (creates collection + doc if needed)
    if (typeof ensureUserProfile === "function") {
      await ensureUserProfile(cred.user);
    }
    redirecting = true;
    
    setTimeout(() => window.location.replace("/dashboard"), 500);
  } catch (err) {
    console.error(err);
    let msg = "Sign in failed.";
    if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password")
      msg = "Wrong email or password.";
    else if (err.code === "auth/too-many-requests") msg = "Too many attempts. Wait a bit.";
    else if (err.code === "auth/network-request-failed") msg = "Network error.";
    showToast(msg, "error");
  } finally {
    setLoading("login-btn", false);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById("reg-name").value.trim();
  const email = document.getElementById("reg-email").value.trim();
  const phoneRaw = document.getElementById("reg-phone").value.replace(/\s+/g, "");
  const business = document.getElementById("reg-business").value.trim();
  const units = document.getElementById("reg-units").value;
  const password = document.getElementById("reg-password").value;
  const confirm = document.getElementById("reg-confirm").value;
  const terms = document.getElementById("reg-terms").checked;

  if (!name || !email || !phoneRaw || !units || !password) return showToast("Fill all required fields", "error");
  if (!/^[17]\d{8}$/.test(phoneRaw)) return showToast("Valid Kenyan number required (7xxxxxxxx)", "error");
  if (password.length < 8) return showToast("Password min 8 characters", "error");
  if (password !== confirm) return showToast("Passwords do not match", "error");
  if (!terms) return showToast("Accept Terms to continue", "error");

  setLoading("register-btn", true);
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const user = cred.user;
    await user.updateProfile({ displayName: name });

    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 60);

    // This write automatically creates the "users" collection if it does not exist
    await db.collection("users").doc(user.uid).set({
      uid: user.uid,
      fullName: name,
      firstName: capitalize(name.split(/\s+/)[0]),
      lastName: name.split(/\s+/).slice(1).map(capitalize).join(" "),
      email,
      phone: "+254" + phoneRaw,
      businessName: business || null,
      unitsRange: units,
      role: "landlord",
      plan: "trial",
      trialEndsAt: firebase.firestore.Timestamp.fromDate(trialEnds),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      onboardingCompleted: false,
      propertiesCount: 0,
      unitsCount: 0,
      collectedThisMonth: 0
    }, { merge: true });

    redirecting = true;
    showToast("Account created! Redirecting…", "success");
    setTimeout(() => window.location.replace("/dashboard"), 800);
  } catch (err) {
    console.error(err);
    let msg = "Registration failed.";
    if (err.code === "auth/email-already-in-use") msg = "Email already registered. Sign in instead.";
    else if (err.code === "auth/weak-password") msg = "Password too weak.";
    else if (err.code === "auth/operation-not-allowed") msg = "Email/Password not enabled in Firebase Console.";
    else if (err.code === "permission-denied") msg = "Firestore permission denied. Deploy the security rules first.";
    else if (err.message) msg = err.message;
    showToast(msg, "error");
  } finally {
    setLoading("register-btn", false);
  }
}

function handleForgotPassword() {
  const e = document.getElementById("login-email").value.trim();
  window.location.href = "/forgot-password" + (e ? "?email=" + encodeURIComponent(e) : "");
}

window.switchTab = switchTab;
window.togglePassword = togglePassword;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleForgotPassword = handleForgotPassword;
