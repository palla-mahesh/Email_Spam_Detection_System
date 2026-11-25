import express, { Request, Response, NextFunction } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { DatabaseSync } from 'node:sqlite';
import {
  BatchPredictionInput,
  TrainedPipeline,
  analyzeManipulationSignals,
  analyzeSentences,
  classifyThreatCategory,
  generateAiAdvisoryAndReplies,
  loadOrTrainPipeline,
  parseAndValidateCsv,
  predictBatchWithPipeline,
  predictEmailWithPipeline,
  savePipeline,
  searchVocabularyWeights,
  trainPipelineFromRows,
} from './mlEngine.ts';
import nodemailer from 'nodemailer';
import {
  DbDataset,
  DbFeedbackSample,
  DbMailMessage,
  DbModelMetric,
  DbPrediction,
  DbUser,
  getDb,
  logActivity,
  seedInitialDataIfEmpty,
  syncPipelineMetricsToDb,
} from './db.ts';

export interface AuthUserPayload {
  id: string;
  email: string;
  full_name: string;
  role: 'user' | 'admin';
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

export interface AppContext {
  app: express.Express;
  db: DatabaseSync;
  getPipeline: () => TrainedPipeline;
}

const JWT_SECRET = process.env.JWT_SECRET || 'mailguard-ai-zero-key-secret-2026';
const isVercel = Boolean(process.env.VERCEL);

function createRateLimiter(windowMs: number, maxRequests: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === 'test') {
      next();
      return;
    }
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const record = hits.get(key);
    if (!record || now > record.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (record.count >= maxRequests) {
      res.status(429).json({
        detail: 'Rate limit exceeded. Please wait briefly before retrying.',
      });
      return;
    }
    record.count++;
    next();
  };
}

export function createApp(options?: {
  dbPath?: string;
  modelPath?: string;
  datasetCsvPath?: string;
}): AppContext {
  const app = express();

  const datasetCsvPath =
    options?.datasetCsvPath || path.resolve(process.cwd(), 'data/spam_dataset.csv');
  const bundledModelPath =
    options?.modelPath || path.resolve(process.cwd(), 'models/spam_pipeline.json');
  const writableModelPath =
    options?.modelPath || (isVercel ? path.join('/tmp', 'spam_pipeline.json') : bundledModelPath);
  const readModelPath =
    options?.modelPath ||
    (isVercel && fs.existsSync(writableModelPath) ? writableModelPath : bundledModelPath);

  let pipeline = loadOrTrainPipeline(readModelPath, datasetCsvPath);
  const db = getDb(options?.dbPath);
  seedInitialDataIfEmpty(db, pipeline);

  // CORS configuration
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (
      !origin ||
      allowedOrigins.length === 0 ||
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(origin)
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '6mb' }));

  const authLimiter = createRateLimiter(60_000, 30);
  const predictLimiter = createRateLimiter(60_000, 60);

  function signToken(user: AuthUserPayload): string {
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
  }

  function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ detail: 'Missing or invalid authorization token.' });
      return;
    }
    const token = header.slice(7).trim();
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      const userRow = db
        .prepare('SELECT id, full_name, email, role FROM users WHERE id = ?')
        .get(decoded.sub as string) as AuthUserPayload | undefined;

      if (!userRow) {
        res.status(401).json({ detail: 'Authenticated user no longer exists.' });
        return;
      }
      req.user = userRow;
      next();
    } catch {
      res.status(401).json({ detail: 'Token expired or invalid.' });
    }
  }

  function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ detail: 'Administrator privileges required for this action.' });
      return;
    }
    next();
  }

  // =========================================================================
  // SYSTEM HEALTH
  // =========================================================================
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      service: 'MailGuard AI API',
      model: pipeline.selectedModel,
      vocab_size: pipeline.datasetStats.vocabSize,
      dataset_records: pipeline.datasetStats.totalRecords,
      zero_api_key_mode: true,
      timestamp: new Date().toISOString(),
    });
  });

  // =========================================================================
  // AUTHENTICATION ROUTES
  // =========================================================================
  app.post('/auth/register', authLimiter, (req: Request, res: Response) => {
    const fullName = String(req.body?.full_name ?? req.body?.fullName ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (fullName.length < 2) {
      res.status(400).json({ detail: 'Full name must be at least 2 characters.' });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      res.status(400).json({ detail: 'Please provide a valid email address.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ detail: 'Password must be at least 8 characters long.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      res.status(409).json({ detail: 'An account with this email already exists.' });
      return;
    }

    const id = crypto.randomUUID();
    const authUserId = crypto.randomUUID();
    const passwordHash = bcrypt.hashSync(password, 10);
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, full_name, email, password_hash, auth_user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, 'user', ?)
    `).run(id, fullName, email, passwordHash, authUserId, createdAt);

    logActivity(db, id, 'USER_REGISTER', `New user registered: ${email}`);

    const userPayload: AuthUserPayload = {
      id,
      email,
      full_name: fullName,
      role: 'user',
    };

    const access_token = signToken(userPayload);
    res.status(201).json({
      access_token,
      token_type: 'bearer',
      user: { ...userPayload, created_at: createdAt },
    });
  });

  app.post('/auth/login', authLimiter, (req: Request, res: Response) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!email || !password) {
      res.status(400).json({ detail: 'Email and password are required.' });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email) as DbUser | undefined;

    if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
      res.status(401).json({ detail: 'Invalid email or password.' });
      return;
    }

    logActivity(db, userRow.id, 'USER_LOGIN', `User signed in: ${userRow.email}`);

    const userPayload: AuthUserPayload = {
      id: userRow.id,
      email: userRow.email,
      full_name: userRow.full_name,
      role: userRow.role,
    };

    const access_token = signToken(userPayload);
    res.json({
      access_token,
      token_type: 'bearer',
      user: { ...userPayload, created_at: userRow.created_at },
    });
  });

  app.get('/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const userRow = db
      .prepare('SELECT id, full_name, email, role, created_at FROM users WHERE id = ?')
      .get(req.user!.id) as Omit<DbUser, 'password_hash' | 'auth_user_id'>;

    const stats = db
      .prepare(`
        SELECT
          COUNT(*) as total_predictions,
          SUM(CASE WHEN prediction = 'SPAM' THEN 1 ELSE 0 END) as spam_count,
          SUM(CASE WHEN prediction = 'HAM' THEN 1 ELSE 0 END) as ham_count,
          AVG(confidence_score) as avg_confidence
        FROM email_predictions
        WHERE user_id = ?
      `)
      .get(req.user!.id) as {
      total_predictions: number;
      spam_count: number | null;
      ham_count: number | null;
      avg_confidence: number | null;
    };

    res.json({
      user: userRow,
      stats: {
        total_predictions: stats.total_predictions || 0,
        spam_count: stats.spam_count || 0,
        ham_count: stats.ham_count || 0,
        avg_confidence: stats.avg_confidence ? Number(stats.avg_confidence.toFixed(4)) : 0,
      },
    });
  });

  // =========================================================================
  // MACHINE LEARNING ROUTES
  // =========================================================================
  app.get('/api/model/info', (_req: Request, res: Response) => {
    const bestMetric = pipeline.evaluations.find((e) => e.isSelected) || pipeline.evaluations[0];
    res.json({
      selected_model: pipeline.selectedModel,
      version: pipeline.version,
      trained_at: pipeline.trainedAt,
      dataset: pipeline.datasetStats,
      preprocessing: {
        lowercase: true,
        strip_html: true,
        stop_word_removal: true,
        ngram_range: [1, 2],
        vectorizer: 'TF-IDF (Sublinear TF + L2 Normalization)',
        split_strategy: 'Stratified 80/20 Train-Test Split + 5-Fold CV',
      },
      best_metrics: bestMetric,
    });
  });

  app.get('/api/model/metrics', (_req: Request, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM model_metrics ORDER BY is_selected DESC, f1_score DESC')
      .all() as unknown as DbModelMetric[];

    const formatted = rows.map((row) => ({
      id: row.id,
      model_name: row.model_name,
      accuracy: row.accuracy,
      precision_score: row.precision_score,
      recall_score: row.recall_score,
      f1_score: row.f1_score,
      roc_auc: row.roc_auc,
      cv_accuracy: row.cv_accuracy,
      confusion_matrix: JSON.parse(row.confusion_matrix) as [[number, number], [number, number]],
      calibration_note: row.calibration_note,
      is_selected: Boolean(row.is_selected),
      dataset_size: row.dataset_size,
      evaluated_at: row.evaluated_at,
    }));

    res.json({
      selected_model: pipeline.selectedModel,
      dataset_stats: pipeline.datasetStats,
      metrics: formatted,
      ensemble_evaluation: pipeline.ensembleEvaluation,
      roc_curves: pipeline.rocCurves,
      feature_importance: pipeline.featureImportance,
    });
  });

  app.get('/api/model/roc', (_req: Request, res: Response) => {
    res.json({
      selected_model: pipeline.selectedModel,
      ensemble_evaluation: pipeline.ensembleEvaluation,
      roc_curves: pipeline.rocCurves,
    });
  });

  app.get('/api/model/features', (req: Request, res: Response) => {
    const query = String(req.query.q ?? '').trim();
    const limit = Math.min(30, Math.max(5, Number.parseInt(String(req.query.limit ?? '15'), 10) || 15));
    const weights = searchVocabularyWeights(pipeline, query, limit);
    res.json({
      query,
      vocab_size: pipeline.datasetStats.vocabSize,
      total_matches: weights.totalMatches,
      top_spam: weights.topSpam,
      top_ham: weights.topHam,
    });
  });

  app.post('/api/model/retrain', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const csvContent = fs.readFileSync(datasetCsvPath, 'utf-8');
      const parsed = parseAndValidateCsv(csvContent);
      pipeline = trainPipelineFromRows(parsed.rows, path.basename(datasetCsvPath));
      savePipeline(pipeline, writableModelPath);
      syncPipelineMetricsToDb(db, pipeline, null);
      logActivity(
        db,
        req.user!.id,
        'MODEL_RETRAIN',
        `Retrained ML pipeline on ${parsed.rows.length} records. Selected: ${pipeline.selectedModel}`
      );
      res.json({
        message: 'Pipeline retrained and persisted successfully.',
        selected_model: pipeline.selectedModel,
        dataset_stats: pipeline.datasetStats,
        evaluations: pipeline.evaluations,
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Failed to retrain model pipeline.',
      });
    }
  });

  app.post('/api/predict', requireAuth, predictLimiter, (req: AuthenticatedRequest, res: Response) => {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject.trim() : '';
    const sender = typeof req.body?.sender === 'string' ? req.body.sender.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const rawHeaders = typeof req.body?.raw_headers === 'string' ? req.body.raw_headers.trim() : '';
    const useEnsemble = Boolean(req.body?.use_ensemble);
    const threshold =
      typeof req.body?.threshold === 'number' && Number.isFinite(req.body.threshold)
        ? req.body.threshold
        : undefined;

    if (!subject && !body) {
      res.status(400).json({ detail: 'Please provide an email subject or message body.' });
      return;
    }

    if (body.length > 50_000 || subject.length > 1000 || rawHeaders.length > 30_000) {
      res.status(400).json({ detail: 'Email content exceeds maximum allowed length.' });
      return;
    }

    try {
      const result = predictEmailWithPipeline(pipeline, subject, body, sender, {
        rawHeaders: rawHeaders || undefined,
        useEnsemble,
        threshold,
      });
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const storedSubject = subject || '(No Subject)';
      const storedContent = body || subject;
      const storedSender = sender || result.headerAnalysis.fromAddress || null;

      db.prepare(`
        INSERT INTO email_predictions (
          id, user_id, email_subject, sender_address, email_content,
          prediction, spam_probability, confidence_score, model_name,
          processing_time, suspicious_keywords, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        req.user!.id,
        storedSubject,
        storedSender,
        storedContent,
        result.prediction,
        result.spamProbability,
        result.confidenceScore,
        result.modelName,
        result.processingTimeMs,
        JSON.stringify(result.suspiciousKeywords),
        createdAt
      );

      logActivity(
        db,
        req.user!.id,
        'EMAIL_PREDICTION',
        `Classified "${storedSubject.slice(0, 60)}" as ${result.prediction} (${(result.spamProbability * 100).toFixed(1)}%, ${result.classifierMode})`
      );

      res.status(201).json({
        id,
        email_subject: storedSubject,
        sender_address: storedSender,
        prediction: result.prediction,
        spam_probability: result.spamProbability,
        ensemble_probability: result.ensembleProbability,
        confidence_score: result.confidenceScore,
        model_name: result.modelName,
        classifier_mode: result.classifierMode,
        threshold_used: result.thresholdUsed,
        processing_time: result.processingTimeMs,
        suspicious_keywords: result.suspiciousKeywords,
        preprocessed_tokens: result.preprocessedTokens,
        model_breakdown: result.modelBreakdown,
        threat_category: result.threatCategory,
        risk_indicators: result.riskIndicators,
        header_analysis: result.headerAnalysis,
        sentence_analysis: result.sentenceAnalysis,
        ai_advisory: result.aiAdvisory,
        suggested_replies: result.suggestedReplies,
        created_at: createdAt,
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Unable to classify email message.',
      });
    }
  });

  app.post('/api/predict/batch', requireAuth, predictLimiter, (req: AuthenticatedRequest, res: Response) => {
    const rawItems = Array.isArray(req.body?.emails) ? req.body.emails : [];
    if (rawItems.length === 0) {
      res.status(400).json({ detail: 'Provide an array of emails in the "emails" field.' });
      return;
    }
    if (rawItems.length > 50) {
      res.status(400).json({ detail: 'Batch scanner supports up to 50 emails per request.' });
      return;
    }

    const items: BatchPredictionInput[] = rawItems.map((entry: unknown, idx: number) => {
      const obj = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        id: typeof obj.id === 'string' ? obj.id : `row-${idx + 1}`,
        subject: typeof obj.subject === 'string' ? obj.subject : '',
        sender: typeof obj.sender === 'string' ? obj.sender : '',
        body: typeof obj.body === 'string' ? obj.body : '',
      };
    });

    const results = predictBatchWithPipeline(pipeline, items);
    const valid = results.filter((r) => !r.error);
    const spamCount = valid.filter((r) => r.prediction === 'SPAM').length;
    const hamCount = valid.filter((r) => r.prediction === 'HAM').length;
    const highUrgencyCount = valid.filter((r) => r.urgencyScore >= 50).length;

    logActivity(
      db,
      req.user!.id,
      'BATCH_PREDICTION',
      `Scanned batch of ${results.length} emails (${spamCount} SPAM, ${hamCount} HAM)`
    );

    res.json({
      total: results.length,
      processed: valid.length,
      spam_count: spamCount,
      ham_count: hamCount,
      high_urgency_count: highUrgencyCount,
      model_name: pipeline.selectedModel,
      results,
    });
  });

  // =========================================================================
  // PREDICTION HISTORY ROUTES
  // =========================================================================
  app.get('/api/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const search = String(req.query.search ?? '').trim();
    const predictionFilter = String(req.query.prediction ?? 'ALL').toUpperCase();
    const startDate = String(req.query.start_date ?? '').trim();
    const endDate = String(req.query.end_date ?? '').trim();
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const offset = (page - 1) * limit;

    const conditions: string[] = ['user_id = ?'];
    const params: Array<string | number> = [req.user!.id];

    if (predictionFilter === 'SPAM' || predictionFilter === 'HAM') {
      conditions.push('prediction = ?');
      params.push(predictionFilter);
    }
    if (search) {
      conditions.push('(LOWER(email_subject) LIKE ? OR LOWER(email_content) LIKE ? OR LOWER(COALESCE(sender_address, \'\')) LIKE ?)');
      const pattern = `%${search.toLowerCase()}%`;
      params.push(pattern, pattern, pattern);
    }
    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(`${endDate}T23:59:59.999Z`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM email_predictions ${whereClause}`)
      .get(...params) as { total: number };

    const items = db
      .prepare(
        `SELECT * FROM email_predictions ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as unknown as DbPrediction[];

    res.json({
      items: items.map((row) => ({
        ...row,
        suspicious_keywords: JSON.parse(row.suspicious_keywords || '[]'),
      })),
      total: countRow.total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(countRow.total / limit)),
    });
  });

  app.get('/api/history/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const row = db
      .prepare('SELECT * FROM email_predictions WHERE id = ?')
      .get(String(req.params.id)) as DbPrediction | undefined;

    if (!row) {
      res.status(404).json({ detail: 'Prediction record not found.' });
      return;
    }
    if (row.user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ detail: 'You do not have permission to view this prediction.' });
      return;
    }

    res.json({
      ...row,
      suspicious_keywords: JSON.parse(row.suspicious_keywords || '[]'),
    });
  });

  app.delete('/api/history/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const row = db
      .prepare('SELECT id, user_id, email_subject FROM email_predictions WHERE id = ?')
      .get(String(req.params.id)) as { id: string; user_id: string; email_subject: string } | undefined;

    if (!row) {
      res.status(404).json({ detail: 'Prediction record not found.' });
      return;
    }
    if (row.user_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ detail: 'You do not have permission to delete this prediction.' });
      return;
    }

    db.prepare('DELETE FROM email_predictions WHERE id = ?').run(row.id);
    logActivity(
      db,
      req.user!.id,
      'PREDICTION_DELETED',
      `Deleted prediction record "${row.email_subject.slice(0, 60)}"`
    );

    res.json({ deleted: true, id: row.id });
  });

  // =========================================================================
  // ANALYTICS ROUTES (100% Real Database Aggregations)
  // =========================================================================
  function buildDateWhere(userId: string, req: Request): { clause: string; params: string[] } {
    const conditions = ['user_id = ?'];
    const params = [userId];
    const startDate = String(req.query.start_date ?? '').trim();
    const endDate = String(req.query.end_date ?? '').trim();

    if (startDate) {
      conditions.push('created_at >= ?');
      params.push(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      conditions.push('created_at <= ?');
      params.push(`${endDate}T23:59:59.999Z`);
    }
    return { clause: `WHERE ${conditions.join(' AND ')}`, params };
  }

  app.get('/api/analytics/overview', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { clause, params } = buildDateWhere(req.user!.id, req);
    const agg = db
      .prepare(`
        SELECT
          COUNT(*) as total_analyzed,
          SUM(CASE WHEN prediction = 'SPAM' THEN 1 ELSE 0 END) as total_spam,
          SUM(CASE WHEN prediction = 'HAM' THEN 1 ELSE 0 END) as total_ham,
          AVG(confidence_score) as avg_confidence,
          AVG(processing_time) as avg_processing_time
        FROM email_predictions
        ${clause}
      `)
      .get(...params) as {
      total_analyzed: number;
      total_spam: number | null;
      total_ham: number | null;
      avg_confidence: number | null;
      avg_processing_time: number | null;
    };

    const total = agg.total_analyzed || 0;
    const spam = agg.total_spam || 0;
    const ham = agg.total_ham || 0;

    const latest = db
      .prepare(
        `SELECT id, email_subject, sender_address, prediction, spam_probability, confidence_score, model_name, processing_time, created_at
         FROM email_predictions ${clause} ORDER BY created_at DESC LIMIT 6`
      )
      .all(...params);

    const bestMetric = pipeline.evaluations.find((e) => e.isSelected) || pipeline.evaluations[0];

    res.json({
      total_analyzed: total,
      total_spam: spam,
      total_ham: ham,
      spam_percentage: total > 0 ? Number(((spam / total) * 100).toFixed(1)) : 0,
      ham_percentage: total > 0 ? Number(((ham / total) * 100).toFixed(1)) : 0,
      avg_confidence: agg.avg_confidence ? Number((agg.avg_confidence * 100).toFixed(1)) : 0,
      avg_processing_time_ms: agg.avg_processing_time ? Number(agg.avg_processing_time.toFixed(2)) : 0,
      latest_predictions: latest,
      active_model: bestMetric,
    });
  });

  app.get('/api/analytics/distribution', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { clause, params } = buildDateWhere(req.user!.id, req);
    const agg = db
      .prepare(`
        SELECT
          SUM(CASE WHEN prediction = 'SPAM' THEN 1 ELSE 0 END) as spam_count,
          SUM(CASE WHEN prediction = 'HAM' THEN 1 ELSE 0 END) as ham_count
        FROM email_predictions
        ${clause}
      `)
      .get(...params) as { spam_count: number | null; ham_count: number | null };

    const spam = agg.spam_count || 0;
    const ham = agg.ham_count || 0;

    res.json({
      distribution: [
        { name: 'SPAM', value: spam, color: '#EF4444' },
        { name: 'HAM', value: ham, color: '#10B981' },
      ],
      total: spam + ham,
    });
  });

  app.get('/api/analytics/trends', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { clause, params } = buildDateWhere(req.user!.id, req);
    const rows = db
      .prepare(`
        SELECT
          substr(created_at, 1, 10) as date,
          SUM(CASE WHEN prediction = 'SPAM' THEN 1 ELSE 0 END) as spam,
          SUM(CASE WHEN prediction = 'HAM' THEN 1 ELSE 0 END) as ham,
          COUNT(*) as total,
          AVG(spam_probability) as avg_spam_prob
        FROM email_predictions
        ${clause}
        GROUP BY substr(created_at, 1, 10)
        ORDER BY date ASC
      `)
      .all(...params) as Array<{
      date: string;
      spam: number;
      ham: number;
      total: number;
      avg_spam_prob: number;
    }>;

    res.json({
      trends: rows.map((r) => ({
        date: r.date,
        spam: r.spam,
        ham: r.ham,
        total: r.total,
        avg_spam_probability: Number((r.avg_spam_prob * 100).toFixed(1)),
      })),
    });
  });

  app.get('/api/analytics/keywords', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const { clause, params } = buildDateWhere(req.user!.id, req);
    const rows = db
      .prepare(`SELECT suspicious_keywords, prediction FROM email_predictions ${clause}`)
      .all(...params) as Array<{ suspicious_keywords: string; prediction: string }>;

    const freq = new Map<string, { count: number; totalWeight: number }>();

    for (const row of rows) {
      if (row.prediction !== 'SPAM') continue;
      const keywords = JSON.parse(row.suspicious_keywords || '[]') as Array<{
        term: string;
        weight: number;
      }>;
      for (const kw of keywords) {
        const current = freq.get(kw.term) || { count: 0, totalWeight: 0 };
        current.count += 1;
        current.totalWeight += kw.weight;
        freq.set(kw.term, current);
      }
    }

    const keywords = Array.from(freq.entries())
      .map(([term, data]) => ({
        term,
        count: data.count,
        avg_weight: Number((data.totalWeight / data.count).toFixed(3)),
      }))
      .sort((a, b) => b.count - a.count || b.avg_weight - a.avg_weight)
      .slice(0, 12);

    res.json({ keywords });
  });

  // =========================================================================
  // DATASET ROUTES
  // =========================================================================
  app.get('/api/datasets', requireAuth, (_req: Request, res: Response) => {
    const rows = db
      .prepare(`
        SELECT d.*, u.full_name as uploaded_by_name
        FROM datasets d
        LEFT JOIN users u ON d.uploaded_by = u.id
        ORDER BY d.uploaded_at DESC
      `)
      .all();
    res.json({ datasets: rows });
  });

  app.get('/api/datasets/:id', requireAuth, (req: Request, res: Response) => {
    const row = db
      .prepare('SELECT * FROM datasets WHERE id = ?')
      .get(String(req.params.id)) as DbDataset | undefined;

    if (!row) {
      res.status(404).json({ detail: 'Dataset not found.' });
      return;
    }
    res.json(row);
  });

  app.post('/api/datasets/upload', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const rawName = String(req.body?.dataset_name ?? req.body?.datasetName ?? 'uploaded_dataset.csv').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'uploaded_dataset.csv';
    const csvContent = typeof req.body?.csv_content === 'string'
      ? req.body.csv_content
      : typeof req.body?.csvContent === 'string'
        ? req.body.csvContent
        : '';

    if (!csvContent) {
      res.status(400).json({ detail: 'CSV content is required.' });
      return;
    }

    try {
      const parsed = parseAndValidateCsv(csvContent);
      const retrain = req.body?.retrain !== false;

      if (retrain) {
        pipeline = trainPipelineFromRows(parsed.rows, safeName);
        savePipeline(pipeline, writableModelPath);
        syncPipelineMetricsToDb(db, pipeline, req.user!.id);
      } else {
        db.prepare(`
          INSERT INTO datasets (id, dataset_name, total_records, spam_count, ham_count, uploaded_by, uploaded_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          safeName,
          parsed.rows.length,
          parsed.spamCount,
          parsed.hamCount,
          req.user!.id,
          new Date().toISOString()
        );
      }

      logActivity(
        db,
        req.user!.id,
        'DATASET_UPLOAD',
        `Uploaded dataset "${safeName}" (${parsed.rows.length} valid records: ${parsed.spamCount} SPAM, ${parsed.hamCount} HAM)`
      );

      res.status(201).json({
        message: retrain
          ? 'Dataset validated and ML pipeline retrained successfully.'
          : 'Dataset validated and registered successfully.',
        dataset_name: safeName,
        total_records: parsed.rows.length,
        spam_count: parsed.spamCount,
        ham_count: parsed.hamCount,
        skipped_rows: parsed.skippedRows,
        selected_model: pipeline.selectedModel,
        evaluations: pipeline.evaluations,
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Invalid CSV dataset.',
      });
    }
  });

  // =========================================================================
  // ADMIN ROUTES (Strict Role-Based Access Control)
  // =========================================================================
  app.get('/api/admin/dashboard', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const userStats = db.prepare('SELECT COUNT(*) as total_users FROM users').get() as { total_users: number };
    const predStats = db
      .prepare(`
        SELECT
          COUNT(*) as total_predictions,
          SUM(CASE WHEN prediction = 'SPAM' THEN 1 ELSE 0 END) as total_spam,
          SUM(CASE WHEN prediction = 'HAM' THEN 1 ELSE 0 END) as total_ham
        FROM email_predictions
      `)
      .get() as { total_predictions: number; total_spam: number | null; total_ham: number | null };
    const datasetStats = db.prepare('SELECT COUNT(*) as total_datasets FROM datasets').get() as { total_datasets: number };

    const metrics = db
      .prepare('SELECT * FROM model_metrics ORDER BY is_selected DESC, f1_score DESC')
      .all() as unknown as DbModelMetric[];

    res.json({
      total_users: userStats.total_users,
      total_predictions: predStats.total_predictions || 0,
      total_spam: predStats.total_spam || 0,
      total_ham: predStats.total_ham || 0,
      total_datasets: datasetStats.total_datasets,
      active_model: pipeline.selectedModel,
      model_metrics: metrics.map((m) => ({
        ...m,
        confusion_matrix: JSON.parse(m.confusion_matrix),
        is_selected: Boolean(m.is_selected),
      })),
    });
  });

  app.get('/api/admin/users', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const users = db
      .prepare(`
        SELECT
          u.id, u.full_name, u.email, u.role, u.created_at,
          COUNT(p.id) as prediction_count
        FROM users u
        LEFT JOIN email_predictions p ON p.user_id = u.id
        GROUP BY u.id
        ORDER BY u.created_at DESC
      `)
      .all();
    res.json({ users });
  });

  app.patch('/api/admin/users/:id/role', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const targetId = String(req.params.id);
    const nextRole = String(req.body?.role ?? '');
    if (nextRole !== 'user' && nextRole !== 'admin') {
      res.status(400).json({ detail: 'Role must be either user or admin.' });
      return;
    }
    if (targetId === req.user!.id && nextRole !== 'admin') {
      res.status(400).json({ detail: 'You cannot remove your own administrator privileges.' });
      return;
    }

    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(targetId) as { id: string; email: string } | undefined;
    if (!target) {
      res.status(404).json({ detail: 'User not found.' });
      return;
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(nextRole, targetId);
    logActivity(
      db,
      req.user!.id,
      'ROLE_UPDATED',
      `Updated role for ${target.email} to ${nextRole}`
    );

    res.json({ id: targetId, role: nextRole });
  });

  app.get('/api/admin/activity', requireAuth, requireAdmin, (_req: AuthenticatedRequest, res: Response) => {
    const activities = db
      .prepare(`
        SELECT a.*, u.full_name, u.email
        FROM user_activity a
        LEFT JOIN users u ON a.user_id = u.id
        ORDER BY a.created_at DESC
        LIMIT 50
      `)
      .all();
    res.json({ activities });
  });

  // =========================================================================
  // MAILBOX: SEND, RECEIVE FROM CLIENTS & AUTOMATIC ML SPAM GATEKEEPER
  // =========================================================================
  function isSmtpConfigured(): boolean {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  function formatMailRow(row: DbMailMessage) {
    const riskIndicators = analyzeManipulationSignals(row.subject, row.body, row.sender_email);
    const threatCategory = classifyThreatCategory(row.subject, row.body, row.prediction, riskIndicators);
    const sentenceAnalysis = analyzeSentences(pipeline, row.body || row.subject);
    const { aiAdvisory, suggestedReplies } = generateAiAdvisoryAndReplies(
      row.prediction,
      threatCategory,
      riskIndicators,
      row.subject,
      row.body
    );

    return {
      ...row,
      is_read: Boolean(row.is_read),
      suspicious_keywords: JSON.parse(row.suspicious_keywords || '[]'),
      threat_category: threatCategory,
      risk_indicators: riskIndicators,
      sentence_analysis: sentenceAnalysis,
      ai_advisory: aiAdvisory,
      suggested_replies: suggestedReplies,
    };
  }

  app.get('/api/mail/config', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    res.json({
      smtp_configured: isSmtpConfigured(),
      smtp_host: process.env.SMTP_HOST || null,
      inbound_webhook_protected: Boolean(process.env.INBOUND_MAIL_WEBHOOK_SECRET),
    });
  });

  app.get('/api/mail/recipients', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const clients = db
      .prepare('SELECT id, full_name, email, role FROM users WHERE id != ? ORDER BY full_name ASC')
      .all(req.user!.id);
    res.json({ recipients: clients });
  });

  app.get('/api/mail/inbox', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const folderParam = String(req.query.folder ?? 'inbox').toLowerCase();
    const userEmail = req.user!.email.toLowerCase();

    const counts = db
      .prepare(`
        SELECT
          SUM(CASE WHEN folder = 'inbox' THEN 1 ELSE 0 END) as inbox_count,
          SUM(CASE WHEN folder = 'spam' THEN 1 ELSE 0 END) as spam_count,
          SUM(CASE WHEN folder = 'inbox' AND is_read = 0 THEN 1 ELSE 0 END) as unread_inbox_count
        FROM mail_messages
        WHERE recipient_id = ? OR LOWER(recipient_email) = ?
      `)
      .get(req.user!.id, userEmail) as {
      inbox_count: number | null;
      spam_count: number | null;
      unread_inbox_count: number | null;
    };

    const conditions = ['(recipient_id = ? OR LOWER(recipient_email) = ?)'];
    const params: string[] = [req.user!.id, userEmail];
    if (folderParam === 'inbox' || folderParam === 'spam') {
      conditions.push('folder = ?');
      params.push(folderParam);
    }

    const rows = db
      .prepare(`SELECT * FROM mail_messages WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 100`)
      .all(...params) as unknown as DbMailMessage[];

    res.json({
      messages: rows.map(formatMailRow),
      counts: {
        inbox: counts.inbox_count || 0,
        spam: counts.spam_count || 0,
        unread_inbox: counts.unread_inbox_count || 0,
      },
    });
  });

  app.get('/api/mail/sent', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM mail_messages WHERE sender_id = ? ORDER BY created_at DESC LIMIT 100')
      .all(req.user!.id) as unknown as DbMailMessage[];
    res.json({ messages: rows.map(formatMailRow) });
  });

  app.post('/api/mail/send', requireAuth, predictLimiter, async (req: AuthenticatedRequest, res: Response) => {
    const recipientEmail = String(req.body?.to ?? req.body?.recipient_email ?? '').trim().toLowerCase();
    const subject = String(req.body?.subject ?? '').trim();
    const body = String(req.body?.body ?? '').trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      res.status(400).json({ detail: 'Please provide a valid recipient email address.' });
      return;
    }
    if (!subject && !body) {
      res.status(400).json({ detail: 'Email subject or message body is required.' });
      return;
    }
    if (!body) {
      res.status(400).json({ detail: 'Email message body cannot be empty.' });
      return;
    }

    try {
      const scan = predictEmailWithPipeline(pipeline, subject, body, req.user!.email);
      const folder: 'inbox' | 'spam' = scan.prediction === 'SPAM' ? 'spam' : 'inbox';
      const recipientRow = db
        .prepare('SELECT id, email FROM users WHERE LOWER(email) = ?')
        .get(recipientEmail) as { id: string; email: string } | undefined;

      let deliveryChannel: 'internal' | 'smtp' = 'internal';
      let smtpNotice = '';

      // If SMTP environment variables are configured, relay real outbound mail
      if (isSmtpConfigured()) {
        const transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT) || 587,
          secure: Number(process.env.SMTP_PORT) === 465,
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          },
        });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: recipientEmail,
          replyTo: req.user!.email,
          subject: subject || '(No Subject)',
          text: body,
        });
        deliveryChannel = 'smtp';
        smtpNotice = 'Relayed via configured SMTP server.';
      }

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const storedSubject = subject || '(No Subject)';

      db.prepare(`
        INSERT INTO mail_messages (
          id, sender_id, sender_email, recipient_id, recipient_email,
          subject, body, prediction, spam_probability, confidence_score,
          model_name, processing_time, suspicious_keywords, folder,
          delivery_channel, is_read, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        id,
        req.user!.id,
        req.user!.email,
        recipientRow?.id || null,
        recipientEmail,
        storedSubject,
        body,
        scan.prediction,
        scan.spamProbability,
        scan.confidenceScore,
        scan.modelName,
        scan.processingTimeMs,
        JSON.stringify(scan.suspiciousKeywords),
        folder,
        deliveryChannel,
        createdAt
      );

      // Record scan in recipient's prediction telemetry if registered locally (or sender's audit)
      const telemetryOwnerId = recipientRow?.id || req.user!.id;
      db.prepare(`
        INSERT INTO email_predictions (
          id, user_id, email_subject, sender_address, email_content,
          prediction, spam_probability, confidence_score, model_name,
          processing_time, suspicious_keywords, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        telemetryOwnerId,
        storedSubject,
        req.user!.email,
        body,
        scan.prediction,
        scan.spamProbability,
        scan.confidenceScore,
        scan.modelName,
        scan.processingTimeMs,
        JSON.stringify(scan.suspiciousKeywords),
        createdAt
      );

      logActivity(
        db,
        req.user!.id,
        'MAIL_SENT',
        `Sent mail to ${recipientEmail} (${deliveryChannel}) · ML Gatekeeper: ${scan.prediction} (${(scan.spamProbability * 100).toFixed(1)}%)`
      );

      const saved = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(id) as unknown as DbMailMessage;
      res.status(201).json({
        message: formatMailRow(saved),
        delivery_channel: deliveryChannel,
        smtp_notice:
          smtpNotice ||
          (recipientRow
            ? `Delivered to ${recipientEmail} (${folder === 'spam' ? 'routed to Spam Quarantine' : 'delivered to Inbox'}).`
            : `Stored in Sent log (configure SMTP_* env vars to relay externally to ${recipientEmail}).`),
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Unable to send and scan mail.',
      });
    }
  });

  // External client / webhook receiver: accepts incoming mail and checks SPAM vs HAM automatically
  app.post('/api/mail/inbound', predictLimiter, (req: AuthenticatedRequest, res: Response) => {
    const configuredSecret = process.env.INBOUND_MAIL_WEBHOOK_SECRET;
    const providedSecret = String(req.headers['x-webhook-secret'] ?? '');

    let authenticatedSenderUser: AuthUserPayload | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7).trim(), JWT_SECRET) as jwt.JwtPayload;
        authenticatedSenderUser = db
          .prepare('SELECT id, full_name, email, role FROM users WHERE id = ?')
          .get(decoded.sub as string) as AuthUserPayload | undefined;
      } catch {
        // Invalid bearer falls back to webhook secret check
      }
    }

    if (!authenticatedSenderUser && configuredSecret && providedSecret !== configuredSecret) {
      res.status(401).json({ detail: 'Invalid inbound mail webhook secret or authorization token.' });
      return;
    }

    const fromEmail = String(req.body?.from ?? req.body?.sender ?? '').trim().toLowerCase();
    const toEmail = String(
      req.body?.to ?? req.body?.recipient ?? authenticatedSenderUser?.email ?? ''
    )
      .trim()
      .toLowerCase();
    const subject = String(req.body?.subject ?? '').trim();
    const body = String(req.body?.body ?? req.body?.text ?? '').trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fromEmail) || !emailRegex.test(toEmail)) {
      res.status(400).json({ detail: 'Valid sender (from) and recipient (to) email addresses are required.' });
      return;
    }
    if (!subject && !body) {
      res.status(400).json({ detail: 'Incoming email must include a subject or body.' });
      return;
    }

    try {
      const scan = predictEmailWithPipeline(pipeline, subject, body || subject, fromEmail);
      const folder: 'inbox' | 'spam' = scan.prediction === 'SPAM' ? 'spam' : 'inbox';
      const recipientRow = db
        .prepare('SELECT id, email FROM users WHERE LOWER(email) = ?')
        .get(toEmail) as { id: string; email: string } | undefined;

      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const storedSubject = subject || '(No Subject)';
      const storedBody = body || subject;

      db.prepare(`
        INSERT INTO mail_messages (
          id, sender_id, sender_email, recipient_id, recipient_email,
          subject, body, prediction, spam_probability, confidence_score,
          model_name, processing_time, suspicious_keywords, folder,
          delivery_channel, is_read, created_at
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbound_webhook', 0, ?)
      `).run(
        id,
        fromEmail,
        recipientRow?.id || null,
        toEmail,
        storedSubject,
        storedBody,
        scan.prediction,
        scan.spamProbability,
        scan.confidenceScore,
        scan.modelName,
        scan.processingTimeMs,
        JSON.stringify(scan.suspiciousKeywords),
        folder,
        createdAt
      );

      if (recipientRow) {
        db.prepare(`
          INSERT INTO email_predictions (
            id, user_id, email_subject, sender_address, email_content,
            prediction, spam_probability, confidence_score, model_name,
            processing_time, suspicious_keywords, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          recipientRow.id,
          storedSubject,
          fromEmail,
          storedBody,
          scan.prediction,
          scan.spamProbability,
          scan.confidenceScore,
          scan.modelName,
          scan.processingTimeMs,
          JSON.stringify(scan.suspiciousKeywords),
          createdAt
        );
      }

      logActivity(
        db,
        recipientRow?.id || authenticatedSenderUser?.id || null,
        'MAIL_INBOUND',
        `Received external mail from ${fromEmail} to ${toEmail} · Classified as ${scan.prediction} (${(scan.spamProbability * 100).toFixed(1)}%)`
      );

      const saved = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(id) as unknown as DbMailMessage;
      res.status(201).json({
        message: formatMailRow(saved),
        routed_folder: folder,
      });
    } catch (err) {
      res.status(400).json({
        detail: err instanceof Error ? err.message : 'Unable to process inbound mail.',
      });
    }
  });

  app.patch('/api/mail/:id/read', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const msg = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(String(req.params.id)) as unknown as DbMailMessage | undefined;
    if (!msg) {
      res.status(404).json({ detail: 'Mail message not found.' });
      return;
    }
    const isRecipient =
      msg.recipient_id === req.user!.id || msg.recipient_email.toLowerCase() === req.user!.email.toLowerCase();
    if (!isRecipient && req.user!.role !== 'admin') {
      res.status(403).json({ detail: 'Access denied.' });
      return;
    }

    const isRead = req.body?.is_read === false ? 0 : 1;
    db.prepare('UPDATE mail_messages SET is_read = ? WHERE id = ?').run(isRead, msg.id);
    res.json({ id: msg.id, is_read: Boolean(isRead) });
  });

  app.patch('/api/mail/:id/move', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const msg = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(String(req.params.id)) as unknown as DbMailMessage | undefined;
    if (!msg) {
      res.status(404).json({ detail: 'Mail message not found.' });
      return;
    }
    const isRecipient =
      msg.recipient_id === req.user!.id || msg.recipient_email.toLowerCase() === req.user!.email.toLowerCase();
    if (!isRecipient && req.user!.role !== 'admin') {
      res.status(403).json({ detail: 'Only the recipient can move this mail between folders.' });
      return;
    }

    const folder = String(req.body?.folder ?? '');
    if (folder !== 'inbox' && folder !== 'spam') {
      res.status(400).json({ detail: 'Folder must be inbox or spam.' });
      return;
    }
    db.prepare('UPDATE mail_messages SET folder = ?, is_read = 1 WHERE id = ?').run(folder, msg.id);
    res.json({ id: msg.id, folder });
  });

  app.delete('/api/mail/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const msg = db.prepare('SELECT * FROM mail_messages WHERE id = ?').get(String(req.params.id)) as unknown as DbMailMessage | undefined;
    if (!msg) {
      res.status(404).json({ detail: 'Mail message not found.' });
      return;
    }
    const isParticipant =
      msg.sender_id === req.user!.id ||
      msg.recipient_id === req.user!.id ||
      msg.recipient_email.toLowerCase() === req.user!.email.toLowerCase();
    if (!isParticipant && req.user!.role !== 'admin') {
      res.status(403).json({ detail: 'You do not have permission to delete this mail.' });
      return;
    }
    db.prepare('DELETE FROM mail_messages WHERE id = ?').run(msg.id);
    res.json({ deleted: true, id: msg.id });
  });

  // =========================================================================
  // ACTIVE LEARNING FEEDBACK & MODEL RETRAINING ROUTES
  // =========================================================================
  app.post('/api/feedback', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const predictionId =
      typeof req.body?.prediction_id === 'string' && req.body.prediction_id.trim()
        ? req.body.prediction_id.trim()
        : null;
    const emailSubject = String(req.body?.email_subject ?? req.body?.subject ?? '(No Subject)').trim();
    const senderAddress =
      typeof req.body?.sender_address === 'string' && req.body.sender_address.trim()
        ? req.body.sender_address.trim()
        : typeof req.body?.sender === 'string' && req.body.sender.trim()
          ? req.body.sender.trim()
          : null;
    const emailContent = String(req.body?.email_content ?? req.body?.body ?? '').trim();
    const originalPrediction = String(req.body?.original_prediction ?? '').toUpperCase();
    const correctedLabel = String(req.body?.corrected_label ?? '').toUpperCase();
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : null;

    if (!emailContent) {
      res.status(400).json({ detail: 'Email content is required to submit a feedback sample.' });
      return;
    }
    if (
      (originalPrediction !== 'SPAM' && originalPrediction !== 'HAM') ||
      (correctedLabel !== 'SPAM' && correctedLabel !== 'HAM')
    ) {
      res.status(400).json({ detail: 'Both original_prediction and corrected_label must be SPAM or HAM.' });
      return;
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    db.prepare(`
      INSERT INTO feedback_samples (
        id, prediction_id, submitted_by, email_subject, sender_address,
        email_content, original_prediction, corrected_label, notes, status, created_at, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)
    `).run(
      id,
      predictionId,
      req.user!.id,
      emailSubject || '(No Subject)',
      senderAddress,
      emailContent,
      originalPrediction,
      correctedLabel,
      notes,
      createdAt
    );

    logActivity(
      db,
      req.user!.id,
      'FEEDBACK_SUBMITTED',
      `Flagged "${emailSubject.slice(0, 50)}" (${originalPrediction} -> ${correctedLabel}) for Active Learning`
    );

    const saved = db.prepare('SELECT * FROM feedback_samples WHERE id = ?').get(id) as unknown as DbFeedbackSample;
    res.status(201).json({
      feedback: saved,
      message: 'Correction queued for Active Learning retraining.',
    });
  });

  app.get('/api/feedback', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const statusFilter = String(req.query.status ?? 'ALL').toLowerCase();
    const isAdmin = req.user!.role === 'admin';

    const conditions: string[] = [];
    const params: string[] = [];

    if (!isAdmin) {
      conditions.push('f.submitted_by = ?');
      params.push(req.user!.id);
    }
    if (statusFilter === 'pending' || statusFilter === 'applied' || statusFilter === 'dismissed') {
      conditions.push('f.status = ?');
      params.push(statusFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT f.*, u.full_name as submitted_by_name, u.email as submitted_by_email
        FROM feedback_samples f
        LEFT JOIN users u ON f.submitted_by = u.id
        ${whereClause}
        ORDER BY f.created_at DESC
        LIMIT 100
      `)
      .all(...params);

    const summary = db
      .prepare(`
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
          SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied_count,
          SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END) as dismissed_count
        FROM feedback_samples
      `)
      .get() as {
      pending_count: number | null;
      applied_count: number | null;
      dismissed_count: number | null;
    };

    res.json({
      items: rows,
      counts: {
        pending: summary.pending_count || 0,
        applied: summary.applied_count || 0,
        dismissed: summary.dismissed_count || 0,
      },
    });
  });

  app.patch('/api/feedback/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    const targetId = String(req.params.id);
    const existing = db
      .prepare('SELECT * FROM feedback_samples WHERE id = ?')
      .get(targetId) as DbFeedbackSample | undefined;

    if (!existing) {
      res.status(404).json({ detail: 'Feedback sample not found.' });
      return;
    }

    const nextStatus = req.body?.status ? String(req.body.status).toLowerCase() : existing.status;
    const nextLabel = req.body?.corrected_label
      ? String(req.body.corrected_label).toUpperCase()
      : existing.corrected_label;

    if (!['pending', 'applied', 'dismissed'].includes(nextStatus)) {
      res.status(400).json({ detail: 'Status must be pending, applied, or dismissed.' });
      return;
    }
    if (nextLabel !== 'SPAM' && nextLabel !== 'HAM') {
      res.status(400).json({ detail: 'corrected_label must be SPAM or HAM.' });
      return;
    }

    db.prepare('UPDATE feedback_samples SET status = ?, corrected_label = ? WHERE id = ?').run(
      nextStatus,
      nextLabel,
      targetId
    );

    const updated = db.prepare('SELECT * FROM feedback_samples WHERE id = ?').get(targetId) as unknown as DbFeedbackSample;
    res.json({ feedback: updated });
  });

  app.post('/api/feedback/retrain', requireAuth, requireAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const beforeBest =
        pipeline.evaluations.find((e) => e.isSelected) || pipeline.evaluations[0];
      const beforeSnapshot = {
        selected_model: pipeline.selectedModel,
        accuracy: beforeBest.accuracy,
        f1_score: beforeBest.f1Score,
        roc_auc: beforeBest.rocAuc,
        total_records: pipeline.datasetStats.totalRecords,
      };

      const csvContent = fs.readFileSync(datasetCsvPath, 'utf-8');
      const parsed = parseAndValidateCsv(csvContent);

      const feedbackRows = db
        .prepare("SELECT * FROM feedback_samples WHERE status IN ('pending', 'applied')")
        .all() as unknown as DbFeedbackSample[];

      const pendingCount = feedbackRows.filter((f) => f.status === 'pending').length;

      const feedbackDatasetRows = feedbackRows.map((fb) => ({
        label: (fb.corrected_label === 'SPAM' ? 1 : 0) as 0 | 1,
        text: [
          fb.email_subject ? `Subject: ${fb.email_subject}` : '',
          fb.email_content,
          fb.sender_address ? `From: ${fb.sender_address}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }));

      const mergedRows = [...parsed.rows, ...feedbackDatasetRows];
      const nextPipeline = trainPipelineFromRows(
        mergedRows,
        `${path.basename(datasetCsvPath)} + ${feedbackDatasetRows.length} feedback`
      );
      savePipeline(nextPipeline, writableModelPath);
      pipeline = nextPipeline;
      syncPipelineMetricsToDb(db, pipeline, null);

      const now = new Date().toISOString();
      if (pendingCount > 0) {
        db.prepare("UPDATE feedback_samples SET status = 'applied', applied_at = ? WHERE status = 'pending'").run(now);
      }

      const afterBest =
        pipeline.evaluations.find((e) => e.isSelected) || pipeline.evaluations[0];
      const afterSnapshot = {
        selected_model: pipeline.selectedModel,
        accuracy: afterBest.accuracy,
        f1_score: afterBest.f1Score,
        roc_auc: afterBest.rocAuc,
        total_records: pipeline.datasetStats.totalRecords,
      };

      logActivity(
        db,
        req.user!.id,
        'ACTIVE_LEARNING_RETRAIN',
        `Merged ${feedbackDatasetRows.length} feedback samples (${pendingCount} newly applied) into ${mergedRows.length} total training rows. Active: ${pipeline.selectedModel} (F1 ${(afterBest.f1Score * 100).toFixed(2)}%)`
      );

      res.json({
        message: `Pipeline retrained with ${feedbackDatasetRows.length} active-learning feedback sample(s) (${pendingCount} newly applied).`,
        applied_count: pendingCount,
        total_feedback_used: feedbackDatasetRows.length,
        before: beforeSnapshot,
        after: afterSnapshot,
        selected_model: pipeline.selectedModel,
        dataset_stats: pipeline.datasetStats,
        evaluations: pipeline.evaluations,
        ensemble_evaluation: pipeline.ensembleEvaluation,
      });
    } catch (err) {
      res.status(500).json({
        detail: err instanceof Error ? err.message : 'Active-learning retraining failed.',
      });
    }
  });

  return {
    app,
    db,
    getPipeline: () => pipeline,
  };
}
