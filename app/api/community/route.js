import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { broadcastToActiveGuests } from '@/lib/notifications';

// Auto-generated messages by post type.
const AUTO_MESSAGES = {
  parking:
    "Hey all! Friendly reminder — there's a car parked in an assigned spot. Does anyone know whose car this is?",
  noise:
    'Hi neighbors! Just a friendly heads-up about noise levels. Let\u2019s keep things comfortable for everyone.',
  lost_found:
    'Hey! Something was found in the common area. Check the photo below — is it yours?',
};

// Friendly titles for push notifications.
const PUSH_TITLES = {
  parking: 'Parking Alert',
  noise: 'Noise Notice',
  lost_found: 'Lost & Found',
  general: 'Community Post',
};

// ---------------------------------------------------------------------------
// POST /api/community
//
// Creates a new community board post. Any authenticated user (guest or staff)
// can call this. The post is saved to the `community` collection and a push
// notification is broadcast to all active guests.
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { caller, error: authError } = await requireAuth(request);
    if (authError) return authError;

    const body = await request.json();
    const { type, message: customMessage, photoUrl } = body;

    // Validate type.
    const validTypes = ['parking', 'noise', 'lost_found', 'general'];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid post type.' },
        { status: 400 }
      );
    }

    // Parking and lost_found require a photo.
    if ((type === 'parking' || type === 'lost_found') && !photoUrl) {
      return NextResponse.json(
        { success: false, error: 'A photo is required for this post type.' },
        { status: 400 }
      );
    }

    // Resolve the message — auto-generated for parking/noise/lost_found, custom for general.
    let message;
    if (type === 'general') {
      if (!customMessage?.trim()) {
        return NextResponse.json(
          { success: false, error: 'Message is required for general posts.' },
          { status: 400 }
        );
      }
      message = customMessage.trim();
    } else {
      message = AUTO_MESSAGES[type];
    }

    // Determine poster role.
    const postedByRole = caller.role || 'guest';

    // Write to community collection.
    const postData = {
      type,
      message,
      photoUrl: photoUrl || null,
      bookingCode: caller.bookingCode || null,
      postedByRole,
      createdAt: new Date().toISOString(),
    };

    const docRef = await adminDb.collection('community').add(postData);

    // Broadcast push + SMS to all active guests.
    const pushTitle = PUSH_TITLES[type] || 'Community Post';
    await broadcastToActiveGuests({
      title: pushTitle,
      body: message.length > 100 ? message.slice(0, 97) + '...' : message,
      type: 'community',
    });

    return NextResponse.json({
      success: true,
      data: { id: docRef.id },
    });
  } catch (error) {
    console.error('[POST /api/community] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create community post.' },
      { status: 500 }
    );
  }
}
