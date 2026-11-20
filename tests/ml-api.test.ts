import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  parseAndValidateCsv,
  predictEmailWithPipeline,
  preprocessText,
  trainPipelineFromRows,
} from '../server/mlEngine.ts';
import { createApp } from '../server/app.ts';

process.env.NODE_ENV = 'test';

test('NLP preprocessing strips HTML, normalizes URLs/money, and removes stop words', () => {
  const { unigrams, ngrams } = preprocessText(
    '<html><body>URGENT! Claim $1,000 at https://evil-phish.xyz/claim for the free prize!</body></html>'
  );
  assert.ok(!unigrams.includes('html'));
  assert.ok(!unigrams.includes('body'));
  assert.ok(!unigrams.includes('the'));
  assert.ok(!unigrams.includes('for'));
  assert.ok(unigrams.includes('urgent'));
  assert.ok(unigrams.includes('urltoken'));
  assert.ok(unigrams.includes('moneytoken'));
  assert.ok(ngrams.includes('free prize'));
});

test('NLP preprocessing handles empty and punctuation-only inputs safely', () => {
  assert.deepEqual(preprocessText('').unigrams, []);
  assert.deepEqual(preprocessText('   <div>  !!! ??? </div>   ').unigrams, []);
});

test('ML pipeline trains all 3 algorithms and classifies personal, promo spam, and phishing emails', () => {
  const csvPath = path.resolve(process.cwd(), 'data/spam_dataset.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const parsed = parseAndValidateCsv(csvContent);
  assert.ok(parsed.rows.length >= 250);

  const pipeline = trainPipelineFromRows(parsed.rows, 'spam_dataset.csv');
  assert.equal(pipeline.evaluations.length, 3);
  for (const ev of pipeline.evaluations) {
    assert.ok(ev.accuracy >= 0.85, `Expected accuracy >= 0.85 for ${ev.modelName}, got ${ev.accuracy}`);
    assert.ok(ev.f1Score >= 0.8, `Expected F1 >= 0.8 for ${ev.modelName}, got ${ev.f1Score}`);
    assert.ok(ev.rocAuc >= 0.85, `Expected ROC-AUC >= 0.85 for ${ev.modelName}, got ${ev.rocAuc}`);
  }

  // 1. Legitimate personal email
  const hamResult = predictEmailWithPipeline(
    pipeline,
    'Coffee tomorrow morning?',
    'Hey Alex, are we still meeting around 9:30 AM before heading to the library? Let me know if you need a ride.'
  );
  assert.equal(hamResult.prediction, 'HAM');

  // 2. Promotional spam email
  const promoSpamResult = predictEmailWithPipeline(
    pipeline,
    'CONGRATULATIONS! You Won a $1,000 Walmart Gift Card!',
    'Claim your exclusive free prize reward now before midnight by clicking our survey link and paying $1.95 shipping!'
  );
  assert.equal(promoSpamResult.prediction, 'SPAM');
  assert.ok(promoSpamResult.spamProbability >= 0.5);
  assert.ok(promoSpamResult.suspiciousKeywords.length > 0);

  // 3. Suspicious phishing email with brand spoofing
  const phishingResult = predictEmailWithPipeline(
    pipeline,
    'URGENT: Your Chase Bank Account Has Been Suspended!',
    'Verify your social security number, ATM PIN, and password immediately at http://verify-bank-secure.xyz or your funds will be frozen!',
    'security@chase-verify-portal.xyz'
  );
  assert.equal(phishingResult.prediction, 'SPAM');
  assert.ok(phishingResult.spamProbability >= 0.5);
  assert.equal(phishingResult.threatCategory, 'Credential Phishing');
  assert.ok(phishingResult.riskIndicators.urgencyScore >= 50);
  assert.ok(phishingResult.riskIndicators.brandMismatch !== null);
  assert.ok(phishingResult.riskIndicators.urlFindings.length > 0);
  assert.ok(phishingResult.sentenceAnalysis.length > 0);
  assert.ok(phishingResult.aiAdvisory.length > 10);

  // 4. Empty email raises error
  assert.throws(() => predictEmailWithPipeline(pipeline, '', '   '));
});

test('Full-stack API integration: auth, prediction, batch scan, history ownership, analytics, and admin RBAC', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mailguard-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const modelPath = path.join(tmpDir, 'model.json');
  const datasetCsvPath = path.resolve(process.cwd(), 'data/spam_dataset.csv');

  const { app, db } = createApp({ dbPath, modelPath, datasetCsvPath });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const req = async (route: string, init?: RequestInit) => {
      const res = await fetch(`${baseUrl}${route}`, init);
      const body = await res.json().catch(() => ({}));
      return { status: res.status, body };
    };

    // Health check
    const health = await req('/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'healthy');
    assert.equal(health.body.service, 'MailGuard AI API');
    assert.equal(health.body.zero_api_key_mode, true);

    // Register User A
    const regA = await req('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Alice Researcher',
        email: 'alice@university.edu',
        password: 'Password123!',
      }),
    });
    assert.equal(regA.status, 201);
    const tokenA = regA.body.access_token as string;
    assert.ok(tokenA);

    // Register User B
    const regB = await req('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: 'Bob Analyst',
        email: 'bob@university.edu',
        password: 'Password123!',
      }),
    });
    assert.equal(regB.status, 201);
    const tokenB = regB.body.access_token as string;

    // Invalid empty prediction rejected with 400
    const emptyPred = await req('/api/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ subject: '', body: '   ' }),
    });
    assert.equal(emptyPred.status, 400);

    // Predict promotional spam as User A
    const spamPred = await req('/api/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        subject: 'FREE $500 Gift Card Winner!',
        body: 'Click immediately to claim your cash reward prize before tonight!',
      }),
    });
    assert.equal(spamPred.status, 201);
    assert.equal(spamPred.body.prediction, 'SPAM');
    assert.ok(spamPred.body.threat_category);
    assert.ok(spamPred.body.risk_indicators);
    assert.ok(Array.isArray(spamPred.body.sentence_analysis));
    assert.ok(spamPred.body.ai_advisory);
    const predId = spamPred.body.id as string;

    // Predict legitimate email as User A
    const hamPred = await req('/api/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        subject: 'Re: Thesis Defense Slides',
        body: 'Hi Professor, I uploaded the updated confusion matrix figures to the shared folder.',
      }),
    });
    assert.equal(hamPred.status, 201);
    assert.equal(hamPred.body.prediction, 'HAM');
    assert.equal(hamPred.body.threat_category, 'Legitimate Communication');
    assert.ok(Array.isArray(hamPred.body.suggested_replies));
    assert.ok(hamPred.body.suggested_replies.length >= 2);

    // Batch prediction endpoint
    const batchPred = await req('/api/predict/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        emails: [
          {
            subject: 'URGENT: Verify PayPal Password',
            sender: 'alert@paypal-fake.xyz',
            body: 'Click http://paypal-fake.xyz immediately to confirm your password and CVV.',
          },
          {
            subject: 'Friday Team Lunch',
            sender: 'team@company.org',
            body: 'Let us meet at noon for team lunch after the sprint retrospective.',
          },
        ],
      }),
    });
    assert.equal(batchPred.status, 200);
    assert.equal(batchPred.body.total, 2);
    assert.equal(batchPred.body.spam_count, 1);
    assert.equal(batchPred.body.ham_count, 1);

    // User B cannot view or delete User A's prediction (403)
    const forbiddenView = await req(`/api/history/${predId}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(forbiddenView.status, 403);

    const forbiddenDelete = await req(`/api/history/${predId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(forbiddenDelete.status, 403);

    // Analytics overview reflects exact counts for User A (1 SPAM, 1 HAM)
    const analytics = await req('/api/analytics/overview', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(analytics.status, 200);
    assert.equal(analytics.body.total_analyzed, 2);
    assert.equal(analytics.body.total_spam, 1);
    assert.equal(analytics.body.total_ham, 1);
    assert.equal(analytics.body.spam_percentage, 50);

    // Standard user blocked from admin dashboard (403)
    const adminForbidden = await req('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(adminForbidden.status, 403);

    // Admin login succeeds on admin dashboard (200)
    const adminLogin = await req('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'admin@mailguard.ai',
        password: 'Admin@2026!',
      }),
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = adminLogin.body.access_token as string;

    const adminDash = await req('/api/admin/dashboard', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(adminDash.status, 200);
    assert.ok(adminDash.body.total_users >= 3);

    // User A deletes own prediction
    const delA = await req(`/api/history/${predId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(delA.status, 200);
    assert.equal(delA.body.deleted, true);

    // Client-to-client mail: User A sends legitimate email -> delivered to User B Inbox
    const sendHam = await req('/api/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        to: 'bob@university.edu',
        subject: 'Re: Architecture Review Meeting',
        body: 'Hi Bob, let us meet Thursday at 3 PM to review the database schema.',
      }),
    });
    assert.equal(sendHam.status, 201);
    assert.equal(sendHam.body.message.prediction, 'HAM');
    assert.equal(sendHam.body.message.folder, 'inbox');

    // External inbound client sends phishing mail to Bob -> quarantined in SPAM folder
    const inboundSpam = await req('/api/mail/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({
        from: 'security@fake-bank-alert.xyz',
        to: 'bob@university.edu',
        subject: 'URGENT: Bank Account Suspended! Verify Password & SSN!',
        body: 'Click http://fake-bank-alert.xyz immediately to verify your ATM PIN and social security number or funds will be frozen!',
      }),
    });
    assert.equal(inboundSpam.status, 201);
    assert.equal(inboundSpam.body.message.prediction, 'SPAM');
    assert.equal(inboundSpam.body.routed_folder, 'spam');
    const spamMailId = inboundSpam.body.message.id as string;

    // Verify Bob's Inbox (1 HAM) and Spam Quarantine (1 SPAM)
    const bobInbox = await req('/api/mail/inbox?folder=inbox', {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(bobInbox.status, 200);
    assert.equal(bobInbox.body.counts.inbox, 1);
    assert.equal(bobInbox.body.counts.spam, 1);

    // User A cannot move Bob's quarantined mail (403)
    const forbiddenMove = await req(`/api/mail/${spamMailId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ folder: 'inbox' }),
    });
    assert.equal(forbiddenMove.status, 403);

    // Bob can move quarantined mail to Inbox
    const bobMove = await req(`/api/mail/${spamMailId}/move`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenB}`,
      },
      body: JSON.stringify({ folder: 'inbox' }),
    });
    assert.equal(bobMove.status, 200);
    assert.equal(bobMove.body.folder, 'inbox');
  } finally {
    db.close();
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
