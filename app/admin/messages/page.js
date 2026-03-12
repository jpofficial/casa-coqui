'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

function timeAgo(dateValue) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(dateValue) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateDivider(dateValue) {
  if (!dateValue) return '';
  const date = dateValue?.toDate ? dateValue.toDate() : new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Build a thread list from a flat array of messages
function buildThreads(messages) {
  const threadMap = {};
  for (const msg of messages) {
    const code = msg.bookingCode || 'unknown';
    if (!threadMap[code]) {
      threadMap[code] = {
        bookingCode: code,
        guestName: msg.guestName || code,
        messages: [],
        lastMessage: null,
        unreadCount: 0,
      };
    }
    threadMap[code].messages.push(msg);
    if (!threadMap[code].lastMessage || compareFirestoreDates(msg.createdAt, threadMap[code].lastMessage.createdAt) > 0) {
      threadMap[code].lastMessage = msg;
    }
    if (msg.sender === 'guest' && !msg.read) {
      threadMap[code].unreadCount += 1;
    }
  }
  // Sort threads by last message descending
  return Object.values(threadMap).sort((a, b) =>
    compareFirestoreDates(b.lastMessage?.createdAt, a.lastMessage?.createdAt)
  );
}

function compareFirestoreDates(a, b) {
  const toMs = (v) => {
    if (!v) return 0;
    if (v?.toDate) return v.toDate().getTime();
    return new Date(v).getTime();
  };
  return toMs(a) - toMs(b);
}

// Group thread messages by calendar day
function groupByDay(messages) {
  const groups = [];
  let currentDay = null;
  for (const msg of messages) {
    const dayLabel = formatDateDivider(msg.createdAt);
    if (dayLabel !== currentDay) {
      currentDay = dayLabel;
      groups.push({ type: 'divider', label: dayLabel, key: `divider-${dayLabel}-${msg.id}` });
    }
    groups.push({ type: 'message', msg, key: msg.id });
  }
  return groups;
}

// Thread list item
function ThreadItem({ thread, onSelect }) {
  const last = thread.lastMessage;
  return (
    <button
      onClick={() => onSelect(thread)}
      className="w-full bg-white rounded-xl shadow-sm p-4 text-left flex items-start gap-3 active:bg-gray-50 transition-colors"
    >
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 font-bold text-sm uppercase">
        {(thread.guestName || thread.bookingCode).charAt(0)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {thread.guestName !== thread.bookingCode
              ? thread.guestName
              : `Guest · ${thread.bookingCode}`}
          </span>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{timeAgo(last?.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-gray-500 truncate flex-1">
            {last?.sender === 'host' ? 'You: ' : ''}
            {last?.text || ''}
          </p>
          {thread.unreadCount > 0 && (
            <span className="flex-shrink-0 bg-green-600 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// Full chat view for a single thread
function ChatView({ thread, allMessages, onBack }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  // Messages sorted oldest first
  const threadMessages = allMessages
    .filter((m) => m.bookingCode === thread.bookingCode)
    .sort((a, b) => compareFirestoreDates(a.createdAt, b.createdAt));

  const grouped = groupByDay(threadMessages);

  // Mark all unread guest messages as read when thread opens
  useEffect(() => {
    const unread = threadMessages.filter((m) => m.sender === 'guest' && !m.read);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((m) => {
      batch.update(doc(db, 'messages', m.id), { read: true });
    });
    batch.commit().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.bookingCode]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [threadMessages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    try {
      await addDoc(collection(db, 'messages'), {
        bookingCode: thread.bookingCode,
        guestName: thread.guestName,
        sender: 'host',
        text: trimmed,
        createdAt: serverTimestamp(),
        read: false,
      });

      // Notify guest of host reply (fire-and-forget)
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      if (idToken) {
        fetch('/api/messages/notify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            bookingCode: thread.bookingCode,
            sender: 'host',
          }),
        }).catch(() => {});
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setText(trimmed);
    } finally {
      setSending(false);
    }
  }, [text, sending, thread.bookingCode, thread.guestName]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-112px)]">
      {/* Chat header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-green-600 min-h-[44px] min-w-[44px] flex items-center justify-center -ml-2"
          aria-label="Back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm uppercase flex-shrink-0">
          {(thread.guestName || thread.bookingCode).charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {thread.guestName !== thread.bookingCode
              ? thread.guestName
              : `Guest · ${thread.bookingCode}`}
          </p>
          <p className="text-xs text-gray-400 truncate">Code: {thread.bookingCode}</p>
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-gray-50">
        {grouped.length === 0 && (
          <p className="text-center text-gray-400 text-sm mt-8">No messages yet</p>
        )}
        {grouped.map((item) => {
          if (item.type === 'divider') {
            return (
              <div key={item.key} className="flex items-center gap-2 my-3">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-[11px] text-gray-400 font-medium">{item.label}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
            );
          }
          const { msg } = item;
          const isHost = msg.sender === 'host';
          return (
            <div key={item.key} className={`flex ${isHost ? 'justify-end' : 'justify-start'} mt-1`}>
              <div
                className={`max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-snug shadow-sm ${
                  isHost
                    ? 'bg-green-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-800 rounded-bl-sm'
                }`}
              >
                <p>{msg.text}</p>
                <p className={`text-[10px] mt-1 ${isHost ? 'text-green-200' : 'text-gray-400'} text-right`}>
                  {formatTime(msg.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Reply input */}
      <div className="bg-white border-t border-gray-100 px-4 py-3 flex items-end gap-2 flex-shrink-0">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none max-h-32"
          style={{ minHeight: '44px' }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          className="bg-green-600 text-white rounded-xl p-3 flex-shrink-0 disabled:opacity-50 active:bg-green-700 transition-colors"
          aria-label="Send"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [selectedThread, setSelectedThread] = useState(null);

  // Subscribe to all messages ordered by newest first
  useEffect(() => {
    const q = query(collection(db, 'messages'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setMessages(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoadingMessages(false);
      },
      (err) => {
        console.error('Messages subscription error:', err);
        setLoadingMessages(false);
      }
    );
    return unsubscribe;
  }, []);

  const threads = buildThreads(messages);

  // Keep selectedThread in sync when messages update
  useEffect(() => {
    if (!selectedThread) return;
    const updated = threads.find((t) => t.bookingCode === selectedThread.bookingCode);
    if (updated) setSelectedThread(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  if (selectedThread) {
    return (
      <ChatView
        thread={selectedThread}
        allMessages={messages}
        onBack={() => setSelectedThread(null)}
      />
    );
  }

  return (
    <div className="px-4 pt-5 pb-6 max-w-2xl mx-auto space-y-5">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Messages</h1>
        <p className="text-sm text-gray-500 mt-0.5">Guest conversations</p>
      </div>

      {loadingMessages ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-gray-100 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 bg-gray-100 rounded w-1/3" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : threads.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-10 text-center">
          <div className="text-gray-300 mb-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 16a2 2 0 01-2 2H7l-4 4V6a2 2 0 012-2h14a2 2 0 012 2v10z" />
            </svg>
          </div>
          <p className="text-gray-400 text-sm font-medium">No guest conversations yet</p>
          <p className="text-gray-400 text-xs mt-1">Messages from guests will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => (
            <ThreadItem key={thread.bookingCode} thread={thread} onSelect={setSelectedThread} />
          ))}
        </div>
      )}
    </div>
  );
}
