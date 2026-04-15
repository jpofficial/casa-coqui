import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';
import { generateWelcomeMessage } from '@/lib/welcome-ai';

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
    return NextResponse.json(
      { success: false, error: 'Failed to generate welcome message.' },
      { status: 500 }
    );
  }
}
