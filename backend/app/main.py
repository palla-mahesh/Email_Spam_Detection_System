from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
import smtplib
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import get_current_user, get_supabase_client, require_admin
from app.ml_service import SpamMLService, train_and_evaluate
from app.schemas import (
    DatasetUploadRequest,
    HealthResponse,
    InboundMailRequest,
    LoginRequest,
    MailFolderUpdateRequest,
    MailSendRequest,
    PredictRequest,
    RegisterRequest,
    RoleUpdateRequest,
)

settings = get_settings()
BASE_DIR = Path(__file__).resolve().parents[1]
ml_service = SpamMLService(
    artifact_path=BASE_DIR / settings.model_artifact_path,
    default_dataset_path=BASE_DIR / settings.default_dataset_path,
)

app = FastAPI(
    title="MailGuard AI API",
    description="E-Mail Spam Detection System Using Machine Learning (FastAPI + Scikit-learn + Supabase PostgreSQL)",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health_check() -> HealthResponse:
    artifact = ml_service.load_or_train()
    return HealthResponse(
        status="healthy",
        service="MailGuard AI API",
        model=artifact["selected_model"],
        dataset_records=artifact["dataset_stats"]["total_records"],
    )


# =============================================================================
# AUTHENTICATION ENDPOINTS
# =============================================================================
@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> dict[str, Any]:
    supabase = get_supabase_client()
    auth_res = supabase.auth.sign_up({
        "email": payload.email,
        "password": payload.password,
        "options": {"data": {"full_name": payload.full_name}},
    })
    if not auth_res.user:
        raise HTTPException(status_code=400, detail="Registration failed.")

    profile_row = {
        "full_name": payload.full_name.strip(),
        "email": payload.email.lower(),
        "auth_user_id": auth_res.user.id,
        "role": "user",
    }
    inserted = supabase.table("users").insert(profile_row).execute()
    user_data = inserted.data[0]
    supabase.table("user_activity").insert({
        "user_id": user_data["id"],
        "activity_type": "USER_REGISTER",
        "description": f"New user registered: {user_data['email']}",
    }).execute()

    return {
        "access_token": auth_res.session.access_token if auth_res.session else None,
        "token_type": "bearer",
        "user": user_data,
    }


@app.post("/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    supabase = get_supabase_client()
    auth_res = supabase.auth.sign_in_with_password({
        "email": payload.email.lower(),
        "password": payload.password,
    })
    if not auth_res.session or not auth_res.user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user_row = (
        supabase.table("users")
        .select("*")
        .eq("auth_user_id", auth_res.user.id)
        .limit(1)
        .execute()
        .data[0]
    )
    supabase.table("user_activity").insert({
        "user_id": user_row["id"],
        "activity_type": "USER_LOGIN",
        "description": f"User signed in: {user_row['email']}",
    }).execute()

    return {
        "access_token": auth_res.session.access_token,
        "token_type": "bearer",
        "user": user_row,
    }


@app.get("/auth/me")
def get_me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    supabase = get_supabase_client()
    preds = (
        supabase.table("email_predictions")
        .select("prediction, confidence_score")
        .eq("user_id", user["id"])
        .execute()
        .data
    )
    total = len(preds)
    spam_count = sum(1 for p in preds if p["prediction"] == "SPAM")
    avg_conf = sum(float(p["confidence_score"]) for p in preds) / total if total else 0.0
    return {
        "user": user,
        "stats": {
            "total_predictions": total,
            "spam_count": spam_count,
            "ham_count": total - spam_count,
            "avg_confidence": round(avg_conf, 4),
        },
    }


# =============================================================================
# MACHINE LEARNING ENDPOINTS
# =============================================================================
@app.get("/api/model/info")
def get_model_info() -> dict[str, Any]:
    artifact = ml_service.load_or_train()
    best = next((e for e in artifact["evaluations"] if e["is_selected"]), artifact["evaluations"][0])
    return {
        "selected_model": artifact["selected_model"],
        "version": artifact["version"],
        "trained_at": artifact["trained_at"],
        "dataset": artifact["dataset_stats"],
        "best_metrics": best,
    }


@app.get("/api/model/metrics")
def get_model_metrics() -> dict[str, Any]:
    artifact = ml_service.load_or_train()
    return {
        "selected_model": artifact["selected_model"],
        "dataset_stats": artifact["dataset_stats"],
        "metrics": artifact["evaluations"],
    }


@app.post("/api/predict", status_code=status.HTTP_201_CREATED)
def predict_email(
    payload: PredictRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    if not payload.subject.strip() and not payload.body.strip():
        raise HTTPException(status_code=400, detail="Email subject or body is required.")

    try:
        result = ml_service.predict(payload.subject, payload.body, payload.sender)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    supabase = get_supabase_client()
    record = {
        "user_id": user["id"],
        "email_subject": payload.subject.strip() or "(No Subject)",
        "sender_address": payload.sender.strip() if payload.sender else None,
        "email_content": payload.body.strip() or payload.subject.strip(),
        "prediction": result["prediction"],
        "spam_probability": result["spam_probability"],
        "confidence_score": result["confidence_score"],
        "model_name": result["model_name"],
        "processing_time": result["processing_time"],
        "suspicious_keywords": result["suspicious_keywords"],
    }
    inserted = supabase.table("email_predictions").insert(record).execute().data[0]
    supabase.table("user_activity").insert({
        "user_id": user["id"],
        "activity_type": "EMAIL_PREDICTION",
        "description": f"Classified '{record['email_subject'][:60]}' as {record['prediction']}",
    }).execute()

    return inserted


# =============================================================================
# PREDICTION HISTORY CRUD
# =============================================================================
@app.get("/api/history")
def list_history(
    search: str | None = None,
    prediction: str = Query(default="ALL"),
    start_date: str | None = None,
    end_date: str | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=10, ge=1, le=100),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    query = (
        supabase.table("email_predictions")
        .select("*", count="exact")
        .eq("user_id", user["id"])
        .order("created_at", desc=True)
    )
    if prediction.upper() in {"SPAM", "HAM"}:
        query = query.eq("prediction", prediction.upper())
    if start_date:
        query = query.gte("created_at", f"{start_date}T00:00:00Z")
    if end_date:
        query = query.lte("created_at", f"{end_date}T23:59:59Z")
    if search:
        query = query.or_(f"email_subject.ilike.%{search}%,email_content.ilike.%{search}%")

    offset = (page - 1) * limit
    resp = query.range(offset, offset + limit - 1).execute()
    total = resp.count or 0
    return {
        "items": resp.data,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": max(1, (total + limit - 1) // limit),
    }


@app.get("/api/history/{prediction_id}")
def get_history_item(
    prediction_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    resp = (
        supabase.table("email_predictions")
        .select("*")
        .eq("id", prediction_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Prediction not found.")
    row = resp.data[0]
    if row["user_id"] != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied.")
    return row


@app.delete("/api/history/{prediction_id}")
def delete_history_item(
    prediction_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    resp = (
        supabase.table("email_predictions")
        .select("id, user_id")
        .eq("id", prediction_id)
        .limit(1)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Prediction not found.")
    if resp.data[0]["user_id"] != user["id"] and user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied.")
    supabase.table("email_predictions").delete().eq("id", prediction_id).execute()
    return {"deleted": True, "id": prediction_id}


# =============================================================================
# ANALYTICS ENDPOINTS
# =============================================================================
def _fetch_user_predictions(user_id: str, start_date: str | None, end_date: str | None) -> list[dict[str, Any]]:
    supabase = get_supabase_client()
    query = supabase.table("email_predictions").select("*").eq("user_id", user_id)
    if start_date:
        query = query.gte("created_at", f"{start_date}T00:00:00Z")
    if end_date:
        query = query.lte("created_at", f"{end_date}T23:59:59Z")
    return query.order("created_at", desc=True).execute().data


@app.get("/api/analytics/overview")
def analytics_overview(
    start_date: str | None = None,
    end_date: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    rows = _fetch_user_predictions(user["id"], start_date, end_date)
    total = len(rows)
    spam = sum(1 for r in rows if r["prediction"] == "SPAM")
    ham = total - spam
    avg_conf = (sum(float(r["confidence_score"]) for r in rows) / total) * 100 if total else 0.0
    avg_time = sum(float(r["processing_time"]) for r in rows) / total if total else 0.0
    artifact = ml_service.load_or_train()
    best = next((e for e in artifact["evaluations"] if e["is_selected"]), artifact["evaluations"][0])

    return {
        "total_analyzed": total,
        "total_spam": spam,
        "total_ham": ham,
        "spam_percentage": round((spam / total) * 100, 1) if total else 0.0,
        "ham_percentage": round((ham / total) * 100, 1) if total else 0.0,
        "avg_confidence": round(avg_conf, 1),
        "avg_processing_time_ms": round(avg_time, 2),
        "latest_predictions": rows[:6],
        "active_model": best,
    }


@app.get("/api/analytics/distribution")
def analytics_distribution(
    start_date: str | None = None,
    end_date: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    rows = _fetch_user_predictions(user["id"], start_date, end_date)
    spam = sum(1 for r in rows if r["prediction"] == "SPAM")
    ham = len(rows) - spam
    return {
        "distribution": [
            {"name": "SPAM", "value": spam, "color": "#EF4444"},
            {"name": "HAM", "value": ham, "color": "#10B981"},
        ],
        "total": len(rows),
    }


@app.get("/api/analytics/trends")
def analytics_trends(
    start_date: str | None = None,
    end_date: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    rows = _fetch_user_predictions(user["id"], start_date, end_date)
    buckets: dict[str, dict[str, Any]] = {}
    for r in rows:
        day = str(r["created_at"])[:10]
        if day not in buckets:
            buckets[day] = {"date": day, "spam": 0, "ham": 0, "total": 0, "prob_sum": 0.0}
        buckets[day]["total"] += 1
        buckets[day]["prob_sum"] += float(r["spam_probability"])
        if r["prediction"] == "SPAM":
            buckets[day]["spam"] += 1
        else:
            buckets[day]["ham"] += 1

    trends = [
        {
            "date": day,
            "spam": d["spam"],
            "ham": d["ham"],
            "total": d["total"],
            "avg_spam_probability": round((d["prob_sum"] / d["total"]) * 100, 1),
        }
        for day, d in sorted(buckets.items())
    ]
    return {"trends": trends}


@app.get("/api/analytics/keywords")
def analytics_keywords(
    start_date: str | None = None,
    end_date: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    rows = _fetch_user_predictions(user["id"], start_date, end_date)
    freq: dict[str, dict[str, float]] = {}
    for r in rows:
        if r["prediction"] != "SPAM":
            continue
        for kw in r.get("suspicious_keywords") or []:
            term = kw["term"]
            entry = freq.setdefault(term, {"count": 0, "weight_sum": 0.0})
            entry["count"] += 1
            entry["weight_sum"] += float(kw["weight"])

    keywords = sorted(
        [
            {
                "term": term,
                "count": int(v["count"]),
                "avg_weight": round(v["weight_sum"] / v["count"], 3),
            }
            for term, v in freq.items()
        ],
        key=lambda item: (item["count"], item["avg_weight"]),
        reverse=True,
    )[:12]
    return {"keywords": keywords}


# =============================================================================
# DATASETS & ADMIN ENDPOINTS
# =============================================================================
@app.get("/api/datasets")
def list_datasets(_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    supabase = get_supabase_client()
    data = supabase.table("datasets").select("*").order("uploaded_at", desc=True).execute().data
    return {"datasets": data}


@app.get("/api/datasets/{dataset_id}")
def get_dataset(dataset_id: str, _user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    supabase = get_supabase_client()
    data = supabase.table("datasets").select("*").eq("id", dataset_id).limit(1).execute().data
    if not data:
        raise HTTPException(status_code=404, detail="Dataset not found.")
    return data[0]


@app.post("/api/datasets/upload", status_code=status.HTTP_201_CREATED)
def upload_dataset(
    payload: DatasetUploadRequest,
    admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    try:
        artifact = train_and_evaluate(
            csv_content=payload.csv_content,
            dataset_name=payload.dataset_name,
            artifact_path=BASE_DIR / settings.model_artifact_path,
        )
        ml_service.artifact = artifact
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    supabase = get_supabase_client()
    stats = artifact["dataset_stats"]
    supabase.table("datasets").insert({
        "dataset_name": stats["dataset_name"],
        "total_records": stats["total_records"],
        "spam_count": stats["spam_count"],
        "ham_count": stats["ham_count"],
        "uploaded_by": admin["id"],
    }).execute()

    for ev in artifact["evaluations"]:
        supabase.table("model_metrics").insert({
            "model_name": ev["model_name"],
            "accuracy": ev["accuracy"],
            "precision_score": ev["precision_score"],
            "recall_score": ev["recall_score"],
            "f1_score": ev["f1_score"],
            "roc_auc": ev["roc_auc"],
            "cv_accuracy": ev["cv_accuracy"],
            "confusion_matrix": ev["confusion_matrix"],
            "is_selected": ev["is_selected"],
            "dataset_size": stats["total_records"],
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()

    return {
        "message": "Dataset validated and ML pipeline retrained successfully.",
        "selected_model": artifact["selected_model"],
        "dataset_stats": stats,
        "evaluations": artifact["evaluations"],
    }


@app.get("/api/admin/dashboard")
def admin_dashboard(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    supabase = get_supabase_client()
    users = supabase.table("users").select("id", count="exact").execute()
    preds = supabase.table("email_predictions").select("prediction", count="exact").execute()
    datasets = supabase.table("datasets").select("id", count="exact").execute()
    artifact = ml_service.load_or_train()

    total_spam = sum(1 for p in preds.data if p["prediction"] == "SPAM")
    total_preds = preds.count or len(preds.data)

    return {
        "total_users": users.count or len(users.data),
        "total_predictions": total_preds,
        "total_spam": total_spam,
        "total_ham": total_preds - total_spam,
        "total_datasets": datasets.count or len(datasets.data),
        "active_model": artifact["selected_model"],
        "model_metrics": artifact["evaluations"],
    }


@app.get("/api/admin/users")
def admin_users(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    supabase = get_supabase_client()
    users = supabase.table("users").select("id, full_name, email, role, created_at").order("created_at", desc=True).execute().data
    return {"users": users}


@app.patch("/api/admin/users/{user_id}/role")
def admin_update_role(
    user_id: str,
    payload: RoleUpdateRequest,
    _admin: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    supabase.table("users").update({"role": payload.role}).eq("id", user_id).execute()
    return {"id": user_id, "role": payload.role}


@app.get("/api/admin/activity")
def admin_activity(_admin: dict[str, Any] = Depends(require_admin)) -> dict[str, Any]:
    supabase = get_supabase_client()
    activities = supabase.table("user_activity").select("*").order("created_at", desc=True).limit(50).execute().data
    return {"activities": activities}


# =============================================================================
# MAILBOX: CLIENT-TO-CLIENT SEND, RECEIVE & ML SPAM GATEKEEPER
# =============================================================================
@app.get("/api/mail/config")
def mail_config(_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {
        "smtp_configured": bool(settings.smtp_host and settings.smtp_user and settings.smtp_pass),
        "smtp_host": settings.smtp_host or None,
        "inbound_webhook_protected": bool(settings.inbound_mail_webhook_secret),
    }


@app.get("/api/mail/recipients")
def mail_recipients(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    supabase = get_supabase_client()
    rows = supabase.table("users").select("id, full_name, email, role").neq("id", user["id"]).execute().data
    return {"recipients": rows}


@app.get("/api/mail/inbox")
def mail_inbox(
    folder: str = Query(default="inbox"),
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    all_rows = (
        supabase.table("mail_messages")
        .select("*")
        .eq("recipient_email", user["email"].lower())
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )
    inbox_count = sum(1 for r in all_rows if r["folder"] == "inbox")
    spam_count = sum(1 for r in all_rows if r["folder"] == "spam")
    unread_inbox = sum(1 for r in all_rows if r["folder"] == "inbox" and not r["is_read"])
    filtered = [r for r in all_rows if folder == "all" or r["folder"] == folder]
    return {
        "messages": filtered,
        "counts": {"inbox": inbox_count, "spam": spam_count, "unread_inbox": unread_inbox},
    }


@app.get("/api/mail/sent")
def mail_sent(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    supabase = get_supabase_client()
    rows = (
        supabase.table("mail_messages")
        .select("*")
        .eq("sender_id", user["id"])
        .order("created_at", desc=True)
        .limit(100)
        .execute()
        .data
    )
    return {"messages": rows}


@app.post("/api/mail/send", status_code=status.HTTP_201_CREATED)
def mail_send(
    payload: MailSendRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    scan = ml_service.predict(payload.subject, payload.body, user["email"])
    folder = "spam" if scan["prediction"] == "SPAM" else "inbox"
    recipient_email = payload.to.lower()

    supabase = get_supabase_client()
    rec_rows = supabase.table("users").select("id").eq("email", recipient_email).limit(1).execute().data
    recipient_id = rec_rows[0]["id"] if rec_rows else None

    delivery_channel = "internal"
    if settings.smtp_host and settings.smtp_user and settings.smtp_pass:
        msg = EmailMessage()
        msg["Subject"] = payload.subject or "(No Subject)"
        msg["From"] = settings.smtp_from or settings.smtp_user
        msg["To"] = recipient_email
        msg["Reply-To"] = user["email"]
        msg.set_content(payload.body)
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            server.starttls()
            server.login(settings.smtp_user, settings.smtp_pass)
            server.send_message(msg)
        delivery_channel = "smtp"

    inserted = supabase.table("mail_messages").insert({
        "sender_id": user["id"],
        "sender_email": user["email"],
        "recipient_id": recipient_id,
        "recipient_email": recipient_email,
        "subject": payload.subject or "(No Subject)",
        "body": payload.body,
        "prediction": scan["prediction"],
        "spam_probability": scan["spam_probability"],
        "confidence_score": scan["confidence_score"],
        "model_name": scan["model_name"],
        "processing_time": scan["processing_time"],
        "suspicious_keywords": scan["suspicious_keywords"],
        "folder": folder,
        "delivery_channel": delivery_channel,
        "is_read": False,
    }).execute().data[0]
    return {"message": inserted, "delivery_channel": delivery_channel}


@app.post("/api/mail/inbound", status_code=status.HTTP_201_CREATED)
def mail_inbound(
    payload: InboundMailRequest,
    x_webhook_secret: str | None = Header(default=None),
) -> dict[str, Any]:
    if settings.inbound_mail_webhook_secret and x_webhook_secret != settings.inbound_mail_webhook_secret:
        raise HTTPException(status_code=401, detail="Invalid inbound webhook secret.")

    from_email = payload.sender.lower()
    to_email = payload.to.lower()
    scan = ml_service.predict(payload.subject, payload.body, from_email)
    folder = "spam" if scan["prediction"] == "SPAM" else "inbox"

    supabase = get_supabase_client()
    rec_rows = supabase.table("users").select("id").eq("email", to_email).limit(1).execute().data
    recipient_id = rec_rows[0]["id"] if rec_rows else None

    inserted = supabase.table("mail_messages").insert({
        "sender_id": None,
        "sender_email": from_email,
        "recipient_id": recipient_id,
        "recipient_email": to_email,
        "subject": payload.subject or "(No Subject)",
        "body": payload.body,
        "prediction": scan["prediction"],
        "spam_probability": scan["spam_probability"],
        "confidence_score": scan["confidence_score"],
        "model_name": scan["model_name"],
        "processing_time": scan["processing_time"],
        "suspicious_keywords": scan["suspicious_keywords"],
        "folder": folder,
        "delivery_channel": "inbound_webhook",
        "is_read": False,
    }).execute().data[0]
    return {"message": inserted, "routed_folder": folder}


@app.patch("/api/mail/{mail_id}/move")
def mail_move(
    mail_id: str,
    payload: MailFolderUpdateRequest,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    row = supabase.table("mail_messages").select("*").eq("id", mail_id).limit(1).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Mail message not found.")
    if row[0]["recipient_email"] != user["email"].lower():
        raise HTTPException(status_code=403, detail="Access denied.")
    supabase.table("mail_messages").update({"folder": payload.folder, "is_read": True}).eq("id", mail_id).execute()
    return {"id": mail_id, "folder": payload.folder}


@app.delete("/api/mail/{mail_id}")
def mail_delete(
    mail_id: str,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    supabase = get_supabase_client()
    row = supabase.table("mail_messages").select("*").eq("id", mail_id).limit(1).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Mail message not found.")
    if row[0]["sender_id"] != user["id"] and row[0]["recipient_email"] != user["email"].lower():
        raise HTTPException(status_code=403, detail="Access denied.")
    supabase.table("mail_messages").delete().eq("id", mail_id).execute()
    return {"deleted": True, "id": mail_id}

