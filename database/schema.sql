-- =============================================================================
-- E-Mail Spam Detection System Using Machine Learning
-- Supabase PostgreSQL Production Database Schema & Row Level Security (RLS)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1. users table (linked to Supabase Auth auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL CHECK (char_length(trim(full_name)) >= 2),
    email TEXT NOT NULL UNIQUE,
    auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- -----------------------------------------------------------------------------
-- 2. email_predictions table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    email_subject TEXT NOT NULL DEFAULT '(No Subject)',
    sender_address TEXT,
    email_content TEXT NOT NULL CHECK (char_length(trim(email_content)) >= 1),
    prediction TEXT NOT NULL CHECK (prediction IN ('SPAM', 'HAM')),
    spam_probability DOUBLE PRECISION NOT NULL CHECK (spam_probability >= 0.0 AND spam_probability <= 1.0),
    confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    model_name TEXT NOT NULL,
    processing_time DOUBLE PRECISION NOT NULL CHECK (processing_time >= 0.0),
    suspicious_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_predictions_user_created
    ON public.email_predictions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_predictions_prediction
    ON public.email_predictions(prediction);
CREATE INDEX IF NOT EXISTS idx_email_predictions_created_at
    ON public.email_predictions(created_at DESC);

-- -----------------------------------------------------------------------------
-- 3. model_metrics table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.model_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name TEXT NOT NULL,
    accuracy DOUBLE PRECISION NOT NULL CHECK (accuracy >= 0.0 AND accuracy <= 1.0),
    precision_score DOUBLE PRECISION NOT NULL CHECK (precision_score >= 0.0 AND precision_score <= 1.0),
    recall_score DOUBLE PRECISION NOT NULL CHECK (recall_score >= 0.0 AND recall_score <= 1.0),
    f1_score DOUBLE PRECISION NOT NULL CHECK (f1_score >= 0.0 AND f1_score <= 1.0),
    roc_auc DOUBLE PRECISION CHECK (roc_auc IS NULL OR (roc_auc >= 0.0 AND roc_auc <= 1.0)),
    cv_accuracy DOUBLE PRECISION,
    confusion_matrix JSONB NOT NULL DEFAULT '[[0,0],[0,0]]'::jsonb,
    is_selected BOOLEAN NOT NULL DEFAULT FALSE,
    dataset_size INTEGER NOT NULL DEFAULT 0,
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_metrics_evaluated_at
    ON public.model_metrics(evaluated_at DESC);

-- -----------------------------------------------------------------------------
-- 4. datasets table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.datasets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_name TEXT NOT NULL,
    total_records INTEGER NOT NULL CHECK (total_records >= 0),
    spam_count INTEGER NOT NULL CHECK (spam_count >= 0),
    ham_count INTEGER NOT NULL CHECK (ham_count >= 0),
    uploaded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasets_uploaded_at
    ON public.datasets(uploaded_at DESC);

-- -----------------------------------------------------------------------------
-- 5. user_activity table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user_created
    ON public.user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_created_at
    ON public.user_activity(created_at DESC);

-- -----------------------------------------------------------------------------
-- Helper function for RLS Admin checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE auth_user_id = auth.uid() AND role = 'admin'
  );
$$;

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS) Enablement & Policies
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- users policies
CREATE POLICY "Users can read own profile"
    ON public.users FOR SELECT
    USING (auth_user_id = auth.uid() OR public.is_admin());

CREATE POLICY "Users can update own profile name"
    ON public.users FOR UPDATE
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid() AND role = (SELECT role FROM public.users WHERE auth_user_id = auth.uid()));

-- email_predictions policies (users only see/insert/delete their own rows)
CREATE POLICY "Users read own predictions"
    ON public.email_predictions FOR SELECT
    USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR public.is_admin()
    );

CREATE POLICY "Users insert own predictions"
    ON public.email_predictions FOR INSERT
    WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY "Users delete own predictions"
    ON public.email_predictions FOR DELETE
    USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR public.is_admin()
    );

-- model_metrics policies (readable by authenticated users, writable by admins/service role)
CREATE POLICY "Authenticated users read model metrics"
    ON public.model_metrics FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "Admins manage model metrics"
    ON public.model_metrics FOR ALL
    USING (public.is_admin());

-- datasets policies
CREATE POLICY "Authenticated users read datasets"
    ON public.datasets FOR SELECT
    TO authenticated
    USING (TRUE);

CREATE POLICY "Admins manage datasets"
    ON public.datasets FOR ALL
    USING (public.is_admin());

-- user_activity policies
CREATE POLICY "Users read own activity and admins read all"
    ON public.user_activity FOR SELECT
    USING (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR public.is_admin()
    );

CREATE POLICY "Users insert own activity"
    ON public.user_activity FOR INSERT
    WITH CHECK (
        user_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );


-- -----------------------------------------------------------------------------
-- 6. mail_messages table (Client-to-Client & External Inbound Mail + Spam Gate)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mail_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sender_email TEXT NOT NULL,
    recipient_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '(No Subject)',
    body TEXT NOT NULL CHECK (char_length(trim(body)) >= 1),
    prediction TEXT NOT NULL CHECK (prediction IN ('SPAM', 'HAM')),
    spam_probability DOUBLE PRECISION NOT NULL CHECK (spam_probability >= 0.0 AND spam_probability <= 1.0),
    confidence_score DOUBLE PRECISION NOT NULL CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
    model_name TEXT NOT NULL,
    processing_time DOUBLE PRECISION NOT NULL CHECK (processing_time >= 0.0),
    suspicious_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
    folder TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox', 'spam')),
    delivery_channel TEXT NOT NULL DEFAULT 'internal' CHECK (delivery_channel IN ('internal', 'smtp', 'inbound_webhook')),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_recipient_folder
    ON public.mail_messages(recipient_email, folder, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_sender_created
    ON public.mail_messages(sender_id, created_at DESC);

ALTER TABLE public.mail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own received or sent mail"
    ON public.mail_messages FOR SELECT
    USING (
        sender_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR recipient_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR recipient_email = (SELECT email FROM public.users WHERE auth_user_id = auth.uid())
        OR public.is_admin()
    );

CREATE POLICY "Users send mail as themselves"
    ON public.mail_messages FOR INSERT
    WITH CHECK (
        sender_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY "Recipients update folder or read state"
    ON public.mail_messages FOR UPDATE
    USING (
        recipient_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR recipient_email = (SELECT email FROM public.users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY "Participants delete own mail"
    ON public.mail_messages FOR DELETE
    USING (
        sender_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR recipient_id IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR recipient_email = (SELECT email FROM public.users WHERE auth_user_id = auth.uid())
    );

-- -----------------------------------------------------------------------------
-- 7. feedback_samples table (Active Learning Feedback & Model Retraining Queue)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feedback_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prediction_id UUID REFERENCES public.email_predictions(id) ON DELETE SET NULL,
    submitted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    email_subject TEXT NOT NULL DEFAULT '(No Subject)',
    sender_address TEXT,
    email_content TEXT NOT NULL CHECK (char_length(trim(email_content)) >= 1),
    original_prediction TEXT NOT NULL CHECK (original_prediction IN ('SPAM', 'HAM')),
    corrected_label TEXT NOT NULL CHECK (corrected_label IN ('SPAM', 'HAM')),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_feedback_status_created
    ON public.feedback_samples(status, created_at DESC);

ALTER TABLE public.feedback_samples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own feedback and admins read all"
    ON public.feedback_samples FOR SELECT
    USING (
        submitted_by IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
        OR public.is_admin()
    );

CREATE POLICY "Authenticated users submit feedback"
    ON public.feedback_samples FOR INSERT
    WITH CHECK (
        submitted_by IN (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    );

CREATE POLICY "Admins manage feedback queue"
    ON public.feedback_samples FOR UPDATE
    USING (public.is_admin());
