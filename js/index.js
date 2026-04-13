import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

gsap.registerPlugin(ScrollTrigger);

// ── Lock scroll immediately during intro ──
document.body.classList.add("no-scroll");

// ── DOM refs ──
const container   = document.getElementById("scene-container");
const home        = document.getElementById("home");
const brand       = document.getElementById("brand");
const impactFlash = document.getElementById("impact-flash");
const impactRipple= document.getElementById("impact-ripple");
const burger      = document.getElementById("burger");
const mobileMenu  = document.getElementById("mobileMenu");
const menuClose   = document.getElementById("menuClose");
const mainNav     = document.getElementById("mainNav");

// ── Mobile detection (for perf reductions) ──
const isMobile = window.innerWidth <= 680;
const pixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
const FRAGMENT_COUNT = isMobile ? 18 : 42;

// ── Three.js scene ──
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1.5, 5.2);

const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(pixelRatio);
container.appendChild(renderer.domElement);

// ── Lighting ──
scene.add(new THREE.AmbientLight(0xffffff, 1.05));

const keyLight = new THREE.DirectionalLight(0xf3e9d5, 1.85);
keyLight.position.set(4, 5, 6);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0xa89f48, 2.4, 16);
fillLight.position.set(0, 1.6, 2.8);
scene.add(fillLight);

const cursorLight = new THREE.PointLight(0xf3e9d5, 1.8, 10);
cursorLight.position.set(0, 0.8, 3);
scene.add(cursorLight);

// ── Floor + ring ──
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(2.6, 64),
  new THREE.MeshPhysicalMaterial({
    color: 0x2d4629,
    transparent: true,
    opacity: 0.28,
    roughness: 0.38,
    metalness: 0.12
  })
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -1.95, 0);
scene.add(floor);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.45, 0.55, 56),
  new THREE.MeshBasicMaterial({ color: 0xf3e9d5, transparent: true, opacity: 0 })
);
ring.rotation.x = -Math.PI / 2;
ring.position.set(0, -1.94, 0);
scene.add(ring);

// ── Golf ball (no external texture for speed) ──
const ballMaterial = new THREE.MeshStandardMaterial({
  color: 0xf3e9d5,
  roughness: 0.34,
  metalness: 0.05
});

const ball = new THREE.Mesh(new THREE.SphereGeometry(0.78, isMobile ? 64 : 128, isMobile ? 64 : 128), ballMaterial);
ball.position.set(0, 5.4, 0);
scene.add(ball);

const glowOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 24, 24),
  new THREE.MeshBasicMaterial({ color: 0xa89f48, transparent: true, opacity: 0.3 })
);
glowOrb.position.copy(ball.position);
scene.add(glowOrb);

// ── Fragments ──
const fragments = [];

function createFragment() {
  const size = 0.045 + Math.random() * 0.06;
  const fragment = new THREE.Mesh(
    new THREE.IcosahedronGeometry(size, 0),
    new THREE.MeshStandardMaterial({ color: 0xf3e9d5, roughness: 0.34, metalness: 0.04 })
  );
  fragment.position.copy(ball.position);
  fragment.userData = {
    vx: (Math.random() - 0.5) * 0.18,
    vy: 0.12 + Math.random() * 0.18,
    vz: (Math.random() - 0.5) * 0.18,
    life: 1.5 + Math.random() * 0.8
  };
  scene.add(fragment);
  fragments.push(fragment);
}

// ── Intro state ──
let introState = "falling";
let velocityY = 0;
let bounceVelocity = 0.54;
let impactTriggered = false;
let introComplete = false;
let sceneDrift = 0;

// ── Impact effects ──
function triggerImpactEffects() {
  if (impactTriggered) return;
  impactTriggered = true;

  for (let i = 0; i < FRAGMENT_COUNT; i++) createFragment();

  gsap.to(impactFlash, { opacity: 1, duration: 0.12, yoyo: true, repeat: 1, ease: "power2.out" });

  gsap.fromTo(
    impactRipple,
    { opacity: 0.9, scale: 0.2 },
    { opacity: 0, scale: 4.6, duration: 1, ease: "power2.out" }
  );

  gsap.fromTo(ring.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 5, y: 5, z: 5, duration: 1.1, ease: "power2.out" });
  gsap.fromTo(ring.material, { opacity: 0.8 }, { opacity: 0, duration: 1.1, ease: "power2.out" });

  gsap.fromTo(camera.position,
    { x: 0 },
    { x: 0.08, duration: 0.05, repeat: 5, yoyo: true, ease: "power1.inOut", onComplete: () => { camera.position.x = 0; } }
  );

  gsap.to(brand, { opacity: 0, y: 24, duration: 0.45, ease: "power2.out" });
}

// ── Reveal homepage (fixed: instant position reset → crossfade) ──
function revealHomepage() {
  if (introComplete) return;
  introComplete = true;

  // Instantly snap home to correct position — no top animation that confuses scroll
  home.style.top = "0px";
  home.style.position = "relative";
  window.scrollTo({ top: 0, behavior: "instant" });

  const tl = gsap.timeline({
    onComplete: () => {
      // Clean up Three.js objects
      ball.visible = false;
      glowOrb.visible = false;
      floor.visible = false;
      ring.visible = false;
      fragments.forEach(f => { f.visible = false; });

      // Unlock scroll
      document.body.classList.remove("no-scroll");

      // Setup scroll-driven animations NOW (positions are correct)
      setupRevealAnimations();
      setupParallax();
      setupSectionToggles();
      ScrollTrigger.refresh();
    }
  });

  // Fade out 3D canvas + intro elements
  tl.to(container, { opacity: 0.18, duration: 1.1, ease: "power2.out" }, 0);
  tl.to([brand, impactFlash, impactRipple], { opacity: 0, duration: 0.8, ease: "power2.out" }, 0);

  // Reveal hero content
  tl.from(".hero-copy > *", {
    opacity: 0,
    y: 60,
    stagger: 0.11,
    duration: 0.95,
    ease: "power4.out"
  }, 0.25);
}

// ── Animation loop ──
function animateIntro() {
  requestAnimationFrame(animateIntro);
  sceneDrift += 0.003;

  if (introState === "falling") {
    velocityY -= 0.022;
    ball.position.y += velocityY;
    ball.rotation.y += 0.08;
    ball.rotation.x += 0.03;

    if (ball.position.y <= -1.18) {
      ball.position.y = -1.18;
      introState = "impact";
      bounceVelocity = 0.5;
      triggerImpactEffects();
    }

  } else if (introState === "impact") {
    ball.position.y += bounceVelocity;
    bounceVelocity -= 0.03;
    ball.rotation.y += 0.06;

    if (bounceVelocity <= -0.02 && ball.position.y <= -0.88) {
      introState = "settle";
    }

  } else if (introState === "settle") {
    ball.position.y += (-1.05 - ball.position.y) * 0.08;
    ball.rotation.y += 0.015;

    if (!introComplete) {
      revealHomepage();
    }
  }

  glowOrb.position.copy(ball.position);
  glowOrb.scale.setScalar(1 + Math.sin(sceneDrift * 2.5) * 0.08);

  fragments.forEach(fragment => {
    fragment.userData.vy -= 0.008;
    fragment.position.x += fragment.userData.vx;
    fragment.position.y += fragment.userData.vy;
    fragment.position.z += fragment.userData.vz;
    fragment.rotation.x += 0.08;
    fragment.rotation.y += 0.06;
    fragment.userData.life -= 0.016;

    if (fragment.position.y < -1.95) {
      fragment.position.y = -1.95;
      fragment.userData.vy *= -0.38;
      fragment.userData.vx *= 0.92;
      fragment.userData.vz *= 0.92;
    }

    fragment.material.opacity = Math.max(0, Math.min(1, fragment.userData.life / 1.8));
    fragment.material.transparent = true;
  });

  floor.material.opacity = 0.22 + Math.sin(sceneDrift * 2) * 0.03;
  fillLight.intensity = 2.2 + Math.sin(sceneDrift * 2.4) * 0.3;

  renderer.render(scene, camera);
}

animateIntro();

// ── Scroll animations (called after intro) ──
function setupRevealAnimations() {
  gsap.from(".action-card", {
    scrollTrigger: { trigger: ".action-grid", start: "top 82%" },
    opacity: 0,
    y: 44,
    stagger: 0.1,
    duration: 0.75,
    ease: "power3.out"
  });

  gsap.from(".pricing-card", {
    scrollTrigger: { trigger: ".pricing-grid", start: "top 82%" },
    opacity: 0,
    y: 34,
    stagger: 0.1,
    duration: 0.7,
    ease: "power3.out"
  });

  gsap.from(".map-card, .contact-card-home", {
    scrollTrigger: { trigger: ".contact-layout", start: "top 84%" },
    opacity: 0,
    y: 38,
    stagger: 0.14,
    duration: 0.75,
    ease: "power3.out"
  });
}

function setupParallax() {
  gsap.to(".hero-copy", {
    yPercent: -8,
    ease: "none",
    scrollTrigger: {
      trigger: ".hero",
      start: "top top",
      end: "bottom top",
      scrub: true
    }
  });
}

function setupSectionToggles() {
  const navLinks = Array.from(document.querySelectorAll(".links li a"));

  navLinks.forEach(link => {
    const href = link.getAttribute("href");
    if (href === "./index.html" || href === "/") {
      link.classList.add("is-active");
    }
  });
}

// ── Mobile menu ──
function setupMenu() {
  const toggleMenu = (open) => {
    mobileMenu.classList.toggle("open", open);
    burger.classList.toggle("active", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    // Prevent body scroll when menu open
    if (open) {
      document.body.classList.add("no-scroll");
    } else {
      document.body.classList.remove("no-scroll");
    }
  };

  burger.addEventListener("click", () => toggleMenu(!mobileMenu.classList.contains("open")));
  menuClose.addEventListener("click", () => toggleMenu(false));

  document.querySelectorAll(".menu-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleMenu(false));

    btn.addEventListener("mousemove", (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rx = (y - rect.height / 2) / 7;
      const ry = (rect.width / 2 - x) / 7;
      btn.style.transform = `perspective(400px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    });

    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "perspective(400px) rotateX(0) rotateY(0)";
    });
  });

  // Close menu on backdrop click
  document.addEventListener("click", (e) => {
    if (mobileMenu.classList.contains("open") &&
        !mobileMenu.contains(e.target) &&
        e.target !== burger) {
      toggleMenu(false);
    }
  });
}

// ── Nav scroll state ──
function setupNavScroll() {
  const handler = () => {
    mainNav.classList.toggle("nav-scrolled", window.scrollY > 40);
  };
  window.addEventListener("scroll", handler, { passive: true });
}

// ── Nav entrance animation (runs immediately, not scroll-gated) ──
function setupNavEntrance() {
  gsap.from(".navlogo", {
    opacity: 0,
    x: -20,
    duration: 0.7,
    ease: "power3.out",
    delay: 0.5
  });
  gsap.from(".nav-right", {
    opacity: 0,
    x: 20,
    duration: 0.7,
    ease: "power3.out",
    delay: 0.5
  });
}

// ── Cursor light tracking (desktop only) ──
if (!isMobile) {
  window.addEventListener("mousemove", (e) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = -(e.clientY / window.innerHeight) * 2 + 1;
    cursorLight.position.x = x * 2.4;
    cursorLight.position.y = y * 2;
  }, { passive: true });
}

// ── Resize ──
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}, { passive: true });

// ── User greeting + Login button ──
function setupGreeting() {
  const userName = localStorage.getItem("userName");
  const navRight = document.querySelector(".nav-right");

  if (userName) {
    const firstName = userName.split(" ")[0];

    // Desktop pill badge — click to logout
    const greetingEl   = document.getElementById("userGreeting");
    const greetingName = document.getElementById("greetingName");
    if (greetingEl && greetingName) {
      greetingName.textContent = firstName;
      greetingEl.classList.add("visible");
      greetingEl.style.cursor  = "pointer";
      greetingEl.title         = "Click to log out";
      greetingEl.addEventListener("click", () => {
        if (confirm("Log out of SkyGolf?")) {
          localStorage.removeItem("userName");
          localStorage.removeItem("phone");
          window.location.reload();
        }
      });
    }

    // Mobile menu footer
    const menuFooter = document.getElementById("menuFooterGreeting");
    if (menuFooter) menuFooter.textContent = `✦ Hello, ${firstName}`;

  } else if (navRight) {
    // Inject login link for unauthenticated visitors
    const burger    = navRight.querySelector(".burger");
    const loginLink = document.createElement("a");
    loginLink.href      = "./login.html";
    loginLink.className = "nav-login-btn";
    loginLink.textContent = "Login";
    navRight.insertBefore(loginLink, burger);

    // Mobile menu login link
    const mobileMenuItems = document.querySelector(".menu-items");
    if (mobileMenuItems) {
      const mLink = document.createElement("a");
      mLink.href      = "./login.html";
      mLink.className = "menu-btn";
      mLink.textContent = "Login";
      mobileMenuItems.appendChild(mLink);
    }
  }
}

// ── Init ──
setupMenu();
setupNavScroll();
setupNavEntrance();
setupGreeting();
