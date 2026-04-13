/**
 * SkyGolf — Golf Bay Booking
 * Fetches settings from /settings, computes dynamic pricing,
 * uses payment.js modal, then POSTs to /book-golf.
 */

/* ── State ───────────────────────────────────────────────── */
let selectedTime = "";
let guestCount   = 2;
let selectedType = "Standard Bay";
let allBookings  = [];
let venueSettings = {};   // loaded from /settings

const ZONE_META = {
  "Standard Bay": { label: "Standard Bay · up to 4 players",  swatch: "fzc-indoor"  },
  "Premium Bay":  { label: "Premium Bay · up to 6 players",   swatch: "fzc-outdoor" },
  "VIP Bay":      { label: "VIP Bay · up to 8 players",       swatch: "fzc-vip"     },
};

const GOLF_TIMES = [];
for (let h = 9; h <= 22; h++) GOLF_TIMES.push(h + ":00");

/* ── Settings load ───────────────────────────────────────── */
async function loadSettings() {
  try {
    const res  = await fetch(BASE + "/settings");
    venueSettings = await res.json();

    // Update opening-hours badge in topbar
    const liveEl = document.querySelector(".tb-live span:last-child");
    if (liveEl && venueSettings.opening_hours) {
      liveEl.textContent = "Open · " + venueSettings.opening_hours;
    }

    // Update zone caps in card text
    const capMap = {
      "Standard Bay": venueSettings.capacity_standard_bay,
      "Premium Bay":  venueSettings.capacity_premium_bay,
      "VIP Bay":      venueSettings.capacity_vip_bay,
    };
    document.querySelectorAll(".zone-card").forEach(card => {
      const t = card.dataset.type;
      const c = capMap[t];
      if (c !== undefined) {
        const capEl = card.querySelector(".zone-cap");
        if (capEl) {
          const currentText = capEl.textContent;
          // Replace number at start if found
          capEl.textContent = currentText.replace(/Up to \d+ players/, `Up to ${c * 4} players`);
        }
      }
    });
  } catch {
    // No settings — use defaults silently
  }
}

/* ── Dynamic price calculation ───────────────────────────── */
function calcPrice() {
  const dateEl = document.getElementById("date");
  const date   = dateEl?.value;
  if (!date) return 0;

  const day = new Date(date + "T00:00:00").getDay(); // 0=Sun, 6=Sat
  const isWeekend = day === 0 || day === 6;

  const priceMap = {
    "Standard Bay": isWeekend ? venueSettings.weekend_price : venueSettings.weekday_price,
    "Premium Bay":  venueSettings.price_premium_bay,
    "VIP Bay":      venueSettings.price_vip_bay,
  };

  // Fall back to weekday/weekend price if per-bay prices not set
  const base = priceMap[selectedType] || (isWeekend ? venueSettings.weekend_price : venueSettings.weekday_price) || 0;
  return base;
}

function updatePriceBadge() {
  const badge = document.getElementById("priceBadge");
  if (!badge) return;
  const price = calcPrice();
  badge.textContent = price ? "₹" + Number(price).toLocaleString("en-IN") + " / session" : "";
  badge.style.display = price ? "" : "none";
}

/* ── Guest stepper ───────────────────────────────────────── */
window.changeGuests = function(delta) {
  guestCount = Math.min(8, Math.max(1, guestCount + delta));
  const el = document.getElementById("guestCount");
  el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip");
  el.textContent = guestCount;
  document.getElementById("guestMinus").disabled = guestCount <= 1;
  document.getElementById("guestPlus").disabled  = guestCount >= 8;
};

/* ── Zone selection ──────────────────────────────────────── */
window.selectZone = function(card) {
  document.querySelectorAll(".zone-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  selectedType = card.dataset.type;
  const meta = ZONE_META[selectedType];
  document.getElementById("fzcSwatch").className = "fzc-swatch " + meta.swatch;
  document.getElementById("fzcLabel").textContent = meta.label;
  card.classList.add("zone-pulse");
  card.addEventListener("animationend", () => card.classList.remove("zone-pulse"), { once: true });
  updatePriceBadge();
};

/* ── Time slots ──────────────────────────────────────────── */
function formatTime(t) {
  const [h] = t.split(":").map(Number);
  if (h === 0)  return "12:00 AM";
  if (h < 12)   return h + ":00 AM";
  if (h === 12) return "12:00 PM";
  return (h - 12) + ":00 PM";
}

function buildSlots(availMap) {
  const grid = document.getElementById("slots");
  grid.innerHTML = "";
  selectedTime = "";
  document.getElementById("fieldTime").classList.remove("filled");

  const dateVal  = document.getElementById("date")?.value || "";
  const todayStr = new Date().toISOString().split("T")[0];
  const isToday  = dateVal === todayStr;
  const nowHour  = new Date().getHours();

  GOLF_TIMES.forEach((t, i) => {
    const btn      = document.createElement("button");
    const slotHour = parseInt(t.split(":")[0]);
    const isPast   = isToday && slotHour <= nowHour;
    const avail    = isPast ? 0 : (availMap ? (availMap[t] ?? 1) : 1);
    const full     = avail === 0;
    btn.className     = "time-slot" + (full ? " slot-full" : "");
    btn.textContent   = formatTime(t) + (full ? " · Full" : "");
    btn.dataset.index = i;
    btn.disabled      = full;
    if (!full) {
      btn.onclick = () => {
        document.querySelectorAll(".time-slot").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTime = t;
        document.getElementById("fieldTime").classList.add("filled");
      };
      btn.addEventListener("mouseenter", () => {
        const all = document.querySelectorAll(".time-slot");
        const idx = parseInt(btn.dataset.index);
        if (all[idx - 1] && !all[idx - 1].disabled) all[idx - 1].classList.add("neighbor");
        if (all[idx + 1] && !all[idx + 1].disabled) all[idx + 1].classList.add("neighbor");
      });
      btn.addEventListener("mouseleave", () =>
        document.querySelectorAll(".time-slot.neighbor").forEach(b => b.classList.remove("neighbor"))
      );
    }
    grid.appendChild(btn);
  });
}

buildSlots(null);

async function refreshGolfSlots(date) {
  if (!date) return;
  try {
    const res  = await fetch(`${BASE}/check-golf-slots?date=${date}`);
    const data = await res.json();
    buildSlots(data.slots || {});
  } catch {
    buildSlots(null);
  }
}

document.getElementById("date").addEventListener("change", function () {
  document.getElementById("fieldDate").classList.toggle("filled", !!this.value);
  refreshGolfSlots(this.value);
  updatePriceBadge();
});

/* ── Book button → payment modal ─────────────────────────── */
window.bookGolf = function() {
  const date = document.getElementById("date").value;
  if (!date)         { alert("Please select a date.");       return; }
  if (!selectedTime) { alert("Please select a time slot.");  return; }

  const duration = document.getElementById("duration").value;
  const price    = calcPrice();
  const summary  =
    `${formatDate(date)} at ${formatTime(selectedTime)}\n` +
    `${guestCount} player${guestCount > 1 ? "s" : ""} · ${selectedType} · ${duration}`;

  // If payment.js modal is available, show it; otherwise fall back to old popup
  if (typeof showPaymentModal === "function" && price > 0) {
    showPaymentModal({
      summary,
      amount: price,
      onPay: (method, extra) => doConfirmGolf(date, duration, method, extra, price),
    });
  } else {
    // Free booking or no payment.js — show confirm popup
    document.getElementById("popupContent").innerHTML =
      `<strong>${formatDate(date)}</strong> at ${formatTime(selectedTime)}<br>` +
      `${guestCount} player${guestCount > 1 ? "s" : ""} · ${selectedType} · ${duration}`;
    document.getElementById("popup").classList.remove("hidden");
  }
};

/* Called from old confirm popup (no payment.js) */
window.confirmBooking = function() {
  const date     = document.getElementById("date").value;
  const duration = document.getElementById("duration").value;
  document.getElementById("popup").classList.add("hidden");
  doConfirmGolf(date, duration, "venue", {}, 0);
};

async function doConfirmGolf(date, duration, payMethod, extra, amount) {
  const phone      = localStorage.getItem("phone") || "";
  const name       = localStorage.getItem("userName") || "";
  const payment_id = extra?.razorpay_payment_id || "";

  const btn = document.getElementById("bookBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Reserving…"; }

  try {
    const res  = await fetch(BASE + "/book-golf", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        time:           selectedTime,
        bay_type:       selectedType,
        players:        guestCount,
        duration,
        phone,
        name,
        payment_method: payMethod,
        payment_status: payment_id ? "paid" : (payMethod === "online" ? "pending" : "pay_at_venue"),
        amount,
        payment_id,
      })
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.message || "Booking failed. Please try another slot.");
      refreshGolfSlots(date);
      return;
    }
  } catch {
    // Offline fallback
    const cached = JSON.parse(localStorage.getItem("sg_golf_bookings") || "[]");
    cached.push({ date, time: selectedTime, bay_type: selectedType, players: guestCount, duration });
    localStorage.setItem("sg_golf_bookings", JSON.stringify(cached));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Reserve Bay"; }
  }

  document.getElementById("successPopup").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("successPopup").classList.add("hidden");
    loadBookings();
    refreshGolfSlots(date);
  }, 2400);
}

/* ── Booking history ─────────────────────────────────────── */
async function loadBookings() {
  const phone = localStorage.getItem("phone") || "demo";
  try {
    const res  = await fetch(`${BASE}/my-golf-bookings?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    allBookings = data.bookings || [];
  } catch {
    allBookings = JSON.parse(localStorage.getItem("sg_golf_bookings") || "[]");
  }
  renderBookings();
}

function renderBookings() {
  const el    = document.getElementById("bookingList");
  const today = new Date().toISOString().split("T")[0];
  const list  = [...allBookings].sort((a, b) => b.date.localeCompare(a.date));

  if (!list.length) {
    el.innerHTML = `<div class="bk-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
      No golf bookings yet
    </div>`;
    return;
  }

  el.innerHTML = list.map(b => {
    const d    = new Date(b.date + "T00:00:00");
    const type = b.date >= today ? "upcoming" : "past";
    const st   = b.status || "confirmed";
    const ps   = b.payment_status || "pay_at_venue";
    return `<div class="bk-card">
      <div class="bk-left">
        <div class="bk-date-day">${d.getDate()}</div>
        <div class="bk-date-rest">${d.toLocaleDateString("en-GB", {month:"short"}).toUpperCase()}<br>${d.getFullYear()}</div>
      </div>
      <div class="bk-perf"></div>
      <div class="bk-right">
        <span class="bk-tag ${type}">${type === "upcoming" ? "✦ Soon" : "Past"}</span>
        <div class="bk-meta">
          <span class="bk-chip">${formatTime(b.time)}</span>
          <span class="bk-chip">${b.players || 1} player${b.players > 1 ? "s" : ""}</span>
          <span class="bk-chip">${b.bay_type || b.type || "Bay"}</span>
          ${b.duration ? `<span class="bk-chip">${b.duration}</span>` : ""}
        </div>
        <div class="bk-status-row">
          <span class="bk-status-badge bk-st-${st}">${st}</span>
          <span class="bk-pay-badge bk-ps-${ps.replace(/_/g,"-")}">${ps === "pay_at_venue" ? "pay at venue" : ps}</span>
          ${b.amount ? `<span class="bk-amount">₹${Number(b.amount).toLocaleString("en-IN")}</span>` : ""}
        </div>
      </div>
    </div>`;
  }).join("");
}

function formatDate(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/* ── 3D micro-interactions ───────────────────────────────── */
function initInteractions() {
  document.querySelectorAll(".zone-card").forEach(card => {
    const icon = card.querySelector(".zone-3d-icon");
    card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.transform = `perspective(700px) rotateX(${(y-.5)*-14}deg) rotateY(${(x-.5)*14}deg) translateZ(6px) scale(1.018)`;
      if (icon) icon.style.transform = `translateZ(36px) translateX(${(x-.5)*8}px) translateY(${(y-.5)*8}px)`;
    });
    card.addEventListener("mouseleave", () => { card.style.transform = ""; if (icon) icon.style.transform = ""; });
  });

  const listEl = document.getElementById("bookingList");
  if (listEl) {
    new MutationObserver(() => {
      listEl.querySelectorAll(".bk-card").forEach(card => {
        if (card._3d) return; card._3d = true;
        card.addEventListener("mousemove", e => {
          const r = card.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
          card.style.transform = `perspective(600px) rotateX(${(y-.5)*-8}deg) rotateY(${(x-.5)*8}deg) translateY(-6px) scale(1.018)`;
        });
        card.addEventListener("mouseleave", () => { card.style.transform = ""; });
      });
    }).observe(listEl, { childList: true, subtree: true });
  }
}

/* ── Init ────────────────────────────────────────────────── */
document.getElementById("date").min = new Date().toISOString().split("T")[0];
document.getElementById("guestMinus").disabled = true;

loadSettings().then(() => {
  updatePriceBadge();
});
loadBookings();
initInteractions();
