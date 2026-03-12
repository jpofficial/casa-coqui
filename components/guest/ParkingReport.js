'use client';

import { useState, useRef } from 'react';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage, auth } from '@/lib/firebase';

const LOCATIONS = ['Front lot', 'Driveway', 'Street', 'Other'];

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
        <p className="text-base font-bold text-gray-900">Report submitted</p>
        <p className="text-sm text-gray-500 mt-1 leading-snug">
          We have alerted all guests. If this is your vehicle, please move it
          to your designated spot.
        </p>
      </div>
      <button
        onClick={onReset}
        className="mt-2 text-sm text-green-600 font-medium underline underline-offset-2"
      >
        Submit another report
      </button>
    </div>
  );
}

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

// ─── Main component ────────────────────────────────────────────────────────────
export default function ParkingReport({ code }) {
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
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
    setPhoto(null);
    setPhotoPreview(null);
    setDescription('');
    setLocation('');
    setUploadProgress(0);
    setSubmitted(false);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function uploadPhoto(file) {
    return new Promise((resolve, reject) => {
      const storageRef = ref(storage, `parking-reports/${Date.now()}-${file.name}`);
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

    if (!photo) {
      setError('Please take or upload a photo of the vehicle.');
      return;
    }
    if (!location) {
      setError('Please select the vehicle location.');
      return;
    }

    try {
      setUploading(true);
      const photoUrl = await uploadPhoto(photo);
      setUploading(false);

      setSubmitting(true);

      // Save to Firestore — reporter identity is not included
      await addDoc(collection(db, 'parking_reports'), {
        photoUrl,
        description: description.trim() || null,
        location,
        bookingCode: code,
        createdAt: serverTimestamp(),
        status: 'new',
      });

      // Trigger generic broadcast — hides reporter identity from other guests
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      await fetch('/api/parking/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken && { Authorization: `Bearer ${idToken}` }),
        },
      });

      setSubmitted(true);
    } catch (err) {
      console.error('Parking report error:', err);
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
            Report a Parking Issue
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Alert other guests about an unfamiliar vehicle
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <SuccessView onReset={handleReset} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold text-gray-900">
          Report a Parking Issue
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Alert other guests about an unfamiliar vehicle
        </p>
      </div>

      {/* Privacy notice */}
      <div className="flex gap-2.5 items-start bg-blue-50 border border-blue-100 rounded-xl p-3">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-xs text-blue-800 leading-snug">
          Your identity will not be shared. Other guests will only see a generic
          alert, and the host will handle the details privately.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-4"
      >
        {/* Photo upload */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-semibold text-gray-700">
            Photo of vehicle{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>

          {photoPreview ? (
            <div className="relative rounded-xl overflow-hidden border border-gray-200">
              <img
                src={photoPreview}
                alt="Selected vehicle photo"
                className="w-full h-48 object-cover"
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

              {/* Upload progress */}
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
              className="flex flex-col items-center justify-center gap-2 w-full h-36 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 text-gray-400 hover:border-green-400 hover:bg-green-50 hover:text-green-600 transition-colors disabled:opacity-50"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-7 h-7"
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
              <span className="text-sm font-medium">Take or upload photo</span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoSelect}
            className="sr-only"
            aria-label="Upload vehicle photo"
          />
        </div>

        {/* Location dropdown */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="location"
            className="text-sm font-semibold text-gray-700"
          >
            Vehicle location{' '}
            <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <select
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={isLoading}
            required
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition disabled:opacity-50 disabled:bg-gray-50"
          >
            <option value="">Select a location</option>
            {LOCATIONS.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        </div>

        {/* Description textarea */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="description"
            className="text-sm font-semibold text-gray-700"
          >
            Vehicle description{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isLoading}
            rows={3}
            placeholder="Describe the vehicle — color, make, license plate if visible"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none disabled:opacity-50 disabled:bg-gray-50"
          />
        </div>

        {/* Inline error */}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* Submit */}
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
              {uploading ? 'Uploading photo...' : 'Submitting report...'}
            </>
          ) : (
            'Submit Report'
          )}
        </button>
      </form>
    </div>
  );
}
