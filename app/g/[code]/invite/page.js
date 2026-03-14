'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useCollection } from '@/hooks/useFirestore';
import useAuth from '@/hooks/useAuth';
import { where } from 'firebase/firestore';
import { auth } from '@/lib/firebase';
import InviteForm from '@/components/guest/InviteForm';

const MAX_MEMBERS = 6;

// ─── Member card ───────────────────────────────────────────────────────────────
function MemberCard({ member, isPrimary, canRemove, onRemove }) {
  const [removing, setRemoving] = useState(false);

  async function handleRemove() {
    if (!confirm(`Remove ${member.name} from the group?`)) return;
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
      }
    } catch {
      alert('Something went wrong.');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-100">
      <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
        <span className="text-sm font-semibold text-green-700">
          {member.name?.[0]?.toUpperCase() || '?'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
          {member.role === 'primary' && (
            <span className="text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full uppercase">
              You
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">{member.email}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase ${
            member.status === 'verified'
              ? 'bg-green-50 text-green-600'
              : 'bg-amber-50 text-amber-600'
          }`}
        >
          {member.status === 'verified' ? 'Joined' : 'Pending'}
        </span>
        {canRemove && member.role !== 'primary' && (
          <button
            onClick={handleRemove}
            disabled={removing}
            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-50"
            title="Remove member"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function InvitePage({ params }) {
  const code = params.code;
  const { user } = useAuth();

  const { data: members, loading } = useCollection('booking_members', [
    where('bookingCode', '==', code),
  ]);

  const isPrimary = members.some(
    (m) => m.role === 'primary' && m.uid === user?.uid
  );

  const memberCount = members.length;
  const spotsLeft = MAX_MEMBERS - memberCount;

  return (
    <div className="px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
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
          <p className="text-xs text-gray-500">
            {memberCount} of {MAX_MEMBERS} spots filled
            {spotsLeft > 0 && ` · ${spotsLeft} remaining`}
          </p>
        </div>
      </div>

      {/* Invite form — only for primary guest with spots available */}
      {isPrimary && spotsLeft > 0 && (
        <div className="mb-5">
          <InviteForm code={code} />
        </div>
      )}

      {isPrimary && spotsLeft <= 0 && (
        <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          Group is full ({MAX_MEMBERS} members maximum).
        </div>
      )}

      {/* Member list */}
      {loading ? (
        <div className="flex flex-col gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {members
            .sort((a, b) => (a.role === 'primary' ? -1 : 1))
            .map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                isPrimary={isPrimary}
                canRemove={isPrimary && member.status === 'pending'}
              />
            ))}
        </div>
      )}

      {!loading && members.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">
          No group members yet.
        </div>
      )}
    </div>
  );
}
