// BASE is provided by js/config.js loaded before this script

const sendBtn   = document.getElementById("sendBtn");
const verifyBtn = document.getElementById("verifyBtn");
const step2     = document.getElementById("step2");
const msgEl     = document.getElementById("message");

function setMsg(text, type = "") {
  msgEl.textContent = text;
  msgEl.className   = "login-message" + (type ? " " + type : "");
}

function setLoading(btn, loading) {
  btn.disabled    = loading;
  btn.textContent = loading
    ? (btn === sendBtn ? "Sending…" : "Verifying…")
    : (btn === sendBtn ? "Send OTP"  : "Verify & Enter");
}

async function sendOTP() {
  const name  = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();

  if (!name)  { setMsg("Please enter your name.", "error"); return; }
  if (!phone) { setMsg("Please enter your phone number.", "error"); return; }
  if (!/^[6-9]\d{9}$/.test(phone)) {
    setMsg("Enter a valid 10-digit Indian mobile number.", "error");
    return;
  }

  setLoading(sendBtn, true);
  setMsg("");

  try {
    const res  = await fetch(BASE + "/send-otp", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, phone })
    });
    const data = await res.json();
    if (data.success) {
      setMsg("OTP sent — check your phone.", "success");
      step2.classList.add("visible");
      document.getElementById("otp").focus();
    } else {
      setMsg(data.message || "Could not send OTP. Try again.", "error");
    }
  } catch {
    setMsg("Could not reach server. Make sure the backend is running.", "error");
  } finally {
    setLoading(sendBtn, false);
  }
}

async function verifyOTP() {
  const name  = document.getElementById("name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const otp   = document.getElementById("otp").value.trim();

  if (!otp) { setMsg("Enter the OTP first.", "error"); return; }

  setLoading(verifyBtn, true);
  setMsg("");

  try {
    const res  = await fetch(BASE + "/verify-otp", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ name, phone, otp })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem("userName", name);
      localStorage.setItem("phone",    phone);
      setMsg("Verified! Taking you in…", "success");

      // Redirect back to the page the user came from, or home
      const redirect = sessionStorage.getItem("sg_redirect");
      sessionStorage.removeItem("sg_redirect");
      setTimeout(() => {
        window.location.href = redirect || "./index.html";
      }, 700);
    } else {
      setMsg("Invalid OTP. Please try again.", "error");
      setLoading(verifyBtn, false);
    }
  } catch {
    setMsg("Could not reach server. Make sure the backend is running.", "error");
    setLoading(verifyBtn, false);
  }
}

function resetLogin() {
  step2.classList.remove("visible");
  document.getElementById("otp").value = "";
  setMsg("");
}

/* Floating label — input scale on focus */
document.querySelectorAll(".input-group input").forEach(input => {
  input.addEventListener("focus",  () => { input.parentElement.style.transform = "scale(1.015)"; input.parentElement.style.transition = "transform 0.25s ease"; });
  input.addEventListener("blur",   () => { input.parentElement.style.transform = "scale(1)"; });
});

/* Enter key shortcuts */
document.getElementById("name").addEventListener("keydown",  e => { if (e.key === "Enter") document.getElementById("phone").focus(); });
document.getElementById("phone").addEventListener("keydown", e => { if (e.key === "Enter") sendOTP(); });
document.getElementById("otp").addEventListener("keydown",   e => { if (e.key === "Enter") verifyOTP(); });
