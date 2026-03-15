'use client';

import { useState, useRef } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage, auth } from '@/lib/firebase';

// ─── Post type definitions ──────────────────────────────────────────────────
const POST_TYPES = [
  {
    value: 'parking',
    label: 'Parking',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path d="M3.375 4.5C2.339 4.5 1.5 5.34 1.5 6.375V13.5h1.218c.252-.948.949-1.724 1.858-2.093A3.75 3.75 0 0112 13.5h2.625c.946 0 1.77-.565 2.135-1.375A3.75 3.75 0 0122.5 13.5V6.375c0-1.036-.84-1.875-1.875-1.875H3.375z" />
        <path d="M7.5 16.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM18 16.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zM1.5 15.75V18a2.25 2.25 0 002.25 2.25h1.28a3.74 3.74 0 01-.03-.5 3.75 3.75 0 013-3.675V15.75H1.5zM15 15.75v.325A3.75 3.75 0 0118 19.75c0 .168-.01.334-.03.5h1.28A2.25 2.25 0 0021.5 18v-2.25H15z" />
      </svg>
    ),
    autoMessage:
      "Hey all! Friendly reminder — there's a car parked in an assigned spot. Does anyone know whose car this is?",
    requiresPhoto: true,
  },
  {
    value: 'laundry',
    label: 'Laundry',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" clipRule="evenodd" />
      </svg>
    ),
    autoMessage: null,
    requiresPhoto: false,
  },
  {
    value: 'property_issue',
    label: 'Property Issue',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.499-2.599 4.499H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003zM12 8.25a.75.75 0 01.75.75v3.75a.75.75 0 01-1.5 0V9a.75.75 0 01.75-.75zm0 8.25a.75.75 0 100-1.5.75.75 0 000 1.5z" clipRule="evenodd" />
      </svg>
    ),
    autoMessage: null,
    requiresPhoto: true,
  },
  {
    value: 'general',
    label: 'General',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.29 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.68-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd" />
      </svg>
    ),
    autoMessage: null,
    requiresPhoto: false,
  },
];

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
  const [selectedType, setSelectedType] = useState(initialType || null);
  const [customMessage, setCustomMessage] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const typeConfig = POST_TYPES.find((t) => t.value === selectedType);

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
      setError('Please select a category.');
      return;
    }

    if (typeConfig.requiresPhoto && !photo) {
      setError('A photo is required for this category.');
      return;
    }

    if (!typeConfig.autoMessage && !customMessage.trim()) {
      setError('Please write a message.');
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
        setError(data.error || 'Something went wrong.');
        return;
      }

      onSuccess?.();
    } catch (err) {
      console.error('Community post error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  }

  const isLoading = uploading || submitting;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-gray-900">New Post</p>
        <button
          type="button"
          onClick={onClose}
          disabled={isLoading}
          className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Category picker — 2x2 grid */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">What would you like to report?</p>
          <div className="grid grid-cols-2 gap-2">
            {POST_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setSelectedType(t.value);
                  setError(null);
                }}
                disabled={isLoading}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition text-center ${
                  selectedType === t.value
                    ? 'border-green-500 bg-green-50 text-green-700'
                    : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                } disabled:opacity-50`}
              >
                {t.icon}
                <span className="text-xs font-medium">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Auto-message preview or custom input */}
        {selectedType && (
          <>
            {typeConfig.autoMessage ? (
              <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
                <p className="text-xs font-medium text-gray-500 mb-1">Message preview</p>
                <p className="text-sm text-gray-700 leading-relaxed">
                  {typeConfig.autoMessage}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="custom-message" className="text-sm font-semibold text-gray-700">
                  Your message
                </label>
                <textarea
                  id="custom-message"
                  value={customMessage}
                  onChange={(e) => setCustomMessage(e.target.value)}
                  disabled={isLoading}
                  rows={3}
                  maxLength={500}
                  placeholder="Write your message to fellow guests..."
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
                        Uploading... {uploadProgress}%
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
                  <span className="text-xs font-medium">Take or upload photo</span>
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
            Your identity will not be shared. Posts are anonymous to other guests.
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
              {uploading ? 'Uploading photo...' : 'Posting...'}
            </>
          ) : (
            'Post to Community'
          )}
        </button>
      </form>
    </div>
  );
}
