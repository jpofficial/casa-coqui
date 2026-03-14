'use client';

import { useState } from 'react';
import { auth } from '@/lib/firebase';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function InviteForm({ code, onSent }) {
  const [emailsText, setEmailsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailWarning, setEmailWarning] = useState('');
  const [success, setSuccess] = useState('');

  function parseEmails(text) {
    return [...new Set(
      text
        .split(/[,\n]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    )];
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setEmailWarning('');
    setSuccess('');

    const emails = parseEmails(emailsText);
    if (emails.length === 0) {
      setError('Enter at least one email address.');
      return;
    }

    const invalid = emails.filter((em) => !EMAIL_RE.test(em));
    if (invalid.length === emails.length) {
      setError('No valid email addresses found.');
      return;
    }
    if (invalid.length > 0) {
      setError(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError('You must be signed in to invite guests.');
        return;
      }
      const token = await currentUser.getIdToken();
      const res = await fetch('/api/guests/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ emails }),
      });
      const json = await res.json();

      if (!json.success) {
        setError(json.error || 'Failed to send invites.');
        return;
      }

      const { sent, duplicates, capped, results } = json.data;
      setEmailsText('');

      // Build feedback messages
      const messages = [];
      if (sent > 0) {
        const failedEmails = results?.filter((r) => r.emailSent === false && !r.error) || [];
        if (failedEmails.length > 0) {
          messages.push(`${sent} invite${sent > 1 ? 's' : ''} created, but email delivery failed for: ${failedEmails.map((r) => r.email).join(', ')}`);
        }
      }
      if (duplicates?.length > 0) {
        messages.push(`Already invited: ${duplicates.join(', ')}`);
      }
      if (capped?.length > 0) {
        messages.push(`Group full, not invited: ${capped.join(', ')}`);
      }

      if (messages.length > 0) {
        setEmailWarning(messages.join(' · '));
      }

      if (sent > 0) {
        setSuccess(`${sent} invite${sent > 1 ? 's' : ''} sent!`);
      }

      if (onSent) onSent();
    } catch (err) {
      console.error('[InviteForm] Error:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-sm font-semibold text-gray-900">Invite guests</p>
      <textarea
        placeholder="Enter email addresses (comma or newline separated)"
        value={emailsText}
        onChange={(e) => { setEmailsText(e.target.value); setError(''); }}
        rows={3}
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400
          focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition resize-none"
      />
      {success && <p className="text-xs text-green-600 font-medium">{success}</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {emailWarning && <p className="text-xs text-amber-600">{emailWarning}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold text-sm
          hover:bg-green-700 active:bg-green-800 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? 'Sending...' : 'Send Invites'}
      </button>
    </form>
  );
}
