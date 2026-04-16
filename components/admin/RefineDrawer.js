'use client';

import { useState, useEffect, useRef } from 'react';

export default function RefineDrawer({ isOpen, onClose, draft, context, onAccept }) {
  // draft: string — current draft text
  // context: { type: 'welcome'|'reply', guestName, bookingCode, inboundMessage? }
  // onAccept: (acceptedDraft) => void — called when user accepts a refined draft

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [currentDraft, setCurrentDraft] = useState(draft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  // Reset state when draft changes or drawer opens
  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setCurrentDraft(draft);
      setInput('');
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [isOpen, draft]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleSend() {
    const feedback = input.trim();
    if (!feedback || loading) return;

    const newMessages = [...messages, { role: 'user', content: feedback }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    try {
      const { auth } = await import('@/lib/firebase');
      const idToken = await auth.currentUser.getIdToken();

      const res = await fetch('/api/ai/refine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          draft: currentDraft,
          feedback,
          context,
          history: newMessages.slice(0, -1),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCurrentDraft(data.data.revisedDraft);
        setMessages([...newMessages, { role: 'assistant', content: data.data.revisedDraft }]);
      } else {
        setMessages([...newMessages, { role: 'assistant', content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      console.error('[RefineDrawer] send failed:', err);
      setMessages([...newMessages, { role: 'assistant', content: 'Something went wrong. Try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAccept() {
    setSaving(true);
    try {
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
      if (userMessages.length > 0) {
        const { auth } = await import('@/lib/firebase');
        const idToken = await auth.currentUser.getIdToken();
        await fetch('/api/ai/refine', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            feedbackMessages: userMessages,
            acceptedDraft: currentDraft,
            context,
          }),
        });
      }
      onAccept(currentDraft);
      onClose();
    } catch (err) {
      console.error('[RefineDrawer] accept failed:', err);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/30 z-[60] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Refine draft"
        className={`fixed top-0 right-0 h-full w-full sm:w-[28rem] bg-white shadow-xl z-[70] transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 flex-none">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-blue-600">
              <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.683a1 1 0 01.633.633l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633l-.683-2.051z" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900">Refine Draft</h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-gray-400">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* Current draft */}
        <div className="px-4 py-3 border-b border-gray-100 flex-none bg-gray-50">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Current Draft</p>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{currentDraft}</p>
        </div>

        {/* Chat messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              Tell the AI how to adjust this message. e.g. &quot;sound more like me&quot; or &quot;less formal&quot;
            </p>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}>
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-500">
                <span className="animate-pulse">Rewriting...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input + Accept */}
        <div className="flex-none border-t border-gray-100 p-3 space-y-2">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. 'more casual' or 'say aight instead of alright'"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          </div>
          {messages.length > 0 && (
            <button
              onClick={handleAccept}
              disabled={saving || loading}
              className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 active:bg-green-800 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Accept Draft'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
