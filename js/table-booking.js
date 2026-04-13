/**
 * SkyGolf — Table Booking
 * Fetches settings for zone capacities & max guests,
 * shows live availability per slot, uses payment.js modal,
 * then POSTs to /book-table.
 */

/* ── State ───────────────────────────────────────────────── */
let selectedTime = "";
let guestCount   = 2;
let selectedType = "Indoor";
let activeTab    = "upcoming";
let allBookings  = [];
let venueSettings = {};

const ZONE_META = {
  Indoor:  { label: "Indoor · up to 8 guests",       swatch: "fzc-indoor",  maxGuests: 8  },
  Outdoor: { label: "Outdoor · up to 10 guests",     swatch: "fzc-outdoor", maxGuests: 10 },
  VIP:     { label: "VIP Lounge · up to 12 guests",  swatch: "fzc-vip",     maxGuests: 12 },
};

const TABLE_TIMES = [];
for (let h = 11; h <= 23; h++) TABLE_TIMES.push(h + ":00");
TABLE_TIMES.push("0:00"); TABLE_TIMES.push("1:00");

/* ── Settings load ───────────────────────────────────────── */
async function loadSettings() {
  try {
    const res = await fetch(BASE + "/settings");
    venueSettings = await res.json();

    // Override ZONE_META maxGuests from settings
    if (venueSettings.max_guests_per_table) {
      Object.keys(ZONE_META).forEach(z => {
        ZONE_META[z].maxGuests = venueSettings.max_guests_per_table;
      });
    }

    // Update zone cap labels on zone cards
    const capMap = {
      Indoor:  venueSettings.capacity_indoor,
      Outdoor: venueSettings.capacity_outdoor,
      VIP:     venueSettings.capacity_vip,
    };
    document.querySelectorAll(".zone-card").forEach(card => {
      const z = card.dataset.type;
      const c = capMap[z];
      if (c !== undefined) {
        // Update the cap label: "Up to X guests per table" (c = simultaneous bookings, not guest count)
        const capEl = card.querySelector(".zone-cap");
        // Leave guest cap label as-is; just update avail if we know it
      }
    });

    // Update opening-hours strip
    const liveEl = document.querySelector(".tb-live span:last-child");
    if (liveEl && venueSettings.opening_hours) {
      liveEl.textContent = "Open · " + venueSettings.opening_hours;
    }
  } catch {
    // Silently use defaults
  }
}

/* ── Guest stepper ───────────────────────────────────────── */
window.changeGuests = function(delta) {
  const maxGuests = ZONE_META[selectedType]?.maxGuests || 20;
  guestCount = Math.min(maxGuests, Math.max(1, guestCount + delta));
  const el = document.getElementById("guestCount");
  el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip");
  el.textContent = guestCount;
  document.getElementById("guestMinus").disabled = guestCount <= 1;
  document.getElementById("guestPlus").disabled  = guestCount >= maxGuests;
};

/* ── Zone selection ──────────────────────────────────────── */
window.selectZone = function(card) {
  document.querySelectorAll(".zone-card").forEach(c => c.classList.remove("selected"));
  card.classList.add("selected");
  selectedType = card.dataset.type;

  document.getElementById("zoneCards").classList.add("has-selection");

  const meta = ZONE_META[selectedType];
  document.getElementById("fzcSwatch").className = "fzc-swatch " + meta.swatch;
  document.getElementById("fzcLabel").textContent = meta.label;

  // Re-clamp guest count for new zone
  const maxGuests = meta.maxGuests;
  if (guestCount > maxGuests) {
    guestCount = maxGuests;
    document.getElementById("guestCount").textContent = guestCount;
  }
  document.getElementById("guestPlus").disabled = guestCount >= maxGuests;

  card.classList.add("zone-pulse");
  card.addEventListener("animationend", () => card.classList.remove("zone-pulse"), { once: true });

  // Refresh slots for the new zone if date is already selected
  const date = document.getElementById("date").value;
  if (date) refreshTableSlots(date);
};

/* ── Time slots ──────────────────────────────────────────── */
function formatTime(t) {
  const [h] = t.split(":").map(Number);
  if (h === 0)  return "12:00 AM";
  if (h === 1)  return "1:00 AM";
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

  TABLE_TIMES.forEach((t, i) => {
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

async function refreshTableSlots(date) {
  if (!date) return;
  try {
    const res  = await fetch(`${BASE}/check-slots?date=${date}`);
    const data = await res.json();
    buildSlots(data.slots || {});
  } catch {
    buildSlots(null);
  }
}

document.getElementById("date").addEventListener("change", function () {
  document.getElementById("fieldDate").classList.toggle("filled", !!this.value);
  refreshTableSlots(this.value);
});

/* ── Book button → payment modal ─────────────────────────── */
window.bookTable = function() {
  const date = document.getElementById("date").value;
  const req  = document.getElementById("request").value;
  if (!date)         { alert("Please select a date.");      return; }
  if (!selectedTime) { alert("Please select a time slot."); return; }

  // Determine price for this zone
  const priceMap = {
    Indoor:  venueSettings.price_indoor_table  || 0,
    Outdoor: venueSettings.price_outdoor_table || 0,
    VIP:     venueSettings.price_vip_table     || 0,
  };
  const price  = priceMap[selectedType] || 0;
  const display = formatDate(date);
  const summary =
    `${display} at ${formatTime(selectedTime)}\n` +
    `${guestCount} guest${guestCount > 1 ? "s" : ""} · ${selectedType}` +
    (req ? `\nNote: ${req}` : "");

  if (typeof showPaymentModal === "function" && price > 0) {
    showPaymentModal({
      summary,
      amount: price,
      onPay: (method, extra) => doConfirmTable(date, req, method, extra, price),
    });
  } else {
    // No price configured — show simple confirm popup
    document.getElementById("popupContent").innerHTML =
      `<strong>${display}</strong> at ${formatTime(selectedTime)}<br>` +
      `${guestCount} guest${guestCount > 1 ? "s" : ""} · ${selectedType}` +
      (req ? `<br><em style="opacity:0.6">${req}</em>` : "");
    document.getElementById("popup").classList.remove("hidden");
  }
};

/* Called from old confirm popup (zero-price fallback) */
window.confirmBooking = function() {
  const date = document.getElementById("date").value;
  const req  = document.getElementById("request").value;
  document.getElementById("popup").classList.add("hidden");
  doConfirmTable(date, req, "venue", {}, 0);
};

async function doConfirmTable(date, req, payMethod, extra, amount) {
  const phone      = localStorage.getItem("phone") || "";
  const name       = localStorage.getItem("userName") || "";
  const payment_id = extra?.razorpay_payment_id || "";

  const btn = document.getElementById("bookBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Reserving…"; }

  try {
    const res  = await fetch(BASE + "/book-table", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        time:           selectedTime,
        guests:         guestCount,
        type:           selectedType,
        request:        req,
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
      refreshTableSlots(date);
      return;
    }
  } catch {
    const cached = JSON.parse(localStorage.getItem("sg_bookings") || "[]");
    cached.push({ date, time: selectedTime, guests: guestCount, type: selectedType });
    localStorage.setItem("sg_bookings", JSON.stringify(cached));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Reserve Table"; }
  }

  document.getElementById("successPopup").classList.remove("hidden");
  setTimeout(() => {
    document.getElementById("successPopup").classList.add("hidden");
    loadBookings();
    refreshTableSlots(date);
  }, 2400);
}

/* ── Tabs ────────────────────────────────────────────────── */
window.switchTab = function(tab) {
  activeTab = tab;
  document.getElementById("tabUpcoming").classList.toggle("active", tab === "upcoming");
  document.getElementById("tabPast").classList.toggle("active", tab === "past");
  renderActive();
};

/* ── Load bookings ───────────────────────────────────────── */
async function loadBookings() {
  const phone = localStorage.getItem("phone") || "demo";
  try {
    const res  = await fetch(`${BASE}/my-bookings?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    allBookings = data.bookings || [];
    localStorage.setItem("sg_bookings", JSON.stringify(allBookings));
  } catch {
    allBookings = JSON.parse(localStorage.getItem("sg_bookings") || "[]");
  }
  renderActive();
}

function renderActive() {
  const today = new Date().toISOString().split("T")[0];
  const list  = activeTab === "upcoming"
    ? allBookings.filter(b => b.date >= today).sort((a, b) => a.date.localeCompare(b.date))
    : allBookings.filter(b => b.date <  today).sort((a, b) => b.date.localeCompare(a.date));
  renderList(list, activeTab);
}

const CLOCK = 'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2zm0 5v5l3 2';
const USERS = 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75';
const PIN   = 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zm-9 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z';

function renderList(list, type) {
  const el = document.getElementById("bookingList");
  if (!list.length) {
    el.innerHTML = `<div class="bk-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4M8 2v4M3 10h18"/>
      </svg>
      No ${type} reservations yet</div>`;
    return;
  }
  el.innerHTML = list.map(b => {
    const d   = new Date(b.date + "T00:00:00");
    const st  = b.status || "confirmed";
    const ps  = b.payment_status || "pay_at_venue";
    return `<div class="bk-card">
      <div class="bk-left">
        <div class="bk-date-day">${d.getDate()}</div>
        <div class="bk-date-rest">${d.toLocaleDateString("en-GB",{month:"short"}).toUpperCase()}<br>${d.getFullYear()}</div>
      </div>
      <div class="bk-perf"></div>
      <div class="bk-right">
        <span class="bk-tag ${type}">${type === "upcoming" ? "✦ Soon" : "Past"}</span>
        <div class="bk-meta">
          <span class="bk-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${CLOCK}"/></svg>
            ${formatTime(b.time)}
          </span>
          <span class="bk-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${USERS}"/></svg>
            ${b.guests} guest${b.guests > 1 ? "s" : ""}
          </span>
          <span class="bk-chip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="${PIN}"/></svg>
            ${b.type}
          </span>
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

function formatDate(str) {
  return new Date(str + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/* ── 3D micro-interactions ───────────────────────────────── */
function initInteractions() {
  document.querySelectorAll(".zone-card").forEach(card => {
    const icon = card.querySelector(".zone-3d-icon");
    card.addEventListener("mousemove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.transform = `perspective(700px) rotateX(${(y-.5)*-14}deg) rotateY(${(x-.5)*14}deg) translateZ(6px) scale(1.018)`;
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
      if (icon) icon.style.transform = `translateZ(36px) translateX(${(x-.5)*8}px) translateY(${(y-.5)*8}px)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = ""; card.style.removeProperty("--mx"); card.style.removeProperty("--my");
      if (icon) icon.style.transform = "";
    });
  });

  const form = document.querySelector(".tb-form-card");
  if (form) {
    form.addEventListener("mousemove", e => {
      const r = form.getBoundingClientRect();
      form.style.transform = `perspective(1400px) rotateX(${((e.clientY-r.top)/r.height-.5)*-3.5}deg) rotateY(${((e.clientX-r.left)/r.width-.5)*3.5}deg)`;
    });
    form.addEventListener("mouseleave", () => { form.style.transform = ""; });
  }

  const bookBtn = document.getElementById("bookBtn");
  if (bookBtn) {
    bookBtn.addEventListener("mousemove", e => {
      const r = bookBtn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.24;
      const y = (e.clientY - r.top  - r.height / 2) * 0.24;
      bookBtn.style.transform = `translate(${x}px, ${y}px) translateY(-2px)`;
    });
    bookBtn.addEventListener("mouseleave", () => { bookBtn.style.transform = ""; });
  }

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

loadSettings();
loadBookings();
initInteractions();
