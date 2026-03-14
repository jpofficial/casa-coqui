'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import useAuth from '@/hooks/useAuth';
import { auth } from '@/lib/firebase';
import InviteForm from '@/components/guest/InviteForm';

const MAX_MEMBERS = 6;

// ─── Avatar colors by index ─────────────────────────────────────────────────
const AVATAR_COLORS = [
  { bg: 'bg-green-600', ring: 'ring-green-200' },
  { bg: 'bg-cyan-500', ring: 'ring-cyan-200' },
  { bg: 'bg-purple-500', ring: 'ring-purple-200' },
  { bg: 'bg-amber-500', ring: 'ring-amber-200' },
  { bg: 'bg-rose-500', ring: 'ring-rose-200' },
  { bg: 'bg-indigo-500', ring: 'ring-indigo-200' },
];

function getAvatarColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

// ─── Member card ───────────────────────────────────────────────────────────────
function MemberCard({ member, isPrimary, canRemove, colorIndex, onRemoved }) {
  const [removing, setRemoving] = useState(false);
  const [copied, setCopied] = useState(false);
  const color = getAvatarColor(colorIndex);

  async function handleRemove() {
    if (!confirm(`Remove ${member.name || member.email} from the group?`)) return;
    setRemoving(true);
    try {
      const token = await auth.currentUser.getIdToken();
      const res = await fetch('/api/guests/invite', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ memberId: member.id }),
      });
      const json = await res.json();
      if (!json.success) {
        alert(json.error || 'Failed to remove member.');
      } else if (onRemoved) {
        onRemoved();
      }
    } catch {
      alert('Something went wrong.');
    } finally {
      setRemoving(false);
    }
  }

  function handleCopyLink() {
    if (!member.inviteLink) return;
    navigator.clipboard.writeText(member.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const isPending = member.status !== 'verified';
  const isInvitedMember = member.role !== 'primary';
  const displayName = member.name || member.email;
  const initial = (member.name?.[0] || member.email?.[0] || '?').toUpperCase();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-50 overflow-hidden">
      <div className="flex items-center gap-3 p-4">
        {/* Avatar with colored ring */}
        <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ring-2 ${
          isPending ? 'bg-gray-300 ring-gray-200' : `${color.bg} ${color.ring}`
        }`}>
          {isPending ? (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white/80">
              <path d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 00-1.5 0v6c0 .414.336.75.75.75h4.5a.75.75 0 000-1.5h-3.75V6z" />
            </svg>
          ) : (
            <span className="text-sm font-bold text-white">{initial}</span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
            {member.role === 'primary' && (
              <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                You
              </span>
            )}
          </div>
          {member.name && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{member.email}</p>
          )}
          {isInvitedMember && member.sentAt && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              Invited {formatDate(member.sentAt)}
              {member.emailSent === false && (
                <span className="text-red-400"> · Email failed</span>
              )}
            </p>
          )}
        </div>

        {/* Status + actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isPending ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-600 uppercase tracking-wide">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Pending
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-green-50 text-green-600 uppercase tracking-wide">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" clipRule="evenodd" />
              </svg>
              Joined
            </span>
          )}
          {canRemove && member.role !== 'primary' && (
            <button
              onClick={handleRemove}
              disabled={removing}
              className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50"
              title="Remove member"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Copy link row for pending members */}
      {isPrimary && isPending && isInvitedMember && member.inviteLink && (
        <div className="px-4 pb-3">
          <button
            onClick={handleCopyLink}
            className={`w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg py-2 transition-all duration-150 ${
              copied
                ? 'bg-green-600 text-white'
                : 'text-green-700 bg-green-50 hover:bg-green-100'
            }`}
          >
            {copied ? (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 01.208 1.04l-5 7.5a.75.75 0 01-1.154.114l-3-3a.75.75 0 011.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 011.04-.207z" clipRule="evenodd" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.056a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.343 8.28" />
                </svg>
                Copy invite link
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Capacity bar ───────────────────────────────────────────────────────────────
function CapacityBar({ filled, total }) {
  const pct = Math.round((filled / total) * 100);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-50 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4.5 h-4.5 text-cyan-600">
              <path d="M8.25 6.75a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0zM15.75 9.75a3 3 0 116 0 3 3 0 01-6 0zM2.25 9.75a3 3 0 116 0 3 3 0 01-6 0zM6.31 15.117A6.745 6.745 0 0112 12a6.745 6.745 0 016.709 7.498.75.75 0 01-.372.568A12.696 12.696 0 0112 21.75c-2.305 0-4.47-.612-6.337-1.684a.75.75 0 01-.372-.568 6.787 6.787 0 011.019-4.38z" />
              <path d="M5.082 14.254a8.287 8.287 0 00-1.308 5.135 9.687 9.687 0 01-1.764-.44l-.115-.04a.563.563 0 01-.373-.487l-.01-.121a3.75 3.75 0 013.57-4.047zM20.226 19.389a8.287 8.287 0 00-1.308-5.135 3.75 3.75 0 013.57 4.047l-.01.121a.563.563 0 01-.373.486l-.115.04c-.567.2-1.156.349-1.764.441z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Group Capacity</p>
            <p className="text-xs text-gray-500">{filled} of {total} spots filled</p>
          </div>
        </div>
        <span className="text-lg font-bold text-gray-900">{filled}<span className="text-gray-300">/{total}</span></span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            pct >= 100 ? 'bg-amber-500' : 'bg-green-500'
          }`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {/* Dot indicators */}
      <div className="flex items-center gap-1.5 mt-2.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
              i < filled ? 'bg-green-400' : 'bg-gray-100'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Section header ─────────────────────────────────────────────────────────────
function SectionHeader({ label, count }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">{label}</p>
      {count !== undefined && (
        <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function InvitePage({ params }) {
  const code = params.code;
  const { user, loading: authLoading } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [membersError, setMembersError] = useState(null);

  const fetchMembers = useCallback(async () => {
    if (!user) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch('/api/guests/invite', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (json.success) {
        setMembers(json.data || []);
        setMembersError(null);
      } else {
        setMembersError({ message: json.error || 'Failed to load members' });
      }
    } catch (err) {
      console.error('[InvitePage] Fetch members error:', err);
      setMembersError({ message: 'Failed to load members' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchMembers();
  }, [user, authLoading, fetchMembers]);

  const isPrimary = members.some(
    (m) => m.role === 'primary' && m.uid === user?.uid
  );

  const sorted = [...members].sort((a, b) => {
    if (a.role === 'primary') return -1;
    if (b.role === 'primary') return 1;
    if (a.status === 'verified' && b.status !== 'verified') return -1;
    if (a.status !== 'verified' && b.status === 'verified') return 1;
    return 0;
  });

  const joined = sorted.filter((m) => m.status === 'verified');
  const pending = sorted.filter((m) => m.status !== 'verified');
  const memberCount = members.length;
  const spotsLeft = MAX_MEMBERS - memberCount;

  return (
    <div className="px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link
          href={`/g/${code}`}
          className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 hover:bg-gray-200 transition"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Your Group</h1>
          <p className="text-xs text-gray-500">Manage who has access to the guest portal</p>
        </div>
      </div>

      {/* Firestore error */}
      {membersError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          Error loading members: {membersError.message || 'Unknown error'}
        </div>
      )}

      {/* Capacity bar */}
      {!loading && (
        <div className="mb-5">
          <CapacityBar filled={memberCount} total={MAX_MEMBERS} />
        </div>
      )}

      {/* Invite form — only for primary guest with spots available */}
      {isPrimary && spotsLeft > 0 && (
        <div className="mb-5">
          <InviteForm code={code} onSent={fetchMembers} />
        </div>
      )}

      {isPrimary && spotsLeft <= 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-500 flex-shrink-0">
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.345 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-amber-800">Group is full ({MAX_MEMBERS} members maximum).</p>
        </div>
      )}

      {/* Member list */}
      {loading ? (
        <div className="flex flex-col gap-3 mt-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-xl shadow-sm border border-gray-50 p-4 flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-gray-200 animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-28 bg-gray-200 rounded animate-pulse" />
                <div className="h-2.5 w-40 bg-gray-100 rounded animate-pulse" />
              </div>
              <div className="h-5 w-14 bg-gray-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-500">No group members yet</p>
          <p className="text-xs text-gray-400 mt-1">Invite friends and family to share portal access</p>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Joined members */}
          {joined.length > 0 && (
            <div>
              <SectionHeader label="Joined" count={joined.length} />
              <div className="flex flex-col gap-2.5">
                {joined.map((member, i) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    isPrimary={isPrimary}
                    canRemove={false}
                    colorIndex={i}
                    onRemoved={fetchMembers}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Pending members */}
          {pending.length > 0 && (
            <div>
              <SectionHeader label="Pending" count={pending.length} />
              <div className="flex flex-col gap-2.5">
                {pending.map((member, i) => (
                  <MemberCard
                    key={member.id}
                    member={member}
                    isPrimary={isPrimary}
                    canRemove={isPrimary && member.status === 'pending'}
                    colorIndex={joined.length + i}
                    onRemoved={fetchMembers}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
