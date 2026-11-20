from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.ml_service import SpamMLService, preprocess_text, validate_and_load_csv
from app.main import app


def test_text_preprocessing():
    raw = "<html><body>URGENT! Claim $1,000 at https://evil.xyz/claim NOW!!</body></html>"
    cleaned = preprocess_text(raw)
    assert "html" not in cleaned
    assert "urltoken" in cleaned
    assert "moneytoken" in cleaned
    assert "urgent" in cleaned


def test_empty_input_preprocessing():
    assert preprocess_text("") == ""
    assert preprocess_text("   <div>   </div>   ") == ""


def test_csv_validation_rejects_invalid_headers():
    with pytest.raises(ValueError):
        validate_and_load_csv("col1,col2\na,b\n")


def test_ml_training_and_predictions():
    root = Path(__file__).resolve().parents[2]
    dataset_path = root / "data" / "spam_dataset.csv"
    service = SpamMLService(
        artifact_path=root / "backend" / "ml" / "test_pipeline.joblib",
        default_dataset_path=dataset_path,
    )

    promo_spam = service.predict(
        subject="CONGRATULATIONS! You Won a $1,000 Gift Card!",
        body="Click now to claim your free prize reward before midnight!",
    )
    assert promo_spam["prediction"] == "SPAM"
    assert promo_spam["spam_probability"] >= 0.5

    phishing = service.predict(
        subject="URGENT: Bank Account Suspended",
        body="Verify your social security number, ATM PIN, and password immediately!",
    )
    assert phishing["prediction"] == "SPAM"

    ham = service.predict(
        subject="Re: Architecture Review Meeting",
        body="Hi team, let us meet Thursday at 3 PM to review the PostgreSQL schema.",
    )
    assert ham["prediction"] == "HAM"

    with pytest.raises(ValueError):
        service.predict(subject="", body="   ")


def test_health_endpoint():
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "healthy"
