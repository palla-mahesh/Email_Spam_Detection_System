import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import {
  TrainedPipeline,
  predictEmailWithPipeline,
} from './mlEngine.ts';

export interface DbUser {
  id: string;
  full_name: string;
  email: string;
  password_hash: string;
  auth_user_id: string;
  role: 'user' | 'admin';
  created_at: string;
}

export interface DbPrediction {
  id: string;
  user_id: string;
  email_subject: string;
  sender_address: string | null;
  email_content: string;
  prediction: 'SPAM' | 'HAM';
  spam_probability: number;
  confidence_score: number;
  model_name: string;
  processing_time: number;
  suspicious_keywords: string; // JSON string
  created_at: string;
}

export interface DbMailMessage {
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
  suspicious_keywords: string;
  folder: 'inbox' | 'spam';
  delivery_channel: 'internal' | 'smtp' | 'inbound_webhook';
  is_read: number;
  created_at: string;
}

export interface DbModelMetric {
  id: string;
  model_name: string;
  accuracy: number;
  precision_score: number;
  recall_score: number;
  f1_score: number;
  roc_auc: number | null;
  cv_accuracy: number | null;
  confusion_matrix: string; // JSON string
  calibration_note: string;
  is_selected: number;
  dataset_size: number;
  evaluated_at: string;
}

export interface DbDataset {
  id: string;
  dataset_name: string;
  total_records: number;
  spam_count: number;
  ham_count: number;
  uploaded_by: string | null;
  uploaded_at: string;
}

export interface DbActivity {
  id: string;
  user_id: string | null;
  activity_type: string;
  description: string;
  created_at: string;
}

let dbInstance: DatabaseSync | null = null;

const isVercel = Boolean(process.env.VERCEL);

export function getDb(
  dbPath = isVercel
    ? path.join('/tmp', 'spam_detector.db')
    : path.resolve(process.cwd(), 'data/spam_detector.db')
): DatabaseSync {
  if (dbInstance) return dbInstance;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      auth_user_id TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS email_predictions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_subject TEXT NOT NULL DEFAULT '(No Subject)',
      sender_address TEXT,
      email_content TEXT NOT NULL,
      prediction TEXT NOT NULL CHECK (prediction IN ('SPAM', 'HAM')),
      spam_probability REAL NOT NULL CHECK (spam_probability >= 0 AND spam_probability <= 1),
      confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
      model_name TEXT NOT NULL,
      processing_time REAL NOT NULL,
      suspicious_keywords TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_user_created ON email_predictions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_predictions_prediction ON email_predictions(prediction);

    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      sender_email TEXT NOT NULL,
      recipient_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      recipient_email TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '(No Subject)',
      body TEXT NOT NULL,
      prediction TEXT NOT NULL CHECK (prediction IN ('SPAM', 'HAM')),
      spam_probability REAL NOT NULL CHECK (spam_probability >= 0 AND spam_probability <= 1),
      confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
      model_name TEXT NOT NULL,
      processing_time REAL NOT NULL,
      suspicious_keywords TEXT NOT NULL DEFAULT '[]',
      folder TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'spam')),
      delivery_channel TEXT NOT NULL DEFAULT 'internal' CHECK (delivery_channel IN ('internal', 'smtp', 'inbound_webhook')),
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mail_recipient_folder ON mail_messages(recipient_email, folder, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mail_sender ON mail_messages(sender_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS model_metrics (
      id TEXT PRIMARY KEY,
      model_name TEXT NOT NULL,
      accuracy REAL NOT NULL,
      precision_score REAL NOT NULL,
      recall_score REAL NOT NULL,
      f1_score REAL NOT NULL,
      roc_auc REAL,
      cv_accuracy REAL,
      confusion_matrix TEXT NOT NULL DEFAULT '[[0,0],[0,0]]',
      calibration_note TEXT NOT NULL DEFAULT '',
      is_selected INTEGER NOT NULL DEFAULT 0,
      dataset_size INTEGER NOT NULL DEFAULT 0,
      evaluated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      dataset_name TEXT NOT NULL,
      total_records INTEGER NOT NULL,
      spam_count INTEGER NOT NULL,
      ham_count INTEGER NOT NULL,
      uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_activity (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      activity_type TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activity_created ON user_activity(created_at DESC);
  `);

  dbInstance = db;
  return db;
}

export function syncPipelineMetricsToDb(db: DatabaseSync, pipeline: TrainedPipeline, uploadedById: string | null = null): void {
  const existingDatasets = db.prepare('SELECT COUNT(*) as cnt FROM datasets').get() as { cnt: number };
  if (existingDatasets.cnt === 0 || uploadedById !== null) {
    db.prepare(`
      INSERT INTO datasets (id, dataset_name, total_records, spam_count, ham_count, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      pipeline.datasetStats.datasetName,
      pipeline.datasetStats.totalRecords,
      pipeline.datasetStats.spamCount,
      pipeline.datasetStats.hamCount,
      uploadedById,
      pipeline.trainedAt
    );
  }

  db.prepare('DELETE FROM model_metrics').run();
  const insertMetric = db.prepare(`
    INSERT INTO model_metrics (
      id, model_name, accuracy, precision_score, recall_score, f1_score,
      roc_auc, cv_accuracy, confusion_matrix, calibration_note, is_selected, dataset_size, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of pipeline.evaluations) {
    insertMetric.run(
      crypto.randomUUID(),
      m.modelName,
      m.accuracy,
      m.precisionScore,
      m.recallScore,
      m.f1Score,
      m.rocAuc,
      m.cvAccuracy,
      JSON.stringify(m.confusionMatrix),
      m.calibrationNote,
      m.isSelected ? 1 : 0,
      pipeline.datasetStats.totalRecords,
      pipeline.trainedAt
    );
  }
}

export function seedInitialDataIfEmpty(db: DatabaseSync, pipeline: TrainedPipeline): void {
  const userCount = (db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number }).cnt;
  let adminId = '';
  let analystId = '';

  if (userCount === 0) {
    const now = new Date().toISOString();
    adminId = crypto.randomUUID();
    analystId = crypto.randomUUID();

    const adminHash = bcrypt.hashSync('Admin@2026!', 10);
    const analystHash = bcrypt.hashSync('Analyst@2026!', 10);

    const insertUser = db.prepare(`
      INSERT INTO users (id, full_name, email, password_hash, auth_user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(adminId, 'Dr. Elena Vance', 'admin@mailguard.ai', adminHash, crypto.randomUUID(), 'admin', now);
    insertUser.run(analystId, 'Alex Mercer', 'analyst@mailguard.ai', analystHash, crypto.randomUUID(), 'user', now);

    db.prepare(`
      INSERT INTO user_activity (id, user_id, activity_type, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), adminId, 'MODEL_TRAINING', `Trained TF-IDF pipeline on ${pipeline.datasetStats.totalRecords} emails; selected ${pipeline.selectedModel}.`, now);
  } else {
    const adminRow = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get() as { id: string } | undefined;
    const analystRow = db.prepare("SELECT id FROM users WHERE role = 'user' LIMIT 1").get() as { id: string } | undefined;
    adminId = adminRow?.id ?? '';
    analystId = analystRow?.id ?? adminId;
  }

  const metricCount = (db.prepare('SELECT COUNT(*) as cnt FROM model_metrics').get() as { cnt: number }).cnt;
  if (metricCount === 0) {
    syncPipelineMetricsToDb(db, pipeline, null);
  }

  // Seed initial real ML-evaluated predictions across the last 7 days if table is empty
  const predCount = (db.prepare('SELECT COUNT(*) as cnt FROM email_predictions').get() as { cnt: number }).cnt;
  if (predCount === 0 && analystId) {
    const sampleInputs: Array<{ subject: string; sender: string; body: string; daysAgo: number; userId: string }> = [
      {
        subject: 'URGENT: Your Chase Bank Account Has Been Suspended!',
        sender: 'security-alert@chase-verify-portal.xyz',
        body: 'Click here immediately to verify your social security number, ATM PIN, and online banking password within 24 hours or your funds will be frozen permanently.',
        daysAgo: 6,
        userId: analystId,
      },
      {
        subject: 'Q3 Architecture Review Rescheduled',
        sender: 'priya.nair@engineering.org',
        body: 'Hi team, I moved Thursday architecture review from 2:00 PM to 3:30 PM PST so the backend engineers can join after the PostgreSQL migration dry run.',
        daysAgo: 6,
        userId: analystId,
      },
      {
        subject: 'CONGRATULATIONS! You Won a $1,000 Walmart Gift Card!',
        sender: 'rewards@sweepstakes-winner-claim.top',
        body: 'You are today lucky visitor! Claim your exclusive $1,000 prize reward now by completing our 2-minute survey and paying $1.95 shipping fee.',
        daysAgo: 5,
        userId: analystId,
      },
      {
        subject: 'Pull Request #418 Merged: Fix JWT Race Condition',
        sender: 'notifications@github.com',
        body: 'Your commit fixing token expiration validation in auth middleware has been merged into main. All 42 unit tests passed cleanly on CI.',
        daysAgo: 4,
        userId: analystId,
      },
      {
        subject: 'Double Your Bitcoin in 48 Hours - Guaranteed 300% ROI',
        sender: 'vip-signals@crypto-wealth-bot.biz',
        body: 'Join our automated crypto trading club today. Minimum deposit $250 with instant risk-free payouts directly to your wallet!',
        daysAgo: 3,
        userId: analystId,
      },
      {
        subject: 'CS-410 Machine Learning Assignment 3 Reminder',
        sender: 'prof.chen@university.edu',
        body: 'Dear students, please submit your Jupyter notebook and confusion matrix evaluation report on TF-IDF classification before Friday at 11:59 PM.',
        daysAgo: 2,
        userId: analystId,
      },
      {
        subject: 'PayPal Account Limited - Confirm Credit Card Immediately',
        sender: 'service@paypal-billing-update.info',
        body: 'We detected unauthorized login activity from an unknown device. Verify your credit card number, CVV, and billing address now to restore account access.',
        daysAgo: 1,
        userId: analystId,
      },
      {
        subject: 'Flight Confirmation - SEA to SFO',
        sender: 'confirmations@alaskaair.com',
        body: 'Thank you for booking with Alaska Airlines. Confirmation code XK94LP. Departure Friday at 08:15 AM from Gate N12.',
        daysAgo: 1,
        userId: analystId,
      },
      {
        subject: 'Monthly Cloud Infrastructure Invoice #INV-2026-089',
        sender: 'billing@cloudprovider.com',
        body: 'Your monthly invoice for $142.80 is ready to view in the billing console. Payment will process automatically on the 1st.',
        daysAgo: 0,
        userId: analystId,
      },
      {
        subject: 'IRS Tax Refund Notification - $2,480.00 Pending',
        sender: 'refunds@irs-rebate-claim.top',
        body: 'You are eligible for an unclaimed federal tax refund. Submit your bank routing number and social security number immediately for direct deposit.',
        daysAgo: 0,
        userId: adminId || analystId,
      },
    ];

    const insertPred = db.prepare(`
      INSERT INTO email_predictions (
        id, user_id, email_subject, sender_address, email_content,
        prediction, spam_probability, confidence_score, model_name,
        processing_time, suspicious_keywords, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of sampleInputs) {
      const result = predictEmailWithPipeline(pipeline, item.subject, item.body, item.sender);
      const ts = new Date(Date.now() - item.daysAgo * 86400 * 1000).toISOString();
      insertPred.run(
        crypto.randomUUID(),
        item.userId,
        item.subject,
        item.sender,
        item.body,
        result.prediction,
        result.spamProbability,
        result.confidenceScore,
        result.modelName,
        result.processingTimeMs,
        JSON.stringify(result.suspiciousKeywords),
        ts
      );
    }
  }

  // Seed initial client-to-client & external inbound mail messages scanned by the real ML gatekeeper
  const mailCount = (db.prepare('SELECT COUNT(*) as cnt FROM mail_messages').get() as { cnt: number }).cnt;
  if (mailCount === 0 && analystId && adminId) {
    const initialMails: Array<{
      senderId: string | null;
      senderEmail: string;
      recipientId: string;
      recipientEmail: string;
      subject: string;
      body: string;
      channel: 'internal' | 'inbound_webhook';
      hoursAgo: number;
    }> = [
      {
        senderId: adminId,
        senderEmail: 'admin@mailguard.ai',
        recipientId: analystId,
        recipientEmail: 'analyst@mailguard.ai',
        subject: 'Dataset Validation Checklist for Friday Review',
        body: 'Hi Alex, please verify the confusion matrix counts on the held-out 20% test split before Friday afternoon sprint review.',
        channel: 'internal',
        hoursAgo: 18,
      },
      {
        senderId: null,
        senderEmail: 'rewards@giftcard-claim-now.xyz',
        recipientId: analystId,
        recipientEmail: 'analyst@mailguard.ai',
        subject: 'CONGRATULATIONS! Claim Your Free $1,000 Gift Card Today!',
        body: 'You won our exclusive cash sweepstakes! Click http://giftcard-claim-now.xyz/win and enter your bank account and credit card details immediately!',
        channel: 'inbound_webhook',
        hoursAgo: 6,
      },
      {
        senderId: analystId,
        senderEmail: 'analyst@mailguard.ai',
        recipientId: adminId,
        recipientEmail: 'admin@mailguard.ai',
        subject: 'Re: Platt Scaling Calibration Benchmarks Ready',
        body: 'Hi Elena, Linear SVM with 3-fold Platt scaling reached 95.83% accuracy and 0.9969 ROC-AUC on the validation split.',
        channel: 'internal',
        hoursAgo: 3,
      },
    ];

    const insertMail = db.prepare(`
      INSERT INTO mail_messages (
        id, sender_id, sender_email, recipient_id, recipient_email,
        subject, body, prediction, spam_probability, confidence_score,
        model_name, processing_time, suspicious_keywords, folder,
        delivery_channel, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    for (const m of initialMails) {
      const scan = predictEmailWithPipeline(pipeline, m.subject, m.body, m.senderEmail);
      const folder = scan.prediction === 'SPAM' ? 'spam' : 'inbox';
      const ts = new Date(Date.now() - m.hoursAgo * 3600 * 1000).toISOString();
      insertMail.run(
        crypto.randomUUID(),
        m.senderId,
        m.senderEmail,
        m.recipientId,
        m.recipientEmail,
        m.subject,
        m.body,
        scan.prediction,
        scan.spamProbability,
        scan.confidenceScore,
        scan.modelName,
        scan.processingTimeMs,
        JSON.stringify(scan.suspiciousKeywords),
        folder,
        m.channel,
        ts
      );
    }
  }
}

export function logActivity(
  db: DatabaseSync,
  userId: string | null,
  activityType: string,
  description: string
): void {
  db.prepare(`
    INSERT INTO user_activity (id, user_id, activity_type, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, activityType, description, new Date().toISOString());
}
