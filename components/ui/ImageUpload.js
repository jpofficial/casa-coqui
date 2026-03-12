'use client';

import { useState, useRef, useId } from 'react';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from '@/lib/firebase';

export default function ImageUpload({ storagePath, value, onChange, label }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const inputId = useId();

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setProgress(0);

    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const storageRef = ref(storage, `${storagePath}/${filename}`);
    const task = uploadBytesResumable(storageRef, file);

    task.on(
      'state_changed',
      (snap) => {
        setProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      (err) => {
        console.error('Upload error:', err);
        setUploading(false);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        onChange(url);
        setUploading(false);
        // Reset input so the same file can be re-selected
        if (inputRef.current) inputRef.current.value = '';
      }
    );
  }

  async function handleRemove() {
    if (!value) return;
    try {
      const storageRef = ref(storage, value);
      await deleteObject(storageRef);
    } catch (err) {
      // File may already be deleted or URL may not be a storage ref
      console.warn('Could not delete from storage:', err);
    }
    onChange('');
  }

  return (
    <div className="flex flex-col gap-2">
      {label && <p className="text-xs font-medium text-gray-500">{label}</p>}

      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt={label || 'Uploaded photo'}
            className="w-full max-w-xs h-32 object-cover rounded-lg border border-gray-200"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center text-xs font-bold shadow hover:bg-red-700"
            aria-label="Remove photo"
          >
            &times;
          </button>
        </div>
      ) : (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFile}
            className="hidden"
            id={inputId}
          />
          <label
            htmlFor={inputId}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-dashed border-gray-300 text-gray-600 cursor-pointer hover:bg-gray-50 active:bg-gray-100 transition ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            {uploading ? 'Uploading...' : 'Add Photo'}
          </label>
        </div>
      )}

      {uploading && (
        <div className="w-full max-w-xs bg-gray-200 rounded-full h-1.5">
          <div
            className="bg-green-600 h-1.5 rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
