/**
 * SkyGolf — Payment Modal
 *
 * Usage from any booking page:
 *   showPaymentModal({
 *     summary:  "Table for 2 · Indoor · 8:00 PM · 12 May 2026",
 *     amount:   0,          // 0 = no online payment required
 *     onPay:    function(method, extraData) { ... }
 *     // method = "online" | "venue" | "invoice"
 *     // extraData = { company, gst } for invoice; { razorpay_payment_id } for online
 *   });
 */

(function () {

  /* ── Inject modal HTML once ─────────────────────────── */
  function ensureModal() {
    if (document.getElementById("payModal")) return;

    const el = document.createElement("div");
    el.id        = "payModal";
    el.className = "pay-overlay hidden";
    el.innerHTML = `
      <div class="pay-card">
        <div class="pay-header">
          <span class="pay-star">✦</span>
          <h2 class="pay-title">Complete Your Booking</h2>
          <button class="pay-close" id="payClose">✕</button>
        </div>

        <div class="pay-summary" id="paySummary"></div>

        <div class="pay-amount-row" id="payAmountRow">
          <span class="pay-amount-label">Amount</span>
          <span class="pay-amount-val" id="payAmountVal"></span>
        </div>

        <div class="pay-divider"></div>

        <p class="pay-choose-label">Choose how to pay</p>

        <div class="pay-options" id="payOptions">

          <button class="pay-opt" id="payOptOnline">
            <div class="pay-opt-icon">💳</div>
            <div class="pay-opt-body">
              <div class="pay-opt-name">Pay Online</div>
              <div class="pay-opt-desc">UPI · Debit / Credit Card · Net Banking</div>
            </div>
            <div class="pay-opt-arrow">→</div>
          </button>

          <button class="pay-opt" id="payOptVenue">
            <div class="pay-opt-icon">🏠</div>
            <div class="pay-opt-body">
              <div class="pay-opt-name">Pay at Venue</div>
              <div class="pay-opt-desc">Settle by cash or card when you arrive</div>
            </div>
            <div class="pay-opt-arrow">→</div>
          </button>

          <button class="pay-opt" id="payOptInvoice">
            <div class="pay-opt-icon">📋</div>
            <div class="pay-opt-body">
              <div class="pay-opt-name">Corporate Invoice</div>
              <div class="pay-opt-desc">For business bookings — we send a GST invoice</div>
            </div>
            <div class="pay-opt-arrow">→</div>
          </button>
        </div>

        <!-- Invoice sub-form (hidden until invoice selected) -->
        <div class="pay-invoice-form hidden" id="payInvoiceForm">
          <div class="pay-inv-field">
            <label>Company Name</label>
            <input type="text" id="payCompany" class="pay-inv-input" placeholder="Acme Pvt Ltd">
          </div>
          <div class="pay-inv-field">
            <label>GST Number (optional)</label>
            <input type="text" id="payGst" class="pay-inv-input" placeholder="29XXXXX1234X1ZX">
          </div>
          <button class="pay-confirm-btn" id="payInvoiceConfirm">Confirm &amp; Request Invoice</button>
        </div>

        <!-- Online not configured notice -->
        <div class="pay-online-notice hidden" id="payOnlineNotice">
          <p>Online payments are not yet configured for this venue.</p>
          <p style="margin-top:0.4rem;opacity:0.7">Please pay at the venue or use corporate invoice.</p>
        </div>

        <div class="pay-policy">
          <span>✦ Your booking is confirmed immediately</span>
          <span>◇ Cancellation allowed up to 2 hours before</span>
        </div>
      </div>`;

    document.body.appendChild(el);

    /* Close handlers */
    document.getElementById("payClose").addEventListener("click", closePayModal);
    el.addEventListener("click", e => { if (e.target === el) closePayModal(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closePayModal(); });
  }

  /* ── Inject CSS once ────────────────────────────────── */
  function ensureStyles() {
    if (document.getElementById("payStyles")) return;
    const style = document.createElement("style");
    style.id = "payStyles";
    style.textContent = `
.pay-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(8,4,4,0.82);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
}
.pay-overlay.hidden { display: none; }

.pay-card {
  background: #181414;
  border: 1px solid rgba(243,233,213,0.1);
  border-radius: 24px;
  width: 100%; max-width: 440px;
  padding: 2rem 2rem 1.5rem;
  position: relative;
  animation: paySlideUp 0.28s cubic-bezier(0.22,1,0.36,1);
}
@keyframes paySlideUp {
  from { opacity:0; transform: translateY(32px) scale(0.97); }
  to   { opacity:1; transform: translateY(0)     scale(1); }
}

.pay-header {
  display: flex; align-items: center; gap: 0.7rem;
  margin-bottom: 1.2rem;
}
.pay-star {
  color: #e26127; font-size: 0.72rem;
}
.pay-title {
  font-family: "Cormorant Garamond", serif;
  font-size: 1.45rem; font-weight: 700; color: #f3e9d5;
  flex: 1; line-height: 1;
}
.pay-close {
  background: transparent; border: none; cursor: pointer;
  color: rgba(243,233,213,0.35); font-size: 1rem; padding: 0.2rem 0.4rem;
  border-radius: 6px; transition: color 0.15s;
}
.pay-close:hover { color: #f3e9d5; }

.pay-summary {
  font-size: 0.74rem; color: rgba(243,233,213,0.55);
  background: rgba(243,233,213,0.04); border-radius: 10px;
  padding: 0.7rem 0.9rem; line-height: 1.5;
  margin-bottom: 0.8rem;
}

.pay-amount-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 0.2rem; margin-bottom: 1rem;
}
.pay-amount-label { font-size: 0.68rem; color: rgba(243,233,213,0.35); letter-spacing: 0.06em; }
.pay-amount-val {
  font-family: "Cormorant Garamond", serif;
  font-size: 1.5rem; font-weight: 700; color: #e26127;
}

.pay-divider { height: 1px; background: rgba(243,233,213,0.07); margin-bottom: 1rem; }

.pay-choose-label {
  font-size: 0.58rem; font-weight: 800; letter-spacing: 0.22em; text-transform: uppercase;
  color: rgba(243,233,213,0.3); margin-bottom: 0.7rem;
}

.pay-options { display: flex; flex-direction: column; gap: 0.55rem; margin-bottom: 1rem; }

.pay-opt {
  display: flex; align-items: center; gap: 0.9rem;
  background: rgba(243,233,213,0.03); border: 1px solid rgba(243,233,213,0.09);
  border-radius: 14px; padding: 0.85rem 1rem; cursor: pointer; text-align: left;
  width: 100%; transition: border-color 0.18s, background 0.18s;
}
.pay-opt:hover {
  border-color: rgba(226,97,39,0.45);
  background: rgba(226,97,39,0.07);
}
.pay-opt-icon { font-size: 1.3rem; flex-shrink: 0; }
.pay-opt-body { flex: 1; }
.pay-opt-name { font-size: 0.82rem; font-weight: 700; color: #f3e9d5; margin-bottom: 0.15rem; }
.pay-opt-desc { font-size: 0.63rem; color: rgba(243,233,213,0.38); }
.pay-opt-arrow { color: rgba(243,233,213,0.2); font-size: 0.9rem; flex-shrink: 0; }
.pay-opt:hover .pay-opt-arrow { color: #e26127; }

.pay-invoice-form {
  background: rgba(243,233,213,0.03); border: 1px solid rgba(243,233,213,0.08);
  border-radius: 14px; padding: 1rem; margin-bottom: 0.8rem;
  display: flex; flex-direction: column; gap: 0.7rem;
}
.pay-invoice-form.hidden { display: none; }
.pay-inv-field { display: flex; flex-direction: column; gap: 0.3rem; }
.pay-inv-field label { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.07em; color: rgba(243,233,213,0.4); }
.pay-inv-input {
  background: rgba(20,17,17,0.7); border: 1px solid rgba(243,233,213,0.12);
  border-radius: 8px; padding: 0.55rem 0.75rem; color: #f3e9d5;
  font-family: "Manrope", sans-serif; font-size: 0.8rem; outline: none;
}
.pay-inv-input:focus { border-color: rgba(226,97,39,0.5); }
.pay-confirm-btn {
  background: #e26127; border: none; border-radius: 10px;
  color: #fff; font-family: "Manrope", sans-serif; font-size: 0.72rem;
  font-weight: 700; letter-spacing: 0.07em; padding: 0.65rem 1.2rem;
  cursor: pointer; transition: background 0.18s; margin-top: 0.2rem;
}
.pay-confirm-btn:hover { background: #c94f1a; }

.pay-online-notice {
  background: rgba(226,97,39,0.08); border: 1px solid rgba(226,97,39,0.2);
  border-radius: 12px; padding: 0.9rem 1rem; margin-bottom: 0.8rem;
  font-size: 0.7rem; color: rgba(243,233,213,0.65); line-height: 1.5;
}
.pay-online-notice.hidden { display: none; }

.pay-policy {
  display: flex; flex-direction: column; gap: 0.2rem;
  font-size: 0.58rem; color: rgba(243,233,213,0.22); padding-top: 0.8rem;
  border-top: 1px solid rgba(243,233,213,0.05); margin-top: 0.5rem;
}
    `;
    document.head.appendChild(style);
  }

  let _payCallback = null;

  function closePayModal() {
    const modal = document.getElementById("payModal");
    if (modal) modal.classList.add("hidden");
    _payCallback = null;
  }

  /* ── Public API ─────────────────────────────────────── */
  window.showPaymentModal = function ({ summary = "", amount = 0, onPay }) {
    ensureStyles();
    ensureModal();

    _payCallback = onPay;

    /* Populate */
    document.getElementById("paySummary").textContent = summary;

    const amtRow = document.getElementById("payAmountRow");
    const amtVal = document.getElementById("payAmountVal");
    if (amount > 0) {
      amtVal.textContent = "₹" + Number(amount).toLocaleString("en-IN");
      amtRow.classList.remove("hidden");
    } else {
      amtRow.classList.add("hidden");
    }

    /* Reset sub-forms */
    document.getElementById("payInvoiceForm").classList.add("hidden");
    document.getElementById("payOnlineNotice").classList.add("hidden");

    /* Reset option button visibility */
    document.getElementById("payOptOnline").style.display  = "";
    document.getElementById("payOptVenue").style.display   = "";
    document.getElementById("payOptInvoice").style.display = "";

    /* Wire option buttons */
    document.getElementById("payOptOnline").onclick   = handleOnline;
    document.getElementById("payOptVenue").onclick    = handleVenue;
    document.getElementById("payOptInvoice").onclick  = handleInvoice;
    document.getElementById("payInvoiceConfirm").onclick = handleInvoiceConfirm;

    /* Reset invoice input styles */
    const companyInput = document.getElementById("payCompany");
    if (companyInput) { companyInput.value = ""; companyInput.style.borderColor = ""; }
    const gstInput = document.getElementById("payGst");
    if (gstInput) gstInput.value = "";

    document.getElementById("payModal").classList.remove("hidden");
  };

  function handleVenue() {
    const cb = _payCallback;
    closePayModal();
    cb && cb("venue", {});
  }

  function handleInvoice() {
    document.getElementById("payInvoiceForm").classList.remove("hidden");
    document.getElementById("payOnlineNotice").classList.add("hidden");
    document.getElementById("payOptOnline").style.display   = "none";
    document.getElementById("payOptVenue").style.display    = "none";
    document.getElementById("payOptInvoice").style.display  = "none";
  }

  function handleInvoiceConfirm() {
    const company = document.getElementById("payCompany").value.trim();
    if (!company) {
      document.getElementById("payCompany").focus();
      document.getElementById("payCompany").style.borderColor = "rgba(226,97,39,0.7)";
      return;
    }
    const gst = document.getElementById("payGst").value.trim();
    const cb  = _payCallback;
    closePayModal();
    cb && cb("invoice", { company, gst });
  }

  function handleOnline() {
    const key = typeof RAZORPAY_KEY !== "undefined" ? RAZORPAY_KEY : "";
    if (!key) {
      /* Razorpay not configured */
      document.getElementById("payOnlineNotice").classList.remove("hidden");
      document.getElementById("payOptOnline").style.display = "none";
      return;
    }

    /* ── Razorpay integration ── */
    const amtVal = document.getElementById("payAmountVal").textContent;
    const amount = parseInt((amtVal || "0").replace(/[^\d]/g, "")) * 100; // paise

    const loadRazorpay = () => {
      const cb = _payCallback;
      const opts = {
        key:    key,
        amount: amount,
        currency: "INR",
        name:   "SkyGolf Club & Kitchen",
        description: "Booking Payment",
        theme:  { color: "#e26127" },
        handler: function (response) {
          closePayModal();
          cb && cb("online", { razorpay_payment_id: response.razorpay_payment_id });
        },
        modal: { ondismiss: function () { /* user closed Razorpay */ } }
      };
      const rzp = new window.Razorpay(opts);
      rzp.open();
    };

    if (window.Razorpay) {
      loadRazorpay();
    } else {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = loadRazorpay;
      document.head.appendChild(script);
    }
  }

})();
