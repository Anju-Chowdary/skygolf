from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient, DESCENDING, ASCENDING
from bson import ObjectId
from bson.errors import InvalidId
import os, random, datetime, jwt, csv, io, uuid
from functools import wraps
from dotenv import load_dotenv
from werkzeug.utils import secure_filename


load_dotenv()

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app, origins="*")

# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017")
client    = MongoClient(MONGO_URI)
db        = client["skygolf"]

col_otps     = db["otps"]
col_users    = db["users"]
col_tables   = db["table_bookings"]
col_golf     = db["golf_bookings"]
col_events   = db["events"]
col_ev_book  = db["event_bookings"]
col_menu     = db["menu_items"]
col_settings = db["settings"]

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY  = os.environ.get("SECRET_KEY", "skygolf-secret-2026")
ADMIN_USER  = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASS  = os.environ.get("ADMIN_PASSWORD", "skygolf@admin123")
OTP_TTL_MIN = 10

VALID_STATUSES         = {"pending", "confirmed", "cancelled", "no-show"}
VALID_PAYMENT_STATUSES = {"pending", "paid", "failed", "pay_at_venue", "refunded"}


# ── Helpers ───────────────────────────────────────────────────────────────────
def serial(doc):
    if doc is None:
        return None
    doc["_id"] = str(doc["_id"])
    return doc

def serial_all(docs):
    return [serial(d) for d in docs]

def get_setting(key, default=None):
    s = col_settings.find_one({"key": key})
    return s["value"] if s else default

def set_setting(key, value):
    col_settings.update_one({"key": key}, {"$set": {"value": value}}, upsert=True)

def now_iso():
    return datetime.datetime.utcnow().isoformat()

def today_str():
    return datetime.date.today().isoformat()

def days_ago_str(n):
    return (datetime.date.today() - datetime.timedelta(days=n)).isoformat()

def paginate_collection(collection, query, sort_field="booked_at", sort_dir=DESCENDING, page=1, limit=50):
    skip  = (page - 1) * limit
    total = collection.count_documents(query)
    docs  = list(collection.find(query).sort(sort_field, sort_dir).skip(skip).limit(limit))
    return serial_all(docs), total

def build_search_query(search, extra_fields=None):
    fields = ["phone", "name"] + (extra_fields or [])
    return {"$or": [{"f": {"$regex": search, "$options": "i"}} for f in fields]}

def search_or(search, fields):
    return {"$or": [{f: {"$regex": search, "$options": "i"}} for f in fields]}


# ── Admin Auth Decorator ──────────────────────────────────────────────────────
def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get("Authorization", "").replace("Bearer ", "").strip()
        if not token:
            return jsonify({"error": "No token provided"}), 401
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
            if payload.get("role") != "admin":
                return jsonify({"error": "Forbidden"}), 403
        except jwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


# ══════════════════════════════════════════════════════════════════════════════
#  PUBLIC ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def home():
    return send_from_directory(os.getcwd(), "index.html")


# ── OTP ───────────────────────────────────────────────────────────────────────
@app.route("/send-otp", methods=["POST"])
def send_otp():
    data  = request.json or {}
    name  = data.get("name", "").strip()
    phone = data.get("phone", "").strip()

    if not name or not phone:
        return jsonify({"success": False, "message": "Name and phone required"}), 400

    otp = str(random.randint(100000, 999999))
    col_otps.update_one(
        {"phone": phone},
        {"$set": {"otp": otp, "name": name, "created": datetime.datetime.utcnow()}},
        upsert=True
    )
    # In production: replace with MSG91 / Twilio SMS call
    print(f"[OTP] {phone} → {otp}")
    return jsonify({"success": True, "message": "OTP sent — check your phone"})


@app.route("/verify-otp", methods=["POST"])
def verify_otp():
    data  = request.json or {}
    name  = data.get("name", "").strip()
    phone = data.get("phone", "").strip()
    otp   = data.get("otp", "").strip()

    record = col_otps.find_one({"phone": phone})
    if not record or record.get("otp") != otp:
        return jsonify({"success": False, "message": "Invalid OTP"}), 401

    created = record.get("created")
    if created:
        age = (datetime.datetime.utcnow() - created).total_seconds() / 60
        if age > OTP_TTL_MIN:
            col_otps.delete_one({"phone": phone})
            return jsonify({"success": False, "message": "OTP expired. Please request a new one."}), 401

    col_users.update_one(
        {"phone": phone},
        {"$set": {"name": name, "last_login": datetime.datetime.utcnow()}},
        upsert=True
    )
    col_otps.delete_one({"phone": phone})
    return jsonify({"success": True, "name": name})


# ── Admin Login ───────────────────────────────────────────────────────────────
@app.route("/admin/login", methods=["POST"])
def admin_login():
    data = request.json or {}
    if data.get("username") != ADMIN_USER or data.get("password") != ADMIN_PASS:
        return jsonify({"success": False, "message": "Invalid credentials"}), 401
    token = jwt.encode(
        {"role": "admin", "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=12)},
        SECRET_KEY, algorithm="HS256"
    )
    return jsonify({"success": True, "token": token})


# ── Table Bookings (public) ───────────────────────────────────────────────────
@app.route("/book-table", methods=["POST"])
def book_table():
    data = request.json or {}
    date = data.get("date", "").strip()
    time = data.get("time", "").strip()

    if not date or not time:
        return jsonify({"success": False, "message": "Date and time are required"}), 400

    zone_type = data.get("type", "Indoor")
    cap_key   = "capacity_" + zone_type.lower().replace(" ", "_")
    capacity  = get_setting(cap_key, get_setting("total_tables", 10))
    count     = col_tables.count_documents({
        "date": date, "time": time, "type": zone_type,
        "status": {"$in": ["confirmed", "pending"]}
    })
    if count >= capacity:
        return jsonify({"success": False, "message": f"{zone_type} is fully booked for this slot."}), 409

    booking = {
        "date":           date,
        "time":           time,
        "guests":         int(data.get("guests", 1)),
        "type":           zone_type,
        "request":        data.get("request", "").strip(),
        "phone":          data.get("phone", "unknown").strip(),
        "name":           data.get("name", "").strip(),
        "status":         "confirmed",
        "booked_at":      now_iso(),
        "payment_method": data.get("payment_method", "venue"),
        "payment_status": "pending" if data.get("payment_method") == "online" else "pay_at_venue",
        "amount":         float(data.get("amount", 0)),
        "payment_id":     data.get("payment_id", ""),
    }
    result = col_tables.insert_one(booking)
    print(f"[TABLE] {date} {time} | {booking['guests']} guests | {booking['phone']}")
    return jsonify({"success": True, "id": str(result.inserted_id)})


@app.route("/my-bookings", methods=["GET"])
def my_bookings():
    phone = request.args.get("phone", "").strip()
    if not phone:
        return jsonify({"bookings": []})
    docs = list(col_tables.find({"phone": phone}).sort("date", DESCENDING))
    return jsonify({"bookings": serial_all(docs)})


@app.route("/check-slots", methods=["GET"])
def check_slots():
    date = request.args.get("date", "").strip()
    if not date:
        return jsonify({"error": "date required"}), 400

    total = get_setting("total_tables", 10)
    pipe  = [
        {"$match": {"date": date, "status": {"$in": ["confirmed", "pending"]}}},
        {"$group": {"_id": "$time", "count": {"$sum": 1}}}
    ]
    result   = list(col_tables.aggregate(pipe))
    occupied = {r["_id"]: r["count"] for r in result}

    times = [f"{h}:00" for h in range(11, 24)] + [f"{h}:00" for h in range(0, 2)]
    slots = {t: max(0, total - occupied.get(t, 0)) for t in times}

    # Zero out past slots when date is today
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    if date == today_str:
        now_hour = datetime.datetime.now().hour
        slots = {t: (0 if int(t.split(":")[0]) <= now_hour else v) for t, v in slots.items()}

    return jsonify({"date": date, "slots": slots, "total": total})


# ── Golf Bookings (public) ────────────────────────────────────────────────────
@app.route("/book-golf", methods=["POST"])
def book_golf():
    data = request.json or {}
    date = data.get("date", "").strip()
    time = data.get("time", "").strip()

    if not date or not time:
        return jsonify({"success": False, "message": "Date and time are required"}), 400

    bay_type = data.get("bay_type", data.get("type", "Standard Bay"))
    cap_key  = "capacity_" + bay_type.lower().replace(" ", "_")
    capacity = get_setting(cap_key, get_setting("total_bays", 6))
    count    = col_golf.count_documents({
        "date": date, "time": time, "bay_type": bay_type,
        "status": {"$in": ["confirmed", "pending"]}
    })
    if count >= capacity:
        return jsonify({"success": False, "message": f"{bay_type} is fully booked for this slot."}), 409

    booking = {
        "date":           date,
        "time":           time,
        "bay_type":       bay_type.strip(),
        "players":        int(data.get("players", 1)),
        "duration":       data.get("duration", "1 hour").strip(),
        "phone":          data.get("phone", "unknown").strip(),
        "name":           data.get("name", "").strip(),
        "status":         "confirmed",
        "booked_at":      now_iso(),
        "payment_method": data.get("payment_method", "venue"),
        "payment_status": "pending" if data.get("payment_method") == "online" else "pay_at_venue",
        "amount":         float(data.get("amount", 0)),
        "payment_id":     data.get("payment_id", ""),
    }
    result = col_golf.insert_one(booking)
    print(f"[GOLF] {date} {time} | {bay_type} | {booking['players']} players | {booking['phone']}")
    return jsonify({"success": True, "id": str(result.inserted_id)})


@app.route("/my-golf-bookings", methods=["GET"])
def my_golf_bookings():
    phone = request.args.get("phone", "").strip()
    if not phone:
        return jsonify({"bookings": []})
    docs = list(col_golf.find({"phone": phone}).sort("date", DESCENDING))
    return jsonify({"bookings": serial_all(docs)})


@app.route("/check-golf-slots", methods=["GET"])
def check_golf_slots():
    date = request.args.get("date", "").strip()
    if not date:
        return jsonify({"error": "date required"}), 400

    total_bays = get_setting("total_bays", 6)
    pipe       = [
        {"$match": {"date": date, "status": {"$in": ["confirmed", "pending"]}}},
        {"$group": {"_id": "$time", "count": {"$sum": 1}}}
    ]
    result   = list(col_golf.aggregate(pipe))
    occupied = {r["_id"]: r["count"] for r in result}

    times = [f"{h}:00" for h in range(9, 23)]
    slots = {t: max(0, total_bays - occupied.get(t, 0)) for t in times}

    # Zero out past slots when date is today
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    if date == today_str:
        now_hour = datetime.datetime.now().hour
        slots = {t: (0 if int(t.split(":")[0]) <= now_hour else v) for t, v in slots.items()}

    return jsonify({"date": date, "slots": slots, "total": total_bays})


@app.route("/check-zone-availability", methods=["GET"])
def check_zone_availability():
    date = request.args.get("date", "").strip()
    if not date:
        return jsonify({"error": "date required"}), 400

    zone_types  = ["Indoor", "Outdoor", "VIP"]
    times       = [f"{h}:00" for h in range(11, 24)] + ["0:00", "1:00"]
    total_slots = len(times)

    result = {}
    for ztype in zone_types:
        cap_key  = "capacity_" + ztype.lower()
        capacity = get_setting(cap_key, 4)
        full_slots = sum(
            1 for t in times
            if col_tables.count_documents({
                "date": date, "time": t, "type": ztype,
                "status": {"$in": ["confirmed", "pending"]}
            }) >= capacity
        )
        available_slots = total_slots - full_slots
        result[ztype] = {
            "available_slots": available_slots,
            "total_slots":     total_slots,
            "capacity":        capacity,
            "full":            available_slots == 0,
            "pct_used":        round((full_slots / total_slots) * 100) if total_slots else 0,
        }
    return jsonify({"date": date, "zones": result})


@app.route("/check-bay-availability", methods=["GET"])
def check_bay_availability():
    date = request.args.get("date", "").strip()
    if not date:
        return jsonify({"error": "date required"}), 400

    bay_types   = ["Standard Bay", "Premium Bay", "VIP Bay"]
    times       = [f"{h}:00" for h in range(9, 23)]
    total_slots = len(times)

    result = {}
    for btype in bay_types:
        cap_key  = "capacity_" + btype.lower().replace(" ", "_")
        capacity = get_setting(cap_key, 2)
        full_slots = sum(
            1 for t in times
            if col_golf.count_documents({
                "date": date, "time": t, "bay_type": btype,
                "status": {"$in": ["confirmed", "pending"]}
            }) >= capacity
        )
        available_slots = total_slots - full_slots
        result[btype] = {
            "available_slots": available_slots,
            "total_slots":     total_slots,
            "capacity":        capacity,
            "full":            available_slots == 0,
            "pct_used":        round((full_slots / total_slots) * 100) if total_slots else 0,
        }
    return jsonify({"date": date, "bays": result})


# ── Events (public) ───────────────────────────────────────────────────────────
@app.route("/events", methods=["GET"])
def get_events():
    docs = list(col_events.find({"active": True}).sort("order", ASCENDING))
    return jsonify(serial_all(docs))


# ── Event Bookings (public) ───────────────────────────────────────────────────
@app.route("/book-event", methods=["POST"])
def book_event():
    data     = request.json or {}
    event_id = data.get("eventId", "").strip()
    qty      = int(data.get("qty", 1))
    tier_id  = data.get("tier")

    if qty < 1:
        return jsonify({"success": False, "message": "Invalid quantity"}), 400

    if event_id:
        try:
            oid   = ObjectId(event_id)
            event = col_events.find_one({"_id": oid})
            if event:
                if event.get("priceType") == "variant" and tier_id:
                    tier = next((t for t in event.get("tiers", []) if t["id"] == tier_id), None)
                    if not tier:
                        return jsonify({"success": False, "message": "Invalid tier"}), 400
                    if tier.get("available", 0) < qty:
                        return jsonify({"success": False, "message": "Not enough spots in this tier"}), 409
                    col_events.update_one(
                        {"_id": oid, "tiers.id": tier_id},
                        {"$inc": {"tiers.$.available": -qty}}
                    )
                elif event.get("priceType") == "single":
                    if event.get("available", 0) < qty:
                        return jsonify({"success": False, "message": "Not enough spots available"}), 409
                    col_events.update_one({"_id": oid}, {"$inc": {"available": -qty}})
        except Exception as e:
            print(f"[WARN] book_event availability: {e}")

    booking = {
        "eventId":        event_id,
        "eventTitle":     data.get("eventTitle", ""),
        "date":           data.get("date", ""),
        "tier":           tier_id,
        "qty":            qty,
        "total":          float(data.get("total", 0)),
        "phone":          data.get("phone", "unknown").strip(),
        "name":           data.get("name", "").strip(),
        "status":         "confirmed",
        "booked_at":      now_iso(),
        "payment_method": data.get("payment_method", "venue"),
        "payment_status": "pending" if data.get("payment_method") == "online" else "pay_at_venue",
        "payment_id":     data.get("payment_id", ""),
    }
    result = col_ev_book.insert_one(booking)
    print(f"[EVENT] {booking['eventTitle']} | qty={qty} | ₹{booking['total']} | {booking['phone']}")
    return jsonify({"success": True, "id": str(result.inserted_id)})


# ── Menu (public) ─────────────────────────────────────────────────────────────
@app.route("/menu", methods=["GET"])
def get_menu():
    docs = list(col_menu.find().sort("order", ASCENDING))
    return jsonify(serial_all(docs))


# ── Settings (public) ─────────────────────────────────────────────────────────
@app.route("/settings", methods=["GET"])
def get_settings_public():
    keys = [
        "total_tables", "opening_hours", "max_guests_per_table", "total_bays",
        "capacity_indoor", "capacity_outdoor", "capacity_vip",
        "capacity_standard_bay", "capacity_premium_bay", "capacity_vip_bay",
        "price_standard_bay", "price_premium_bay", "price_vip_bay",
        "price_indoor_table", "price_outdoor_table", "price_vip_table",
        "weekday_price", "weekend_price",
    ]
    return jsonify({k: get_setting(k) for k in keys})


# ══════════════════════════════════════════════════════════════════════════════
#  ADMIN ROUTES  (JWT required)
# ══════════════════════════════════════════════════════════════════════════════

# ── Dashboard ─────────────────────────────────────────────────────────────────
@app.route("/admin/dashboard", methods=["GET"])
@admin_required
def admin_dashboard():
    today     = today_str()
    week_ago  = days_ago_str(7)
    month_ago = days_ago_str(30)

    def rev_sum(col, query):
        field = "total" if col is col_ev_book else "amount"
        pipe  = [
            {"$match": {**query, "payment_status": "paid"}},
            {"$group": {"_id": None, "s": {"$sum": f"${field}"}}}
        ]
        r = list(col.aggregate(pipe))
        return round(r[0]["s"], 2) if r else 0

    def rev_by_day(col, days=7):
        field  = "total" if col is col_ev_book else "amount"
        cutoff = days_ago_str(days)
        pipe   = [
            {"$match": {"payment_status": "paid", "booked_at": {"$gte": cutoff}}},
            {"$group": {"_id": {"$substr": ["$booked_at", 0, 10]}, "s": {"$sum": f"${field}"}}},
            {"$sort":  {"_id": 1}}
        ]
        return {r["_id"]: round(r["s"], 2) for r in col.aggregate(pipe)}

    # Revenue by period
    rt = {"table": {}, "golf": {}, "event": {}}
    for period, q in [
        ("today",  {"booked_at": {"$gte": today}}),
        ("week",   {"booked_at": {"$gte": week_ago}}),
        ("month",  {"booked_at": {"$gte": month_ago}}),
    ]:
        rt["table"][period] = rev_sum(col_tables,  q)
        rt["golf"][period]  = rev_sum(col_golf,    q)
        rt["event"][period] = rev_sum(col_ev_book, q)

    # 7-day chart data
    g_map = rev_by_day(col_golf,    7)
    t_map = rev_by_day(col_tables,  7)
    e_map = rev_by_day(col_ev_book, 7)
    all_dates = sorted(set(list(g_map) + list(t_map) + list(e_map)))
    chart_data = [
        {"date": d, "golf": g_map.get(d, 0), "table": t_map.get(d, 0), "events": e_map.get(d, 0)}
        for d in all_dates
    ]

    return jsonify({
        # Booking counts
        "today_table_bookings": col_tables.count_documents({"date": today}),
        "total_table_bookings": col_tables.count_documents({}),
        "today_golf_bookings":  col_golf.count_documents({"date": today}),
        "total_golf_bookings":  col_golf.count_documents({}),
        "total_event_bookings": col_ev_book.count_documents({}),
        "total_events":         col_events.count_documents({"active": True}),
        "total_menu_items":     col_menu.count_documents({}),
        "total_users":          col_users.count_documents({}),
        # Status counts
        "pending_table":    col_tables.count_documents({"status": "pending"}),
        "cancelled_table":  col_tables.count_documents({"status": "cancelled"}),
        "pending_golf":     col_golf.count_documents({"status": "pending"}),
        "cancelled_golf":   col_golf.count_documents({"status": "cancelled"}),
        # Revenue
        "rev_today":        rt["table"]["today"] + rt["golf"]["today"] + rt["event"]["today"],
        "rev_week":         rt["table"]["week"]  + rt["golf"]["week"]  + rt["event"]["week"],
        "rev_month":        rt["table"]["month"] + rt["golf"]["month"] + rt["event"]["month"],
        "rev_today_golf":   rt["golf"]["today"],
        "rev_today_table":  rt["table"]["today"],
        "rev_today_events": rt["event"]["today"],
        "rev_week_golf":    rt["golf"]["week"],
        "rev_week_table":   rt["table"]["week"],
        "rev_week_events":  rt["event"]["week"],
        "rev_month_golf":   rt["golf"]["month"],
        "rev_month_table":  rt["table"]["month"],
        "rev_month_events": rt["event"]["month"],
        # Chart
        "chart_data": chart_data,
    })


# ── Table Bookings Admin ──────────────────────────────────────────────────────
@app.route("/admin/table-bookings", methods=["GET"])
@admin_required
def admin_table_bookings():
    date   = request.args.get("date",   "").strip()
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    page   = max(1, int(request.args.get("page",  1)))
    limit  = min(200, int(request.args.get("limit", 50)))

    query = {}
    if date:   query["date"]   = date
    if status: query["status"] = status
    if search:
        query["$or"] = [
            {"phone": {"$regex": search, "$options": "i"}},
            {"name":  {"$regex": search, "$options": "i"}},
        ]

    docs, total = paginate_collection(col_tables, query, page=page, limit=limit)
    return jsonify({"data": docs, "total": total, "page": page, "limit": limit})


@app.route("/admin/table-bookings/<bid>", methods=["DELETE"])
@admin_required
def admin_delete_table_booking(bid):
    try:
        col_tables.delete_one({"_id": ObjectId(bid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/table-bookings/<bid>/status", methods=["PATCH"])
@admin_required
def admin_update_table_status(bid):
    data   = request.json or {}
    status = data.get("status", "").strip()
    if status not in VALID_STATUSES:
        return jsonify({"error": f"Invalid status. Use: {', '.join(VALID_STATUSES)}"}), 400
    try:
        col_tables.update_one(
            {"_id": ObjectId(bid)},
            {"$set": {"status": status, "updated_at": now_iso()}}
        )
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/table-bookings/<bid>/payment", methods=["PATCH"])
@admin_required
def admin_update_table_payment(bid):
    data = request.json or {}
    ps   = data.get("payment_status", "").strip()
    if ps not in VALID_PAYMENT_STATUSES:
        return jsonify({"error": "Invalid payment status"}), 400
    try:
        update = {"payment_status": ps, "updated_at": now_iso()}
        if data.get("payment_id"):          update["payment_id"] = data["payment_id"]
        if data.get("amount") is not None:  update["amount"]     = float(data["amount"])
        col_tables.update_one({"_id": ObjectId(bid)}, {"$set": update})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ── Golf Bookings Admin ───────────────────────────────────────────────────────
@app.route("/admin/golf-bookings", methods=["GET"])
@admin_required
def admin_golf_bookings():
    date   = request.args.get("date",   "").strip()
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    page   = max(1, int(request.args.get("page",  1)))
    limit  = min(200, int(request.args.get("limit", 50)))

    query = {}
    if date:   query["date"]   = date
    if status: query["status"] = status
    if search:
        query["$or"] = [
            {"phone": {"$regex": search, "$options": "i"}},
            {"name":  {"$regex": search, "$options": "i"}},
        ]

    docs, total = paginate_collection(col_golf, query, page=page, limit=limit)
    return jsonify({"data": docs, "total": total, "page": page, "limit": limit})


@app.route("/admin/golf-bookings/<bid>", methods=["DELETE"])
@admin_required
def admin_delete_golf_booking(bid):
    try:
        col_golf.delete_one({"_id": ObjectId(bid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/golf-bookings/<bid>/status", methods=["PATCH"])
@admin_required
def admin_update_golf_status(bid):
    data   = request.json or {}
    status = data.get("status", "").strip()
    if status not in VALID_STATUSES:
        return jsonify({"error": f"Invalid status. Use: {', '.join(VALID_STATUSES)}"}), 400
    try:
        col_golf.update_one(
            {"_id": ObjectId(bid)},
            {"$set": {"status": status, "updated_at": now_iso()}}
        )
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/golf-bookings/<bid>/payment", methods=["PATCH"])
@admin_required
def admin_update_golf_payment(bid):
    data = request.json or {}
    ps   = data.get("payment_status", "").strip()
    if ps not in VALID_PAYMENT_STATUSES:
        return jsonify({"error": "Invalid payment status"}), 400
    try:
        update = {"payment_status": ps, "updated_at": now_iso()}
        if data.get("payment_id"):          update["payment_id"] = data["payment_id"]
        if data.get("amount") is not None:  update["amount"]     = float(data["amount"])
        col_golf.update_one({"_id": ObjectId(bid)}, {"$set": update})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ── Event Bookings Admin ──────────────────────────────────────────────────────
@app.route("/admin/event-bookings", methods=["GET"])
@admin_required
def admin_event_bookings():
    search = request.args.get("search", "").strip()
    status = request.args.get("status", "").strip()
    page   = max(1, int(request.args.get("page",  1)))
    limit  = min(200, int(request.args.get("limit", 50)))

    query = {}
    if status: query["status"] = status
    if search:
        query["$or"] = [
            {"phone":      {"$regex": search, "$options": "i"}},
            {"name":       {"$regex": search, "$options": "i"}},
            {"eventTitle": {"$regex": search, "$options": "i"}},
        ]

    docs, total = paginate_collection(col_ev_book, query, page=page, limit=limit)
    return jsonify({"data": docs, "total": total, "page": page, "limit": limit})


@app.route("/admin/event-bookings/<bid>", methods=["DELETE"])
@admin_required
def admin_delete_event_booking(bid):
    try:
        booking = col_ev_book.find_one({"_id": ObjectId(bid)})
        if not booking:
            return jsonify({"error": "Booking not found"}), 404

        # Restore availability
        event_id = booking.get("eventId")
        qty      = int(booking.get("qty", 1))
        tier_id  = booking.get("tier")
        if event_id:
            try:
                oid   = ObjectId(event_id)
                event = col_events.find_one({"_id": oid})
                if event:
                    if event.get("priceType") == "variant" and tier_id:
                        col_events.update_one({"_id": oid, "tiers.id": tier_id}, {"$inc": {"tiers.$.available": qty}})
                    elif event.get("priceType") == "single":
                        col_events.update_one({"_id": oid}, {"$inc": {"available": qty}})
            except Exception:
                pass

        col_ev_book.delete_one({"_id": ObjectId(bid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/event-bookings/<bid>/status", methods=["PATCH"])
@admin_required
def admin_update_event_booking_status(bid):
    data   = request.json or {}
    status = data.get("status", "").strip()
    if status not in {"confirmed", "cancelled", "pending"}:
        return jsonify({"error": "Invalid status"}), 400
    try:
        col_ev_book.update_one(
            {"_id": ObjectId(bid)},
            {"$set": {"status": status, "updated_at": now_iso()}}
        )
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/event-bookings/<bid>/payment", methods=["PATCH"])
@admin_required
def admin_update_event_payment(bid):
    data = request.json or {}
    ps   = data.get("payment_status", "").strip()
    if ps not in VALID_PAYMENT_STATUSES:
        return jsonify({"error": "Invalid payment status"}), 400
    try:
        update = {"payment_status": ps, "updated_at": now_iso()}
        if data.get("payment_id"): update["payment_id"] = data["payment_id"]
        col_ev_book.update_one({"_id": ObjectId(bid)}, {"$set": update})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ── CSV Exports ───────────────────────────────────────────────────────────────
@app.route("/admin/export/table-bookings", methods=["GET"])
@admin_required
def export_table_bookings():
    query = {}
    if request.args.get("date"):   query["date"]   = request.args["date"]
    if request.args.get("status"): query["status"] = request.args["status"]
    docs   = list(col_tables.find(query).sort("booked_at", DESCENDING))
    output = io.StringIO()
    w      = csv.writer(output)
    w.writerow(["ID","Name","Phone","Date","Time","Guests","Type","Request","Status","Payment Method","Payment Status","Amount","Booked At"])
    for d in docs:
        w.writerow([str(d.get("_id","")), d.get("name",""), d.get("phone",""),
                    d.get("date",""), d.get("time",""), d.get("guests",""),
                    d.get("type",""), d.get("request",""), d.get("status",""),
                    d.get("payment_method",""), d.get("payment_status",""),
                    d.get("amount",0), d.get("booked_at","")])
    return Response(output.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment;filename=table_bookings.csv"})


@app.route("/admin/export/golf-bookings", methods=["GET"])
@admin_required
def export_golf_bookings():
    query = {}
    if request.args.get("date"):   query["date"]   = request.args["date"]
    if request.args.get("status"): query["status"] = request.args["status"]
    docs   = list(col_golf.find(query).sort("booked_at", DESCENDING))
    output = io.StringIO()
    w      = csv.writer(output)
    w.writerow(["ID","Name","Phone","Date","Time","Bay","Players","Duration","Status","Payment Method","Payment Status","Amount","Booked At"])
    for d in docs:
        w.writerow([str(d.get("_id","")), d.get("name",""), d.get("phone",""),
                    d.get("date",""), d.get("time",""), d.get("bay_type",""),
                    d.get("players",""), d.get("duration",""), d.get("status",""),
                    d.get("payment_method",""), d.get("payment_status",""),
                    d.get("amount",0), d.get("booked_at","")])
    return Response(output.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment;filename=golf_bookings.csv"})


@app.route("/admin/export/event-bookings", methods=["GET"])
@admin_required
def export_event_bookings():
    query = {}
    if request.args.get("status"): query["status"] = request.args["status"]
    docs   = list(col_ev_book.find(query).sort("booked_at", DESCENDING))
    output = io.StringIO()
    w      = csv.writer(output)
    w.writerow(["ID","Event","Date","Tier","Qty","Total","Name","Phone","Status","Payment Method","Payment Status","Booked At"])
    for d in docs:
        w.writerow([str(d.get("_id","")), d.get("eventTitle",""), d.get("date",""),
                    d.get("tier",""), d.get("qty",""), d.get("total",0),
                    d.get("name",""), d.get("phone",""), d.get("status",""),
                    d.get("payment_method",""), d.get("payment_status",""), d.get("booked_at","")])
    return Response(output.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": "attachment;filename=event_bookings.csv"})


# ── Events CRUD ───────────────────────────────────────────────────────────────
@app.route("/admin/events", methods=["GET"])
@admin_required
def admin_get_events():
    docs = list(col_events.find().sort("order", ASCENDING))
    return jsonify(serial_all(docs))


@app.route("/admin/events", methods=["POST"])
@admin_required
def admin_create_event():
    data = request.json or {}
    if not data.get("title"):
        return jsonify({"error": "title is required"}), 400
    data.setdefault("active", True)
    data.setdefault("order", col_events.count_documents({}) + 1)
    data["created_at"] = now_iso()
    result = col_events.insert_one(data)
    return jsonify({"success": True, "id": str(result.inserted_id)})


@app.route("/admin/events/<eid>", methods=["PUT"])
@admin_required
def admin_update_event(eid):
    try:
        data = request.json or {}
        data.pop("_id", None)
        col_events.update_one({"_id": ObjectId(eid)}, {"$set": data})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/events/<eid>", methods=["DELETE"])
@admin_required
def admin_delete_event(eid):
    try:
        col_events.delete_one({"_id": ObjectId(eid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ── Image upload ──────────────────────────────────────────────────────────────
UPLOAD_FOLDER   = os.path.join(os.path.dirname(__file__), "assets", "uploads")
ALLOWED_EXT     = {"jpg", "jpeg", "png", "webp", "gif"}
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXT

@app.route("/admin/upload-image", methods=["POST"])
@admin_required
def upload_image():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename or not allowed_file(f.filename):
        return jsonify({"error": "Invalid file type. Use jpg, png, webp or gif"}), 400
    ext      = f.filename.rsplit(".", 1)[1].lower()
    filename = secure_filename(f"{uuid.uuid4().hex}.{ext}")
    f.save(os.path.join(UPLOAD_FOLDER, filename))
    return jsonify({"success": True, "url": f"/uploads/{filename}"})

@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_upload(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


# ── Menu CRUD ─────────────────────────────────────────────────────────────────
@app.route("/admin/menu", methods=["GET"])
@admin_required
def admin_get_menu():
    docs = list(col_menu.find().sort("order", ASCENDING))
    return jsonify(serial_all(docs))


@app.route("/admin/menu", methods=["POST"])
@admin_required
def admin_create_menu():
    data = request.json or {}
    if not data.get("name"):
        return jsonify({"error": "name is required"}), 400
    data.setdefault("sold_out", False)
    data.setdefault("offer", "")
    data.setdefault("order", col_menu.count_documents({}) + 1)
    data["created_at"] = now_iso()
    result = col_menu.insert_one(data)
    return jsonify({"success": True, "id": str(result.inserted_id)})


@app.route("/admin/menu/<mid>", methods=["PUT"])
@admin_required
def admin_update_menu(mid):
    try:
        data = request.json or {}
        data.pop("_id", None)
        col_menu.update_one({"_id": ObjectId(mid)}, {"$set": data})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/menu/<mid>", methods=["DELETE"])
@admin_required
def admin_delete_menu(mid):
    try:
        col_menu.delete_one({"_id": ObjectId(mid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ── Settings Admin ────────────────────────────────────────────────────────────
@app.route("/admin/settings", methods=["GET"])
@admin_required
def admin_get_settings():
    docs = list(col_settings.find())
    return jsonify({d["key"]: d["value"] for d in docs})


@app.route("/admin/settings", methods=["PUT"])
@admin_required
def admin_update_settings():
    data = request.json or {}
    for key, value in data.items():
        set_setting(key, value)
    return jsonify({"success": True})


# ── Users Admin ───────────────────────────────────────────────────────────────
@app.route("/admin/users", methods=["GET"])
@admin_required
def admin_users():
    search = request.args.get("search", "").strip()
    page   = max(1, int(request.args.get("page",  1)))
    limit  = min(200, int(request.args.get("limit", 50)))

    query = {}
    if search:
        query["$or"] = [
            {"phone": {"$regex": search, "$options": "i"}},
            {"name":  {"$regex": search, "$options": "i"}},
        ]

    docs, total = paginate_collection(col_users, query, sort_field="last_login", page=page, limit=limit)
    return jsonify({"data": docs, "total": total, "page": page, "limit": limit})


@app.route("/admin/users/<uid>", methods=["DELETE"])
@admin_required
def admin_delete_user(uid):
    try:
        col_users.delete_one({"_id": ObjectId(uid)})
        return jsonify({"success": True})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


@app.route("/admin/users/<uid>/bookings", methods=["GET"])
@admin_required
def admin_user_bookings(uid):
    try:
        user = col_users.find_one({"_id": ObjectId(uid)})
        if not user:
            return jsonify({"error": "User not found"}), 404
        phone  = user.get("phone", "")
        tables = serial_all(list(col_tables.find({"phone": phone}).sort("date", DESCENDING).limit(20)))
        golf   = serial_all(list(col_golf.find({"phone": phone}).sort("date", DESCENDING).limit(20)))
        events = serial_all(list(col_ev_book.find({"phone": phone}).sort("date", DESCENDING).limit(20)))
        return jsonify({"name": user.get("name",""), "phone": phone,
                        "table_bookings": tables, "golf_bookings": golf, "event_bookings": events})
    except InvalidId:
        return jsonify({"error": "Invalid ID"}), 400


# ══════════════════════════════════════════════════════════════════════════════
#  INDEXES
# ══════════════════════════════════════════════════════════════════════════════
def create_indexes():
    # Drop conflicting old indexes (sparse vs unique) before recreating
    for col, field in [(col_otps, "phone_1"), (col_users, "phone_1")]:
        try:
            col.drop_index(field)
        except Exception:
            pass
    col_otps.create_index("phone", unique=True)
    col_otps.create_index("created", expireAfterSeconds=600)
    col_users.create_index("phone", unique=True)
    col_tables.create_index([("date", ASCENDING), ("time", ASCENDING)])
    col_tables.create_index("phone")
    col_tables.create_index("status")
    col_tables.create_index("booked_at")
    col_golf.create_index([("date", ASCENDING), ("time", ASCENDING)])
    col_golf.create_index("phone")
    col_golf.create_index("status")
    col_golf.create_index("booked_at")
    col_ev_book.create_index("phone")
    col_ev_book.create_index("eventId")
    col_ev_book.create_index("status")
    col_ev_book.create_index("booked_at")
    col_events.create_index([("active", ASCENDING), ("order", ASCENDING)])
    col_menu.create_index("order")
    print("[DB] Indexes ensured")


# ══════════════════════════════════════════════════════════════════════════════
#  SEED DEFAULTS
# ══════════════════════════════════════════════════════════════════════════════
def seed_defaults():
    defaults = {
        "total_tables":          10,
        "total_bays":            6,
        "opening_hours":         "12:00 PM – 1:00 AM",
        "max_guests_per_table":  12,
        "capacity_indoor":       4,
        "capacity_outdoor":      3,
        "capacity_vip":          3,
        "capacity_standard_bay": 3,
        "capacity_premium_bay":  2,
        "capacity_vip_bay":      1,
        "price_standard_bay":    2500,
        "price_premium_bay":     3800,
        "price_vip_bay":         5500,
        "price_indoor_table":    0,
        "price_outdoor_table":   0,
        "price_vip_table":       0,
        "weekday_price":         2500,
        "weekend_price":         3800,
    }
    for k, v in defaults.items():
        if not col_settings.find_one({"key": k}):
            set_setting(k, v)
    print("[DB] Defaults seeded")


if __name__ == "__main__":
    create_indexes()
    seed_defaults()
    app.run(debug=True, host="0.0.0.0", port=5000)
