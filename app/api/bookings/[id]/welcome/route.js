import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { generateWelcomeMessage } from '@/lib/welcome-ai';
import { FieldValue } from 'firebase-admin/firestore';
import { buildThreadKey } from '@/lib/thread-key';

// ---------------------------------------------------------------------------
// POST /api/bookings/[id]/welcome
//
// Regenerate welcome message for a booking. Admin-only.
// Idempotency: only generates if welcomeStatus is 'pending' or forced via ?force=true
// ---------------------------------------------------------------------------

export async function POST(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    // Load booking
    const bookingDoc = await adminDb.collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }

    const booking = { id: bookingDoc.id, ...bookingDoc.data() };

    // Idempotency guard: skip if already ready/sent (unless forced)
    if (!force && booking.welcomeStatus !== 'pending') {
      return NextResponse.json({
        success: true,
        data: {
          message: booking.welcomeMessage,
          welcomeStatus: booking.welcomeStatus,
          skipped: true,
        },
      });
    }

    // Load property settings
    const settingsDoc = await adminDb.collection('settings').doc('property').get();
    const settings = settingsDoc.exists ? settingsDoc.data() : {};
    const template = settings.welcomeTemplate || null;

    // Parse optional notes from request body (for regeneration with context)
    const body = await request.json().catch(() => ({}));
    const customTemplate = body.template || template;

    const result = await generateWelcomeMessage({
      booking,
      settings,
      template: customTemplate,
    });

    // Update booking with draft
    const now = new Date().toISOString();
    await bookingDoc.ref.update({
      welcomeStatus: 'ready',
      welcomeMessage: result.message,
      welcomeDraftedAt: now,
    });

    // Log agent run
    if (result._agentRun) {
      result._agentRun.refId = id;
      await adminDb.collection('agent_runs').add(result._agentRun);
    }

    return NextResponse.json({
      success: true,
      data: {
        message: result.message,
        language: result.language,
        welcomeStatus: 'ready',
      },
    });
  } catch (error) {
    console.error('[POST /api/bookings/[id]/welcome]', error);
    const detail = error?.message || String(error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate welcome message.', detail },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/bookings/[id]/welcome
//
// Action dispatcher for Mark-as-Sent, Snooze, and Skip.
// Admin-only. Mirrors writes so that Mark-as-Sent adds a thread entry to
// airbnb_messages, unifying the welcome into the guest's conversation log.
// ---------------------------------------------------------------------------

export async function PATCH(request, { params }) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (!['mark-sent', 'snooze', 'skip'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'Unknown action. Expected mark-sent | snooze | skip.' },
        { status: 400 }
      );
    }

    const bookingRef = adminDb.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return NextResponse.json(
        { success: false, error: 'Booking not found.' },
        { status: 404 }
      );
    }
    const booking = { id: bookingDoc.id, ...bookingDoc.data() };
    const now = new Date().toISOString();

    // Helper: create or update the single welcome message doc tied to this booking.
    async function upsertWelcomeMessageDoc({ welcomeState, text, snoozedUntil }) {
      const threadKey = buildThreadKey({
        bookingCode: booking.code,
        senderEmail: booking.guestEmail || null,
        senderName: booking.guestName || null,
      });

      const baseFields = {
        bookingId: booking.id,
        bookingCode: booking.code || null,
        threadKey,
        guestName: booking.guestName || null,
        senderEmail: booking.guestEmail || null,
        source: 'welcome_draft',
        sender: 'host',
        read: true,
      };

      // Build the state-specific payload. We keep two variants: `create`
      // (fresh set, cannot use FieldValue.delete) and `update` (set with
      // merge, can clear stale fields via FieldValue.delete).
      let create;
      let update;
      if (welcomeState === 'sent') {
        create = { direction: 'outbound', welcomeState: 'sent', text, sentAt: FieldValue.serverTimestamp() };
        update = { ...create, welcomeSnoozedUntil: FieldValue.delete() };
      } else if (welcomeState === 'snoozed') {
        create = { direction: 'outbound_draft', welcomeState: 'snoozed', text, welcomeSnoozedUntil: snoozedUntil || null };
        update = { ...create, sentAt: FieldValue.delete() };
      } else {
        // skipped
        create = { direction: 'outbound_draft', welcomeState: 'skipped', text };
        update = { ...create, welcomeSnoozedUntil: FieldValue.delete(), sentAt: FieldValue.delete() };
      }

      if (booking.welcomeMessageId) {
        const ref = adminDb.collection('airbnb_messages').doc(booking.welcomeMessageId);
        await ref.set({ ...baseFields, ...update }, { merge: true });
        return booking.welcomeMessageId;
      } else {
        const ref = adminDb.collection('airbnb_messages').doc();
        const ts = FieldValue.serverTimestamp();
        // `receivedAt` is the field the Messages page orders by — without it
        // the doc is silently excluded from the onSnapshot query. Set it to
        // the same timestamp as createdAt so the welcome lands chronologically
        // at the moment it was staged.
        await ref.set({
          ...baseFields,
          ...create,
          createdAt: ts,
          receivedAt: ts,
        });
        await bookingRef.update({ welcomeMessageId: ref.id });
        return ref.id;
      }
    }

    if (action === 'skip') {
      const text = booking.welcomeMessage || '(welcome skipped)';
      await upsertWelcomeMessageDoc({ welcomeState: 'skipped', text });
      await bookingRef.update({ welcomeStatus: 'skipped' });
      return NextResponse.json({ success: true, data: { welcomeStatus: 'skipped' } });
    }

    if (action === 'snooze') {
      const snoozedUntil = body.snoozedUntil;
      if (!snoozedUntil || Number.isNaN(new Date(snoozedUntil).getTime())) {
        return NextResponse.json(
          { success: false, error: 'snoozedUntil must be a valid ISO timestamp.' },
          { status: 400 }
        );
      }
      if (!booking.welcomeMessage) {
        return NextResponse.json(
          { success: false, error: 'Cannot snooze — no welcome draft to stage.' },
          { status: 400 }
        );
      }
      await upsertWelcomeMessageDoc({
        welcomeState: 'snoozed',
        text: booking.welcomeMessage,
        snoozedUntil,
      });
      await bookingRef.update({
        welcomeStatus: 'snoozed',
        welcomeSnoozedUntil: snoozedUntil,
      });
      return NextResponse.json({
        success: true,
        data: { welcomeStatus: 'snoozed', welcomeSnoozedUntil: snoozedUntil },
      });
    }

    // action === 'mark-sent'
    // Idempotency guard: re-tapping Mark-as-Sent must not create duplicate thread entries.
    if (booking.welcomeStatus === 'sent') {
      return NextResponse.json({
        success: true,
        data: { welcomeStatus: 'sent', alreadySent: true },
      });
    }

    const finalText = typeof body.text === 'string' ? body.text.trim() : '';
    if (!finalText) {
      return NextResponse.json(
        { success: false, error: 'text is required for mark-sent.' },
        { status: 400 }
      );
    }

    if (finalText.length > 10000) {
      return NextResponse.json(
        { success: false, error: 'text exceeds maximum length.' },
        { status: 400 }
      );
    }

    const messageId = await upsertWelcomeMessageDoc({
      welcomeState: 'sent',
      text: finalText,
    });
    await bookingRef.update({
      welcomeStatus: 'sent',
      welcomeSentAt: now,
      welcomeSentText: finalText,
    });

    return NextResponse.json({
      success: true,
      data: { welcomeStatus: 'sent', messageId },
    });
  } catch (error) {
    console.error('[PATCH /api/bookings/[id]/welcome]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update welcome.' },
      { status: 500 }
    );
  }
}
