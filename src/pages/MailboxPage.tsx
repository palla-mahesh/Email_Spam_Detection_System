import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Inbox,
  Loader2,
  MailPlus,
  Reply,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Webhook,
  X,
} from 'lucide-react';
import { mailApi, MailMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { VerdictLabel } from '../components/VerdictLabel';

type MailboxTab = 'inbox' | 'spam' | 'sent';

export function MailboxPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<MailboxTab>('inbox');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [counts, setCounts] = useState({ inbox: 0, spam: 0, unread_inbox: 0 });
  const [selectedMail, setSelectedMail] = useState<MailMessage | null>(null);
  const [recipients, setRecipients] = useState<Array<{ id: string; full_name: string; email: string }>>([]);
  const [mailConfig, setMailConfig] = useState<{ smtp_configured: boolean; smtp_host: string | null } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Compose & Send state
  const [composeOpen, setComposeOpen] = useState(false);
  const [toEmail, setToEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  // Receive External Client Mail modal state
  const [inboundOpen, setInboundOpen] = useState(false);
  const [extFrom, setExtFrom] = useState('client@external-company.com');
  const [extSubject, setExtSubject] = useState('');
  const [extBody, setExtBody] = useState('');
  const [receiving, setReceiving] = useState(false);

  const loadMailbox = useCallback(async (tab: MailboxTab) => {
    setLoading(true);
    setError('');
    try {
      const [inboxRes, sentRes] = await Promise.all([
        mailApi.inbox(tab === 'sent' ? 'inbox' : tab),
        tab === 'sent' ? mailApi.sent() : Promise.resolve(null),
      ]);
      setCounts(inboxRes.data.counts);
      const nextList = tab === 'sent' && sentRes ? sentRes.data.messages : inboxRes.data.messages;
      setMessages(nextList);
      setSelectedMail((prev) => {
        if (!prev) return nextList[0] || null;
        return nextList.find((m) => m.id === prev.id) || nextList[0] || null;
      });
    } catch {
      setError('Failed to load mailbox messages.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMailbox(activeTab);
  }, [activeTab, loadMailbox]);

  useEffect(() => {
    Promise.all([mailApi.recipients(), mailApi.config()])
      .then(([recRes, cfgRes]) => {
        setRecipients(recRes.data.recipients);
        setMailConfig(cfgRes.data);
      })
      .catch(() => {
        // Non-blocking
      });
  }, []);

  const handleSelectMail = async (msg: MailMessage) => {
    setSelectedMail(msg);
    if (!msg.is_read && activeTab !== 'sent') {
      try {
        await mailApi.markRead(msg.id, true);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, is_read: true } : m)));
        if (msg.folder === 'inbox') {
          setCounts((c) => ({ ...c, unread_inbox: Math.max(0, c.unread_inbox - 1) }));
        }
      } catch {
        // Ignore read receipt error
      }
    }
  };

  const handleSendMail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!toEmail.trim() || !body.trim()) {
      setError('Recipient email and message body are required.');
      return;
    }

    setSending(true);
    try {
      const { data } = await mailApi.send({
        to: toEmail.trim(),
        subject: subject.trim(),
        body: body.trim(),
      });
      setNotice(
        `${data.smtp_notice} ML Gatekeeper classified as ${data.message.prediction} (${(
          data.message.spam_probability * 100
        ).toFixed(1)}% spam probability).`
      );
      setComposeOpen(false);
      setToEmail('');
      setSubject('');
      setBody('');
      await loadMailbox(activeTab);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to send email.';
      setError(msg);
    } finally {
      setSending(false);
    }
  };

  const handleReceiveInbound = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!extFrom.trim() || !extBody.trim() || !user?.email) {
      setError('External sender email and message body are required.');
      return;
    }

    setReceiving(true);
    try {
      const { data } = await mailApi.receiveInbound({
        from: extFrom.trim(),
        to: user.email,
        subject: extSubject.trim(),
        body: extBody.trim(),
      });
      setNotice(
        `Received external mail from ${extFrom.trim()}. ML Spam Gatekeeper classified as ${data.message.prediction} (${(
          data.message.spam_probability * 100
        ).toFixed(1)}%) and routed it to ${data.routed_folder === 'spam' ? 'Spam Quarantine' : 'Inbox'}.`
      );
      setInboundOpen(false);
      setExtSubject('');
      setExtBody('');
      const targetTab: MailboxTab = data.routed_folder === 'spam' ? 'spam' : 'inbox';
      setActiveTab(targetTab);
      await loadMailbox(targetTab);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        'Failed to process inbound email.';
      setError(msg);
    } finally {
      setReceiving(false);
    }
  };

  const handleMoveFolder = async (msg: MailMessage, nextFolder: 'inbox' | 'spam') => {
    setError('');
    try {
      await mailApi.moveFolder(msg.id, nextFolder);
      setNotice(
        nextFolder === 'inbox'
          ? 'Moved message to Inbox.'
          : 'Moved message to Spam Quarantine.'
      );
      await loadMailbox(activeTab);
    } catch {
      setError('Unable to move message.');
    }
  };

  const handleDelete = async (msg: MailMessage) => {
    setError('');
    try {
      await mailApi.remove(msg.id);
      setNotice('Message deleted.');
      await loadMailbox(activeTab);
    } catch {
      setError('Unable to delete message.');
    }
  };

  const openReply = (msg: MailMessage, suggestedText?: string) => {
    setToEmail(msg.sender_email);
    setSubject(msg.subject.startsWith('Re:') ? msg.subject : `Re: ${msg.subject}`);
    const prefix = suggestedText ? `${suggestedText}\n\n` : '\n\n';
    setBody(`${prefix}--- On ${new Date(msg.created_at).toLocaleString()}, ${msg.sender_email} wrote: ---\n${msg.body}`);
    setComposeOpen(true);
  };

  const webhookUrl = `${window.location.origin}/api/mail/inbound`;

  return (
    <div className="space-y-5">
      {/* Top Action & Folder Toolbar */}
      <div className="p-4 rounded-xl bg-slate-900/75 backdrop-blur-md border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'inbox'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Inbox ({counts.inbox})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('spam')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'spam'
                ? 'bg-rose-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Spam Quarantine ({counts.spam})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('sent')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'sent'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sent</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-slate-400 hidden sm:inline">
            {mailConfig?.smtp_configured
              ? `SMTP Relay: ${mailConfig.smtp_host}`
              : 'Internal Client Delivery · Webhook Ready'}
          </span>
          <button
            type="button"
            onClick={() => setInboundOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 transition-colors whitespace-nowrap"
          >
            <Webhook className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Receive External Mail</span>
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors whitespace-nowrap"
          >
            <MailPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Compose Mail</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl border border-rose-500/40 bg-rose-950/35 text-xs text-rose-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="p-3.5 rounded-xl border border-indigo-500/40 bg-indigo-950/35 text-xs text-indigo-200 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            className="text-indigo-300 hover:text-white"
            aria-label="Dismiss notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Split Mail List + Reading & ML Gatekeeper Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 rounded-xl bg-slate-900/75 border border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-display text-sm font-semibold text-white capitalize">
              {activeTab === 'spam' ? 'Spam Quarantine' : activeTab} Messages
            </h2>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {messages.length} items
            </span>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm text-slate-300">No messages in {activeTab}.</p>
              <p className="text-xs text-slate-500">
                Compose a message to another client or receive external mail to test automatic ML spam routing.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/70 max-h-[580px] overflow-y-auto">
              {messages.map((msg) => {
                const isSelected = selectedMail?.id === msg.id;
                return (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => handleSelectMail(msg)}
                    className={`w-full text-left px-5 py-4 transition-colors space-y-1.5 ${
                      isSelected ? 'bg-indigo-600/15' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          msg.is_read || activeTab === 'sent'
                            ? 'text-slate-300'
                            : 'font-semibold text-white'
                        }`}
                      >
                        {activeTab === 'sent' ? `To: ${msg.recipient_email}` : msg.sender_email}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                        {new Date(msg.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    <p className="text-sm font-medium text-slate-100 truncate">{msg.subject}</p>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <VerdictLabel prediction={msg.prediction} />
                      <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                        {(msg.spam_probability * 100).toFixed(1)}% spam
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Message Reading & ML Gatekeeper Inspection Pane */}
        <div className="lg:col-span-7 rounded-xl bg-slate-900/75 border border-slate-800 p-6 space-y-5">
          {!selectedMail ? (
            <div className="py-20 text-center text-sm text-slate-400">
              Select a message to inspect its content and ML spam scan results.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <VerdictLabel prediction={selectedMail.prediction} />
                    {selectedMail.threat_category && (
                      <span className="text-xs font-mono text-slate-400">
                        · {selectedMail.threat_category}
                      </span>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-semibold text-white">
                    {selectedMail.subject}
                  </h3>
                  <p className="text-xs text-slate-400">
                    From <span className="text-slate-200">{selectedMail.sender_email}</span> to{' '}
                    <span className="text-slate-200">{selectedMail.recipient_email}</span> ·{' '}
                    {new Date(selectedMail.created_at).toLocaleString()}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {activeTab !== 'sent' && (
                    <>
                      <button
                        type="button"
                        onClick={() => openReply(selectedMail)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        <span>Reply</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleMoveFolder(
                            selectedMail,
                            selectedMail.folder === 'spam' ? 'inbox' : 'spam'
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800"
                      >
                        <ArrowRightLeft className="w-3.5 h-3.5" />
                        <span>
                          {selectedMail.folder === 'spam' ? 'Not Spam (Move to Inbox)' : 'Mark as Spam'}
                        </span>
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDelete(selectedMail)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-300 bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </div>

              {/* ML Gatekeeper Telemetry Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <p className="text-slate-500">Spam Probability</p>
                  <p className="mt-1 font-mono text-base font-semibold text-white tabular-nums">
                    {(selectedMail.spam_probability * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <p className="text-slate-500">Confidence</p>
                  <p className="mt-1 font-mono text-base font-semibold text-indigo-300 tabular-nums">
                    {(selectedMail.confidence_score * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <p className="text-slate-500">Scan Latency</p>
                  <p className="mt-1 font-mono text-base font-semibold text-slate-200 tabular-nums">
                    {selectedMail.processing_time.toFixed(2)} ms
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                  <p className="text-slate-500">Channel</p>
                  <p className="mt-1 font-mono text-xs font-medium text-slate-300">
                    {selectedMail.delivery_channel}
                  </p>
                </div>
              </div>

              {/* Email Body */}
              <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 text-sm text-slate-200 leading-relaxed whitespace-pre-wrap min-h-[140px]">
                {selectedMail.body}
              </div>

              {/* AI Threat Forensics & Advisory */}
              {selectedMail.ai_advisory && (
                <div className="p-4 rounded-lg bg-slate-950/80 border border-slate-800 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-300">
                      {selectedMail.prediction === 'SPAM' ? (
                        <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      <span>AI Gatekeeper Security Advisory</span>
                    </div>
                    {selectedMail.risk_indicators && (
                      <span className="text-xs font-mono text-slate-400 tabular-nums">
                        Urgency Index: {selectedMail.risk_indicators.urgencyScore}/100
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{selectedMail.ai_advisory}</p>

                  {selectedMail.risk_indicators?.brandMismatch && (
                    <div className="p-2.5 rounded bg-rose-950/35 border border-rose-500/40 flex items-start gap-2 text-xs text-rose-200">
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <span>{selectedMail.risk_indicators.brandMismatch.detail}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 1-Click AI Suggested Replies for Legitimate Incoming Mail */}
              {activeTab !== 'sent' &&
                selectedMail.prediction === 'HAM' &&
                selectedMail.suggested_replies &&
                selectedMail.suggested_replies.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <p className="text-xs font-medium text-slate-400">
                      AI Quick Reply Suggestions (1-Click Draft)
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {selectedMail.suggested_replies.map((replyText, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => openReply(selectedMail, replyText)}
                          className="text-left text-xs text-slate-200 bg-slate-950 hover:bg-slate-800 border border-slate-800 px-3 py-2 rounded-lg transition-colors"
                        >
                          {replyText}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Suspicious Keywords */}
              {selectedMail.suspicious_keywords.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <p className="text-xs font-medium text-slate-400">
                    ML Gatekeeper Suspicious Keyword Triggers
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedMail.suspicious_keywords.map((kw) => (
                      <span
                        key={kw.term}
                        className="text-xs font-mono text-rose-300 bg-rose-950/40 border border-rose-500/30 px-2.5 py-1 rounded-md"
                      >
                        {kw.term} (+{kw.weight.toFixed(2)})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Compose & Send Mail Modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="max-w-lg w-full bg-[#0D1326] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">
                Compose &amp; Send Email
              </h3>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                aria-label="Close compose modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendMail} className="space-y-4">
              <div>
                <label htmlFor="toEmail" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Recipient Email (Client or External)
                </label>
                <input
                  id="toEmail"
                  type="email"
                  required
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="recipient@mailguard.ai"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
                {recipients.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Registered clients:</span>
                    {recipients.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setToEmail(r.email)}
                        className="px-2 py-1 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] text-slate-300"
                      >
                        {r.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="mailSubj" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Subject
                </label>
                <input
                  id="mailSubj"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="mailBody" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Message Body
                </label>
                <textarea
                  id="mailBody"
                  rows={6}
                  required
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your email message..."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  <span>{sending ? 'Scanning & Sending...' : 'Scan & Send'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Receive External Client Mail & Inbound Webhook Modal */}
      {inboundOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="max-w-lg w-full bg-[#0D1326] border border-slate-800 rounded-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">
                Receive Mail from External Client
              </h3>
              <button
                type="button"
                onClick={() => setInboundOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg"
                aria-label="Close external mail modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1.5 text-xs">
              <p className="text-slate-400">External Webhook Endpoint (POST with <code className="font-mono text-slate-200">x-webhook-secret</code>):</p>
              <code className="block font-mono text-indigo-300 break-all">{webhookUrl}</code>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setExtFrom('alerts@bank-verify-portal.xyz');
                  setExtSubject('URGENT: Account Suspended - Verify Password & SSN');
                  setExtBody('Click http://bank-verify-portal.xyz immediately to confirm your ATM PIN, SSN, and password or your bank funds will be frozen!');
                }}
                className="px-2.5 py-1.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300"
              >
                External Phishing Spam
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtFrom('colleague@partner-university.edu');
                  setExtSubject('Workshop Schedule & Paper Review Feedback');
                  setExtBody('Hello, attached are the final notes from our seminar on TF-IDF classification and Platt scaling calibration. Let us meet Friday at 2 PM.');
                }}
                className="px-2.5 py-1.5 rounded bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs text-slate-300"
              >
                External Legitimate Mail
              </button>
            </div>

            <form onSubmit={handleReceiveInbound} className="space-y-3.5">
              <div>
                <label htmlFor="extFrom" className="block text-xs font-medium text-slate-300 mb-1">
                  External Sender Email
                </label>
                <input
                  id="extFrom"
                  type="email"
                  required
                  value={extFrom}
                  onChange={(e) => setExtFrom(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="extSubj" className="block text-xs font-medium text-slate-300 mb-1">
                  Subject
                </label>
                <input
                  id="extSubj"
                  type="text"
                  value={extSubject}
                  onChange={(e) => setExtSubject(e.target.value)}
                  placeholder="Incoming email subject"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="extBody" className="block text-xs font-medium text-slate-300 mb-1">
                  Message Body
                </label>
                <textarea
                  id="extBody"
                  rows={5}
                  required
                  value={extBody}
                  onChange={(e) => setExtBody(e.target.value)}
                  placeholder="Incoming email body..."
                  className="w-full px-3.5 py-2.5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setInboundOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={receiving}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60"
                >
                  {receiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
                  <span>{receiving ? 'Scanning...' : 'Receive & Scan'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
