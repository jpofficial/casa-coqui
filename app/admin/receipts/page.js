'use client';

import { useState, useMemo, useRef } from 'react';
import { orderBy } from 'firebase/firestore';
import { collection, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { useCollection } from '@/hooks/useFirestore';

function currentMonthYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(ym) {
  if (!ym) return '';
  const [year, month] = ym.split('-');
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatCurrency(n) {
  if (n === null || n === undefined) return null;
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isPdf(filename) {
  return filename && filename.toLowerCase().endsWith('.pdf');
}

function isImage(filename) {
  if (!filename) return false;
  return /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename);
}

function FileIcon({ filename }) {
  if (isPdf(filename)) {
    return (
      <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0">
        <span className="text-xs font-bold text-red-600">PDF</span>
      </div>
    );
  }
  if (isImage(filename)) {
    return (
      <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    </div>
  );
}

function ReceiptPreviewModal({ receipt, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="relative w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/80 hover:text-white p-2"
          aria-label="Close preview"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="bg-white rounded-2xl overflow-hidden shadow-2xl">
          <div className="p-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900 truncate">{receipt.filename}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {formatDate(receipt.uploadedAt)}
              {receipt.amount != null && ` · ${formatCurrency(receipt.amount)}`}
            </p>
          </div>

          {isImage(receipt.filename) ? (
            <img
              src={receipt.storageUrl}
              alt={receipt.filename}
              className="w-full max-h-[60vh] object-contain bg-gray-50"
            />
          ) : (
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-xl font-bold text-red-600">PDF</span>
              </div>
              <p className="text-sm text-gray-500 mb-4">PDF files open in a new tab.</p>
              <a
                href={receipt.storageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg px-6 py-3 text-sm"
              >
                Open PDF
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Receipts() {
  const { data: receipts, loading, error } = useCollection('receipts', [orderBy('uploadedAt', 'desc')]);

  const [expandedMonths, setExpandedMonths] = useState(() => new Set([currentMonthYM()]));
  const [previewReceipt, setPreviewReceipt] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  // Group receipts by month
  const groupedByMonth = useMemo(() => {
    const groups = {};
    for (const receipt of receipts) {
      const month = receipt.month || (receipt.uploadedAt ? receipt.uploadedAt.substring(0, 7) : 'unknown');
      if (!groups[month]) groups[month] = [];
      groups[month].push(receipt);
    }
    // Sort months descending
    const sorted = Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
    return sorted;
  }, [receipts]);

  function toggleMonth(month) {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) {
        next.delete(month);
      } else {
        next.add(month);
      }
      return next;
    });
  }

  function handleReceiptClick(receipt) {
    if (isPdf(receipt.filename)) {
      window.open(receipt.storageUrl, '_blank', 'noopener,noreferrer');
    } else {
      setPreviewReceipt(receipt);
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setUploading(true);

    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `receipts/${month}/${Date.now()}_${safeName}`;

      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });
      const storageUrl = await getDownloadURL(storageRef);

      await addDoc(collection(db, 'receipts'), {
        filename: file.name,
        storageUrl,
        storagePath,
        uploadedAt: now.toISOString(),
        month,
        amount: null,
        vendor: null,
        sender: null,
        subject: null,
        contentType: file.type,
      });

      // Expand the current month
      setExpandedMonths((prev) => new Set([...prev, month]));
    } catch (err) {
      console.error('Upload failed:', err);
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (error) {
    return (
      <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto">
        <div className="bg-red-50 rounded-xl p-4 text-sm text-red-600">
          Failed to load receipts. Please refresh.
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Receipts</h1>
          <p className="text-sm text-gray-500 mt-0.5">Bills and receipts by month</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-semibold rounded-lg px-4 py-2.5 text-sm flex-shrink-0 disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : '+ Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={handleUpload}
        />
      </div>

      {uploadError && (
        <div className="bg-red-50 rounded-xl p-3 text-sm text-red-600">{uploadError}</div>
      )}

      {/* Month folders */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : groupedByMonth.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-8 text-center">
          <p className="text-gray-400 text-sm">No receipts yet.</p>
          <p className="text-gray-400 text-xs mt-1">
            Upload a file or forward receipts via email.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groupedByMonth.map(([month, monthReceipts]) => {
            const isOpen = expandedMonths.has(month);
            const monthTotal = monthReceipts
              .filter((r) => r.amount != null)
              .reduce((sum, r) => sum + (r.amount || 0), 0);
            const hasAmounts = monthReceipts.some((r) => r.amount != null);

            return (
              <div key={month} className="bg-white rounded-xl shadow-sm overflow-hidden">
                {/* Month folder header */}
                <button
                  onClick={() => toggleMonth(month)}
                  className="w-full flex items-center justify-between p-4 text-left active:bg-gray-50 transition-colors min-h-[56px]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-base">
                      <svg xmlns="http://www.w3.org/2000/svg" className={`w-5 h-5 text-yellow-500 transition-transform ${isOpen ? 'rotate-0' : ''}`} fill="currentColor" viewBox="0 0 24 24">
                        <path d="M10 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2h-8l-2-2z" />
                      </svg>
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {formatMonthLabel(month)}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {monthReceipts.length} receipt{monthReceipts.length !== 1 ? 's' : ''}
                        {hasAmounts && ` · ${formatCurrency(monthTotal)}`}
                      </p>
                    </div>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className={`w-5 h-5 text-gray-400 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Receipt list for this month */}
                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {monthReceipts.map((receipt) => (
                      <button
                        key={receipt.id}
                        onClick={() => handleReceiptClick(receipt)}
                        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors min-h-[64px]"
                      >
                        {isImage(receipt.filename) ? (
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                            <img
                              src={receipt.storageUrl}
                              alt={receipt.filename}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <FileIcon filename={receipt.filename} />
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {receipt.vendor || receipt.subject || receipt.filename}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDate(receipt.uploadedAt)}
                            {receipt.sender && ` · ${receipt.sender}`}
                          </p>
                        </div>

                        <div className="flex-shrink-0 text-right">
                          {receipt.amount != null ? (
                            <span className="text-sm font-semibold text-gray-900">
                              {formatCurrency(receipt.amount)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">No amount</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Receipt Preview Modal */}
      {previewReceipt && (
        <ReceiptPreviewModal
          receipt={previewReceipt}
          onClose={() => setPreviewReceipt(null)}
        />
      )}
    </div>
  );
}
