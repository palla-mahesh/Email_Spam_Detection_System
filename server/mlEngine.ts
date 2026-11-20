import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export interface DatasetRow {
  label: 0 | 1; // 0 = HAM, 1 = SPAM
  text: string;
}

export interface DatasetStats {
  datasetName: string;
  totalRecords: number;
  spamCount: number;
  hamCount: number;
  trainSize: number;
  testSize: number;
  vocabSize: number;
}

export interface ModelEvaluation {
  modelName: 'Multinomial Naive Bayes' | 'Logistic Regression' | 'Linear SVM';
  accuracy: number;
  precisionScore: number;
  recallScore: number;
  f1Score: number;
  rocAuc: number;
  cvAccuracy: number;
  confusionMatrix: [[number, number], [number, number]]; // [[TN, FP], [FN, TP]]
  isSelected: boolean;
  calibrationNote: string;
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

export interface BatchPredictionInput {
  id?: string;
  subject?: string;
  sender?: string;
  body: string;
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

export interface PredictionOutput {
  prediction: 'SPAM' | 'HAM';
  spamProbability: number;
  confidenceScore: number;
  modelName: string;
  processingTimeMs: number;
  suspiciousKeywords: SuspiciousKeyword[];
  preprocessedTokens: string[];
  modelBreakdown: Array<{
    modelName: string;
    prediction: 'SPAM' | 'HAM';
    spamProbability: number;
  }>;
  threatCategory: ThreatCategory;
  riskIndicators: RiskIndicators;
  sentenceAnalysis: SentenceRisk[];
  aiAdvisory: string;
  suggestedReplies: string[];
}

interface SparseVector {
  indices: number[];
  values: number[];
}

interface SerializedNaiveBayes {
  logPriorHam: number;
  logPriorSpam: number;
  logLikelihoodHam: number[];
  logLikelihoodSpam: number[];
}

interface SerializedLinearModel {
  weights: number[];
  bias: number;
  plattA?: number;
  plattB?: number;
}

export interface TrainedPipeline {
  version: string;
  trainedAt: string;
  datasetStats: DatasetStats;
  vocabulary: Record<string, number>;
  idf: number[];
  selectedModel: 'Multinomial Naive Bayes' | 'Logistic Regression' | 'Linear SVM';
  evaluations: ModelEvaluation[];
  naiveBayes: SerializedNaiveBayes;
  logisticRegression: SerializedLinearModel;
  linearSvm: SerializedLinearModel;
}

const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her', 'hers',
  'herself', 'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
  'did', 'doing', 'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until',
  'while', 'of', 'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so',
  'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'd',
  'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', 'couldn', 'didn', 'doesn', 'hadn',
  'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn', 'needn', 'shan', 'shouldn', 'wasn',
  'weren', 'won', 'wouldn', 'subject', 'hi', 'hello', 'hey', 'dear', 'thanks', 'thank'
]);

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const copy = [...arr];
  const rand = mulberry32(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

/**
 * Step 2: NLP Preprocessing
 * - Strip HTML tags
 * - Normalize URLs & email addresses into domain tokens
 * - Lowercase & remove unnecessary punctuation
 * - Tokenize & remove stop words
 * - Generate unigrams + bigrams
 */
export function preprocessText(rawText: string): { unigrams: string[]; ngrams: string[] } {
  if (!rawText || typeof rawText !== 'string') {
    return { unigrams: [], ngrams: [] };
  }

  let text = rawText
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' urltoken ')
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, ' emailtoken ')
    .replace(/\$\s*\d[\d,.]*/g, ' moneytoken ')
    .replace(/\d+%/g, ' percenttoken ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return { unigrams: [], ngrams: [] };
  }

  const rawTokens = text.split(' ');
  const unigrams = rawTokens.filter((tok) => tok.length >= 2 && !STOP_WORDS.has(tok));
  const ngrams: string[] = [...unigrams];
  for (let i = 0; i < unigrams.length - 1; i++) {
    ngrams.push(`${unigrams[i]} ${unigrams[i + 1]}`);
  }
  return { unigrams, ngrams };
}

/**
 * Step 1: Parse and validate CSV dataset
 */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseAndValidateCsv(csvContent: string): {
  rows: DatasetRow[];
  spamCount: number;
  hamCount: number;
  skippedRows: number;
} {
  const normalized = csvContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines: string[] = [];
  let buffer = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      buffer += ch;
    } else if (ch === '\n' && !inQuotes) {
      if (buffer.trim().length > 0) {
        lines.push(buffer);
      }
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  if (buffer.trim().length > 0) {
    lines.push(buffer);
  }

  if (lines.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9_]/g, ''));
  const labelIdx = headers.findIndex((h) => ['label', 'category', 'class', 'target', 'v1', 'is_spam', 'spam'].includes(h));
  const textIdx = headers.findIndex((h) => ['text', 'message', 'email', 'content', 'body', 'v2', 'email_content'].includes(h));
  const subjectIdx = headers.findIndex((h) => ['subject', 'email_subject', 'title'].includes(h));

  if (labelIdx === -1) {
    throw new Error('CSV is missing a required label column (expected: label, category, class, or target).');
  }
  if (textIdx === -1 && subjectIdx === -1) {
    throw new Error('CSV is missing a required text column (expected: text, message, email, content, or body).');
  }

  const rows: DatasetRow[] = [];
  let spamCount = 0;
  let hamCount = 0;
  let skippedRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length <= labelIdx) {
      skippedRows++;
      continue;
    }

    const rawLabel = (cols[labelIdx] ?? '').toLowerCase().trim();
    let label: 0 | 1 | null = null;
    if (['spam', '1', 'true', 'yes', 'junk'].includes(rawLabel)) {
      label = 1;
    } else if (['ham', '0', 'false', 'no', 'legit', 'legitimate'].includes(rawLabel)) {
      label = 0;
    }

    const subjectPart = subjectIdx !== -1 ? (cols[subjectIdx] ?? '').trim() : '';
    const bodyPart = textIdx !== -1 ? (cols[textIdx] ?? '').trim() : '';
    const combinedText = subjectPart && bodyPart
      ? `Subject: ${subjectPart}. ${bodyPart}`
      : (bodyPart || subjectPart);

    if (label === null || !combinedText || preprocessText(combinedText).ngrams.length === 0) {
      skippedRows++;
      continue;
    }

    rows.push({ label, text: combinedText });
    if (label === 1) spamCount++;
    else hamCount++;
  }

  if (rows.length < 20 || spamCount < 5 || hamCount < 5) {
    throw new Error('Dataset must contain at least 20 valid records with at least 5 SPAM and 5 HAM samples.');
  }

  return { rows, spamCount, hamCount, skippedRows };
}

/**
 * Step 3: TF-IDF Vectorizer fitted ONLY on training split
 */
function fitTfidf(trainTexts: string[], maxFeatures = 3500): {
  vocabulary: Record<string, number>;
  idf: number[];
} {
  const docTokens = trainTexts.map((t) => preprocessText(t).ngrams);
  const df = new Map<string, number>();

  for (const tokens of docTokens) {
    const unique = new Set(tokens);
    for (const tok of unique) {
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }

  const minDf = trainTexts.length >= 60 ? 2 : 1;
  const sortedTerms = Array.from(df.entries())
    .filter(([, count]) => count >= minDf)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFeatures);

  const vocabulary: Record<string, number> = {};
  const idf: number[] = [];
  const nDocs = trainTexts.length;

  sortedTerms.forEach(([term, count], idx) => {
    vocabulary[term] = idx;
    idf.push(Math.log((1 + nDocs) / (1 + count)) + 1);
  });

  return { vocabulary, idf };
}

function transformTfidf(
  text: string,
  vocabulary: Record<string, number>,
  idf: number[]
): SparseVector {
  const { ngrams } = preprocessText(text);
  const tf = new Map<number, number>();

  for (const tok of ngrams) {
    const idx = vocabulary[tok];
    if (idx !== undefined) {
      tf.set(idx, (tf.get(idx) ?? 0) + 1);
    }
  }

  const indices: number[] = [];
  const values: number[] = [];
  let normSq = 0;

  for (const [idx, count] of tf.entries()) {
    const sublinearTf = 1 + Math.log(count);
    const val = sublinearTf * idf[idx];
    indices.push(idx);
    values.push(val);
    normSq += val * val;
  }

  const norm = Math.sqrt(normSq) || 1;
  for (let i = 0; i < values.length; i++) {
    values[i] /= norm;
  }

  return { indices, values };
}

function dotSparse(vec: SparseVector, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < vec.indices.length; i++) {
    sum += vec.values[i] * weights[vec.indices[i]];
  }
  return sum;
}

/**
 * Stratified Train/Test Split (80/20)
 */
function stratifiedSplit(rows: DatasetRow[], testRatio = 0.2, seed = 42): {
  train: DatasetRow[];
  test: DatasetRow[];
} {
  const spamRows = seededShuffle(rows.filter((r) => r.label === 1), seed);
  const hamRows = seededShuffle(rows.filter((r) => r.label === 0), seed + 1);

  const spamTestCount = Math.max(1, Math.round(spamRows.length * testRatio));
  const hamTestCount = Math.max(1, Math.round(hamRows.length * testRatio));

  const test = seededShuffle(
    [...spamRows.slice(0, spamTestCount), ...hamRows.slice(0, hamTestCount)],
    seed + 2
  );
  const train = seededShuffle(
    [...spamRows.slice(spamTestCount), ...hamRows.slice(hamTestCount)],
    seed + 3
  );

  return { train, test };
}

/**
 * Algorithm 1: Multinomial Naive Bayes
 */
function trainNaiveBayes(
  X: SparseVector[],
  y: Array<0 | 1>,
  vocabSize: number,
  alpha = 0.5
): SerializedNaiveBayes {
  const spamCounts = new Float64Array(vocabSize);
  const hamCounts = new Float64Array(vocabSize);
  let spamTotal = 0;
  let hamTotal = 0;
  let nSpam = 0;
  let nHam = 0;

  for (let i = 0; i < X.length; i++) {
    const vec = X[i];
    if (y[i] === 1) {
      nSpam++;
      for (let j = 0; j < vec.indices.length; j++) {
        spamCounts[vec.indices[j]] += vec.values[j];
        spamTotal += vec.values[j];
      }
    } else {
      nHam++;
      for (let j = 0; j < vec.indices.length; j++) {
        hamCounts[vec.indices[j]] += vec.values[j];
        hamTotal += vec.values[j];
      }
    }
  }

  const totalDocs = nSpam + nHam;
  const logPriorSpam = Math.log(nSpam / totalDocs);
  const logPriorHam = Math.log(nHam / totalDocs);

  const spamDenom = spamTotal + alpha * vocabSize;
  const hamDenom = hamTotal + alpha * vocabSize;

  const logLikelihoodSpam = new Array<number>(vocabSize);
  const logLikelihoodHam = new Array<number>(vocabSize);

  for (let idx = 0; idx < vocabSize; idx++) {
    logLikelihoodSpam[idx] = Math.log((spamCounts[idx] + alpha) / spamDenom);
    logLikelihoodHam[idx] = Math.log((hamCounts[idx] + alpha) / hamDenom);
  }

  return { logPriorHam, logPriorSpam, logLikelihoodHam, logLikelihoodSpam };
}

function predictNaiveBayes(vec: SparseVector, model: SerializedNaiveBayes): number {
  let logSpam = model.logPriorSpam;
  let logHam = model.logPriorHam;
  for (let i = 0; i < vec.indices.length; i++) {
    const idx = vec.indices[i];
    const val = vec.values[i];
    logSpam += val * model.logLikelihoodSpam[idx];
    logHam += val * model.logLikelihoodHam[idx];
  }
  const diff = logHam - logSpam;
  if (diff > 50) return 0;
  if (diff < -50) return 1;
  return 1 / (1 + Math.exp(diff));
}

/**
 * Algorithm 2: Logistic Regression (L2-regularized gradient descent)
 */
function trainLogisticRegression(
  X: SparseVector[],
  y: Array<0 | 1>,
  vocabSize: number,
  epochs = 220,
  lr = 3.2,
  l2 = 0.00015
): SerializedLinearModel {
  const weights = new Array<number>(vocabSize).fill(0);
  let bias = 0;
  const n = X.length;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Float64Array(vocabSize);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      const vec = X[i];
      const z = dotSparse(vec, weights) + bias;
      const pred = sigmoid(z);
      const err = pred - y[i];
      gradB += err;
      for (let j = 0; j < vec.indices.length; j++) {
        gradW[vec.indices[j]] += err * vec.values[j];
      }
    }

    const step = lr / Math.sqrt(1 + epoch * 0.015);
    bias -= step * (gradB / n);
    for (let k = 0; k < vocabSize; k++) {
      const g = gradW[k] / n + l2 * weights[k];
      weights[k] -= step * g;
    }
  }

  return { weights, bias };
}

function predictLogisticRegression(vec: SparseVector, model: SerializedLinearModel): number {
  return sigmoid(dotSparse(vec, model.weights) + model.bias);
}

/**
 * Algorithm 3: Linear SVM with Hinge Loss + Platt Scaling Calibration
 */
function trainLinearSvmRaw(
  X: SparseVector[],
  y: Array<0 | 1>,
  vocabSize: number,
  epochs = 120,
  C = 1.6
): SerializedLinearModel {
  const weights = new Array<number>(vocabSize).fill(0);
  let bias = 0;
  const n = X.length;
  const lambda = 1 / (C * n);
  const rand = mulberry32(101);

  const order = Array.from({ length: n }, (_, i) => i);
  let t = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (const idx of order) {
      t++;
      const eta = 1 / (lambda * t + 10);
      const vec = X[idx];
      const ySigned = y[idx] === 1 ? 1 : -1;
      const margin = ySigned * (dotSparse(vec, weights) + bias);

      const scale = 1 - eta * lambda;
      if (scale > 0) {
        for (let k = 0; k < vocabSize; k++) {
          weights[k] *= scale;
        }
      }

      if (margin < 1) {
        for (let j = 0; j < vec.indices.length; j++) {
          weights[vec.indices[j]] += eta * ySigned * vec.values[j];
        }
        bias += eta * ySigned * 0.5;
      }
    }
  }

  return { weights, bias };
}

function fitPlattScaling(margins: number[], y: Array<0 | 1>): { A: number; B: number } {
  let A = -1.5;
  let B = 0;
  const n = margins.length;
  const lr = 0.1;

  for (let iter = 0; iter < 300; iter++) {
    let gradA = 0;
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(A * margins[i] + B);
      const err = p - y[i];
      gradA += err * margins[i];
      gradB += err;
    }
    A -= lr * (gradA / n + 0.001 * A);
    B -= lr * (gradB / n + 0.001 * B);
  }
  return { A, B };
}

function trainCalibratedLinearSvm(
  X: SparseVector[],
  y: Array<0 | 1>,
  vocabSize: number
): SerializedLinearModel {
  // Collect 3-fold out-of-fold raw margins for unbiased Platt scaling calibration
  const kFolds = 3;
  const oofMargins = new Array<number>(X.length).fill(0);

  for (let fold = 0; fold < kFolds; fold++) {
    const foldTrainX: SparseVector[] = [];
    const foldTrainY: Array<0 | 1> = [];
    const valIndices: number[] = [];

    for (let i = 0; i < X.length; i++) {
      if (i % kFolds === fold) {
        valIndices.push(i);
      } else {
        foldTrainX.push(X[i]);
        foldTrainY.push(y[i]);
      }
    }

    const foldModel = trainLinearSvmRaw(foldTrainX, foldTrainY, vocabSize, 90);
    for (const idx of valIndices) {
      oofMargins[idx] = dotSparse(X[idx], foldModel.weights) + foldModel.bias;
    }
  }

  const { A, B } = fitPlattScaling(oofMargins, y);
  const fullModel = trainLinearSvmRaw(X, y, vocabSize, 120);
  return {
    weights: fullModel.weights,
    bias: fullModel.bias,
    plattA: A,
    plattB: B,
  };
}

function predictLinearSvm(vec: SparseVector, model: SerializedLinearModel): number {
  const margin = dotSparse(vec, model.weights) + model.bias;
  const A = model.plattA ?? -1.5;
  const B = model.plattB ?? 0;
  return sigmoid(A * margin + B);
}

/**
 * Step 5: Compute Accuracy, Precision, Recall, F1, Confusion Matrix, and ROC-AUC
 */
function computeMetrics(
  yTrue: Array<0 | 1>,
  probs: number[]
): {
  accuracy: number;
  precisionScore: number;
  recallScore: number;
  f1Score: number;
  rocAuc: number;
  confusionMatrix: [[number, number], [number, number]];
} {
  let tp = 0;
  let tn = 0;
  let fp = 0;
  let fn = 0;

  for (let i = 0; i < yTrue.length; i++) {
    const pred = probs[i] >= 0.5 ? 1 : 0;
    if (yTrue[i] === 1 && pred === 1) tp++;
    else if (yTrue[i] === 0 && pred === 0) tn++;
    else if (yTrue[i] === 0 && pred === 1) fp++;
    else fn++;
  }

  const total = yTrue.length || 1;
  const accuracy = (tp + tn) / total;
  const precisionScore = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recallScore = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1Score =
    precisionScore + recallScore > 0
      ? (2 * precisionScore * recallScore) / (precisionScore + recallScore)
      : 0;

  // Exact ROC-AUC via trapezoidal integration
  const totalPos = yTrue.filter((y) => y === 1).length;
  const totalNeg = yTrue.length - totalPos;
  let rocAuc = 0.5;

  if (totalPos > 0 && totalNeg > 0) {
    const pairs = probs
      .map((p, idx) => ({ p, y: yTrue[idx] }))
      .sort((a, b) => b.p - a.p);

    let curTp = 0;
    let curFp = 0;
    let prevTpr = 0;
    let prevFpr = 0;
    let area = 0;

    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].y === 1) curTp++;
      else curFp++;

      const nextDiff = i === pairs.length - 1 || pairs[i + 1].p !== pairs[i].p;
      if (nextDiff) {
        const tpr = curTp / totalPos;
        const fpr = curFp / totalNeg;
        area += ((fpr - prevFpr) * (tpr + prevTpr)) / 2;
        prevTpr = tpr;
        prevFpr = fpr;
      }
    }
    rocAuc = Math.min(1, Math.max(0, area));
  }

  return {
    accuracy: Number(accuracy.toFixed(4)),
    precisionScore: Number(precisionScore.toFixed(4)),
    recallScore: Number(recallScore.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4)),
    rocAuc: Number(rocAuc.toFixed(4)),
    confusionMatrix: [
      [tn, fp],
      [fn, tp],
    ],
  };
}

function crossValidateAccuracy(
  trainRows: DatasetRow[],
  algo: 'nb' | 'lr' | 'svm',
  folds = 5
): number {
  const spam = trainRows.filter((r) => r.label === 1);
  const ham = trainRows.filter((r) => r.label === 0);
  const foldBuckets: DatasetRow[][] = Array.from({ length: folds }, () => []);
  spam.forEach((r, idx) => foldBuckets[idx % folds].push(r));
  ham.forEach((r, idx) => foldBuckets[idx % folds].push(r));

  let correct = 0;
  let total = 0;

  for (let f = 0; f < folds; f++) {
    const val = foldBuckets[f];
    const tr = foldBuckets.flatMap((b, idx) => (idx === f ? [] : b));
    const { vocabulary, idf } = fitTfidf(tr.map((r) => r.text), 2500);
    const vocabSize = idf.length;
    const Xtr = tr.map((r) => transformTfidf(r.text, vocabulary, idf));
    const ytr = tr.map((r) => r.label);
    const Xval = val.map((r) => transformTfidf(r.text, vocabulary, idf));

    if (algo === 'nb') {
      const m = trainNaiveBayes(Xtr, ytr, vocabSize);
      Xval.forEach((v, i) => {
        const pred = predictNaiveBayes(v, m) >= 0.5 ? 1 : 0;
        if (pred === val[i].label) correct++;
        total++;
      });
    } else if (algo === 'lr') {
      const m = trainLogisticRegression(Xtr, ytr, vocabSize, 100);
      Xval.forEach((v, i) => {
        const pred = predictLogisticRegression(v, m) >= 0.5 ? 1 : 0;
        if (pred === val[i].label) correct++;
        total++;
      });
    } else {
      const m = trainLinearSvmRaw(Xtr, ytr, vocabSize, 80);
      Xval.forEach((v, i) => {
        const pred = dotSparse(v, m.weights) + m.bias >= 0 ? 1 : 0;
        if (pred === val[i].label) correct++;
        total++;
      });
    }
  }

  return Number((correct / (total || 1)).toFixed(4));
}

/**
 * Full Training Pipeline: Step 1 -> Step 6
 */
export function trainPipelineFromRows(
  rows: DatasetRow[],
  datasetName = 'spam_dataset.csv'
): TrainedPipeline {
  const { train, test } = stratifiedSplit(rows, 0.2, 42);
  const { vocabulary, idf } = fitTfidf(train.map((r) => r.text), 3500);
  const vocabSize = idf.length;

  const XTrain = train.map((r) => transformTfidf(r.text, vocabulary, idf));
  const yTrain = train.map((r) => r.label);
  const XTest = test.map((r) => transformTfidf(r.text, vocabulary, idf));
  const yTest = test.map((r) => r.label);

  // Train all 3 models strictly on XTrain
  const naiveBayes = trainNaiveBayes(XTrain, yTrain, vocabSize);
  const logisticRegression = trainLogisticRegression(XTrain, yTrain, vocabSize);
  const linearSvm = trainCalibratedLinearSvm(XTrain, yTrain, vocabSize);

  // Evaluate on held-out XTest
  const nbProbs = XTest.map((v) => predictNaiveBayes(v, naiveBayes));
  const lrProbs = XTest.map((v) => predictLogisticRegression(v, logisticRegression));
  const svmProbs = XTest.map((v) => predictLinearSvm(v, linearSvm));

  const nbMetrics = computeMetrics(yTest, nbProbs);
  const lrMetrics = computeMetrics(yTest, lrProbs);
  const svmMetrics = computeMetrics(yTest, svmProbs);

  const nbCv = crossValidateAccuracy(train, 'nb', 5);
  const lrCv = crossValidateAccuracy(train, 'lr', 5);
  const svmCv = crossValidateAccuracy(train, 'svm', 5);

  const candidates: ModelEvaluation[] = [
    {
      modelName: 'Multinomial Naive Bayes',
      ...nbMetrics,
      cvAccuracy: nbCv,
      isSelected: false,
      calibrationNote: 'Exact Bayesian Posterior (Laplace α=0.5)',
    },
    {
      modelName: 'Logistic Regression',
      ...lrMetrics,
      cvAccuracy: lrCv,
      isSelected: false,
      calibrationNote: 'Direct Sigmoid Probability (L2 Regularized)',
    },
    {
      modelName: 'Linear SVM',
      ...svmMetrics,
      cvAccuracy: svmCv,
      isSelected: false,
      calibrationNote: 'Platt Scaling Calibration (3-Fold Out-of-Fold)',
    },
  ];

  // Select best model based on F1-score, tie-breaker ROC-AUC
  let bestIdx = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (
      candidates[i].f1Score > candidates[bestIdx].f1Score ||
      (candidates[i].f1Score === candidates[bestIdx].f1Score &&
        candidates[i].rocAuc > candidates[bestIdx].rocAuc)
    ) {
      bestIdx = i;
    }
  }
  candidates[bestIdx].isSelected = true;

  const spamCount = rows.filter((r) => r.label === 1).length;
  const hamCount = rows.length - spamCount;

  return {
    version: '1.0.0',
    trainedAt: new Date().toISOString(),
    datasetStats: {
      datasetName,
      totalRecords: rows.length,
      spamCount,
      hamCount,
      trainSize: train.length,
      testSize: test.length,
      vocabSize,
    },
    vocabulary,
    idf,
    selectedModel: candidates[bestIdx].modelName,
    evaluations: candidates,
    naiveBayes,
    logisticRegression,
    linearSvm,
  };
}

export function savePipeline(pipeline: TrainedPipeline, modelPath: string): void {
  const dir = path.dirname(modelPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(modelPath, JSON.stringify(pipeline), 'utf-8');
}

export function loadOrTrainPipeline(
  modelPath: string,
  datasetCsvPath: string
): TrainedPipeline {
  if (fs.existsSync(modelPath)) {
    const raw = fs.readFileSync(modelPath, 'utf-8');
    return JSON.parse(raw) as TrainedPipeline;
  }

  const csvContent = fs.readFileSync(datasetCsvPath, 'utf-8');
  const parsed = parseAndValidateCsv(csvContent);
  const pipeline = trainPipelineFromRows(parsed.rows, path.basename(datasetCsvPath));
  savePipeline(pipeline, modelPath);
  return pipeline;
}

const URGENCY_PHRASES: Array<{ regex: RegExp; label: string; weight: number }> = [
  { regex: /\burgent(ly)?\b/i, label: 'Urgent action demand', weight: 18 },
  { regex: /\bimmediate(ly)?\b/i, label: 'Immediate compliance trigger', weight: 18 },
  { regex: /\bwithin\s+(12|24|48)\s+hours\b/i, label: 'Artificial time deadline', weight: 20 },
  { regex: /\b(suspended|locked|frozen|deactivated|compromised)\b/i, label: 'Account suspension threat', weight: 22 },
  { regex: /\b(verify|confirm|validate)\s+(your\s+)?(account|identity|password|pin|ssn|card|billing)\b/i, label: 'Credential verification lure', weight: 24 },
  { regex: /\b(ssn|social security|atm pin|cvv|routing number|bank account)\b/i, label: 'Sensitive PII / financial harvest', weight: 25 },
  { regex: /\b(congratulations|winner|won|prize|gift card|sweepstakes|unclaimed)\b/i, label: 'Reward / lottery bait', weight: 18 },
  { regex: /\b(act now|limited time|expires tonight|final notice|last chance)\b/i, label: 'Scarcity pressure tactic', weight: 16 },
  { regex: /\b(bitcoin|crypto|roi|guaranteed\s+\d+%|wire transfer|western union)\b/i, label: 'Financial / crypto inducement', weight: 20 },
  { regex: /\b(attachment|invoice\.zip|\.exe|macro|enable content)\b/i, label: 'Suspicious attachment lure', weight: 18 },
];

const BRAND_DOMAINS: Array<{ brand: string; keywords: RegExp; officialDomains: string[] }> = [
  { brand: 'Chase Bank', keywords: /\bchase\b/i, officialDomains: ['chase.com', 'jpmorganchase.com'] },
  { brand: 'PayPal', keywords: /\bpaypal\b/i, officialDomains: ['paypal.com'] },
  { brand: 'Apple', keywords: /\b(apple id|icloud|apple support)\b/i, officialDomains: ['apple.com', 'icloud.com'] },
  { brand: 'Microsoft', keywords: /\b(microsoft|office 365|outlook)\b/i, officialDomains: ['microsoft.com', 'outlook.com', 'live.com'] },
  { brand: 'Amazon', keywords: /\bamazon\b/i, officialDomains: ['amazon.com'] },
  { brand: 'IRS', keywords: /\b(irs|internal revenue|federal tax refund)\b/i, officialDomains: ['irs.gov'] },
  { brand: 'Bank of America', keywords: /\bbank of america\b/i, officialDomains: ['bankofamerica.com'] },
  { brand: 'Netflix', keywords: /\bnetflix\b/i, officialDomains: ['netflix.com'] },
  { brand: 'Coinbase', keywords: /\bcoinbase\b/i, officialDomains: ['coinbase.com'] },
];

const SUSPICIOUS_TLDS = ['.xyz', '.top', '.biz', '.info', '.ru', '.tk', '.click', '.club', '.work', '.loan'];
const SHORTENER_HOSTS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'rb.gy', 'is.gd'];

export function analyzeManipulationSignals(
  subject: string,
  body: string,
  sender?: string
): RiskIndicators {
  const fullText = `${subject}\n${body}`;
  let urgencyPoints = 0;
  const triggers: string[] = [];

  for (const rule of URGENCY_PHRASES) {
    if (rule.regex.test(fullText)) {
      urgencyPoints += rule.weight;
      if (!triggers.includes(rule.label)) {
        triggers.push(rule.label);
      }
    }
  }

  // Excessive exclamation marks or uppercase shouting in subject/body
  const exclCount = (fullText.match(/!/g) || []).length;
  if (exclCount >= 3) {
    urgencyPoints += 10;
    triggers.push('Excessive exclamation punctuation');
  }
  const upperWords = fullText.match(/\b[A-Z]{4,}\b/g) || [];
  if (upperWords.length >= 2) {
    urgencyPoints += 8;
    triggers.push('All-caps emphasis pressure');
  }

  // Extract & inspect URLs
  const urlMatches = fullText.match(/https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+/gi) || [];
  const urlFindings: UrlFinding[] = [];
  const seenUrls = new Set<string>();

  for (const rawUrl of urlMatches) {
    const cleanUrl = rawUrl.replace(/[.,;!?]+$/, '');
    if (seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);

    const lower = cleanUrl.toLowerCase();
    if (/https?:\/\/\d{1,3}(?:\.\d{1,3}){3}/.test(lower)) {
      urlFindings.push({ url: cleanUrl, reason: 'Direct raw IP address link', severity: 'high' });
      urgencyPoints += 22;
      continue;
    }

    let hostname = '';
    try {
      const normalized = lower.startsWith('http') ? lower : `http://${lower}`;
      hostname = new URL(normalized).hostname;
    } catch {
      hostname = lower;
    }

    if (SUSPICIOUS_TLDS.some((tld) => hostname.endsWith(tld))) {
      urlFindings.push({ url: cleanUrl, reason: 'High-risk disposable TLD domain', severity: 'high' });
      urgencyPoints += 20;
    } else if (SHORTENER_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      urlFindings.push({ url: cleanUrl, reason: 'Obfuscated URL shortener', severity: 'medium' });
      urgencyPoints += 12;
    } else if (lower.startsWith('http://')) {
      urlFindings.push({ url: cleanUrl, reason: 'Unencrypted HTTP transport', severity: 'medium' });
      urgencyPoints += 8;
    }
  }

  // Brand Spoofing / Domain Mismatch Detection
  let brandMismatch: BrandSpoofAlert | null = null;
  const senderLower = (sender || '').trim().toLowerCase();
  const atIdx = senderLower.lastIndexOf('@');
  const senderDomain = atIdx !== -1 ? senderLower.slice(atIdx + 1) : '';

  if (senderDomain) {
    for (const entry of BRAND_DOMAINS) {
      if (entry.keywords.test(fullText)) {
        const matchesOfficial = entry.officialDomains.some(
          (d) => senderDomain === d || senderDomain.endsWith(`.${d}`)
        );
        if (!matchesOfficial) {
          brandMismatch = {
            claimedBrand: entry.brand,
            senderDomain,
            expectedDomains: entry.officialDomains,
            detail: `Content references ${entry.brand}, but sender domain (${senderDomain}) does not match official domains (${entry.officialDomains.join(', ')}).`,
          };
          urgencyPoints += 25;
          if (!triggers.includes('Brand impersonation / sender domain mismatch')) {
            triggers.push('Brand impersonation / sender domain mismatch');
          }
          break;
        }
      }
    }
  }

  return {
    urgencyScore: Math.min(100, Math.round(urgencyPoints)),
    manipulationTriggers: triggers.slice(0, 6),
    urlFindings: urlFindings.slice(0, 5),
    brandMismatch,
  };
}

export function classifyThreatCategory(
  subject: string,
  body: string,
  prediction: 'SPAM' | 'HAM',
  riskIndicators: RiskIndicators
): ThreatCategory {
  if (prediction === 'HAM' && !riskIndicators.brandMismatch && riskIndicators.urgencyScore < 40) {
    return 'Legitimate Communication';
  }

  const text = `${subject}\n${body}`.toLowerCase();

  if (
    riskIndicators.brandMismatch ||
    /\b(password|ssn|social security|atm pin|cvv|verify your account|account suspended|login activity|credit card|restore access)\b/i.test(text)
  ) {
    return 'Credential Phishing';
  }

  if (
    /\b(bitcoin|crypto|roi|investment|wire transfer|bank routing|tax refund|unclaimed|guaranteed profit|trading club|million dollars)\b/i.test(text)
  ) {
    return 'Financial / Crypto Scam';
  }

  if (/\b(attachment|invoice\.zip|\.exe|macro|security patch|download immediately|trojan|malware)\b/i.test(text)) {
    return 'Malware / Urgent Lure';
  }

  if (prediction === 'SPAM') {
    return 'Promotional / Bulk Spam';
  }

  return 'Legitimate Communication';
}

function scoreWithActiveModel(pipeline: TrainedPipeline, vec: SparseVector): number {
  if (pipeline.selectedModel === 'Multinomial Naive Bayes') {
    return predictNaiveBayes(vec, pipeline.naiveBayes);
  }
  if (pipeline.selectedModel === 'Linear SVM') {
    return predictLinearSvm(vec, pipeline.linearSvm);
  }
  return predictLogisticRegression(vec, pipeline.logisticRegression);
}

export function analyzeSentences(pipeline: TrainedPipeline, body: string): SentenceRisk[] {
  const cleanBody = (body ?? '').trim();
  if (!cleanBody) return [];

  const rawSentences = cleanBody
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
    .slice(0, 12);

  return rawSentences.map((sentence) => {
    const { unigrams } = preprocessText(sentence);
    if (unigrams.length === 0) {
      return { sentence, spamProbability: 0.1, riskLevel: 'normal' };
    }
    const vec = transformTfidf(sentence, pipeline.vocabulary, pipeline.idf);
    const prob = Math.min(0.9999, Math.max(0.0001, scoreWithActiveModel(pipeline, vec)));
    const riskLevel: 'high' | 'medium' | 'normal' =
      prob >= 0.65 ? 'high' : prob >= 0.45 ? 'medium' : 'normal';
    return {
      sentence,
      spamProbability: Number(prob.toFixed(4)),
      riskLevel,
    };
  });
}

export function generateAiAdvisoryAndReplies(
  prediction: 'SPAM' | 'HAM',
  threatCategory: ThreatCategory,
  riskIndicators: RiskIndicators,
  subject: string,
  body: string
): { aiAdvisory: string; suggestedReplies: string[] } {
  const lower = `${subject} ${body}`.toLowerCase();

  if (prediction === 'SPAM') {
    const parts: string[] = [`Classified under ${threatCategory} with urgency index ${riskIndicators.urgencyScore}/100.`];
    if (riskIndicators.brandMismatch) {
      parts.push(riskIndicators.brandMismatch.detail);
    }
    if (riskIndicators.urlFindings.length > 0) {
      parts.push(`Detected ${riskIndicators.urlFindings.length} risky URL(s) (${riskIndicators.urlFindings[0].reason}).`);
    }
    if (riskIndicators.manipulationTriggers.length > 0) {
      parts.push(`Primary social engineering signals: ${riskIndicators.manipulationTriggers.slice(0, 3).join(', ')}.`);
    }
    parts.push('Recommended action: Do not click links, download attachments, or reply; keep quarantined.');

    return {
      aiAdvisory: parts.join(' '),
      suggestedReplies: [
        'Quarantine & block sender domain (recommended)',
        'Do not reply — report as phishing / spam attempt',
      ],
    };
  }

  const replies: string[] = [];
  if (/\b(meet|meeting|schedule|reschedul|thursday|friday|tomorrow|pm|am)\b/.test(lower)) {
    replies.push('Thanks for the update — that time works well for me. See you then.');
    replies.push('Received, thank you! Let me check my calendar and confirm shortly.');
  } else if (/\b(review|pull request|commit|assignment|report|notebook|schema|dataset)\b/.test(lower)) {
    replies.push('Thank you for sharing this. I will review the details and follow up with feedback today.');
    replies.push('Looks great — appreciate the thorough update and benchmark notes.');
  } else {
    replies.push('Thank you for your message. I have received this and will follow up shortly.');
    replies.push('Confirmed, thanks for letting me know!');
  }
  replies.push('Could you please share any additional details or timeline expectations?');

  const advisory =
    riskIndicators.urgencyScore >= 30 || riskIndicators.urlFindings.length > 0
      ? `Classified as legitimate communication, though moderate urgency or external links (${riskIndicators.urgencyScore}/100) were observed. Verify the sender address before sharing sensitive information.`
      : 'No phishing indicators, domain spoofing, or manipulative urgency patterns detected. Message aligns with legitimate communication norms.';

  return {
    aiAdvisory: advisory,
    suggestedReplies: replies,
  };
}

/**
 * Step 7: Real-Time Prediction + Suspicious Keyword Attribution + AI Threat Intelligence
 */
export function predictEmailWithPipeline(
  pipeline: TrainedPipeline,
  subject: string,
  body: string,
  sender?: string
): PredictionOutput {
  const start = performance.now();

  const cleanSubject = (subject ?? '').trim();
  const cleanBody = (body ?? '').trim();
  const cleanSender = (sender ?? '').trim();

  if (!cleanSubject && !cleanBody) {
    throw new Error('Email subject or body must contain meaningful text.');
  }

  const combined = [
    cleanSubject ? `Subject: ${cleanSubject}` : '',
    cleanBody,
    cleanSender ? `From: ${cleanSender}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const { unigrams, ngrams } = preprocessText(combined);
  if (unigrams.length === 0) {
    throw new Error('Input contains no valid analyzable tokens after preprocessing.');
  }

  const vec = transformTfidf(combined, pipeline.vocabulary, pipeline.idf);

  const nbProb = predictNaiveBayes(vec, pipeline.naiveBayes);
  const lrProb = predictLogisticRegression(vec, pipeline.logisticRegression);
  const svmProb = predictLinearSvm(vec, pipeline.linearSvm);

  let primaryProb = lrProb;
  if (pipeline.selectedModel === 'Multinomial Naive Bayes') primaryProb = nbProb;
  else if (pipeline.selectedModel === 'Linear SVM') primaryProb = svmProb;

  const clampedProb = Math.min(0.9999, Math.max(0.0001, primaryProb));
  const prediction: 'SPAM' | 'HAM' = clampedProb >= 0.5 ? 'SPAM' : 'HAM';
  const confidenceScore = prediction === 'SPAM' ? clampedProb : 1 - clampedProb;

  // Invert vocabulary index -> term for explainable feature attribution
  const indexToTerm = new Map<number, string>();
  for (const [term, idx] of Object.entries(pipeline.vocabulary)) {
    indexToTerm.set(idx, term);
  }

  const suspiciousKeywords: SuspiciousKeyword[] = [];
  for (let i = 0; i < vec.indices.length; i++) {
    const idx = vec.indices[i];
    const tfidfVal = vec.values[i];
    const term = indexToTerm.get(idx);
    if (!term) continue;

    // Combine log-odds from Naive Bayes and Linear model weight for crisp token attribution
    const nbLogOdds =
      pipeline.naiveBayes.logLikelihoodSpam[idx] - pipeline.naiveBayes.logLikelihoodHam[idx];
    const lrWeight = pipeline.logisticRegression.weights[idx];
    const combinedSpamScore = tfidfVal * (nbLogOdds * 0.4 + lrWeight * 0.6);

    if (combinedSpamScore > 0.01) {
      suspiciousKeywords.push({
        term,
        weight: Number(combinedSpamScore.toFixed(4)),
        tfidf: Number(tfidfVal.toFixed(4)),
      });
    }
  }

  suspiciousKeywords.sort((a, b) => b.weight - a.weight);

  const riskIndicators = analyzeManipulationSignals(cleanSubject, cleanBody, cleanSender);
  const threatCategory = classifyThreatCategory(cleanSubject, cleanBody, prediction, riskIndicators);
  const sentenceAnalysis = analyzeSentences(pipeline, cleanBody || cleanSubject);
  const { aiAdvisory, suggestedReplies } = generateAiAdvisoryAndReplies(
    prediction,
    threatCategory,
    riskIndicators,
    cleanSubject,
    cleanBody
  );

  const processingTimeMs = Number((performance.now() - start).toFixed(2));

  return {
    prediction,
    spamProbability: Number(clampedProb.toFixed(4)),
    confidenceScore: Number(confidenceScore.toFixed(4)),
    modelName: pipeline.selectedModel,
    processingTimeMs,
    suspiciousKeywords: suspiciousKeywords.slice(0, 8),
    preprocessedTokens: Array.from(new Set(ngrams)).slice(0, 24),
    modelBreakdown: [
      {
        modelName: 'Multinomial Naive Bayes',
        prediction: nbProb >= 0.5 ? 'SPAM' : 'HAM',
        spamProbability: Number(nbProb.toFixed(4)),
      },
      {
        modelName: 'Logistic Regression',
        prediction: lrProb >= 0.5 ? 'SPAM' : 'HAM',
        spamProbability: Number(lrProb.toFixed(4)),
      },
      {
        modelName: 'Linear SVM',
        prediction: svmProb >= 0.5 ? 'SPAM' : 'HAM',
        spamProbability: Number(svmProb.toFixed(4)),
      },
    ],
    threatCategory,
    riskIndicators,
    sentenceAnalysis,
    aiAdvisory,
    suggestedReplies,
  };
}

export function predictBatchWithPipeline(
  pipeline: TrainedPipeline,
  items: BatchPredictionInput[]
): BatchPredictionItem[] {
  return items.slice(0, 50).map((item, index) => {
    const subject = (item.subject ?? '').trim() || '(No Subject)';
    const sender = (item.sender ?? '').trim();
    const body = (item.body ?? '').trim();

    try {
      const res = predictEmailWithPipeline(pipeline, subject, body, sender);
      return {
        index,
        id: item.id,
        subject,
        sender,
        prediction: res.prediction,
        spamProbability: res.spamProbability,
        confidenceScore: res.confidenceScore,
        threatCategory: res.threatCategory,
        urgencyScore: res.riskIndicators.urgencyScore,
        processingTimeMs: res.processingTimeMs,
      };
    } catch (err) {
      return {
        index,
        id: item.id,
        subject,
        sender,
        prediction: 'HAM',
        spamProbability: 0,
        confidenceScore: 0,
        threatCategory: 'Legitimate Communication',
        urgencyScore: 0,
        processingTimeMs: 0,
        error: err instanceof Error ? err.message : 'Unable to classify message.',
      };
    }
  });
}
