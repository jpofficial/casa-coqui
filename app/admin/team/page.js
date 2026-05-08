'use client';

import { useState } from 'react';
import { useCollection } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import { ROLES } from '@/lib/roles';

export default function TeamPage() {
  const { isAdmin, user } = useAuth();
  const { data: users, loading } = useCollection('users');

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('cohost');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(null);

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

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
  }

  async function handleResend(uid) {
    setActionLoading(uid);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/admin/invite/${uid}/resend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error);
      } else if (!data.data.emailSent) {
        const fallback = confirm(
          `Email failed to send: ${data.data.emailError || 'Unknown error'}.\n\nCopy the setup link instead?`
        );
        if (fallback && data.data.resetLink) {
          navigator.clipboard.writeText(data.data.resetLink);
        }
      }
    } catch {
      alert('Failed to resend invite.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRevoke(uid, name) {
    if (!confirm(`Revoke invitation for ${name}? This will delete their pending account.`)) return;
    setActionLoading(uid);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/admin/team/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error);
      } else {
        setResult({ message: `Invitation for ${name} has been revoked.` });
      }
    } catch {
      alert('Failed to revoke invitation.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRoleChange(uid, newRole) {
    setActionLoading(uid);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/admin/team/${uid}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!data.success) alert(data.error);
    } catch {
      alert('Failed to update role.');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleRemove(uid, name) {
    if (!confirm(`Remove ${name} from the team? This will disable their account.`)) return;
    setActionLoading(uid);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/admin/team/${uid}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error);
      } else {
        setResult({ message: `${name} has been removed from the team.` });
      }
    } catch {
      alert('Failed to remove team member.');
    } finally {
      setActionLoading(null);
    }
  }

  const roleBadgeColors = {
    admin: 'bg-blue-600 text-white',
    cohost: 'bg-purple-600 text-white',
    cleaner: 'bg-amber-500 text-white',
    maintenance: 'bg-orange-500 text-white',
  };

  const pendingUsers = users.filter((m) => m.status === 'pending');
  const activeUsers = users.filter((m) => m.status === 'active');

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-black">Team Management</h1>

      {/* Invite Form */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-bold text-black mb-4">
          Invite Team Member
        </h2>
        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-black mb-1">
              Display Name
            </label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Maria Garcia"
              className="w-full rounded-lg border border-gray-400 px-4 py-2.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-black mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="maria@example.com"
              className="w-full rounded-lg border border-gray-400 px-4 py-2.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-black mb-1">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-lg border border-gray-400 px-4 py-2.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="cohost">Co-host</option>
              <option value="cleaner">Cleaner</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              {error}
            </p>
          )}

          {result && result.resetLink && result.emailSent && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-green-800 font-medium">
                Invite email sent to {result.email}
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
                  onClick={() => copyToClipboard(result.resetLink)}
                  className="px-3 py-2 bg-green-600 text-white text-xs font-medium rounded hover:bg-green-700 transition"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-green-700">
                Backup link in case the email gets lost.
              </p>
            </div>
          )}

          {result && result.resetLink && !result.emailSent && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
              <p className="text-sm text-amber-800 font-medium">
                User created, but the invite email failed to send
              </p>
              {result.emailError && (
                <p className="text-xs text-amber-700">
                  Error: {result.emailError}
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={result.resetLink}
                  className="flex-1 text-xs bg-white border border-amber-300 rounded px-3 py-2 text-gray-700"
                />
                <button
                  type="button"
                  onClick={() => copyToClipboard(result.resetLink)}
                  className="px-3 py-2 bg-amber-600 text-white text-xs font-medium rounded hover:bg-amber-700 transition"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-amber-700">
                Share this link directly so they can set their password.
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

      {/* Action success banner (for remove/revoke) */}
      {result?.message && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-800 font-medium">{result.message}</p>
          <button
            type="button"
            onClick={() => setResult(null)}
            className="text-green-600 hover:text-green-800 text-xs font-medium ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pending Invitations */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-bold text-black mb-4">
          Pending Invitations
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : pendingUsers.length === 0 ? (
          <p className="text-sm text-gray-500">No pending invitations.</p>
        ) : (
          <div className="space-y-3">
            {pendingUsers.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-black truncate">
                    {member.displayName || member.email}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{member.email}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadgeColors[member.role] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {ROLES[member.role]?.label || member.role}
                    </span>
                    {member.emailSent === true && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        Email sent
                      </span>
                    )}
                    {member.emailSent === false && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                        Email failed
                      </span>
                    )}
                    {member.emailSent === undefined && (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        Unknown
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => handleResend(member.id)}
                    disabled={actionLoading === member.id}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50"
                  >
                    Resend
                  </button>
                  <button
                    onClick={() => handleRevoke(member.id, member.displayName || member.email)}
                    disabled={actionLoading === member.id}
                    className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Members */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
        <h2 className="text-base font-bold text-black mb-4">
          Active Members
        </h2>
        {loading ? (
          <p className="text-sm text-gray-500">Loading...</p>
        ) : activeUsers.length === 0 ? (
          <p className="text-sm text-gray-500">No active team members yet.</p>
        ) : (
          <div className="space-y-3">
            {activeUsers.map((member) => {
              const isSelf = member.id === user?.uid;
              const isAdminMember = member.role === 'admin';
              const canManage = !isSelf && !isAdminMember;
              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-black truncate">
                      {member.displayName || member.email}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {canManage ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        disabled={actionLoading === member.id}
                        className="text-sm font-semibold text-black border border-gray-400 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="cohost">Co-host</option>
                        <option value="cleaner">Cleaner</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                    ) : (
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${roleBadgeColors[member.role] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {ROLES[member.role]?.label || member.role}
                      </span>
                    )}
                    {canManage && (
                      <button
                        onClick={() => handleRemove(member.id, member.displayName || member.email)}
                        disabled={actionLoading === member.id}
                        className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
