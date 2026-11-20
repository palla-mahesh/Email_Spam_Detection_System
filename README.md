# MailGuard AI — E-Mail Spam Detection System Using Machine Learning

## 1. Project Introduction & Abstract
**MailGuard AI** is a full-stack Machine Learning web application that classifies email messages into **SPAM** or **HAM (Legitimate Email)** in real time without requiring any external API keys. Built for academic Machine Learning evaluation and production deployment, the platform combines deterministic Natural Language Processing (NLP), leakage-free TF-IDF vectorization, multi-algorithm training (**Multinomial Naive Bayes**, **Logistic Regression**, and **Platt-Calibrated Linear SVM**), local AI threat forensics (phishing category classification, brand spoofing detection, social engineering urgency scoring, sentence-level risk scoring, and safe reply coaching), persistent relational database storage, role-based access control, and interactive analytics visualizations.

## 2. Objectives
- Automatically classify user-submitted email subjects, senders, and bodies into `SPAM` or `HAM`.
- Prevent train-test data leakage by fitting preprocessing and TF-IDF vocabularies exclusively on stratified training splits.
- Compare multiple supervised ML classifiers using Accuracy, Precision, Recall, F1-Score, ROC-AUC, 5-Fold Cross-Validation, and Confusion Matrices.
- Provide calibrated spam probabilities and explainable suspicious keyword attribution for every analyzed message.
- Persist user accounts, prediction histories, model evaluation metrics, uploaded datasets, and audit activity in PostgreSQL/SQLite.

## 3. Technology Stack
- **Frontend**: React 19, Vite, Tailwind CSS v4, React Router, Recharts, Framer Motion (`motion/react`), Axios, Lucide React
- **Live Preview Runtime**: Node.js + Express (`server.ts`) + Real Mathematical ML Engine (`server/mlEngine.ts`) + Persistent SQLite (`node:sqlite`)
- **Python Production Backend (`backend/`)**: Python 3.12+, FastAPI, Pydantic, Scikit-learn, Pandas, NumPy, NLTK, Joblib, Supabase Python SDK
- **Database**: Supabase PostgreSQL (`database/schema.sql`) with Foreign Keys, Indexes, Check Constraints, and Row Level Security (RLS)
- **Deployment**: GitHub + Vercel (Frontend SPA + Python FastAPI Serverless Runtime) + Supabase Cloud

## 4. System Architecture
```
[ React + Vite SPA ]
        │  HTTPS / Bearer JWT (Axios)
        ▼
[ FastAPI / Express REST API ] ──► [ NLP + TF-IDF + Classifier Pipeline ]
        │                                       │
        ▼                                       ▼
[ PostgreSQL / Supabase RLS ] ◄── [ Model Metrics & Prediction History ]
```

## 5. Machine Learning Methodology
1. **Dataset Collection & Validation**: Loads labeled email/SMS spam CSV corpora (`data/spam_dataset.csv`), validating `label` and `text` columns.
2. **NLP Preprocessing**:
   - Strips `<script>`, `<style>`, and HTML tags
   - Normalizes URLs (`urltoken`), email addresses (`emailtoken`), currency (`moneytoken`), and percentages (`percenttoken`)
   - Lowercases text, removes punctuation, normalizes whitespace, tokenizes, and removes English stop words
3. **Feature Extraction**: Sublinear TF-IDF Vectorizer with unigrams and bigrams (`ngram_range=(1, 2)`), L2 normalization, fitted strictly on the 80% stratified training split.
4. **Trained Algorithms**:
   - **Multinomial Naive Bayes** (`alpha=0.5`, exact Bayesian posterior)
   - **Logistic Regression** (L2-regularized binary cross-entropy, direct sigmoid probabilities)
   - **Linear SVM** (L2 hinge loss + 3-fold out-of-fold Platt Scaling sigmoid calibration)
5. **Model Evaluation & Selection**: Compares all 3 models on the held-out 20% test split plus 5-fold stratified CV; automatically selects the highest F1-score (tie-breaker ROC-AUC) model and persists the serialized pipeline.
6. **Real-Time Inference**: Returns predicted class, calibrated spam probability, confidence score, processing latency (`ms`), and top suspicious keywords ranked by TF-IDF & log-odds attribution.

## 6. Database Design (`database/schema.sql`)
- `users`: `id`, `full_name`, `email`, `auth_user_id`, `role`, `created_at`
- `email_predictions`: `id`, `user_id` (FK -> `users.id`), `email_subject`, `sender_address`, `email_content`, `prediction`, `spam_probability`, `confidence_score`, `model_name`, `processing_time`, `suspicious_keywords`, `created_at`
- `model_metrics`: `id`, `model_name`, `accuracy`, `precision_score`, `recall_score`, `f1_score`, `roc_auc`, `cv_accuracy`, `confusion_matrix`, `is_selected`, `dataset_size`, `evaluated_at`
- `datasets`: `id`, `dataset_name`, `total_records`, `spam_count`, `ham_count`, `uploaded_by` (FK -> `users.id`), `uploaded_at`
- `user_activity`: `id`, `user_id` (FK -> `users.id`), `activity_type`, `description`, `created_at`

Row Level Security (RLS) ensures standard users can only read/insert/delete their own `email_predictions`, while admin-only routes validate `role = 'admin'`.

## 7. Folder Structure
```
├── backend/
│   ├── app/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── ml_service.py
│   │   └── schemas.py
│   ├── ml/
│   │   └── train.py
│   ├── tests/
│   │   └── test_spam_system.py
│   ├── requirements.txt
│   └── vercel.json
├── data/
│   └── spam_dataset.csv
├── database/
│   └── schema.sql
├── server/
│   ├── app.ts
│   ├── db.ts
│   └── mlEngine.ts
├── src/
│   ├── components/
│   ├── context/
│   ├── pages/
│   └── services/
├── tests/
│   └── ml-api.test.ts
├── model_training.ipynb
├── project_report.md
├── server.ts
├── vercel.json
└── README.md
```

## 8. Installation & Local Execution

### Option A: Live Full-Stack Server (Node.js + Vite + Real ML Engine)
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

### Option B: Python FastAPI Backend + Scikit-Learn
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m ml.train
uvicorn app.main:app --reload --port 8000
```
Swagger UI is automatically served at `http://localhost:8000/docs`.

## 9. Environment Configuration
Copy `.env.example` to `.env` and populate:
- **Frontend**: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Backend**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ALLOWED_ORIGINS`

## 10. Database Setup (Supabase)
1. Create a new Supabase project.
2. Open the **SQL Editor** in Supabase and run `database/schema.sql`.
3. Enable Email/Password authentication under **Authentication -> Providers**.
4. Copy Project URL, Anon Key, Service Role Key, and JWT Secret into your `.env` / Vercel project settings.

## 11. API Documentation
- `POST /auth/register` — Register new user account
- `POST /auth/login` — Authenticate and receive JWT token
- `GET /auth/me` — Retrieve authenticated profile & personal stats
- `POST /api/predict` — Preprocess, classify email, extract AI threat forensics, and save prediction
- `POST /api/predict/batch` — Batch scan up to 50 emails in one pass
- `GET /api/model/info` — Active model, dataset statistics, preprocessing config
- `GET /api/model/metrics` — All evaluated algorithm metrics and confusion matrices
- `POST /api/model/retrain` — Retrain ML pipeline (Admin only)
- `GET /api/history` — Search, filter, paginate user predictions
- `GET /api/history/{id}` & `DELETE /api/history/{id}` — Inspect or delete owned prediction
- `GET /api/analytics/overview`, `/distribution`, `/trends`, `/keywords` — Real DB analytics
- `POST /api/datasets/upload`, `GET /api/datasets`, `GET /api/datasets/{id}` — CSV validation & training
- `GET /api/admin/dashboard`, `/users`, `/activity` — Admin RBAC telemetry
- `GET /health` — Service health probe

## 12. Zero-API-Key Vercel Deployment (Unified Single Project)
You can deploy the entire full-stack application (React SPA + ML API + SQLite runtime) directly to Vercel **with zero API keys or environment variables**:
1. Push this repository to GitHub.
2. Import the repository in **Vercel** (`Add New Project`) with Root Directory `.` (do not add any required API keys).
3. `vercel.json` automatically builds the Vite frontend (`dist/`) and routes `/api/*`, `/auth/*`, and `/health` to the serverless function `api/index.ts`, bundling `data/spam_dataset.csv` and pre-trained `models/spam_pipeline.json` with `/tmp` writable storage.
4. *(Optional)* If deploying the separate Python FastAPI + Supabase PostgreSQL stack instead, deploy `backend/` separately with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and `ALLOWED_ORIGINS`.

## 13. Testing Instructions
Run the integrated ML + API test suite:
```bash
npm test
```
Run the Python FastAPI/Scikit-learn test suite:
```bash
cd backend && pytest
```

## 14. UI Pages Overview
- **Landing Page (`/`)**: Project overview, live benchmark strip, 4-stage ML methodology, architecture summary.
- **Authentication (`/login`, `/register`)**: Validation, password visibility toggle, JWT persistence.
- **Dashboard (`/dashboard`)**: Total analyzed, spam/ham counts & percentages, model summary, recent classifications.
- **Spam Detection (`/detect`)**: Subject/sender/body input, sample presets, real-time verdict, calibrated probability, latency, cross-model consensus, suspicious keywords.
- **Prediction History (`/history`)**: Live search, SPAM/HAM filter, date filtering, pagination, inspection & delete modals.
- **Analytics (`/analytics`)**: 6 interactive charts (Pie, Daily Bar, Trend Line, Model F1 Doughnut, Confusion Matrix, Top Suspicious Keywords Bar).
- **Model Performance (`/models`)**: Algorithm comparison table, grouped metric chart, confusion matrix inspector.
- **Admin Console (`/admin`)**: RBAC-protected KPIs, CSV dataset upload & retraining, user role management, audit log.
- **User Profile (`/profile`)**: Account details, personal stats, sign out.
