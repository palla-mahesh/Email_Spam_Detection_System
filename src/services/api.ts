import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('mailguard_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface SuspiciousKeyword {
  term: string;
  weight: number;
  tfidf: number;
}

export type ThreatCategory =
  | 'Credential Phishing'
  | 'Financial / Crypto Scam'
  | 'Promotional / Bulk Spam'
  | 'Malware / Urgent Lure'
  | 'Legitimate Communication';

export interface UrlFinding {
  url: string;
  reason: string;
  severity: 'high' | 'medium';
}

export interface BrandSpoofAlert {
  claimedBrand: string;
  senderDomain: string;
  expectedDomains: string[];
  detail: string;
}

export interface RiskIndicators {
  urgencyScore: number;
  manipulationTriggers: string[];
  urlFindings: UrlFinding[];
  brandMismatch: BrandSpoofAlert | null;
}

export interface SentenceRisk {
  sentence: string;
  spamProbability: number;
  riskLevel: 'high' | 'medium' | 'normal';
}

export interface BatchPredictionItem {
  index: number;
  id?: string;
  subject: string;
  sender: string;
  prediction: 'SPAM' | 'HAM';
  spamProbability: number;
  confidenceScore: number;
  threatCategory: ThreatCategory;
  urgencyScore: number;
  processingTimeMs: number;
  error?: string;
}

export interface BatchPredictionResponse {
  total: number;
  processed: number;
  spam_count: number;
  ham_count: number;
  high_urgency_count: number;
  model_name: string;
  results: BatchPredictionItem[];
}

export interface RocPoint {
  threshold: number;
  fpr: number;
  tpr: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export interface ModelRocCurve {
  modelName: string;
  rocAuc: number;
  points: RocPoint[];
}

export interface FeatureWeightItem {
  term: string;
  spamWeight: number;
  lrWeight: number;
  svmWeight: number;
  nbLogOdds: number;
  polarity: 'spam' | 'ham';
}

export interface EnsembleEvaluation {
  modelName: 'Soft-Voting Ensemble';
  weights: {
    naiveBayes: number;
    logisticRegression: number;
    linearSvm: number;
  };
  accuracy: number;
  precisionScore: number;
  recallScore: number;
  f1Score: number;
  rocAuc: number;
  confusionMatrix: [[number, number], [number, number]];
  calibrationNote: string;
}

export type HeaderAuthStatus = 'pass' | 'fail' | 'softfail' | 'neutral' | 'missing';

export interface HeaderAnalysis {
  hasHeaders: boolean;
  spf: HeaderAuthStatus;
  dkim: HeaderAuthStatus;
  dmarc: HeaderAuthStatus;
  fromAddress: string | null;
  replyToAddress: string | null;
  returnPathAddress: string | null;
  replyToMismatch: boolean;
  returnPathMismatch: boolean;
  hopCount: number;
  headerRiskScore: number;
  findings: Array<{
    check: string;
    status: HeaderAuthStatus | 'warn';
    detail: string;
  }>;
}

export interface PredictionRecord {
  id: string;
  user_id?: string;
  email_subject: string;
  sender_address: string | null;
  email_content?: string;
  prediction: 'SPAM' | 'HAM';
  spam_probability: number;
  ensemble_probability?: number;
  confidence_score: number;
  model_name: string;
  classifier_mode?: 'Active Best Model' | 'Soft-Voting Ensemble';
  threshold_used?: number;
  processing_time: number;
  suspicious_keywords: SuspiciousKeyword[];
  preprocessed_tokens?: string[];
  model_breakdown?: Array<{
    modelName: string;
    prediction: 'SPAM' | 'HAM';
    spamProbability: number;
  }>;
  threat_category?: ThreatCategory;
  risk_indicators?: RiskIndicators;
  header_analysis?: HeaderAnalysis;
  sentence_analysis?: SentenceRisk[];
  ai_advisory?: string;
  suggested_replies?: string[];
  created_at: string;
}

export interface ModelMetricRow {
  id: string;
  model_name: string;
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  roc_auc: number | null;
  cv_accuracy: number | null;
  confusion_matrix: [[number, number], [number, number]];
  calibration_note: string;
  is_selected: boolean;
  dataset_size: number;
  evaluated_at: string;
}

export interface ModelInfoResponse {
  selected_model: string;
  version: string;
  trained_at: string;
  dataset: {
    datasetName: string;
    totalRecords: number;
    spamCount: number;
    hamCount: number;
    trainSize: number;
    testSize: number;
    vocabSize: number;
  };
  preprocessing: {
    lowercase: boolean;
    strip_html: boolean;
    stop_word_removal: boolean;
    ngram_range: [number, number];
    vectorizer: string;
    split_strategy: string;
  };
  best_metrics: {
    modelName: string;
    accuracy: number;
    precisionScore: number;
    recallScore: number;
    f1Score: number;
    rocAuc: number;
    cvAccuracy: number;
    confusionMatrix: [[number, number], [number, number]];
  };
}

export const authApi = {
  register: (payload: { full_name: string; email: string; password: string }) =>
    apiClient.post<{ access_token: string; user: UserProfile }>('/auth/register', payload),
  login: (payload: { email: string; password: string }) =>
    apiClient.post<{ access_token: string; user: UserProfile }>('/auth/login', payload),
  me: () =>
    apiClient.get<{
      user: UserProfile;
      stats: {
        total_predictions: number;
        spam_count: number;
        ham_count: number;
        avg_confidence: number;
      };
    }>('/auth/me'),
};

export const mlApi = {
  predict: (payload: {
    subject: string;
    sender?: string;
    body: string;
    raw_headers?: string;
    use_ensemble?: boolean;
    threshold?: number;
  }) => apiClient.post<PredictionRecord>('/api/predict', payload),
  predictBatch: (emails: Array<{ id?: string; subject?: string; sender?: string; body: string }>) =>
    apiClient.post<BatchPredictionResponse>('/api/predict/batch', { emails }),
  getModelInfo: () => apiClient.get<ModelInfoResponse>('/api/model/info'),
  getModelMetrics: () =>
    apiClient.get<{
      selected_model: string;
      dataset_stats: ModelInfoResponse['dataset'];
      metrics: ModelMetricRow[];
      ensemble_evaluation: EnsembleEvaluation;
      roc_curves: ModelRocCurve[];
      feature_importance: {
        topSpam: FeatureWeightItem[];
        topHam: FeatureWeightItem[];
      };
    }>('/api/model/metrics'),
  getRocCurves: () =>
    apiClient.get<{
      selected_model: string;
      ensemble_evaluation: EnsembleEvaluation;
      roc_curves: ModelRocCurve[];
    }>('/api/model/roc'),
  getFeatures: (q = '', limit = 15) =>
    apiClient.get<{
      query: string;
      vocab_size: number;
      total_matches: number;
      top_spam: FeatureWeightItem[];
      top_ham: FeatureWeightItem[];
    }>('/api/model/features', { params: { q, limit } }),
  retrain: () => apiClient.post('/api/model/retrain'),
};

export interface FeedbackSample {
  id: string;
  prediction_id: string | null;
  submitted_by: string | null;
  submitted_by_name?: string | null;
  submitted_by_email?: string | null;
  email_subject: string;
  sender_address: string | null;
  email_content: string;
  original_prediction: 'SPAM' | 'HAM';
  corrected_label: 'SPAM' | 'HAM';
  notes: string | null;
  status: 'pending' | 'applied' | 'dismissed';
  created_at: string;
  applied_at: string | null;
}

export interface RetrainFeedbackResponse {
  message: string;
  applied_count: number;
  total_feedback_used: number;
  before: {
    selected_model: string;
    accuracy: number;
    f1_score: number;
    roc_auc: number;
    total_records: number;
  };
  after: {
    selected_model: string;
    accuracy: number;
    f1_score: number;
    roc_auc: number;
    total_records: number;
  };
  selected_model: string;
}

export const feedbackApi = {
  submit: (payload: {
    prediction_id?: string | null;
    email_subject: string;
    sender_address?: string | null;
    email_content: string;
    original_prediction: 'SPAM' | 'HAM';
    corrected_label: 'SPAM' | 'HAM';
    notes?: string;
  }) =>
    apiClient.post<{ feedback: FeedbackSample; message: string }>('/api/feedback', payload),
  list: (status?: 'ALL' | 'pending' | 'applied' | 'dismissed') =>
    apiClient.get<{
      items: FeedbackSample[];
      counts: { pending: number; applied: number; dismissed: number };
    }>('/api/feedback', { params: status && status !== 'ALL' ? { status } : undefined }),
  update: (id: string, payload: { status?: 'pending' | 'applied' | 'dismissed'; corrected_label?: 'SPAM' | 'HAM' }) =>
    apiClient.patch<{ feedback: FeedbackSample }>(`/api/feedback/${id}`, payload),
  retrain: () => apiClient.post<RetrainFeedbackResponse>('/api/feedback/retrain'),
};

export const historyApi = {
  list: (params: {
    search?: string;
    prediction?: string;
    start_date?: string;
    end_date?: string;
    page?: number;
    limit?: number;
  }) =>
    apiClient.get<{
      items: PredictionRecord[];
      total: number;
      page: number;
      limit: number;
      total_pages: number;
    }>('/api/history', { params }),
  getById: (id: string) => apiClient.get<PredictionRecord>(`/api/history/${id}`),
  remove: (id: string) => apiClient.delete(`/api/history/${id}`),
};

export const analyticsApi = {
  overview: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get<{
      total_analyzed: number;
      total_spam: number;
      total_ham: number;
      spam_percentage: number;
      ham_percentage: number;
      avg_confidence: number;
      avg_processing_time_ms: number;
      latest_predictions: PredictionRecord[];
      active_model: ModelInfoResponse['best_metrics'];
    }>('/api/analytics/overview', { params }),
  distribution: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get<{
      distribution: Array<{ name: string; value: number; color: string }>;
      total: number;
    }>('/api/analytics/distribution', { params }),
  trends: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get<{
      trends: Array<{
        date: string;
        spam: number;
        ham: number;
        total: number;
        avg_spam_probability: number;
      }>;
    }>('/api/analytics/trends', { params }),
  keywords: (params?: { start_date?: string; end_date?: string }) =>
    apiClient.get<{
      keywords: Array<{ term: string; count: number; avg_weight: number }>;
    }>('/api/analytics/keywords', { params }),
};

export const adminApi = {
  dashboard: () =>
    apiClient.get<{
      total_users: number;
      total_predictions: number;
      total_spam: number;
      total_ham: number;
      total_datasets: number;
      active_model: string;
      model_metrics: ModelMetricRow[];
    }>('/api/admin/dashboard'),
  users: () =>
    apiClient.get<{
      users: Array<UserProfile & { prediction_count: number }>;
    }>('/api/admin/users'),
  updateUserRole: (id: string, role: 'user' | 'admin') =>
    apiClient.patch(`/api/admin/users/${id}/role`, { role }),
  activity: () =>
    apiClient.get<{
      activities: Array<{
        id: string;
        user_id: string | null;
        full_name: string | null;
        email: string | null;
        activity_type: string;
        description: string;
        created_at: string;
      }>;
    }>('/api/admin/activity'),
  datasets: () =>
    apiClient.get<{
      datasets: Array<{
        id: string;
        dataset_name: string;
        total_records: number;
        spam_count: number;
        ham_count: number;
        uploaded_by_name: string | null;
        uploaded_at: string;
      }>;
    }>('/api/datasets'),
  uploadDataset: (payload: { dataset_name: string; csv_content: string; retrain: boolean }) =>
    apiClient.post('/api/datasets/upload', payload),
};

export interface MailMessage {
  id: string;
  sender_id: string | null;
  sender_email: string;
  recipient_id: string | null;
  recipient_email: string;
  subject: string;
  body: string;
  prediction: 'SPAM' | 'HAM';
  spam_probability: number;
  confidence_score: number;
  model_name: string;
  processing_time: number;
  suspicious_keywords: SuspiciousKeyword[];
  threat_category?: ThreatCategory;
  risk_indicators?: RiskIndicators;
  sentence_analysis?: SentenceRisk[];
  ai_advisory?: string;
  suggested_replies?: string[];
  folder: 'inbox' | 'spam';
  delivery_channel: 'internal' | 'smtp' | 'inbound_webhook';
  is_read: boolean;
  created_at: string;
}

export const mailApi = {
  config: () =>
    apiClient.get<{
      smtp_configured: boolean;
      smtp_host: string | null;
      inbound_webhook_protected: boolean;
    }>('/api/mail/config'),
  recipients: () =>
    apiClient.get<{
      recipients: Array<{ id: string; full_name: string; email: string; role: string }>;
    }>('/api/mail/recipients'),
  inbox: (folder: 'inbox' | 'spam' | 'all' = 'inbox') =>
    apiClient.get<{
      messages: MailMessage[];
      counts: { inbox: number; spam: number; unread_inbox: number };
    }>('/api/mail/inbox', { params: { folder } }),
  sent: () => apiClient.get<{ messages: MailMessage[] }>('/api/mail/sent'),
  send: (payload: { to: string; subject: string; body: string }) =>
    apiClient.post<{
      message: MailMessage;
      delivery_channel: string;
      smtp_notice: string;
    }>('/api/mail/send', payload),
  receiveInbound: (payload: { from: string; to: string; subject: string; body: string }) =>
    apiClient.post<{
      message: MailMessage;
      routed_folder: 'inbox' | 'spam';
    }>('/api/mail/inbound', payload),
  markRead: (id: string, is_read = true) =>
    apiClient.patch(`/api/mail/${id}/read`, { is_read }),
  moveFolder: (id: string, folder: 'inbox' | 'spam') =>
    apiClient.patch(`/api/mail/${id}/move`, { folder }),
  remove: (id: string) => apiClient.delete(`/api/mail/${id}`),
};
