# Academic Project Report: E-Mail Spam Detection System Using Machine Learning

## Abstract
Unsolicited bulk email (spam) and credential-harvesting phishing campaigns remain primary vectors for cyberattacks and productivity loss. This project designs, implements, evaluates, and deploys a complete web-based **E-Mail Spam Detection System Using Machine Learning**. Combining deterministic Natural Language Processing (NLP), TF-IDF feature engineering, and three supervised classification algorithms—**Multinomial Naive Bayes**, **Logistic Regression**, and **Platt-Calibrated Linear Support Vector Machines (SVM)**—the system classifies user-submitted emails in real time with calibrated probability estimates and token-level explainability, backed by persistent relational database storage and interactive analytics.

---

## 1. Problem Statement & Objectives
Rule-based keyword blacklists fail to generalize against obfuscated spam and evolving phishing phrasing. The objective of this system is to:
1. Build an automated NLP + Machine Learning pipeline capable of separating `SPAM` from legitimate `HAM` emails with high F1-score and ROC-AUC.
2. Eliminate train-test data leakage by fitting TF-IDF vocabularies strictly on stratified training partitions.
3. Provide transparent model evaluation metrics (Accuracy, Precision, Recall, F1-Score, ROC-AUC, Confusion Matrices, 5-Fold Cross-Validation).
4. Expose real-time classification via a secure REST API backed by persistent relational tables, user authentication, and Role-Based Access Control (RBAC).

---

## 2. Dataset & Exploratory Structure
The training corpus (`data/spam_dataset.csv`) contains labeled legitimate (`ham`) and unsolicited/malicious (`spam`) email records spanning:
- **Spam Categories**: Credential phishing (banking, cloud SSO, tax refunds), promotional sweepstakes, financial/crypto scams, pharmaceutical ads, and fake parcel delivery alerts.
- **Ham Categories**: Software engineering reviews, university coursework notices, travel confirmations, utility invoices, and personal correspondence.

Incoming CSV uploads are validated for required `label` and `text` columns, normalized to binary targets (`0 = HAM`, `1 = SPAM`), and checked for minimum class balance before training.

---

## 3. NLP Preprocessing & Feature Extraction
Each email undergoes a reproducible normalization sequence:
1. **Markup & Token Sanitization**: Strips `<style>`, `<script>`, and HTML tags; normalizes URLs to `urltoken`, email addresses to `emailtoken`, currency figures to `moneytoken`, and percentages to `percenttoken`.
2. **Case Folding & Punctuation Removal**: Converts text to lowercase and strips non-alphanumeric characters while collapsing whitespace.
3. **Stop-Word Filtering**: Removes high-frequency English function words (NLTK stop-word set) and greeting boilerplate (`subject`, `hi`, `hello`, `dear`, `thanks`).
4. **TF-IDF Vectorization**: Extracts unigrams and bigrams (`ngram_range=(1, 2)`) with sublinear term frequency scaling (`1 + log(tf)`), smooth inverse document frequency, and L2 unit normalization—fitted **strictly on `X_train`**.

---

## 4. Machine Learning Algorithms & Calibration
Three complementary supervised classifiers are trained and benchmarked:
- **Multinomial Naive Bayes (`alpha=0.5`)**: Generative probabilistic baseline computing Laplace-smoothed log-likelihoods over TF-IDF feature distributions; yields fast, exact posterior probabilities via log-sum-exp normalization.
- **Logistic Regression (`L2 Regularized`)**: Discriminative linear classifier minimizing regularized binary cross-entropy, directly outputting calibrated sigmoid probabilities `P(spam | x)`.
- **Linear SVM (`Platt Scaling Calibration`)**: Maximum-margin hyperplane classifier trained with hinge loss; because raw SVM margins are uncalibrated distances, 3-fold out-of-fold Platt Scaling fits a logistic sigmoid `P(y=1|f(x)) = 1 / (1 + exp(A*f(x) + B))` to provide reliable probability estimates.

The pipeline automatically selects the top-performing classifier on held-out test F1-Score (with ROC-AUC tie-breaking) and persists the complete artifact for low-latency inference.

---

## 5. System & Database Architecture
The relational schema (`database/schema.sql`) enforces referential integrity across five normalized tables:
- `users`: Stores profile metadata, role (`user` | `admin`), and Auth linkage.
- `email_predictions`: Foreign-key linked to `users(id)` (`ON DELETE CASCADE`), storing subject, sender, content, verdict, spam probability, confidence, model name, latency, and extracted suspicious keywords (`JSONB`).
- `model_metrics`: Records Accuracy, Precision, Recall, F1-Score, ROC-AUC, 5-Fold CV Accuracy, and Confusion Matrices per training run.
- `datasets`: Tracks uploaded CSV corpora and class distribution.
- `user_activity`: Immutable audit trail of authentication, predictions, deletions, and model retraining events.

PostgreSQL Row Level Security (RLS) policies isolate prediction records per authenticated user and restrict administrative operations to verified `admin` accounts.

---

## 6. Security & Privacy Controls
- **Authentication & Passwords**: Handled via bcrypt / Supabase Auth with signed Bearer JWT verification on every protected endpoint.
- **Data Isolation**: Users can only retrieve or delete their own predictions (`403 Forbidden` enforced otherwise).
- **Input & Upload Safety**: Payload size limits, strict CSV schema validation, parameterized queries preventing SQL injection, rate limiting, and explicit CORS origin allowlisting.
- **Privacy Boundary**: The application analyzes only email text explicitly submitted by the user and never accesses external mailboxes.

---

## 7. Conclusion & Future Enhancements
MailGuard AI demonstrates an end-to-end production-grade Machine Learning system combining rigorous NLP feature engineering, multi-model evaluation, calibrated probabilistic inference, local threat forensics, and persistent analytics. Future extensions include transformer-based embeddings (e.g., DistilBERT fine-tuning), DKIM/SPF header feature extraction, and active-learning feedback loops from user-flagged false positives.
