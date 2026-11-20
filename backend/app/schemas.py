from typing import Any, Literal
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class PredictRequest(BaseModel):
    subject: str = Field(default="", max_length=1000)
    sender: str | None = Field(default=None, max_length=320)
    body: str = Field(default="", max_length=50000)


class SuspiciousKeywordItem(BaseModel):
    term: str
    weight: float
    tfidf: float


class PredictResponse(BaseModel):
    id: str
    email_subject: str
    sender_address: str | None
    prediction: Literal["SPAM", "HAM"]
    spam_probability: float
    confidence_score: float
    model_name: str
    processing_time: float
    suspicious_keywords: list[SuspiciousKeywordItem]
    created_at: str


class DatasetUploadRequest(BaseModel):
    dataset_name: str = Field(default="uploaded_dataset.csv", max_length=200)
    csv_content: str = Field(min_length=10)
    retrain: bool = True


class RoleUpdateRequest(BaseModel):
    role: Literal["user", "admin"]


class HealthResponse(BaseModel):
    status: str
    service: str
    model: str
    dataset_records: int
    details: dict[str, Any] | None = None


class MailSendRequest(BaseModel):
    to: EmailStr
    subject: str = Field(default="", max_length=1000)
    body: str = Field(min_length=1, max_length=50000)


class InboundMailRequest(BaseModel):
    sender: EmailStr = Field(alias="from")
    to: EmailStr
    subject: str = Field(default="", max_length=1000)
    body: str = Field(min_length=1, max_length=50000)

    model_config = {"populate_by_name": True}


class MailFolderUpdateRequest(BaseModel):
    folder: Literal["inbox", "spam"]
