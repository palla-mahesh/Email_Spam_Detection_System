from __future__ import annotations

import io
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from nltk.corpus import stopwords
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

FALLBACK_STOPWORDS = {
    "i", "me", "my", "myself", "we", "our", "ours", "ourselves", "you", "your",
    "yours", "yourself", "he", "him", "his", "she", "her", "hers", "it", "its",
    "they", "them", "their", "what", "which", "who", "whom", "this", "that",
    "these", "those", "am", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "a", "an", "the", "and", "but",
    "if", "or", "because", "as", "until", "while", "of", "at", "by", "for",
    "with", "about", "against", "between", "into", "through", "during", "before",
    "after", "above", "below", "to", "from", "up", "down", "in", "out", "on",
    "off", "over", "under", "again", "further", "then", "once", "here", "there",
    "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
    "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "can", "will", "just", "don", "should", "now",
    "subject", "hi", "hello", "hey", "dear", "thanks", "thank",
}


def get_stop_words() -> set[str]:
    try:
        return set(stopwords.words("english")) | {"subject", "hi", "hello", "dear", "thanks"}
    except LookupError:
        return FALLBACK_STOPWORDS


STOP_WORDS = get_stop_words()


def preprocess_text(raw_text: str) -> str:
    """
    Deterministic NLP text normalization:
    - Strip HTML tags
    - Replace URLs, emails, and currency values with structural tokens
    - Lowercase and remove punctuation
    - Collapse whitespace and remove stop words
    """
    if not isinstance(raw_text, str) or not raw_text.strip():
        return ""

    text = re.sub(r"<style[\s\S]*?</style>", " ", raw_text, flags=re.IGNORECASE)
    text = re.sub(r"<script[\s\S]*?</script>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"https?://\S+|www\.\S+", " urltoken ", text, flags=re.IGNORECASE)
    text = re.sub(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", " emailtoken ", text)
    text = re.sub(r"\$\s*\d[\d,.]*", " moneytoken ", text)
    text = re.sub(r"\d+%", " percenttoken ", text)
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    tokens = [tok for tok in text.split(" ") if len(tok) >= 2 and tok not in STOP_WORDS]
    return " ".join(tokens)


def validate_and_load_csv(csv_content: str) -> tuple[pd.DataFrame, int, int]:
    df = pd.read_csv(io.StringIO(csv_content))
    normalized_cols = {c: c.strip().lower() for c in df.columns}
    df = df.rename(columns=normalized_cols)

    label_col = next(
        (c for c in ["label", "category", "class", "target", "v1", "spam"] if c in df.columns),
        None,
    )
    text_col = next(
        (c for c in ["text", "message", "email", "content", "body", "v2"] if c in df.columns),
        None,
    )
    subject_col = next((c for c in ["subject", "email_subject", "title"] if c in df.columns), None)

    if not label_col:
        raise ValueError("CSV missing required label column (label, category, class, or target).")
    if not text_col and not subject_col:
        raise ValueError("CSV missing required text column (text, message, email, or body).")

    def map_label(val: Any) -> int | None:
        s = str(val).strip().lower()
        if s in {"spam", "1", "true", "yes", "junk"}:
            return 1
        if s in {"ham", "0", "false", "no", "legit", "legitimate"}:
            return 0
        return None

    df["y"] = df[label_col].apply(map_label)
    if subject_col and text_col:
        df["combined_text"] = "Subject: " + df[subject_col].fillna("").astype(str) + ". " + df[text_col].fillna("").astype(str)
    elif text_col:
        df["combined_text"] = df[text_col].fillna("").astype(str)
    else:
        df["combined_text"] = df[subject_col].fillna("").astype(str)

    df["clean_text"] = df["combined_text"].apply(preprocess_text)
    df = df[df["y"].notna() & (df["clean_text"].str.len() > 0)].copy()
    df["y"] = df["y"].astype(int)

    spam_count = int((df["y"] == 1).sum())
    ham_count = int((df["y"] == 0).sum())

    if len(df) < 20 or spam_count < 5 or ham_count < 5:
        raise ValueError("Dataset must contain at least 20 valid emails with at least 5 SPAM and 5 HAM samples.")

    return df[["y", "combined_text", "clean_text"]], spam_count, ham_count


def train_and_evaluate(
    csv_content: str,
    dataset_name: str = "spam_dataset.csv",
    artifact_path: str | Path = "ml/spam_pipeline.joblib",
) -> dict[str, Any]:
    df, spam_count, ham_count = validate_and_load_csv(csv_content)
    X_train, X_test, y_train, y_test = train_test_split(
        df["clean_text"],
        df["y"],
        test_size=0.2,
        random_state=42,
        stratify=df["y"],
    )

    vectorizer_params = {
        "ngram_range": (1, 2),
        "min_df": 2 if len(X_train) >= 60 else 1,
        "max_features": 3500,
        "sublinear_tf": True,
    }

    candidates = [
        (
            "Multinomial Naive Bayes",
            MultinomialNB(alpha=0.5),
            "Exact Bayesian Posterior (Laplace alpha=0.5)",
        ),
        (
            "Logistic Regression",
            LogisticRegression(C=1.5, max_iter=1000, random_state=42),
            "Direct Sigmoid Probability (L2 Regularized)",
        ),
        (
            "Linear SVM",
            CalibratedClassifierCV(LinearSVC(C=1.0, random_state=42), cv=3, method="sigmoid"),
            "Platt Scaling Calibration (3-Fold Out-of-Fold)",
        ),
    ]

    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    evaluations: list[dict[str, Any]] = []
    trained_pipelines: dict[str, Pipeline] = {}

    for name, estimator, calibration_note in candidates:
        pipe = Pipeline([
            ("tfidf", TfidfVectorizer(**vectorizer_params)),
            ("clf", estimator),
        ])
        pipe.fit(X_train, y_train)
        trained_pipelines[name] = pipe

        y_pred = pipe.predict(X_test)
        y_prob = pipe.predict_proba(X_test)[:, 1]
        cv_scores = cross_val_score(pipe, X_train, y_train, cv=cv, scoring="accuracy")
        cm = confusion_matrix(y_test, y_pred).tolist()

        evaluations.append({
            "model_name": name,
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "precision_score": round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
            "recall_score": round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
            "f1_score": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
            "roc_auc": round(float(roc_auc_score(y_test, y_prob)), 4),
            "cv_accuracy": round(float(np.mean(cv_scores)), 4),
            "confusion_matrix": cm,
            "calibration_note": calibration_note,
            "is_selected": False,
        })

    best_eval = max(evaluations, key=lambda e: (e["f1_score"], e["roc_auc"]))
    best_eval["is_selected"] = True
    selected_name = best_eval["model_name"]

    vocab_size = len(trained_pipelines[selected_name].named_steps["tfidf"].vocabulary_)
    artifact = {
        "version": "1.0.0",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "selected_model": selected_name,
        "pipeline": trained_pipelines[selected_name],
        "all_pipelines": trained_pipelines,
        "evaluations": evaluations,
        "dataset_stats": {
            "dataset_name": dataset_name,
            "total_records": int(len(df)),
            "spam_count": spam_count,
            "ham_count": ham_count,
            "train_size": int(len(X_train)),
            "test_size": int(len(X_test)),
            "vocab_size": int(vocab_size),
        },
    }

    target = Path(artifact_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, target)
    return artifact


class SpamMLService:
    def __init__(self, artifact_path: str | Path, default_dataset_path: str | Path):
        self.artifact_path = Path(artifact_path)
        self.default_dataset_path = Path(default_dataset_path)
        self.artifact: dict[str, Any] | None = None

    def load_or_train(self) -> dict[str, Any]:
        if self.artifact is not None:
            return self.artifact
        if self.artifact_path.exists():
            self.artifact = joblib.load(self.artifact_path)
            return self.artifact
        csv_content = self.default_dataset_path.read_text(encoding="utf-8")
        self.artifact = train_and_evaluate(
            csv_content=csv_content,
            dataset_name=self.default_dataset_path.name,
            artifact_path=self.artifact_path,
        )
        return self.artifact

    def predict(self, subject: str, body: str, sender: str | None = None) -> dict[str, Any]:
        start = time.perf_counter()
        combined = "\n".join(
            part
            for part in [
                f"Subject: {subject.strip()}" if subject.strip() else "",
                body.strip(),
                f"From: {sender.strip()}" if sender and sender.strip() else "",
            ]
            if part
        )
        cleaned = preprocess_text(combined)
        if not cleaned:
            raise ValueError("Input contains no valid analyzable tokens after preprocessing.")

        artifact = self.load_or_train()
        pipe: Pipeline = artifact["pipeline"]
        spam_prob = float(pipe.predict_proba([cleaned])[0][1])
        spam_prob = min(0.9999, max(0.0001, spam_prob))
        prediction = "SPAM" if spam_prob >= 0.5 else "HAM"
        confidence = spam_prob if prediction == "SPAM" else 1.0 - spam_prob

        # Explainable suspicious keyword extraction using TF-IDF & NB log-odds
        tfidf_step: TfidfVectorizer = pipe.named_steps["tfidf"]
        nb_pipe: Pipeline = artifact["all_pipelines"]["Multinomial Naive Bayes"]
        nb_clf: MultinomialNB = nb_pipe.named_steps["clf"]
        nb_vec: TfidfVectorizer = nb_pipe.named_steps["tfidf"]

        row_vec = tfidf_step.transform([cleaned])
        feature_names = tfidf_step.get_feature_names_out()
        nb_vocab = nb_vec.vocabulary_
        log_odds = nb_clf.feature_log_prob_[1] - nb_clf.feature_log_prob_[0]

        keywords: list[dict[str, Any]] = []
        for col_idx, val in zip(row_vec.indices, row_vec.data):
            term = str(feature_names[col_idx])
            nb_idx = nb_vocab.get(term)
            score = float(val) * (float(log_odds[nb_idx]) if nb_idx is not None else 0.0)
            if score > 0.01:
                keywords.append({
                    "term": term,
                    "weight": round(score, 4),
                    "tfidf": round(float(val), 4),
                })
        keywords.sort(key=lambda item: item["weight"], reverse=True)

        elapsed_ms = round((time.perf_counter() - start) * 1000.0, 2)
        return {
            "prediction": prediction,
            "spam_probability": round(spam_prob, 4),
            "confidence_score": round(confidence, 4),
            "model_name": artifact["selected_model"],
            "processing_time": elapsed_ms,
            "suspicious_keywords": keywords[:8],
        }
