/**
 * SkyGolf — Events
 * Loads events from backend (falls back to static data),
 * renders an interactive book UI, integrates payment.js modal.
 */

/* ══════════════════════════════════════════
   STATIC FALLBACK (used if backend is down)
   ══════════════════════════════════════════ */
const FALLBACK_EVENTS = [
  {
    id: 1, category: "music", tag: "Live Music",
    title: "Live Jazz\nNight",
    subtitle: "The Groove Quartet",
    recurring: "Every Saturday",
    dates: ["2026-05-10","2026-05-17","2026-05-24","2026-05-31"],
    time: "8:00 PM",
    description: "An intimate evening of jazz, cocktails, and candlelit ambiance in our indoor lounge.",
    accent: "var(--cream)", bgWord: "JAZZ NIGHT",
    priceType: "variant",
    tiers: [
      { id:"floor", name:"Floor Standing", price:1500, available:38, total:60 },
      { id:"dining", name:"Dining Table",   price:3500, available:12, total:20 },
      { id:"vip",    name:"VIP Suite",      price:6000, available:4,  total:6  }
    ]
  },
  {
    id: 2, category: "dining", tag: "Dining",
    title: "Cocktail\nMasterclass",
    subtitle: "with Head Mixologist Arjun",
    recurring: "Selected Tuesdays",
    dates: ["2026-05-06","2026-05-13","2026-05-20"],
    time: "7:00 PM",
    description: "Craft 3 signature cocktails from scratch. Tasting notes, technique, and full bar access included.",
    accent: "var(--deep-red)", bgWord: "COCKTAILS",
    priceType: "single",
    price: 1800, maxPerBooking: 8, available: 14, total: 20
  },
  {
    id: 3, category: "comedy", tag: "Comedy",
    title: "Stand-Up\nComedy",
    subtitle: "ft. Ravi Patel & guests",
    recurring: "Bi-weekly Fridays",
    dates: ["2026-05-01","2026-05-15","2026-05-29"],
    time: "9:00 PM",
    description: "Two hours of curated stand-up from Hyderabad's sharpest voices. Open bar package available.",
    accent: "var(--gold)", bgWord: "COMEDY",
    priceType: "variant",
    tiers: [
      { id:"gen",  name:"General Admission", price:800,  available:45, total:60 },
      { id:"prem", name:"Premium Seating",   price:1500, available:18, total:25 }
    ]
  },
  {
    id: 4, category: "party", tag: "Party",
    title: "Ladies\nNight",
    subtitle: "DJ from midnight",
    recurring: "Every Friday",
    dates: ["2026-05-02","2026-05-09","2026-05-16","2026-05-23"],
    time: "9:00 PM",
    description: "Priority entry, complimentary welcome drink, and a DJ set from midnight. Women enter free.",
    accent: "var(--cream)", bgWord: "LADIES NIGHT",
    priceType: "single",
    price: 600, note: "Women enter free", maxPerBooking: 10, available: 60, total: 100
  },
  {
    id: 5, category: "private", tag: "Private",
    title: "Private\nBuyout",
    subtitle: "Exclusive venue experience",
    recurring: "By arrangement",
    dates: [], time: "Flexible",
    description: "Exclusive access for 50–200 guests. All bays, full dining, and event coordination included.",
    accent: "var(--deep-red)", bgWord: "PRIVATE",
    priceType: "contact"
  },
  {
    id: 6, category: "sports", tag: "Sports",
    title: "Golf\nTournament",
    subtitle: "18-hole virtual championship",
    recurring: "Monthly",
    dates: ["2026-05-18","2026-06-15"],
    time: "11 AM – 6 PM",
    description: "Compete on world-class virtual courses. Dinner and prize ceremony included for all participants.",
    accent: "var(--gold)", bgWord: "GOLF",
    priceType: "variant",
    tiers: [
      { id:"solo", name:"Solo Entry",  price:3000, available:12, total:16 },
      { id:"duo",  name:"Duo Package", price:5500, available:6,  total:8  },
      { id:"team", name:"Team of 4",   price:9000, available:3,  total:4  }
    ]
  }
];

let allEvents = [];

/* ══════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════ */
function fmt(n) { return "\u20B9" + Number(n).toLocaleString("en-IN"); }
function pad(n) { return String(n).padStart(2,"0"); }
function priceFrom(ev) {
  if (ev.priceType === "contact") return "Enquire";
  if (ev.priceType === "single")  return fmt(ev.price);
  return "From " + fmt(Math.min(...ev.tiers.map(t => t.price)));
}
function availChip(av, tot, cls) {
  if (av === 0)      return `<span class="${cls} avail-out">Sold out</span>`;
  if (av/tot <= 0.2) return `<span class="${cls} avail-low">${av} left</span>`;
  if (av/tot <= 0.5) return `<span class="${cls} avail-warn">Filling fast</span>`;
  return "";
}

/* ══════════════════════════════════════════
   BACKGROUND WORD
   ══════════════════════════════════════════ */
let bgWordTimer = null;
function setBgWord(word) {
  const el = document.getElementById("evBgWord");
  if (!el || el.textContent === word) return;
  el.classList.add("fade");
  clearTimeout(bgWordTimer);
  bgWordTimer = setTimeout(() => { el.textContent = word; el.classList.remove("fade"); }, 280);
}

const SPINES = ["#9E1A1A","#E26127","#A89F48","#2D4629","#DDA27A","#9E1A1A","#E26127","#A89F48","#2D4629","#9E1A1A"];
const COVERS = ["#191717","#1e2e1a","#2a1010","#191717","#2c1a0e","#1e2e1a","#191717","#2a1010","#1e2e1a","#191717"];

/* ══════════════════════════════════════════
   STATE
   ══════════════════════════════════════════ */
let visibleEvents  = [];
let currentIdx     = 0;
let bookingOpen    = false;
let panelEvent     = null;
let selectedDate   = null;
let selectedTierId = null;
let qty = 1, panelTotal = 0, prevTotal = 0;

/* ══════════════════════════════════════════
   BUILD — renders the book
   ══════════════════════════════════════════ */
function buildBook() {
  currentIdx  = 0;
  bookingOpen = false;
  panelEvent  = null;

  const scene = document.getElementById("bookScene");

  if (visibleEvents.length === 0) {
    scene.innerHTML = `<div class="book-empty">
      <span class="book-empty-icon">&#10022;</span>
      <p>No events in this category yet.</p>
      <button class="book-empty-reset" onclick="resetFilter()">See all events</button>
    </div>`;
    document.getElementById("evCountBadge").textContent = "0 Events";
    return;
  }

  const count = visibleEvents.length;
  document.getElementById("evCountBadge").textContent = count + " Event" + (count !== 1 ? "s" : "");

  const pagesHtml = visibleEvents.map((ev, i) => {
    const spineCol = SPINES[i % SPINES.length];
    const coverCol = COVERS[i % COVERS.length];
    return `
    <div class="book-page${i === 0 ? " is-current" : ""}" data-idx="${i}"
         style="--spine:${spineCol};--cover-bg:${coverCol}">
      <div class="bp-spread">
        <div class="bps-left">
          <button class="bps-close-btn" onclick="closeBooking()">&#8592; Back</button>
          <span class="bps-tag">${ev.tag}</span>
          <h3 class="bps-title">${ev.title.replace("\n","<br>")}</h3>
          <p class="bps-sub">${ev.subtitle}</p>
          <p class="bps-meta">${ev.recurring} &middot; ${ev.time}</p>
          <div class="bps-divider"></div>
          <p class="bps-desc">${ev.description}</p>
          <span class="bps-ghost">${pad(i+1)}</span>
        </div>
        <div class="bps-right"></div>
      </div>
      <div class="bp-cover">
        <div class="bp-cover-inner">
          <div class="bp-spine"></div>
          <div class="bp-cover-body">
            <div class="bp-frame"></div>
            <div class="bp-cover-top">
              <span class="bp-num">${pad(i+1)}</span>
              <span class="bp-tag">${ev.tag}</span>
            </div>
            <div class="bp-cover-mid">
              <h2 class="bp-title">${ev.title.replace("\n","<br>")}</h2>
              <p class="bp-sub">${ev.subtitle}</p>
            </div>
            <div class="bp-foot">
              <div class="bp-foot-left">
                <span class="bp-meta">${ev.recurring} &middot; ${ev.time}</span>
                <span class="bp-price">${priceFrom(ev)}</span>
              </div>
              <button class="bp-open-btn" onclick="openBooking(${i})">
                ${ev.priceType === "contact" ? "Enquire" : "Book Now"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");

  scene.innerHTML = `
    <div class="book-obj" id="bookObj">${pagesHtml}</div>
    <div class="book-nav">
      <button class="bn-btn" id="bnPrev" onclick="turnPage(-1)" aria-label="Previous" disabled>&#8592;</button>
      <div class="bn-info">
        <span id="bnCur">1</span>
        <span class="bn-sep">/</span>
        <span class="bn-tot" id="bnTot">${count}</span>
      </div>
      <button class="bn-btn" id="bnNext" onclick="turnPage(1)" aria-label="Next"${count < 2 ? " disabled" : ""}>&#8594;</button>
    </div>`;

  if (visibleEvents[0]?.bgWord) setBgWord(visibleEvents[0].bgWord);
}

/* ══════════════════════════════════════════
   TURN PAGE
   ══════════════════════════════════════════ */
function turnPage(dir) {
  const pages = document.querySelectorAll(".book-page");
  if (!pages.length) return;
  if (bookingOpen) closeBooking(true);

  const prev = currentIdx;
  currentIdx = Math.max(0, Math.min(visibleEvents.length - 1, currentIdx + dir));
  if (currentIdx === prev) return;

  pages[prev].classList.remove("is-current");
  pages[prev].classList.add(dir > 0 ? "go-prev" : "go-next");
  setTimeout(() => pages[prev].classList.remove("go-prev","go-next"), 750);
  pages[currentIdx].classList.add("is-current");

  updateNav();
  if (visibleEvents[currentIdx]?.bgWord) setBgWord(visibleEvents[currentIdx].bgWord);
}

function updateNav() {
  const cur  = document.getElementById("bnCur");
  const prev = document.getElementById("bnPrev");
  const next = document.getElementById("bnNext");
  if (cur)  cur.textContent = currentIdx + 1;
  if (prev) prev.disabled   = currentIdx === 0;
  if (next) next.disabled   = currentIdx === visibleEvents.length - 1;
}

/* ══════════════════════════════════════════
   BOOKING
   ══════════════════════════════════════════ */
function openBooking(idx) {
  if (!localStorage.getItem("userName")) {
    sessionStorage.setItem("sg_redirect", window.location.href);
    window.location.href = "./login.html";
    return;
  }

  currentIdx     = idx;
  panelEvent     = visibleEvents[idx];
  selectedDate   = panelEvent.dates[0] || null;
  selectedTierId = null;
  qty = 1; panelTotal = 0; prevTotal = 0;

  const page = document.querySelectorAll(".book-page")[idx];
  renderBack(page);

  const obj = document.getElementById("bookObj");
  if (obj) obj.style.width = "min(524px, 92vw)";

  requestAnimationFrame(() => {
    page.classList.add("page-open");
    bookingOpen = true;
  });
}

function closeBooking(_silent) {
  const pages = document.querySelectorAll(".book-page");
  if (pages[currentIdx]) pages[currentIdx].classList.remove("page-open");
  bookingOpen = false;
  panelEvent  = null;
  const obj = document.getElementById("bookObj");
  if (obj) obj.style.width = "";
}

/* ══════════════════════════════════════════
   RENDER BOOKING FORM
   ══════════════════════════════════════════ */
function renderBack(page) {
  const ev   = panelEvent;
  const back = page.querySelector(".bps-right");

  const datePills = ev.dates.length
    ? ev.dates.map(d => {
        const dt = new Date(d + "T00:00:00");
        return `<button class="bb-date-pill${d===selectedDate?" active":""}" data-date="${d}"
                  onclick="bbSelectDate('${d}')">
          <span class="bb-dp-wd">${dt.toLocaleDateString("en-IN",{weekday:"short"})}</span>
          <span class="bb-dp-d">${dt.getDate()}</span>
          <span class="bb-dp-m">${dt.toLocaleDateString("en-IN",{month:"short"})}</span>
        </button>`;
      }).join("")
    : `<p class="bb-no-date">Contact us to arrange a date.</p>`;

  let priceHtml = "";
  if (ev.priceType === "single") {
    priceHtml = `<div>
      <span class="bb-sec-label">Price per person</span>
      <div class="bb-single-price">${fmt(ev.price)}<span class="bb-per">/person</span></div>
      ${ev.note ? `<span class="bb-note">&#10022; ${ev.note}</span>` : ""}
      <div class="bb-avail-bar"><div class="bb-avail-fill" style="width:${Math.round(ev.available/ev.total*100)}%"></div></div>
      <div class="bb-qty-row">
        <span class="bb-sec-label" style="margin:0">Guests</span>
        <div class="bb-stepper">
          <button class="bb-step-btn" onclick="bbChangeQty(-1)">&#8722;</button>
          <span class="bb-qty-val">${qty}</span>
          <button class="bb-step-btn" onclick="bbChangeQty(1)">+</button>
        </div>
      </div>
    </div>`;
  } else if (ev.priceType === "variant") {
    priceHtml = `<div>
      <span class="bb-sec-label">Select experience</span>
      <div class="bb-tiers">
        ${ev.tiers.map(t => {
          const chip = availChip(t.available, t.total, "bb-tier-chip");
          const so = t.available === 0, act = t.id === selectedTierId;
          return `<div class="bb-tier${act?" active":""}${so?" sold-out":""}" data-tier="${t.id}"
                      onclick="${so?"":"bbSelectTier('"+t.id+"')"}">
            <div class="bb-tier-left"><span class="bb-tier-name">${t.name}</span>${chip}</div>
            <div class="bb-tier-right">
              <span class="bb-tier-price">${fmt(t.price)}</span>
              <div class="bb-tier-check${act?" on":""}">&#10003;</div>
            </div>
          </div>`;
        }).join("")}
      </div>
      <div class="bb-qty-below${selectedTierId?" on":""}">
        <div class="bb-qty-row">
          <span class="bb-sec-label" style="margin:0">Quantity</span>
          <div class="bb-stepper">
            <button class="bb-step-btn" onclick="bbChangeQty(-1)">&#8722;</button>
            <span class="bb-qty-val">${qty}</span>
            <button class="bb-step-btn" onclick="bbChangeQty(1)">+</button>
          </div>
        </div>
      </div>
    </div>`;
  } else {
    priceHtml = `<div>
      <p class="bb-contact-body">This event is built around your group. Get in touch and we'll create the right experience.</p>
      <div class="bb-contact-links">
        <a href="tel:+919999999999" class="bb-contact-link">&#128222; Call us</a>
        <a href="mailto:events@skygolf.in" class="bb-contact-link">&#9993; Email us</a>
      </div>
    </div>`;
  }

  const footer = ev.priceType === "contact" ? "" : `
    <div class="bb-footer">
      <div>
        <span class="bb-total-label">Total</span>
        <span class="bb-total-amt">${fmt(0)}</span>
      </div>
      <button class="bb-book-btn" onclick="submitBooking()" disabled>Book Event</button>
    </div>`;

  back.innerHTML = `
    <div class="bb-header">
      <span class="bb-h-tag">${ev.tag}</span>
      <div class="bb-h-title">${ev.title.replace("\n"," ")}</div>
      <span class="bb-h-time">${ev.time} &middot; ${ev.recurring}</span>
    </div>
    <div class="bb-body">
      ${ev.dates.length
        ? `<div><span class="bb-sec-label">Choose date</span><div class="bb-dates">${datePills}</div></div>`
        : `<div><span class="bb-sec-label">Date</span>${datePills}</div>`}
      ${priceHtml}
    </div>
    ${footer}`;

  bbUpdateTotal(false);
}

/* ══════════════════════════════════════════
   BOOKING FORM INTERACTIONS
   ══════════════════════════════════════════ */
function bbSelectDate(d) {
  selectedDate = d;
  const page = document.querySelectorAll(".book-page")[currentIdx];
  page.querySelectorAll(".bb-date-pill").forEach(p => p.classList.toggle("active", p.dataset.date === d));
  bbRefreshBtn();
}

function bbSelectTier(tierId) {
  selectedTierId = tierId; qty = 1;
  const page = document.querySelectorAll(".book-page")[currentIdx];
  page.querySelectorAll(".bb-tier").forEach(el => {
    const on = el.dataset.tier === tierId;
    el.classList.toggle("active", on);
    el.querySelector(".bb-tier-check")?.classList.toggle("on", on);
  });
  const row = page.querySelector(".bb-qty-below");
  if (row) { row.classList.add("on"); const qel = page.querySelector(".bb-qty-val"); if (qel) qel.textContent = qty; }
  bbUpdateTotal(); bbRefreshBtn();
}

function bbChangeQty(delta) {
  const ev  = panelEvent;
  const max = ev.priceType === "variant"
    ? (ev.tiers.find(t => t.id === selectedTierId)?.available ?? 10)
    : (ev.maxPerBooking || 10);
  qty = Math.min(max, Math.max(1, qty + delta));
  const page = document.querySelectorAll(".book-page")[currentIdx];
  const el = page?.querySelector(".bb-qty-val");
  if (el) { el.classList.remove("qty-flip"); void el.offsetWidth; el.classList.add("qty-flip"); el.textContent = qty; }
  bbUpdateTotal();
}

function bbUpdateTotal(animate) {
  const ev = panelEvent; if (!ev) return;
  let nt = 0;
  if (ev.priceType === "single") nt = ev.price * qty;
  else if (ev.priceType === "variant" && selectedTierId) {
    const t = ev.tiers.find(t => t.id === selectedTierId); if (t) nt = t.price * qty;
  }
  const page = document.querySelectorAll(".book-page")[currentIdx];
  const el = page?.querySelector(".bb-total-amt"); if (!el) return;
  if (animate !== false && nt !== prevTotal) animCount(prevTotal, nt, el); else el.textContent = fmt(nt);
  prevTotal = nt; panelTotal = nt;
  bbRefreshBtn();
}

function bbRefreshBtn() {
  const page = document.querySelectorAll(".book-page")[currentIdx];
  const btn = page?.querySelector(".bb-book-btn"); if (!btn) return;
  btn.disabled = !(selectedDate && (panelEvent.priceType !== "variant" || selectedTierId));
}

function animCount(from, to, el) {
  const dur = 320, s = performance.now();
  const tick = t => {
    const p = Math.min((t-s)/dur, 1);
    el.textContent = fmt(Math.round(from + (to-from)*(1-Math.pow(1-p,3))));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ══════════════════════════════════════════
   SUBMIT BOOKING — payment modal integration
   ══════════════════════════════════════════ */
function submitBooking() {
  const ev    = panelEvent;
  const phone = localStorage.getItem("phone") || "demo";
  const name  = localStorage.getItem("userName") || "";

  const tierLabel = ev.priceType === "variant"
    ? (ev.tiers.find(t => t.id === selectedTierId)?.name || selectedTierId)
    : "";
  const dateLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })
    : "TBA";

  const summary =
    `${ev.title.replace("\n"," ")} — ${dateLabel} at ${ev.time}\n` +
    `${qty} ticket${qty > 1 ? "s" : ""}${tierLabel ? " · " + tierLabel : ""}`;

  if (typeof showPaymentModal === "function" && panelTotal > 0) {
    showPaymentModal({
      summary,
      amount: panelTotal,
      onPay: (method, extra) => doConfirmEvent(ev, phone, name, method, extra),
    });
  } else {
    doConfirmEvent(ev, phone, name, "venue", {});
  }
}

async function doConfirmEvent(ev, phone, name, payMethod, extra) {
  const payment_id = extra?.razorpay_payment_id || "";
  const payload = {
    eventId:        ev._id || ev.id,
    eventTitle:     ev.title.replace("\n"," "),
    date:           selectedDate,
    tier:           selectedTierId,
    qty,
    total:          panelTotal,
    phone,
    name,
    payment_method: payMethod,
    payment_status: payment_id ? "paid" : (payMethod === "online" ? "pending" : "pay_at_venue"),
    payment_id,
  };

  try {
    await fetch(BASE + "/book-event", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch {
    const c = JSON.parse(localStorage.getItem("sg_event_bookings") || "[]");
    c.push(payload);
    localStorage.setItem("sg_event_bookings", JSON.stringify(c));
  }

  closeBooking();
  const p = document.getElementById("evSuccess");
  p.classList.remove("hidden");
  setTimeout(() => p.classList.add("hidden"), 2600);
}

/* ══════════════════════════════════════════
   FILTER
   ══════════════════════════════════════════ */
function resetFilter() {
  visibleEvents = [...allEvents];
  document.querySelectorAll(".evf-tab").forEach(b => b.classList.remove("active"));
  document.querySelector('.evf-tab[data-cat="all"]').classList.add("active");
  buildBook();
}

document.getElementById("evFilterBar").addEventListener("click", e => {
  const btn = e.target.closest(".evf-tab");
  if (!btn) return;
  document.querySelectorAll(".evf-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const cat = btn.dataset.cat;
  visibleEvents = cat === "all" ? [...allEvents] : allEvents.filter(ev => ev.category === cat);
  buildBook();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape")     closeBooking();
  if (e.key === "ArrowLeft")  turnPage(-1);
  if (e.key === "ArrowRight") turnPage(1);
});

/* ══════════════════════════════════════════
   LOAD FROM BACKEND
   ══════════════════════════════════════════ */
async function loadEvents() {
  document.getElementById("bookScene").innerHTML =
    `<div class="book-empty"><span class="book-empty-icon">&#10022;</span><p>Loading events&#8230;</p></div>`;

  try {
    const res = await fetch(BASE + "/events");
    if (!res.ok) throw new Error("bad response");
    const data = await res.json();
    allEvents = data.length ? data : FALLBACK_EVENTS;
  } catch {
    allEvents = FALLBACK_EVENTS;
  }

  visibleEvents = [...allEvents];
  buildBook();
}

loadEvents();
