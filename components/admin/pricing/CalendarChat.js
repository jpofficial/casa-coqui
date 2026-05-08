'use client';

import { useEffect, useRef, useState } from 'react';
import { auth } from '@/lib/firebase';

const QUICK_QUESTIONS = [
  "Who's cheapest right now?",
  'What\u2019s the trend this month?',
  'How booked are comps next 14 days?',
  'Where are the data gaps?',
];

export default function CalendarChat({ unit }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function send(rawQuery) {
    const query = (rawQuery ?? input).trim();
    if (!query || sending) return;

    setMessages((m) => [...m, { role: 'user', text: query }]);
    setInput('');
    setSending(true);

    try {
      const token = await auth.currentUser.getIdToken();
      const history = messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.text,
      }));
      const res = await fetch('/api/pricing/advisor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ unit, query, history }),
      });

      // Read as text first so we can surface auth-redirects, empty 504s,
      // and HTML error pages instead of throwing "unexpected end of JSON".
      const raw = await res.text();
      let json = null;
      if (raw) {
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
      }

      let answer;
      if (json?.success) {
        answer = json.data?.answer || 'No answer returned.';
      } else if (json?.error) {
        answer = json.error;
      } else if (!res.ok) {
        answer = `Server error (${res.status}). ${raw ? raw.slice(0, 160) : 'No response body.'}`;
      } else {
        answer = 'Empty response from server. Please try again.';
      }
      setMessages((m) => [...m, { role: 'assistant', text: answer }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `Error: ${err.message || 'request failed'}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Ask the pricing AI</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Questions about comps, trends, availability, and data gaps for{' '}
          <span className="font-medium">{unit === 'unit-a' ? 'Unit A' : 'Unit B'}</span>.
        </p>
      </div>

      <div ref={scrollRef} className="max-h-[420px] overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Try one of these:</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={sending}
                  className="text-xs px-3 py-1.5 rounded-full border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 transition disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] text-sm px-3 py-2 rounded-2xl whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] text-xs px-3 py-2 rounded-2xl bg-gray-100 text-gray-500 animate-pulse">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 px-4 py-3 border-t border-gray-100"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about pricing, comps, trends…"
          disabled={sending}
          className="flex-1 text-sm text-gray-900 placeholder-gray-400 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          Ask
        </button>
      </form>
    </div>
  );
}
