'use client';

import { useState } from 'react';
import { useCollection } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import { ROLES } from '@/lib/roles';

export default function TeamPage() {
  const { isAdmin } = useAuth();
  const { data: users, loading } = useCollection('users');

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('cohost');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  if (!isAdmin) {
    return (
      <div className="p-6 text-center text-gray-500">
        Only admins can access team management.
      </div>
    );
  }

  async function handleInvite(e) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setResult(null);

    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email, role, displayName }),
      });

      const data = await res.json();
      if (!data.success) {
        setError(data.error);
      } else {
        setResult(data.data);
        setEmail('');
        setDisplayName('');
        setRole('cohost');
      }
    } catch {
      setError('Failed to send invite. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function copyResetLink() {
    if (result?.resetLink) {
      navigator.clipboard.writeText(result.resetLink);
    }
  }

  const roleBadgeColors = {
    admin: 'bg-blue-100 text-blue-800',
    cohost: 'bg-purple-100 text-purple-800',
    cleaner: 'bg-yellow-100 text-yellow-800',
  };

  const statusBadgeColors = {
    active: 'bg-green-100 text-green-800',
    pending: 'bg-orange-100 text-orange-800',
  };

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Team Management</h1>

      {/* Invite Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Invite Team Member
        </h2>
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Display Name
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Maria Garcia"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@example.com"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="cohost">Co-host</option>
              <option value="cleaner">Cleaner</option>
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          {result && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-green-800 font-medium">
                {result.emailSent
                  ? `Invite email sent to ${result.email}`
                  : `Invited ${result.email} as ${ROLES[result.role]?.label}`}
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={result.resetLink}
                  className="flex-1 text-xs bg-white border border-green-300 rounded px-3 py-2 text-gray-700"
                />
                <button
                  type="button"
                  onClick={copyResetLink}
                  className="px-3 py-2 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-green-700">
                {result.emailSent
                  ? 'They can also use this link to set their password.'
                  : 'Share this link so they can set their password.'}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition"
          >
            {submitting ? 'Inviting...' : 'Send Invite'}
          </button>
        </form>
      </div>

      {/* Team List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Team Members
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-gray-500">No team members yet.</p>
        ) : (
          <div className="space-y-3">
            {users.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {member.displayName || member.email}
                  </p>
                  <p className="text-xs text-gray-500">{member.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadgeColors[member.role] || 'bg-gray-100 text-gray-700'}`}
                  >
                    {ROLES[member.role]?.label || member.role}
                  </span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeColors[member.status] || 'bg-gray-100 text-gray-600'}`}
                  >
                    {member.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
