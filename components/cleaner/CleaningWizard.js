'use client';

import { useState, useCallback } from 'react';
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

export default function CleaningWizard({ job, onRefresh }) {
  const { locale, setLocale } = useLocale();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [showIssue, setShowIssue] = useState(false);

  const step = STATUS_STEP[job.status] || 'acknowledge';

  const apiCall = useCallback(async (url, body) => {
    const token = await user.getIdToken();
    const res = await fetch(url, {
      method: body ? 'POST' : 'PATCH',
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
      onRefresh();
    } catch (err) {
      console.error('Failed to advance status:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, onRefresh]);

  const uploadPhotos = useCallback(async (type, urls) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}/photos`, { type, urls });
      // After uploading photos, advance to next status
      const nextStatus = type === 'before' ? 'cleaning' : 'laundry_check';
      await apiCall(`/api/cleaning/jobs/${job.id}`, { status: nextStatus });
      onRefresh();
    } catch (err) {
      console.error('Failed to upload photos:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, onRefresh]);

  const reportIssue = useCallback(async (issue) => {
    setBusy(true);
    try {
      await apiCall(`/api/cleaning/jobs/${job.id}/issues`, issue);
      setShowIssue(false);
      onRefresh();
    } catch (err) {
      console.error('Failed to report issue:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, onRefresh]);

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
      onRefresh();
    } catch (err) {
      console.error('Failed to submit laundry check:', err);
    } finally {
      setBusy(false);
    }
  }, [apiCall, job.id, onRefresh]);

  // Header with locale toggle
  const header = (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
      <div>
        <p className="text-sm font-bold text-gray-900">Casa Coqui</p>
        <p className="text-xs text-gray-500">{t(locale, STATUS_STEP[job.status] === 'complete' ? 'cleaningComplete' : 'todaysCleaning')}</p>
      </div>
      <button
        onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
        className="text-xs font-bold bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full"
      >
        {locale === 'es' ? 'EN' : 'ES'}
      </button>
    </div>
  );

  // Issue report overlay
  if (showIssue) {
    return (
      <div className="min-h-screen bg-gray-50">
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
    <div className="min-h-screen bg-gray-50">
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
    </div>
  );
}
