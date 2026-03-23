'use client';

import { useState, useRef } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';
import useLocale from '@/hooks/useLocale';
import { t } from '@/lib/i18n';

// ─── Post type icon badges (colored square + white icon, Apple Settings style) ─
const POST_TYPE_ICONS = {
  parking: {
    badge: 'bg-atardecer-500',
    selectedBg: 'bg-atardecer-50',
    selectedBorder: 'border-atardecer-400',
    selectedText: 'text-atardecer-700',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
        <path d="M9.5 17V7h3a3.5 3.5 0 010 7H9.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  laundry: {
    badge: 'bg-caribe-500',
    selectedBg: 'bg-caribe-50',
    selectedBorder: 'border-caribe-400',
    selectedText: 'text-caribe-700',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <rect x="4" y="2" width="16" height="20" rx="2.5" />
        <path d="M4 7.5h16" />
        <circle cx="12" cy="14.5" r="4" />
        <circle cx="7.5" cy="4.75" r="0.75" fill="currentColor" stroke="none" />
        <circle cx="10.5" cy="4.75" r="0.75" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  property_issue: {
    badge: 'bg-flamboyan-500',
    selectedBg: 'bg-flamboyan-50',
    selectedBorder: 'border-flamboyan-400',
    selectedText: 'text-flamboyan-700',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
    ),
  },
  general: {
    badge: 'bg-coqui-500',
    selectedBg: 'bg-coqui-50',
    selectedBorder: 'border-coqui-400',
    selectedText: 'text-coqui-700',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
};

// Builds locale-aware post type definitions inside the component
function getPostTypes(locale) {
  return [
    {
      value: 'parking',
      label: t(locale, 'communityType_parking'),
      ...POST_TYPE_ICONS.parking,
      autoMessage: t(locale, 'communityPost_autoMessageParking'),
      requiresPhoto: true,
    },
    {
      value: 'laundry',
      label: t(locale, 'communityType_laundry'),
      ...POST_TYPE_ICONS.laundry,
      autoMessage: null,
      requiresPhoto: false,
    },
    {
      value: 'property_issue',
      label: t(locale, 'communityType_propertyIssue'),
      ...POST_TYPE_ICONS.property_issue,
      autoMessage: null,
      requiresPhoto: true,
    },
    {
      value: 'general',
      label: t(locale, 'communityType_general'),
      ...POST_TYPE_ICONS.general,
      autoMessage: null,
      requiresPhoto: false,
    },
  ];
}

// ─── Progress bar ───────────────────────────────────────────────────────────
function ProgressBar({ progress }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-1.5 bg-green-500 rounded-full transition-all duration-200"
        style={{ width: `${progress}%` }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export default function CommunityPost({ code, onClose, onSuccess, initialType }) {
  const { locale } = useLocale();
  const [selectedType, setSelectedType] = useState(initialType || null);
  const [customMessage, setCustomMessage] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const POST_TYPES = getPostTypes(locale);
  const typeConfig = POST_TYPES.find((pt) => pt.value === selectedType);

  function handlePhotoSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleRemovePhoto() {
    setPhoto(null);
    setPhotoPreview(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadPhoto(file) {
    return new Promise((resolve, reject) => {
      const storageRef = ref(storage, `community-photos/${Date.now()}-${file.name}`);
      const task = uploadBytesResumable(storageRef, file);

      task.on(
        'state_changed',
        (snapshot) => {
          const pct = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          setUploadProgress(pct);
        },
        (err) => reject(err),
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        }
      );
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!selectedType) {
      setError(t(locale, 'communityPost_selectCategory'));
      return;
    }

    if (typeConfig.requiresPhoto && !photo) {
      setError(t(locale, 'communityPost_photoRequired'));
      return;
    }

    if (!typeConfig.autoMessage && !customMessage.trim()) {
      setError(t(locale, 'communityPost_writeMessage'));
      return;
    }

    try {
      let photoUrl = null;

      if (photo) {
        setUploading(true);
        photoUrl = await uploadPhoto(photo);
        setUploading(false);
      }

      setSubmitting(true);

      const idToken = auth.currentUser
        ? await auth.currentUser.getIdToken()
        : null;

      const res = await fetch('/api/community', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken && { Authorization: `Bearer ${idToken}` }),
        },
        body: JSON.stringify({
          type: selectedType,
          message: !typeConfig.autoMessage ? customMessage.trim() : undefined,
          photoUrl,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || t(locale, 'errorGeneric'));
        return;
      }

      onSuccess?.();
    } catch (err) {
      console.error('Community post error:', err);
      setError(t(locale, 'errorGeneric'));
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  }

  const isLoading = uploading || submitting;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900">{t(locale, 'communityPost_newPost')}</p>
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          {t(locale, 'cancel')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Category picker — 2x2 grid */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">{t(locale, 'communityPost_whatReport')}</p>
          <div className="grid grid-cols-2 gap-2">
            {POST_TYPES.map((postType) => {
              const isSelected = selectedType === postType.value;
              return (
                <button
                  key={postType.value}
                  type="button"
                  onClick={() => {
                    setSelectedType(postType.value);
                    setError(null);
                  }}
                  disabled={isLoading}
                  className={`flex flex-col items-center gap-2 p-3.5 rounded-xl border-2 transition-all text-center ${
                    isSelected
                      ? `${postType.selectedBorder} ${postType.selectedBg} ${postType.selectedText}`
                      : 'border-gray-100 bg-gray-50/50 text-gray-500 hover:border-gray-200 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${postType.badge}`}>
                    {postType.icon}
                  </div>
                  <span className="text-xs font-semibold">{postType.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Auto-message preview or custom input */}
        {selectedType && (
          <>
            {typeConfig.autoMessage ? (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-1">{t(locale, 'communityPost_messagePreview')}</p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {typeConfig.autoMessage}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="custom-message" className="text-sm font-semibold text-gray-700">
                  {t(locale, 'communityPost_yourMessage')}
                </label>
                <textarea
                  id="custom-message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  disabled={isLoading}
                  rows={3}
                  maxLength={500}
                  placeholder={t(locale, 'communityPost_messagePlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none disabled:opacity-50 disabled:bg-gray-50"
                />
              </div>
            )}

            {/* Photo upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-gray-700">
                Photo{typeConfig.requiresPhoto ? (
                  <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
                ) : (
                  <span className="text-gray-400 font-normal ml-1">(optional)</span>
                )}
              </label>

              {photoPreview ? (
                <div className="relative rounded-xl overflow-hidden border border-gray-200">
                  <img
                    src={photoPreview}
                    alt="Selected photo"
                    className="w-full h-48 object-cover"
                  />
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    disabled={isLoading}
                    className="absolute top-2 right-2 bg-white rounded-full shadow p-1.5 text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50"
                    aria-label="Remove photo"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>

                  {uploading && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-3 py-2">
                      <ProgressBar progress={uploadProgress} />
                      <p className="text-xs text-white mt-1 text-center">
                        {t(locale, 'communityPost_uploadingPhoto')} {uploadProgress}%
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
                  className="flex flex-col items-center justify-center gap-2 w-full h-28 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 hover:border-green-400 hover:bg-green-50 hover:text-green-600 transition-colors disabled:opacity-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                  </svg>
                  <span className="text-xs font-medium">{t(locale, 'communityPost_takeUploadPhoto')}</span>
                </button>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoSelect}
                className="sr-only"
                aria-label="Upload photo"
              />
            </div>
          </>
        )}

        {/* Privacy notice */}
        <div className="flex gap-2 items-start bg-blue-50 border border-blue-100 rounded-xl p-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" aria-hidden="true">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
          </svg>
          <p className="text-xs text-blue-800 leading-snug">
            {t(locale, 'communityPost_privacyNotice')}
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-600" role="alert">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={isLoading || !selectedType}
          className="w-full bg-green-600 text-white font-semibold text-sm py-3 rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {uploading ? t(locale, 'communityPost_uploadingPhoto') : t(locale, 'communityPost_posting')}
            </>
          ) : (
            t(locale, 'communityPost_postToCommunity')
          )}
        </button>
      </form>
    </div>
  );
}
