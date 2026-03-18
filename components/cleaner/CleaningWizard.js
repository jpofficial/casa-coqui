'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { collection, query, where, orderBy, onSnapshot, doc, addDoc, updateDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { t } from '@/lib/i18n';
import useLocale from '@/hooks/useLocale';
import useAuth from '@/hooks/useAuth';

import Acknowledge from './steps/Acknowledge';
import EnRoute from './steps/EnRoute';
import Arrived from './steps/Arrived';
import BeforePhotos from './steps/BeforePhotos';
import Cleaning from './steps/Cleaning';
import IssueReport from './steps/IssueReport';
import AfterPhotos from './steps/AfterPhotos';
import LaundryCheck from './steps/LaundryCheck';
import Complete from './steps/Complete';

// Maps cleaning_job status to the wizard step to render
const STATUS_STEP = {
  scheduled: 'acknowledge',
  acknowledged: 'en_route',
  declined: 'declined',
  en_route: 'arrived',
  arrived: 'before_photos',
  before_photos: 'before_photos',
  cleaning: 'cleaning',
  after_photos: 'after_photos',
  laundry_check: 'laundry_check',
  completed: 'complete',
};

// ─── WhatsApp icon SVG path ─────────────────────────────────────────────────
const WA_ICON_PATH = 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z';

// ─── JobChat drawer ─────────────────────────────────────────────────────────
function JobChat({ job, user, locale, onClose }) {
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState([]);
  const [sendViaWA, setSendViaWA] = useState(false);
  const bottomRef = useRef(null);
  const phone = process.env.NEXT_PUBLIC_HOST_WHATSAPP;
  const displayName = user.displayName?.split(' ')[0] || 'Staff';

  // Format job context prefix for WhatsApp: [Name - Unit Date]
  const jobPrefix = `[${displayName} - ${job.unit} ${job.scheduledDate}] `;

  // Real-time listener for messages scoped to this job
  useEffect(() => {
    if (!user?.uid || !job?.id) return;
    const q = query(
      collection(db, 'staff_messages'),
      where('staffId', '==', user.uid),
      where('jobId', '==', job.id),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error('[staff_messages] job chat listener error:', err.code, err.message);
    });
  }, [user?.uid, job?.id]);

  // Mark host messages as read when drawer is open
  useEffect(() => {
    if (!user?.uid) return;
    const unread = messages.filter((m) => m.sender === 'host' && !m.read);
    unread.forEach((m) => {
      updateDoc(doc(db, 'staff_messages', m.id), { read: true }).catch(console.error);
    });
  }, [messages, user?.uid]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = msg.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      // 1. Save to Firestore with jobId
      await addDoc(collection(db, 'staff_messages'), {
        staffId: user.uid,
        staffName: displayName,
        sender: 'staff',
        text: trimmed,
        jobId: job.id,
        read: false,
        createdAt: new Date().toISOString(),
      });

      // 2. Notify admin/cohost
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      if (idToken) {
        fetch('/api/staff-messages/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ staffId: user.uid, staffName: displayName, sender: 'staff' }),
        }).catch(() => {});
      }

      // 3. Optionally open WhatsApp with job-context prefix
      if (sendViaWA && phone) {
        const url = `https://wa.me/${phone}?text=${encodeURIComponent(jobPrefix + trimmed)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
      }

      setMsg('');
    } catch (err) {
      console.error('Failed to send staff message:', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Drawer */}
      <div className="relative bg-white rounded-t-2xl max-h-[70vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="bg-[#25D366] px-4 py-3 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-white">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4.5 h-4.5">
              <path d={WA_ICON_PATH} />
            </svg>
            <span className="text-sm font-semibold">{t(locale, 'chatWithHost')}</span>
          </div>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition p-1"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 bg-gray-50 min-h-[120px]">
          {messages.length === 0 && (
            <p className="text-center text-sm text-gray-400 py-8">
              {t(locale, 'whatsappPlaceholder')}
            </p>
          )}
          {messages.map((m) => {
            const isStaff = m.sender === 'staff';
            return (
              <div key={m.id} className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-snug ${
                  isStaff
                    ? 'bg-[#DCF8C6] text-gray-800 rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
                }`}>
                  <p>{m.text}</p>
                  <p className="text-[10px] text-gray-400 text-right mt-0.5">
                    {m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* WhatsApp toggle + Input */}
        <div className="border-t border-gray-100 flex-shrink-0">
          {phone && (
            <button
              onClick={() => setSendViaWA((v) => !v)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                sendViaWA ? 'bg-[#25D366]/10 text-[#25D366]' : 'bg-gray-50 text-gray-400'
              }`}
            >
              <div className={`w-8 h-5 rounded-full flex items-center transition-colors ${sendViaWA ? 'bg-[#25D366] justify-end' : 'bg-gray-300 justify-start'}`}>
                <div className="w-4 h-4 bg-white rounded-full shadow mx-0.5" />
              </div>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                <path d={WA_ICON_PATH} />
              </svg>
              <span className="font-medium">{t(locale, 'sendViaWhatsApp')}</span>
            </button>
          )}
          <div className="p-3 flex gap-2">
            <input
              type="text"
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={t(locale, 'typeMessage')}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5
                focus:outline-none focus:ring-2 focus:ring-[#25D366]/30 focus:border-[#25D366]
                placeholder:text-gray-400"
            />
            <button
              onClick={handleSend}
              disabled={!msg.trim() || sending}
              className="bg-[#25D366] text-white rounded-full w-10 h-10 flex items-center justify-center
                hover:bg-[#20bd5a] active:bg-[#1da851] disabled:bg-gray-200 disabled:text-gray-400
                transition-colors flex-shrink-0"
              aria-label="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CleaningWizard({ job, onRefresh, onClose }) {
  const { locale, setLocale } = useLocale();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Unread count for badge
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    if (!user?.uid || !job?.id) return;
    const q = query(
      collection(db, 'staff_messages'),
      where('staffId', '==', user.uid),
      where('jobId', '==', job.id),
      orderBy('createdAt', 'asc')
    );
    return onSnapshot(q, (snap) => {
      const unread = snap.docs.filter((d) => d.data().sender === 'host' && !d.data().read).length;
      setUnreadCount(unread);
    }, () => {});
  }, [user?.uid, job?.id]);

  const step = STATUS_STEP[job.status] || 'acknowledge';

  // Progress indicator: map status to step number (excludes declined & completed summary)
  const STEP_ORDER = ['acknowledge', 'en_route', 'arrived', 'before_photos', 'cleaning', 'after_photos', 'laundry_check'];
  const currentStepNum = STEP_ORDER.indexOf(step) + 1;
  const totalSteps = STEP_ORDER.length;
  const showProgress = currentStepNum > 0 && step !== 'complete' && step !== 'declined';

  const apiCall = useCallback(async (url, body, method = 'PATCH') => {
    const token = await user.getIdToken();
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data;
  }, [user]);

  const advanceStatus = useCallback(async (newStatus, extraBody = {}) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}`, {
        status: newStatus,
        ...extraBody,
      });
    } catch (err) {
      console.error('Failed to advance status:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id]);

  const uploadPhotos = useCallback(async (type, urls) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}/photos`, { type, urls }, 'POST');
      if (type === 'before') {
        // If still in 'arrived', advance through 'before_photos' first
        if (job.status === 'arrived') {
          await apiCall(`/api/cleaning/jobs/${job.id}`, { status: 'before_photos' });
        }
        await apiCall(`/api/cleaning/jobs/${job.id}`, { status: 'cleaning' });
      } else {
        await apiCall(`/api/cleaning/jobs/${job.id}`, { status: 'laundry_check' });
      }
    } catch (err) {
      console.error('Failed to upload photos:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, job.status]);

  const reportIssue = useCallback(async (issue) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}/issues`, issue, 'POST');
      setShowIssue(false);
    } catch (err) {
      console.error('Failed to report issue:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id]);

  const declineJob = useCallback(async (declineReason) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}`, {
        status: 'declined',
        declineReason,
      });
      onRefresh();
    } catch (err) {
      console.error('Failed to decline job:', err);
      throw err;
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, onRefresh]);

  const submitLaundry = useCallback(async (laundryData) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}`, {
        status: 'completed',
        ...laundryData,
      });
    } catch (err) {
      console.error('Failed to submit laundry check:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id]);

  // Header with close button + WhatsApp button + locale toggle + progress
  const header = (
    <div>
      <div className="flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-sm border-b border-cafe-200 shadow-brand">
        {onClose ? (
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center -ml-1 rounded-lg hover:bg-cafe-100 active:bg-cafe-200 transition-colors" aria-label={t(locale, 'backToHome')}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-coqui-800">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : <div className="w-8" />}
        <div className="text-center">
          <p className="text-sm font-bold text-coqui-800 font-display">Casa Coqui</p>
          <p className="text-xs text-coqui-800/50">{t(locale, STATUS_STEP[job.status] === 'complete' ? 'cleaningComplete' : 'todaysCleaning')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {/* WhatsApp chat button */}
          {process.env.NEXT_PUBLIC_HOST_WHATSAPP && (
            <button
              onClick={() => setShowChat(true)}
              className="relative w-8 h-8 flex items-center justify-center rounded-lg hover:bg-cafe-100 active:bg-cafe-200 transition-colors"
              aria-label={t(locale, 'chatWithHost')}
            >
              <svg viewBox="0 0 24 24" fill="#25D366" className="w-5 h-5">
                <path d={WA_ICON_PATH} />
              </svg>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}
          {/* Locale toggle */}
          <button
            onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
            className="text-xs font-bold bg-cafe-100 text-coqui-700 px-3 py-1.5 rounded-full"
          >
            {locale === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </div>
      {/* Progress bar */}
      {showProgress && (
        <div className="bg-white px-4 py-2 border-b border-cafe-100 flex items-center gap-3">
          <div className="flex gap-1 flex-1">
            {STEP_ORDER.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < currentStepNum ? 'bg-coqui-500' : 'bg-cafe-200'
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-coqui-700 font-medium whitespace-nowrap">
            {t(locale, 'wizardStep').replace('{current}', currentStepNum).replace('{total}', totalSteps)}
          </span>
        </div>
      )}
    </div>
  );

  // Issue report overlay
  if (showIssue) {
    return (
      <div className="min-h-screen bg-cafe-50">
        {header}
        <IssueReport
          job={job}
          locale={locale}
          onSubmit={reportIssue}
          onCancel={() => setShowIssue(false)}
          busy={busy}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cafe-50">
      {header}

      {step === 'acknowledge' && (
        <Acknowledge job={job} locale={locale} onAdvance={() => advanceStatus('acknowledged')} onDecline={declineJob} busy={busy} />
      )}
      {step === 'declined' && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-lg font-semibold text-gray-800 mb-2">{t(locale, 'declined')}</p>
          <p className="text-sm text-gray-500 max-w-xs">
            {job.declineReason || ''}
          </p>
        </div>
      )}
      {step === 'en_route' && (
        <EnRoute job={job} locale={locale} onAdvance={() => advanceStatus('en_route')} busy={busy} />
      )}
      {step === 'arrived' && (
        <Arrived job={job} locale={locale} onAdvance={() => advanceStatus('arrived')} busy={busy} />
      )}
      {step === 'before_photos' && (
        <BeforePhotos job={job} locale={locale} onPhotosUploaded={(urls) => uploadPhotos('before', urls)} busy={busy} />
      )}
      {step === 'cleaning' && (
        <Cleaning locale={locale} onReportIssue={() => setShowIssue(true)} onAdvance={() => advanceStatus('after_photos')} busy={busy} />
      )}
      {step === 'after_photos' && (
        <AfterPhotos job={job} locale={locale} onPhotosUploaded={(urls) => uploadPhotos('after', urls)} busy={busy} />
      )}
      {step === 'laundry_check' && (
        <LaundryCheck job={job} locale={locale} onSubmit={submitLaundry} busy={busy} />
      )}
      {step === 'complete' && (
        <Complete job={job} locale={locale} onFinish={onRefresh} />
      )}

      {/* WhatsApp chat drawer */}
      {showChat && user && (
        <JobChat
          job={job}
          user={user}
          locale={locale}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}
