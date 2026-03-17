import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireAuth } from '@/lib/api-auth';
import { broadcastToActiveGuests } from '@/lib/notifications';
import { createRateLimiter } from '@/lib/rate-limit';

const communityLimiter = createRateLimiter({ maxRequests: 5, windowMs: 15 * 60 * 1000 });

const MAX_MESSAGE_LENGTH = 500;

// Auto-generated messages by post type (used only as fallbacks if no custom message provided).
const AUTO_MESSAGES = {
  parking:
    "Hey all! Friendly reminder — there's a car parked in an assigned spot. Does anyone know whose car this is?",
  laundry: 'Heads up — a laundry-related update has been posted on the community board.',
  property_issue: 'A property issue has been reported. Please check the community board for details.',
};

// Friendly titles for push notifications.
const PUSH_TITLES = {
  parking: 'Parking Alert',
  laundry: 'Laundry Update',
  property_issue: 'Property Update',
  general: 'Broadcast Post',
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

    // Rate limit: 5 posts per 15 minutes per user
    const { limited } = communityLimiter.check(caller.uid);
    if (limited) {
      return NextResponse.json(
        { success: false, error: 'Too many posts. Please wait a few minutes.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { type, message: customMessage, photoUrl } = body;

    // Validate type.
    const validTypes = ['parking', 'laundry', 'property_issue', 'general'];
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Invalid post type.' },
        { status: 400 }
      );
    }

    // Parking and property_issue require a photo.
    if ((type === 'parking' || type === 'property_issue') && !photoUrl) {
      return NextResponse.json(
        { success: false, error: 'A photo is required for this post type.' },
        { status: 400 }
      );
    }

    // Resolve the message — use custom message if provided, otherwise fall back to auto-generated.
    let message;
    if (customMessage?.trim()) {
      if (customMessage.trim().length > MAX_MESSAGE_LENGTH) {
        return NextResponse.json(
          { success: false, error: `Message must be ${MAX_MESSAGE_LENGTH} characters or less.` },
          { status: 400 }
        );
      }
      message = customMessage.trim();
    } else if (AUTO_MESSAGES[type]) {
      message = AUTO_MESSAGES[type];
    } else {
      return NextResponse.json(
        { success: false, error: 'Message is required.' },
        { status: 400 }
      );
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

    // Broadcast push for actionable community post types.
    // 'general' posts are informational and discoverable via the board's
    // real-time listener — no push to avoid noise.
    //
    // All community posts use type: 'community' so the SW routes to the
    // community board. sourceType preserves the post origin for filtering.
    // The standalone parking-page alert (/api/parking/notify) keeps
    // type: 'parking' — that is a separate flow.
    const PUSH_FALLBACKS = {
      parking: 'An unfamiliar vehicle has been reported in the parking area.',
      laundry: 'A laundry update has been posted on the community board.',
      property_issue: 'A property issue has been reported. Check the community board.',
    };

    if (PUSH_FALLBACKS[type]) {
      // Use the guest's actual message for context; fall back to generic copy.
      const pushBody = message !== AUTO_MESSAGES[type]
        ? message.replace(/\s+/g, ' ').trim().slice(0, 100) + (message.length > 100 ? '...' : '')
        : PUSH_FALLBACKS[type];

      await broadcastToActiveGuests({
        title: PUSH_TITLES[type],
        body: pushBody,
        type: 'community',
        data: { postId: docRef.id, sourceType: type },
      });
    }

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
