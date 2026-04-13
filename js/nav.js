/**
 * Shared nav behaviour — include on every page with the standard nav.
 * Handles: greeting pill, login/logout, burger/mobile-menu,
 *          nav-scrolled state, active link, auth guard.
 */
(function () {

  /* ── Auth helpers (exposed globally) ───────────────────── */

  /**
   * Call guardAuth() at the top of any page that requires a logged-in user.
   * It saves the current URL and redirects to login.html if not authenticated.
   * Returns true if the user IS logged in.
   */
  window.guardAuth = function () {
    if (!localStorage.getItem("userName")) {
      sessionStorage.setItem("sg_redirect", window.location.href);
      window.location.replace("./login.html");
      return false;
    }
    return true;
  };

  /* ── Greeting + Login / Logout ──────────────────────────── */
  function setupAuth() {
    const userName = localStorage.getItem("userName");
    const navRight = document.querySelector(".nav-right");
    if (!navRight) return;

    if (userName) {
      // Show greeting pill
      const firstName    = userName.split(" ")[0];
      const greetingEl   = document.getElementById("userGreeting");
      const greetingName = document.getElementById("greetingName");
      if (greetingEl && greetingName) {
        greetingName.textContent = firstName;
        greetingEl.classList.add("visible");
        greetingEl.setAttribute("title", "Click to log out");
        greetingEl.addEventListener("click", () => {
          if (confirm("Log out of SkyGolf?")) {
            localStorage.removeItem("userName");
            localStorage.removeItem("phone");
            window.location.href = "./index.html";
          }
        });
      }

      // Mobile menu footer greeting
      const menuFooter = document.getElementById("menuFooterGreeting");
      if (menuFooter) menuFooter.textContent = "\u2736 Hello, " + firstName;

    } else {
      // Inject a Login link into the nav-right (before the burger)
      const burger = navRight.querySelector(".burger");
      const loginLink = document.createElement("a");
      loginLink.href      = "./login.html";
      loginLink.className = "nav-login-btn";
      loginLink.textContent = "Login";
      loginLink.addEventListener("click", () => {
        // Save current page so we can return after login
        sessionStorage.setItem("sg_redirect", window.location.href);
      });
      navRight.insertBefore(loginLink, burger);

      // Also add to mobile menu if it exists
      const mobileMenuItems = document.querySelector(".menu-items");
      if (mobileMenuItems) {
        const mobileLogin = document.createElement("a");
        mobileLogin.href      = "./login.html";
        mobileLogin.className = "menu-btn";
        mobileLogin.textContent = "Login";
        mobileMenuItems.appendChild(mobileLogin);
      }
    }
  }

  /* ── Burger / Mobile Menu ───────────────────────────────── */
  function setupMenu() {
    const burger     = document.getElementById("burger");
    const mobileMenu = document.getElementById("mobileMenu");
    const menuClose  = document.getElementById("menuClose");
    if (!burger || !mobileMenu) return;

    const toggle = (open) => {
      mobileMenu.classList.toggle("open", open);
      burger.classList.toggle("active", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      document.body.classList.toggle("no-scroll", open);
    };

    burger.addEventListener("click", () => toggle(!mobileMenu.classList.contains("open")));
    if (menuClose) menuClose.addEventListener("click", () => toggle(false));

    document.addEventListener("click", (e) => {
      if (
        mobileMenu.classList.contains("open") &&
        !mobileMenu.contains(e.target) &&
        e.target !== burger
      ) toggle(false);
    });

    mobileMenu.querySelectorAll(".menu-btn").forEach((btn) => {
      btn.addEventListener("click", () => toggle(false));
      btn.addEventListener("mousemove", (e) => {
        const r  = btn.getBoundingClientRect();
        const rx = ((e.clientY - r.top)  - r.height / 2) / 7;
        const ry = (r.width / 2 - (e.clientX - r.left)) / 7;
        btn.style.transform = `perspective(400px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
      btn.addEventListener("mouseleave", () => { btn.style.transform = ""; });
    });
  }

  /* ── Nav Scroll State ───────────────────────────────────── */
  function setupNavScroll() {
    const nav = document.getElementById("mainNav");
    if (!nav) return;
    const handler = () => nav.classList.toggle("nav-scrolled", window.scrollY > 40);
    window.addEventListener("scroll", handler, { passive: true });
    handler();
  }

  /* ── Active Link Highlight ──────────────────────────────── */
  function setupActiveLink() {
    const page = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".links li a").forEach((a) => {
      const href = (a.getAttribute("href") || "").replace("./", "");
      if (href === page) a.classList.add("is-active");
    });
    document.querySelectorAll(".menu-btn").forEach((a) => {
      const href = (a.getAttribute("href") || "").replace("./", "");
      if (href === page) a.classList.add("is-active");
    });
  }

  /* ── Init ───────────────────────────────────────────────── */
  function init() {
    setupAuth();
    setupMenu();
    setupNavScroll();
    setupActiveLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
