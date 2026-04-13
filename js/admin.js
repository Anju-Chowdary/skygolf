// BASE and RAZORPAY_KEY are provided by js/config.js loaded before this script

// ── State ─────────────────────────────────────────────────────────────────────
let adminToken     = localStorage.getItem("sg_admin_token") || "";
let allMenuItems   = [];
let allEventsAdmin = [];
let dashData       = null;
let revChart       = null;
let revPeriod      = "today";

// Pagination state per tab
const pageState = {
  tb:     { page: 1, total: 0, limit: 50 },
  golf:   { page: 1, total: 0, limit: 50 },
  evBook: { page: 1, total: 0, limit: 50 },
  users:  { page: 1, total: 0, limit: 50 },
};

// Debounce timers
const debounceTimers = {};


// ── Core Helpers ──────────────────────────────────────────────────────────────
function authHeaders() {
  return { "Content-Type": "application/json", "Authorization": "Bearer " + adminToken };
}

async function api(method, path, body) {
  const opts = { method, headers: authHeaders() };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(BASE + path, opts);
    if (res.status === 401 || res.status === 403) { adminLogout(); return null; }
    return res.json();
  } catch {
    toast("Network error — is the server running?", "error");
    return null;
  }
}

function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className   = "adm-toast " + type;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

function debounce(key, fn, delay = 350) {
  clearTimeout(debounceTimers[key]);
  debounceTimers[key] = setTimeout(() => fn(), delay);
}

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " +
         d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function fmt(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

function esc(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}


// ── Auth ──────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();
  const errEl    = document.getElementById("loginErr");
  errEl.textContent = "";

  try {
    const res  = await fetch(BASE + "/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      adminToken = data.token;
      localStorage.setItem("sg_admin_token", adminToken);
      showAdminShell();
    } else {
      errEl.textContent = data.message || "Invalid credentials";
    }
  } catch {
    errEl.textContent = "Could not reach server. Make sure app.py is running.";
  }
}

function adminLogout() {
  localStorage.removeItem("sg_admin_token");
  adminToken = "";
  document.getElementById("adminShell").classList.add("hidden");
  document.getElementById("loginOverlay").classList.remove("hidden");
}

function showAdminShell() {
  document.getElementById("loginOverlay").classList.add("hidden");
  document.getElementById("adminShell").classList.remove("hidden");
  document.getElementById("todayBadge").textContent =
    new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  loadDashboard();
}

document.addEventListener("keydown", e => {
  if (!document.getElementById("loginOverlay").classList.contains("hidden") && e.key === "Enter") adminLogin();
});


// ── Tab Switching ─────────────────────────────────────────────────────────────
function switchTab(tabName) {
  document.querySelectorAll(".adm-nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".adm-section").forEach(s => s.classList.remove("active"));

  const btn = document.querySelector(`.adm-nav-btn[data-tab="${tabName}"]`);
  const sec = document.getElementById("tab-" + tabName);
  if (btn) btn.classList.add("active");
  if (sec) sec.classList.add("active");

  const titles = {
    "dashboard":      "Dashboard",
    "table-bookings": "Table Bookings",
    "golf-bookings":  "Golf Bookings",
    "event-bookings": "Event Bookings",
    "events":         "Events",
    "menu":           "Menu",
    "users":          "Users",
    "settings":       "Settings",
  };
  document.getElementById("pageTitle").textContent = titles[tabName] || tabName;

  if (tabName === "dashboard")      loadDashboard();
  if (tabName === "table-bookings") { resetPage("tb");     loadTableBookings(); }
  if (tabName === "golf-bookings")  { resetPage("golf");   loadGolfBookings(); }
  if (tabName === "event-bookings") { resetPage("evBook"); loadEventBookings(); }
  if (tabName === "events")         loadEvents();
  if (tabName === "menu")           loadMenu();
  if (tabName === "users")          { resetPage("users"); loadUsers(); }
  if (tabName === "settings")       loadSettings();
}

document.querySelectorAll(".adm-nav-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});


// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  const data = await api("GET", "/admin/dashboard");
  if (!data) return;
  dashData = data;

  // Booking stats
  const stats = [
    { label: "Table Bookings Today",   value: data.today_table_bookings, sub: "confirmed today" },
    { label: "Total Table Bookings",   value: data.total_table_bookings, sub: "all time" },
    { label: "Golf Bookings Today",    value: data.today_golf_bookings,  sub: "confirmed today" },
    { label: "Total Golf Bookings",    value: data.total_golf_bookings,  sub: "all time" },
    { label: "Event Bookings",         value: data.total_event_bookings, sub: "all time" },
    { label: "Registered Users",       value: data.total_users,          sub: "via OTP" },
    { label: "Active Events",          value: data.total_events,         sub: "published" },
    { label: "Menu Items",             value: data.total_menu_items,     sub: "in catalogue" },
  ];
  document.getElementById("statGrid").innerHTML = stats.map(s => `
    <div class="adm-stat-card">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value">${s.value ?? 0}</div>
      <div class="stat-sub">${s.sub}</div>
    </div>`).join("");

  renderRevCards();
  renderRevChart(data.chart_data || []);
}

function switchRevPeriod(btn) {
  document.querySelectorAll(".adm-rev-tab").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  revPeriod = btn.dataset.period;
  renderRevCards();
}

function renderRevCards() {
  if (!dashData) return;
  const p = revPeriod;
  const d = dashData;
  const total = (d[`rev_${p}_golf`] || 0) + (d[`rev_${p}_table`] || 0) + (d[`rev_${p}_events`] || 0);

  const cards = [
    { label: "Total Revenue",  value: total,                      sub: p === "today" ? "Today" : p === "week" ? "Last 7 Days" : "Last 30 Days", accent: true },
    { label: "Golf Revenue",   value: d[`rev_${p}_golf`]   || 0, sub: "golf bookings" },
    { label: "Dining Revenue", value: d[`rev_${p}_table`]  || 0, sub: "table bookings" },
    { label: "Events Revenue", value: d[`rev_${p}_events`] || 0, sub: "event tickets" },
  ];
  document.getElementById("revGrid").innerHTML = cards.map(c => `
    <div class="adm-rev-card${c.accent ? " adm-rev-accent" : ""}">
      <div class="rev-label">${c.label}</div>
      <div class="rev-value">${fmt(c.value)}</div>
      <div class="rev-sub">${c.sub}</div>
    </div>`).join("");
}

function renderRevChart(chartData) {
  const ctx = document.getElementById("revChart");
  if (!ctx) return;

  if (revChart) { revChart.destroy(); revChart = null; }

  if (!chartData.length) {
    ctx.parentElement.innerHTML = `<div style="padding:2rem;text-align:center;color:rgba(243,233,213,0.25);font-size:0.78rem">No revenue data yet (only paid bookings counted)</div>`;
    return;
  }

  const labels = chartData.map(d => {
    const parts = d.date.split("-");
    return `${parts[2]}/${parts[1]}`;
  });

  revChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Golf",   data: chartData.map(d => d.golf),   backgroundColor: "rgba(158,26,26,0.75)",   borderRadius: 4 },
        { label: "Tables", data: chartData.map(d => d.table),  backgroundColor: "rgba(168,159,72,0.75)",  borderRadius: 4 },
        { label: "Events", data: chartData.map(d => d.events), backgroundColor: "rgba(79,200,122,0.75)",  borderRadius: 4 },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "rgba(243,233,213,0.55)", font: { family: "Manrope", size: 11 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ₹${Number(ctx.raw).toLocaleString("en-IN")}`
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: "rgba(243,233,213,0.4)", font: { size: 10 } }, grid: { color: "rgba(255,255,255,0.04)" } },
        y: { stacked: true, ticks: { color: "rgba(243,233,213,0.4)", font: { size: 10 }, callback: v => "₹" + v.toLocaleString("en-IN") }, grid: { color: "rgba(255,255,255,0.04)" } },
      }
    }
  });
}


// ── Status & Payment Badge Helpers ─────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    confirmed:   "adm-status-confirmed",
    pending:     "adm-status-pending",
    cancelled:   "adm-status-cancelled",
    "no-show":   "adm-status-noshow",
  };
  return `<span class="adm-status-badge ${map[status] || "adm-status-pending"}">${esc(status || "—")}</span>`;
}

function payBadge(ps) {
  const map = {
    paid:         "adm-pay-paid",
    pending:      "adm-pay-pending",
    pay_at_venue: "adm-pay-venue",
    failed:       "adm-pay-failed",
    refunded:     "adm-pay-refunded",
  };
  const labels = { pay_at_venue: "at venue" };
  return `<span class="adm-pay-badge ${map[ps] || "adm-pay-pending"}">${esc(labels[ps] || ps || "—")}</span>`;
}

// Booking status dropdown (inline change calls API immediately)
function statusDropdown(id, collection, current) {
  const opts = ["confirmed", "pending", "cancelled", "no-show"]
    .map(v => `<option value="${v}"${v === current ? " selected" : ""}>${v}</option>`)
    .join("");
  return `<select class="adm-status-select" onchange="updateStatus('${collection}','${id}',this.value)">${opts}</select>`;
}


// ── Pagination ────────────────────────────────────────────────────────────────
function resetPage(key) { pageState[key].page = 1; }

function renderPagination(containerId, key, loadFn) {
  const { page, total, limit } = pageState[key];
  const totalPages = Math.ceil(total / limit) || 1;
  const el = document.getElementById(containerId);
  if (!el) return;

  if (totalPages <= 1) { el.innerHTML = ""; return; }

  el.innerHTML = `
    <button class="adm-page-btn" onclick="${loadFn}(${page - 1})" ${page <= 1 ? "disabled" : ""}>← Prev</button>
    <span class="adm-page-info">Page ${page} of ${totalPages} <span style="opacity:0.4">(${total} total)</span></span>
    <button class="adm-page-btn" onclick="${loadFn}(${page + 1})" ${page >= totalPages ? "disabled" : ""}>Next →</button>`;
}


// ── Filter Helpers ────────────────────────────────────────────────────────────
function clearFilters(prefix) {
  const s = document.getElementById(prefix + "Search");
  const d = document.getElementById(prefix + "DateFilter");
  const f = document.getElementById(prefix + "StatusFilter");
  if (s) s.value = "";
  if (d) d.value = "";
  if (f) f.value = "";
  if (prefix === "tb")     loadTableBookings();
  if (prefix === "golf")   loadGolfBookings();
  if (prefix === "evBook") loadEventBookings();
}

function buildQuery(prefix, extras = {}) {
  const params = new URLSearchParams();
  const s = document.getElementById(prefix + "Search");
  const d = document.getElementById(prefix + "DateFilter");
  const f = document.getElementById(prefix + "StatusFilter");
  if (s?.value)  params.set("search", s.value.trim());
  if (d?.value)  params.set("date", d.value);
  if (f?.value)  params.set("status", f.value);
  for (const [k, v] of Object.entries(extras)) params.set(k, v);
  return params.toString() ? "?" + params.toString() : "";
}


// ── Table Bookings ────────────────────────────────────────────────────────────
async function loadTableBookings(page = pageState.tb.page) {
  pageState.tb.page = page;
  const qs   = buildQuery("tb", { page, limit: pageState.tb.limit });
  const data = await api("GET", "/admin/table-bookings" + qs);
  if (!data) return;

  pageState.tb.total = data.total;
  document.getElementById("tbCount").textContent =
    data.total + " record" + (data.total !== 1 ? "s" : "");

  const tbody = document.getElementById("tbBody");
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="adm-td-empty">No table bookings found</td></tr>`;
  } else {
    tbody.innerHTML = data.data.map(b => `
      <tr>
        <td>${esc(b.date)}</td>
        <td>${esc(b.time)}</td>
        <td>${esc(b.name) || "—"}</td>
        <td>${esc(b.phone)}</td>
        <td>${b.guests || "—"}</td>
        <td>${esc(b.type)}</td>
        <td>${statusDropdown(b._id, "table", b.status)}</td>
        <td>${payBadge(b.payment_status)}</td>
        <td style="font-size:0.75rem">${b.amount ? fmt(b.amount) : "—"}</td>
        <td style="font-size:0.7rem;white-space:nowrap">${fmtDateTime(b.booked_at)}</td>
        <td class="adm-action-cell">
          <button class="adm-tbl-pay" onclick="openPayStatusModal('${b._id}','table','${b.payment_status}',${b.amount||0})">₹ Pay</button>
          <button class="adm-tbl-del" onclick="deleteTableBooking('${b._id}')">Del</button>
        </td>
      </tr>`).join("");
  }

  renderPagination("tbPagination", "tb", "loadTableBookings");
}

async function updateStatus(collection, id, status) {
  const path = {
    table: `/admin/table-bookings/${id}/status`,
    golf:  `/admin/golf-bookings/${id}/status`,
    event: `/admin/event-bookings/${id}/status`,
  }[collection];
  const data = await api("PATCH", path, { status });
  if (data?.success) toast("Status updated to " + status);
  else toast("Error updating status", "error");
}

async function deleteTableBooking(id) {
  if (!confirm("Delete this booking? This cannot be undone.")) return;
  const data = await api("DELETE", "/admin/table-bookings/" + id);
  if (data?.success) { toast("Booking deleted"); loadTableBookings(); }
  else toast("Error deleting booking", "error");
}

async function exportCSV(type) {
  const prefix = type === "table-bookings" ? "tb" : type === "golf-bookings" ? "golf" : "evBook";
  const params = new URLSearchParams();
  const d = document.getElementById(prefix + "DateFilter");
  const f = document.getElementById(prefix + "StatusFilter");
  if (d?.value) params.set("date", d.value);
  if (f?.value) params.set("status", f.value);

  try {
    const res  = await fetch(`${BASE}/admin/export/${type}?${params.toString()}`, { headers: authHeaders() });
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = type + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV downloaded");
  } catch {
    toast("Export failed", "error");
  }
}


// ── Golf Bookings ─────────────────────────────────────────────────────────────
async function loadGolfBookings(page = pageState.golf.page) {
  pageState.golf.page = page;
  const qs   = buildQuery("golf", { page, limit: pageState.golf.limit });
  const data = await api("GET", "/admin/golf-bookings" + qs);
  if (!data) return;

  pageState.golf.total = data.total;
  document.getElementById("golfCount").textContent =
    data.total + " record" + (data.total !== 1 ? "s" : "");

  const tbody = document.getElementById("golfBody");
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="adm-td-empty">No golf bookings found</td></tr>`;
  } else {
    tbody.innerHTML = data.data.map(b => `
      <tr>
        <td>${esc(b.date)}</td>
        <td>${esc(b.time)}</td>
        <td>${esc(b.bay_type || b.type)}</td>
        <td>${b.players || "—"}</td>
        <td>${esc(b.duration) || "—"}</td>
        <td>${esc(b.name) || "—"}</td>
        <td>${esc(b.phone)}</td>
        <td>${statusDropdown(b._id, "golf", b.status)}</td>
        <td>${payBadge(b.payment_status)}</td>
        <td style="font-size:0.75rem">${b.amount ? fmt(b.amount) : "—"}</td>
        <td style="font-size:0.7rem;white-space:nowrap">${fmtDateTime(b.booked_at)}</td>
        <td class="adm-action-cell">
          <button class="adm-tbl-pay" onclick="openPayStatusModal('${b._id}','golf','${b.payment_status}',${b.amount||0})">₹ Pay</button>
          <button class="adm-tbl-del" onclick="deleteGolfBooking('${b._id}')">Del</button>
        </td>
      </tr>`).join("");
  }

  renderPagination("golfPagination", "golf", "loadGolfBookings");
}

async function deleteGolfBooking(id) {
  if (!confirm("Delete this golf booking?")) return;
  const data = await api("DELETE", "/admin/golf-bookings/" + id);
  if (data?.success) { toast("Booking deleted"); loadGolfBookings(); }
  else toast("Error", "error");
}


// ── Event Bookings ────────────────────────────────────────────────────────────
async function loadEventBookings(page = pageState.evBook.page) {
  pageState.evBook.page = page;
  const search = document.getElementById("evBookSearch")?.value.trim() || "";
  const status = document.getElementById("evBookStatusFilter")?.value || "";
  const params = new URLSearchParams({ page, limit: pageState.evBook.limit });
  if (search) params.set("search", search);
  if (status) params.set("status", status);

  const data = await api("GET", "/admin/event-bookings?" + params.toString());
  if (!data) return;

  pageState.evBook.total = data.total;
  document.getElementById("evBookCount").textContent =
    data.total + " booking" + (data.total !== 1 ? "s" : "");

  const tbody = document.getElementById("evBookBody");
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="adm-td-empty">No event bookings yet</td></tr>`;
  } else {
    tbody.innerHTML = data.data.map(b => `
      <tr>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.eventTitle)}</td>
        <td>${esc(b.date) || "—"}</td>
        <td>${esc(b.tier) || "General"}</td>
        <td>${b.qty}</td>
        <td>${fmt(b.total || 0)}</td>
        <td>${esc(b.name) || "—"}</td>
        <td>${esc(b.phone)}</td>
        <td>${statusDropdown(b._id, "event", b.status)}</td>
        <td>${payBadge(b.payment_status)}</td>
        <td style="font-size:0.7rem;white-space:nowrap">${fmtDateTime(b.booked_at)}</td>
        <td class="adm-action-cell">
          <button class="adm-tbl-pay" onclick="openPayStatusModal('${b._id}','event','${b.payment_status}',${b.total||0})">₹ Pay</button>
          <button class="adm-tbl-del" onclick="deleteEventBooking('${b._id}')">Cancel</button>
        </td>
      </tr>`).join("");
  }

  renderPagination("evBookPagination", "evBook", "loadEventBookings");
}

async function deleteEventBooking(id) {
  if (!confirm("Cancel this event booking? Availability will be restored.")) return;
  const data = await api("DELETE", "/admin/event-bookings/" + id);
  if (data?.success) { toast("Booking cancelled"); loadEventBookings(); }
  else toast("Error cancelling booking", "error");
}


// ── Payment Status Modal ──────────────────────────────────────────────────────
function openPayStatusModal(id, collection, currentStatus, currentAmount) {
  document.getElementById("payStatusId").value         = id;
  document.getElementById("payStatusCollection").value = collection;
  document.getElementById("payStatusSelect").value     = currentStatus || "pending";
  document.getElementById("payStatusPaymentId").value  = "";
  document.getElementById("payStatusAmount").value     = currentAmount > 0 ? currentAmount : "";
  document.getElementById("payStatusModal").classList.remove("hidden");
}

function closePayStatusModal() {
  document.getElementById("payStatusModal").classList.add("hidden");
}

async function savePayStatus() {
  const id         = document.getElementById("payStatusId").value;
  const collection = document.getElementById("payStatusCollection").value;
  const ps         = document.getElementById("payStatusSelect").value;
  const paymentId  = document.getElementById("payStatusPaymentId").value.trim();
  const amountRaw  = document.getElementById("payStatusAmount").value;
  const amount     = amountRaw !== "" ? parseFloat(amountRaw) : undefined;

  const path = {
    table: `/admin/table-bookings/${id}/payment`,
    golf:  `/admin/golf-bookings/${id}/payment`,
    event: `/admin/event-bookings/${id}/payment`,
  }[collection];

  const body = { payment_status: ps };
  if (paymentId) body.payment_id = paymentId;
  if (amount !== undefined) body.amount = amount;

  const data = await api("PATCH", path, body);
  if (data?.success) {
    toast("Payment updated to " + ps);
    closePayStatusModal();
    if (collection === "table") loadTableBookings();
    if (collection === "golf")  loadGolfBookings();
    if (collection === "event") loadEventBookings();
  } else {
    toast("Error updating payment", "error");
  }
}


// ── Events CRUD ───────────────────────────────────────────────────────────────
async function loadEvents() {
  const data = await api("GET", "/admin/events");
  if (!data) return;
  allEventsAdmin = data;
  document.getElementById("evCount").textContent = data.length + " event" + (data.length !== 1 ? "s" : "");
  renderEventsGrid();
}

function renderEventsGrid() {
  const grid = document.getElementById("evGrid");
  if (!allEventsAdmin.length) {
    grid.innerHTML = `<div class="adm-td-empty">No events yet. Add one!</div>`;
    return;
  }
  grid.innerHTML = allEventsAdmin.map(ev => {
    const priceLabel = ev.priceType === "contact" ? "Enquire" :
      ev.priceType === "single" ? fmt(ev.price) :
      "From " + fmt(Math.min(...(ev.tiers || []).map(t => t.price)));
    const totalCap = ev.priceType === "single" ? ev.total : (ev.tiers || []).reduce((s, t) => s + (t.total || 0), 0);
    const availCap = ev.priceType === "single" ? ev.available : (ev.tiers || []).reduce((s, t) => s + (t.available || 0), 0);
    const pct      = totalCap ? Math.round((availCap / totalCap) * 100) : 100;
    const cls      = pct <= 20 ? "adm-capacity-low" : pct <= 55 ? "adm-capacity-ok" : "adm-capacity-good";
    const active   = ev.active !== false;
    return `
    <div class="adm-ev-card">
      <div class="adm-ev-card-top">
        <div class="adm-ev-card-name">${esc(ev.title)}</div>
        <span class="adm-ev-card-tag">${esc(ev.tag || ev.category)}</span>
      </div>
      <div class="adm-ev-card-meta">
        <span>${esc(ev.recurring || "")}</span>
        <span>${esc(ev.time || "")}</span>
        <span>${priceLabel}</span>
      </div>
      ${totalCap ? `
      <div style="font-size:0.62rem;color:var(--muted)">${availCap} / ${totalCap} spots left</div>
      <div class="adm-capacity-bar"><div class="adm-capacity-fill ${cls}" style="width:${pct}%"></div></div>` : ""}
      <div style="font-size:0.6rem;color:${active ? "#4fc87a" : "#e05555"}">${active ? "● Published" : "○ Hidden"}</div>
      <div class="adm-card-actions">
        <button class="adm-btn-edit" onclick="editEvent('${ev._id}')">Edit</button>
        <button class="adm-btn-del"  onclick="deleteEvent('${ev._id}')">Delete</button>
      </div>
    </div>`;
  }).join("");
}

function openEventModal(ev) {
  const modal = document.getElementById("eventModal");
  document.getElementById("eventModalTitle").textContent = ev ? "Edit Event" : "Add Event";
  document.getElementById("evId").value         = ev?._id || "";
  document.getElementById("evTitle").value      = ev?.title?.replace("\n", " ") || "";
  document.getElementById("evSubtitle").value   = ev?.subtitle || "";
  document.getElementById("evCategory").value   = ev?.category || "music";
  document.getElementById("evTag").value        = ev?.tag || "";
  document.getElementById("evRecurring").value  = ev?.recurring || "";
  document.getElementById("evTime").value       = ev?.time || "";
  document.getElementById("evDesc").value       = ev?.description || "";
  document.getElementById("evDates").value      = (ev?.dates || []).join(", ");
  document.getElementById("evPriceType").value  = ev?.priceType || "single";
  document.getElementById("evActive").value     = String(ev?.active !== false);
  document.getElementById("evPrice").value      = ev?.price || "";
  document.getElementById("evAvailable").value  = ev?.available || "";
  document.getElementById("evTotal").value      = ev?.total || "";
  document.getElementById("evMaxPer").value     = ev?.maxPerBooking || 10;
  document.getElementById("evNote").value       = ev?.note || "";
  document.getElementById("tierRows").innerHTML = "";
  (ev?.tiers || []).forEach(t => addTierRow(t));
  togglePriceFields();
  modal.classList.remove("hidden");
}

function closeEventModal() { document.getElementById("eventModal").classList.add("hidden"); }

function editEvent(id) {
  const ev = allEventsAdmin.find(e => e._id === id);
  if (ev) openEventModal(ev);
}

function togglePriceFields() {
  const type = document.getElementById("evPriceType").value;
  document.getElementById("evSingleFields").classList.toggle("hidden", type !== "single");
  document.getElementById("evTierFields").classList.toggle("hidden", type !== "variant");
}

function addTierRow(t) {
  const container = document.getElementById("tierRows");
  if (!container.querySelector(".tier-row-head")) {
    const head = document.createElement("div");
    head.className = "tier-row";
    head.innerHTML = `<div class="tier-row-head">Name</div><div class="tier-row-head">Price</div><div class="tier-row-head">Available</div><div class="tier-row-head">Total</div><div></div>`;
    container.appendChild(head);
  }
  const row = document.createElement("div");
  row.className = "tier-row";
  row.innerHTML = `
    <input type="text"   class="adm-input" placeholder="e.g. VIP Suite" value="${esc(t?.name || "")}">
    <input type="number" class="adm-input" placeholder="Price"           value="${t?.price || ""}">
    <input type="number" class="adm-input" placeholder="Available"       value="${t?.available || ""}">
    <input type="number" class="adm-input" placeholder="Total"           value="${t?.total || ""}">
    <button class="adm-tier-del" onclick="this.closest('.tier-row').remove()">×</button>`;
  container.appendChild(row);
}

async function saveEvent() {
  const id        = document.getElementById("evId").value;
  const priceType = document.getElementById("evPriceType").value;
  const dates     = document.getElementById("evDates").value.split(",").map(d => d.trim()).filter(Boolean);
  const body      = {
    title:       document.getElementById("evTitle").value.trim(),
    subtitle:    document.getElementById("evSubtitle").value.trim(),
    category:    document.getElementById("evCategory").value,
    tag:         document.getElementById("evTag").value.trim(),
    recurring:   document.getElementById("evRecurring").value.trim(),
    time:        document.getElementById("evTime").value.trim(),
    description: document.getElementById("evDesc").value.trim(),
    dates, priceType,
    active:      document.getElementById("evActive").value === "true",
    bgWord:      document.getElementById("evTitle").value.trim().split(" ")[0].toUpperCase(),
    accent:      "var(--cream)",
  };

  if (!body.title) { toast("Title is required", "error"); return; }

  if (priceType === "single") {
    body.price         = Number(document.getElementById("evPrice").value);
    body.available     = Number(document.getElementById("evAvailable").value);
    body.total         = Number(document.getElementById("evTotal").value);
    body.maxPerBooking = Number(document.getElementById("evMaxPer").value);
    body.note          = document.getElementById("evNote").value.trim();
  } else if (priceType === "variant") {
    const rows = document.querySelectorAll("#tierRows .tier-row:not(.tier-row-head)");
    body.tiers = Array.from(rows).map((row, i) => {
      const inputs = row.querySelectorAll("input");
      return {
        id:        "tier_" + i,
        name:      inputs[0].value.trim(),
        price:     Number(inputs[1].value),
        available: Number(inputs[2].value),
        total:     Number(inputs[3].value),
      };
    });
  }

  const data = id
    ? await api("PUT",  "/admin/events/" + id, body)
    : await api("POST", "/admin/events", body);

  if (data?.success || data?.id) {
    toast(id ? "Event updated" : "Event created");
    closeEventModal();
    loadEvents();
  } else {
    toast("Error saving event", "error");
  }
}

async function deleteEvent(id) {
  if (!confirm("Delete this event? This cannot be undone.")) return;
  const data = await api("DELETE", "/admin/events/" + id);
  if (data?.success) { toast("Event deleted"); loadEvents(); }
  else toast("Error", "error");
}


// ── Menu CRUD ─────────────────────────────────────────────────────────────────
async function loadMenu() {
  const data = await api("GET", "/admin/menu");
  if (!data) return;
  allMenuItems = data;
  document.getElementById("menuCount").textContent = data.length + " item" + (data.length !== 1 ? "s" : "");
  renderMenu();
}

function renderMenu() {
  const filter = document.getElementById("menuCatFilter").value;
  const items  = filter ? allMenuItems.filter(i => i.category === filter) : allMenuItems;
  const grid   = document.getElementById("menuGrid");
  if (!items.length) {
    grid.innerHTML = `<div class="adm-td-empty">No items found</div>`;
    return;
  }
  grid.innerHTML = items.map(item => `
    <div class="adm-menu-card">
      ${item.image_url
        ? `<div class="adm-menu-card-img"><img src="${BASE + esc(item.image_url)}" alt="${esc(item.name)}" loading="lazy"></div>`
        : `<div class="adm-menu-card-img adm-menu-card-img-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="8.5" cy="8.5" r="1.5"/></svg></div>`}
      <div class="adm-ev-card-top">
        <div>
          <div style="font-size:0.52rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:0.2rem">${esc(item.category)}</div>
          <div class="adm-ev-card-name">${esc(item.name)}</div>
        </div>
        <div class="adm-menu-card-price">${fmt(item.price)}</div>
      </div>
      <div style="font-size:0.68rem;color:var(--muted);line-height:1.5">${esc(item.description || "")}</div>
      <div class="adm-menu-card-status">
        ${item.sold_out ? '<span class="adm-badge-soldout">Sold Out</span>' : ""}
        ${item.tag      ? `<span class="adm-badge-tag">${esc(item.tag)}</span>` : ""}
        ${item.offer    ? `<span class="adm-badge-offer">${esc(item.offer)}</span>` : ""}
      </div>
      <div class="adm-card-actions">
        <button class="adm-btn-edit" onclick="editMenuItem('${item._id}')">Edit</button>
        <button class="adm-btn-toggle ${item.sold_out ? "sold" : ""}" onclick="toggleSoldOut('${item._id}', ${!item.sold_out})">
          ${item.sold_out ? "Mark Available" : "Mark Sold Out"}
        </button>
        <button class="adm-btn-del" onclick="deleteMenuItem('${item._id}')">Delete</button>
      </div>
    </div>`).join("");
}

function openMenuModal(item) {
  document.getElementById("menuModalTitle").textContent = item ? "Edit Item" : "Add Item";
  document.getElementById("menuItemId").value  = item?._id || "";
  document.getElementById("miCategory").value  = item?.category || "Starters";
  document.getElementById("miName").value      = item?.name || "";
  document.getElementById("miDesc").value      = item?.description || "";
  document.getElementById("miPrice").value     = item?.price || "";
  document.getElementById("miTag").value       = item?.tag || "";
  document.getElementById("miOffer").value     = item?.offer || "";
  document.getElementById("miSoldOut").value   = String(item?.sold_out || false);
  document.getElementById("miImageUrl").value  = item?.image_url || "";
  document.getElementById("miImageFile").value = "";
  document.getElementById("miImgStatus").textContent = "";
  const wrap = document.getElementById("miImgPreviewWrap");
  const img  = document.getElementById("miImgPreview");
  if (item?.image_url) {
    img.src = BASE + item.image_url;
    wrap.style.display = "";
  } else {
    img.src = "";
    wrap.style.display = "none";
  }
  document.getElementById("menuModal").classList.remove("hidden");
}

async function handleMenuImagePick(input) {
  const file = input.files[0];
  if (!file) return;
  const status  = document.getElementById("miImgStatus");
  const saveBtn = document.getElementById("miSaveBtn");
  status.textContent = "Uploading…";
  saveBtn.disabled   = true;

  const fd = new FormData();
  fd.append("file", file);
  try {
    const res  = await fetch(BASE + "/admin/upload-image", { method: "POST", headers: { "Authorization": "Bearer " + adminToken }, body: fd });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Upload failed");
    document.getElementById("miImageUrl").value = data.url;
    const img  = document.getElementById("miImgPreview");
    img.src    = BASE + data.url;
    document.getElementById("miImgPreviewWrap").style.display = "";
    status.textContent = "✓ Uploaded";
    status.style.color = "#4fc87a";
  } catch (e) {
    status.textContent = e.message;
    status.style.color = "#e07070";
  } finally {
    saveBtn.disabled = false;
  }
}

function clearMenuImage() {
  document.getElementById("miImageUrl").value  = "";
  document.getElementById("miImageFile").value = "";
  document.getElementById("miImgPreview").src  = "";
  document.getElementById("miImgPreviewWrap").style.display = "none";
  document.getElementById("miImgStatus").textContent = "";
}

function closeMenuModal() { document.getElementById("menuModal").classList.add("hidden"); }

function editMenuItem(id) {
  const item = allMenuItems.find(i => i._id === id);
  if (item) openMenuModal(item);
}

async function saveMenuItem() {
  const id   = document.getElementById("menuItemId").value;
  const body = {
    category:    document.getElementById("miCategory").value,
    name:        document.getElementById("miName").value.trim(),
    description: document.getElementById("miDesc").value.trim(),
    price:       Number(document.getElementById("miPrice").value),
    tag:         document.getElementById("miTag").value.trim(),
    offer:       document.getElementById("miOffer").value.trim(),
    sold_out:    document.getElementById("miSoldOut").value === "true",
    image_url:   document.getElementById("miImageUrl").value.trim() || null,
  };
  if (!body.name) { toast("Name is required", "error"); return; }

  const data = id
    ? await api("PUT",  "/admin/menu/" + id, body)
    : await api("POST", "/admin/menu", body);

  if (data?.success || data?.id) {
    toast(id ? "Item updated" : "Item added");
    closeMenuModal();
    loadMenu();
  } else {
    toast("Error saving item", "error");
  }
}

async function toggleSoldOut(id, soldOut) {
  const data = await api("PUT", "/admin/menu/" + id, { sold_out: soldOut });
  if (data?.success) { toast(soldOut ? "Marked sold out" : "Marked available"); loadMenu(); }
  else toast("Error", "error");
}

async function deleteMenuItem(id) {
  if (!confirm("Delete this menu item?")) return;
  const data = await api("DELETE", "/admin/menu/" + id);
  if (data?.success) { toast("Item deleted"); loadMenu(); }
  else toast("Error", "error");
}


// ── Users ─────────────────────────────────────────────────────────────────────
async function loadUsers(page = pageState.users.page) {
  pageState.users.page = page;
  const search = document.getElementById("usersSearch")?.value.trim() || "";
  const params = new URLSearchParams({ page, limit: pageState.users.limit });
  if (search) params.set("search", search);

  const data = await api("GET", "/admin/users?" + params.toString());
  if (!data) return;

  pageState.users.total = data.total;
  document.getElementById("usersCount").textContent =
    data.total + " user" + (data.total !== 1 ? "s" : "");

  const tbody = document.getElementById("usersBody");
  if (!data.data.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="adm-td-empty">No users found</td></tr>`;
  } else {
    tbody.innerHTML = data.data.map(u => `
      <tr>
        <td>${esc(u.name) || "—"}</td>
        <td>${esc(u.phone)}</td>
        <td>${fmtDateTime(u.last_login)}</td>
        <td class="adm-action-cell">
          <button class="adm-tbl-view" onclick="showUserHistory('${u._id}','${esc(u.name)}')">History</button>
          <button class="adm-tbl-del"  onclick="deleteUser('${u._id}')">Delete</button>
        </td>
      </tr>`).join("");
  }

  renderPagination("usersPagination", "users", "loadUsers");
}

async function deleteUser(id) {
  if (!confirm("Delete this user? Their bookings will remain but the account is removed.")) return;
  const data = await api("DELETE", "/admin/users/" + id);
  if (data?.success) { toast("User deleted"); loadUsers(); }
  else toast("Error", "error");
}

async function showUserHistory(uid, name) {
  document.getElementById("userHistoryTitle").textContent = "Bookings — " + (name || "User");
  document.getElementById("userHistoryBody").innerHTML = "<div style='padding:1rem;color:var(--muted)'>Loading…</div>";
  document.getElementById("userHistoryModal").classList.remove("hidden");

  const data = await api("GET", "/admin/users/" + uid + "/bookings");
  if (!data) { document.getElementById("userHistoryBody").innerHTML = "<div style='padding:1rem;color:#e05555'>Failed to load</div>"; return; }

  let html = "";

  if (data.golf_bookings?.length) {
    html += `<div class="adm-section-heading" style="margin-bottom:0.5rem">Golf Bookings (${data.golf_bookings.length})</div>
    <div class="adm-table-wrap" style="margin-bottom:1rem">
    <table class="adm-table"><thead><tr><th>Date</th><th>Time</th><th>Bay</th><th>Players</th><th>Status</th><th>Payment</th></tr></thead>
    <tbody>${data.golf_bookings.map(b => `
      <tr>
        <td>${esc(b.date)}</td><td>${esc(b.time)}</td><td>${esc(b.bay_type)}</td>
        <td>${b.players}</td><td>${statusBadge(b.status)}</td><td>${payBadge(b.payment_status)}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
  }

  if (data.table_bookings?.length) {
    html += `<div class="adm-section-heading" style="margin-bottom:0.5rem">Table Bookings (${data.table_bookings.length})</div>
    <div class="adm-table-wrap" style="margin-bottom:1rem">
    <table class="adm-table"><thead><tr><th>Date</th><th>Time</th><th>Zone</th><th>Guests</th><th>Status</th><th>Payment</th></tr></thead>
    <tbody>${data.table_bookings.map(b => `
      <tr>
        <td>${esc(b.date)}</td><td>${esc(b.time)}</td><td>${esc(b.type)}</td>
        <td>${b.guests}</td><td>${statusBadge(b.status)}</td><td>${payBadge(b.payment_status)}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
  }

  if (data.event_bookings?.length) {
    html += `<div class="adm-section-heading" style="margin-bottom:0.5rem">Event Bookings (${data.event_bookings.length})</div>
    <div class="adm-table-wrap">
    <table class="adm-table"><thead><tr><th>Event</th><th>Date</th><th>Qty</th><th>Total</th><th>Status</th></tr></thead>
    <tbody>${data.event_bookings.map(b => `
      <tr>
        <td>${esc(b.eventTitle)}</td><td>${esc(b.date)}</td>
        <td>${b.qty}</td><td>${fmt(b.total)}</td><td>${statusBadge(b.status)}</td>
      </tr>`).join("")}
    </tbody></table></div>`;
  }

  if (!html) html = `<div style="padding:1rem;color:var(--muted)">No bookings found for this user.</div>`;
  document.getElementById("userHistoryBody").innerHTML = html;
}

function closeUserHistory() {
  document.getElementById("userHistoryModal").classList.add("hidden");
}


// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const data = await api("GET", "/admin/settings");
  if (!data) return;

  const setVal = (id, key) => {
    const el = document.getElementById(id);
    if (el && data[key] !== undefined) el.value = data[key];
  };

  setVal("set_total_tables",          "total_tables");
  setVal("set_max_guests",            "max_guests_per_table");
  setVal("set_capacity_indoor",       "capacity_indoor");
  setVal("set_capacity_outdoor",      "capacity_outdoor");
  setVal("set_capacity_vip",          "capacity_vip");
  setVal("set_total_bays",            "total_bays");
  setVal("set_capacity_standard_bay", "capacity_standard_bay");
  setVal("set_capacity_premium_bay",  "capacity_premium_bay");
  setVal("set_capacity_vip_bay",      "capacity_vip_bay");
  setVal("set_price_standard_bay",    "price_standard_bay");
  setVal("set_price_premium_bay",     "price_premium_bay");
  setVal("set_price_vip_bay",         "price_vip_bay");
  setVal("set_price_indoor_table",    "price_indoor_table");
  setVal("set_price_outdoor_table",   "price_outdoor_table");
  setVal("set_price_vip_table",       "price_vip_table");
  setVal("set_weekday_price",         "weekday_price");
  setVal("set_weekend_price",         "weekend_price");
  setVal("set_opening_hours",         "opening_hours");
}

async function saveSettings() {
  const getNum = id => { const v = document.getElementById(id)?.value; return v ? Number(v) : undefined; };
  const getStr = id => document.getElementById(id)?.value?.trim();

  const body = {
    total_tables:          getNum("set_total_tables"),
    max_guests_per_table:  getNum("set_max_guests"),
    capacity_indoor:       getNum("set_capacity_indoor"),
    capacity_outdoor:      getNum("set_capacity_outdoor"),
    capacity_vip:          getNum("set_capacity_vip"),
    total_bays:            getNum("set_total_bays"),
    capacity_standard_bay: getNum("set_capacity_standard_bay"),
    capacity_premium_bay:  getNum("set_capacity_premium_bay"),
    capacity_vip_bay:      getNum("set_capacity_vip_bay"),
    price_standard_bay:    getNum("set_price_standard_bay"),
    price_premium_bay:     getNum("set_price_premium_bay"),
    price_vip_bay:         getNum("set_price_vip_bay"),
    price_indoor_table:    getNum("set_price_indoor_table"),
    price_outdoor_table:   getNum("set_price_outdoor_table"),
    price_vip_table:       getNum("set_price_vip_table"),
    weekday_price:         getNum("set_weekday_price"),
    weekend_price:         getNum("set_weekend_price"),
    opening_hours:         getStr("set_opening_hours"),
  };

  // Remove undefined values
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const data = await api("PUT", "/admin/settings", body);
  if (data?.success) {
    toast("Settings saved");
    const msg = document.getElementById("settingsMsg");
    msg.textContent = "Saved ✓";
    setTimeout(() => msg.textContent = "", 2500);
  } else {
    toast("Error saving settings", "error");
  }
}


// ── Init ──────────────────────────────────────────────────────────────────────
if (adminToken) {
  fetch(BASE + "/admin/dashboard", { headers: authHeaders() })
    .then(r => {
      if (r.status === 401 || r.status === 403) adminLogout();
      else showAdminShell();
    })
    .catch(() => showAdminShell());
}
