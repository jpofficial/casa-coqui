'use client';

import { useEffect } from 'react';

export default function BottomSheet({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 md:hidden ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black transition-opacity duration-200 ${open ? 'opacity-40' : 'opacity-0'}`}
      />
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[85vh] bg-white rounded-t-2xl shadow-xl transition-transform duration-300 ${
          open ? 'translate-y-0' : 'translate-y-full'
        } flex flex-col`}
      >
        <div className="flex justify-center pt-2 pb-1 flex-none">
          <div className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-3 text-xs text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >Close</button>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
