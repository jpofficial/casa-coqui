'use client';

import { useState, useRef, useEffect } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { storage, auth, db } from '@/lib/firebase';

const CATEGORIES = [
  { value: 'lighting', label: 'Lighting', icon: '💡' },
  { value: 'water', label: 'Water / Plumbing', icon: '🚿' },
  { value: 'ac_heating', label: 'AC / Heating', icon: '❄️' },
  { value: 'appliance', label: 'Appliance', icon: '🍳' },
  { value: 'lock_door', label: 'Lock / Door', icon: '🔑' },
  { value: 'wifi_tv', label: 'WiFi / TV', icon: '📶' },
  { value: 'pest', label: 'Pest / Bug', icon: '🐛' },
  { value: 'cleaning', label: 'Cleaning', icon: '🧹' },
  { value: 'noise', label: 'Noise Issue', icon: '🔊' },
  { value: 'other', label: 'Other', icon: '📋' },
];
const URGENCIES = [
  {
    value: 'low',
    label: 'Low',
    description: 'Not urgent, fix when convenient',
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-300',
    ring: 'ring-green-500',
  },
  {
    value: 'medium',
    label: 'Medium',
    description: 'Affecting comfort or use',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    ring: 'ring-amber-500',
  },
  {
    value: 'high',
    label: 'High',
    description: 'Safety concern or unusable',
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-300',
    ring: 'ring-red-500',
  },
];

// ─── Upload progress bar ───────────────────────────────────────────────────────
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

// ─── Success state ─────────────────────────────────────────────────────────────
function SuccessView({ onReset }) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-7 h-7 text-green-600"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
            clipRule="evenodd"
          />
        </svg>
      </div>
      <div>
        <p className="text-base font-bold text-gray-900">Request submitted</p>
        <p className="text-sm text-gray-500 mt-1 leading-snug">
          Your request has been submitted. We will get back to you soon.
        </p>
      </div>
      <button
        onClick={onReset}
        className="mt-2 bg-green-600 text-white font-semibold text-sm px-6 py-3 rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors"
      >
        Submit another
      </button>
    </div>
  );
}

// ─── Status badge styles ──────────────────────────────────────────────────────
const STATUS_STYLES = {
  open: 'bg-red-100 text-red-600',
  'in-progress': 'bg-amber-100 text-amber-700',
  done: 'bg-green-100 text-green-700',
};

const STATUS_LABELS = {
  open: 'Open',
  'in-progress': 'In Progress',
  done: 'Done',
};

// Map category values → display labels (supports both new and legacy values)
const CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

// ─── Request history ──────────────────────────────────────────────────────────
function RequestHistory() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubFirestore = null;

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (unsubFirestore) unsubFirestore();

      if (!user) {
        setRequests([]);
        setLoading(false);
        return;
      }

      const q = query(
        collection(db, 'maintenance'),
        where('guestId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );

      unsubFirestore = onSnapshot(
        q,
        (snapshot) => {
          setRequests(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          setLoading(false);
        },
        (err) => {
          console.error('Failed to load request history:', err);
          setLoading(false);
        }
      );
    });

    return () => {
      unsubAuth();
      if (unsubFirestore) unsubFirestore();
    };
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 animate-pulse">
            <div className="h-3 bg-gray-100 rounded w-1/3 mb-2" />
            <div className="h-3 bg-gray-100 rounded w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (requests.length === 0) return null;

  function formatDate(dateValue) {
    if (!dateValue) return '';
    const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-gray-900">Your Requests</h3>
      {requests.map((req) => {
        const status = req.status || 'open';
        return (
          <div
            key={req.id}
            className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">{CATEGORY_LABELS[req.category] || req.category}</span>
                <span className="text-xs text-gray-300">{formatDate(req.createdAt)}</span>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABELS[status] || status}
              </span>
            </div>
            <p className="text-sm text-gray-700 line-clamp-2">{req.description}</p>

            {(req.guestResponse || req.estimatedTime) && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs space-y-1">
                {req.guestResponse && (
                  <p className="text-green-800">
                    <span className="font-medium">Staff: </span>
                    {req.guestResponse}
                  </p>
                )}
                {req.estimatedTime && (
                  <p className="text-green-700">
                    <span className="font-medium">ETA: </span>
                    {req.estimatedTime}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function MaintenanceForm({ code }) {
  const [category, setCategory] = useState('');
  const [urgency, setUrgency] = useState('medium');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

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

  function handleReset() {
    setCategory('');
    setUrgency('medium');
    setDescription('');
    setPhoto(null);
    setPhotoPreview(null);
    setUploadProgress(0);
    setSubmitted(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadPhoto(file) {
    return new Promise((resolve, reject) => {
      const storageRef = ref(
        storage,
        `maintenance-photos/${Date.now()}-${file.name}`
      );
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

    if (!category) {
      setError('Please select a category.');
      return;
    }
    if (!description.trim()) {
      setError('Please describe the issue.');
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

      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      const response = await fetch('/api/maintenance', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken && { Authorization: `Bearer ${idToken}` }),
        },
        body: JSON.stringify({
          category,
          urgency,
          description: description.trim(),
          photoUrl,
          bookingCode: code,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Submission failed.');
      }

      setSubmitted(true);
    } catch (err) {
      console.error('Maintenance form error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  }

  const isLoading = uploading || submitting;

  if (submitted) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-bold text-gray-900">
            Maintenance Request
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Let us know about any issues
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <SuccessView onReset={handleReset} />
        </div>
        <RequestHistory />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">
          Maintenance Request
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Let us know about any issues
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-4"
      >
        {/* Category grid */}
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-gray-700">
            What is the issue?{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </p>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => {
              const isSelected = category === cat.value;
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => { setCategory(cat.value); setError(null); }}
                  disabled={isLoading}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition text-center
                    ${isSelected
                      ? 'border-green-500 bg-green-50 text-green-700'
                      : 'border-gray-100 bg-gray-50 text-gray-600 hover:border-gray-200'
                    } disabled:opacity-50`}
                >
                  <span className="text-lg" aria-hidden="true">{cat.icon}</span>
                  <span className="text-[11px] font-medium leading-tight">{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Urgency radio buttons */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-semibold text-gray-700 mb-1">
            Urgency{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {URGENCIES.map((u) => {
              const isSelected = urgency === u.value;
              return (
                <label
                  key={u.value}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 cursor-pointer transition-all duration-150
                    ${isSelected
                      ? `${u.bg} ${u.border} ring-2 ring-offset-1 ${u.ring}`
                      : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                    }
                    ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <input
                    type="radio"
                    name="urgency"
                    value={u.value}
                    checked={isSelected}
                    onChange={() => setUrgency(u.value)}
                    disabled={isLoading}
                    className="sr-only"
                  />
                  <span
                    className={`text-xs font-bold ${isSelected ? u.color : 'text-gray-600'}`}
                  >
                    {u.label}
                  </span>
                  <span
                    className={`text-xs text-center leading-tight ${isSelected ? u.color : 'text-gray-400'}`}
                  >
                    {u.description}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Description textarea */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="description"
            className="text-sm font-semibold text-gray-700"
          >
            Description{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
            rows={4}
            placeholder="Describe the issue in detail — what happened, where it is, when it started"
            required
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none disabled:opacity-50 disabled:bg-gray-50"
          />
        </div>

        {/* Photo upload (optional) */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700">
            Photo{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>

          {photoPreview ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              <img
                src={photoPreview}
                alt="Selected maintenance issue photo"
                className="w-full h-40 object-cover"
              />
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={isLoading}
                className="absolute top-2 right-2 bg-white rounded-full shadow p-1.5 text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50"
                aria-label="Remove photo"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z"
                />
              </svg>
              <span className="text-sm font-medium">Add a photo</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoSelect}
            className="sr-only"
            aria-label="Upload maintenance photo"
          />
        </div>

        {/* Inline error */}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-green-600 text-white font-semibold text-sm py-3 rounded-xl hover:bg-green-700 active:bg-green-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <svg
                className="w-4 h-4 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              {uploading ? 'Uploading photo...' : 'Submitting...'}
            </>
          ) : (
            'Submit Request'
          )}
        </button>
      </form>

      <RequestHistory />
    </div>
  );
}
