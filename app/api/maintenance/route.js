import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

const VALID_CATEGORIES = ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Other'];
const VALID_URGENCIES = ['low', 'medium', 'high'];

// ---------------------------------------------------------------------------
// GET /api/maintenance
//
// Returns all maintenance requests ordered by createdAt descending.
//
// Returns:
//   { success: true, data: [...] }
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const snapshot = await adminDb
      .collection('maintenance')
      .orderBy('createdAt', 'desc')
      .get();

    const requests = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({ success: true, data: requests });
  } catch (error) {
    console.error('[GET /api/maintenance] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch maintenance requests.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/maintenance
//
// Creates a new maintenance request.
//
// Request body:
//   { category, urgency?, description, photoUrl?, bookingCode }
//
// Returns:
//   { success: true, data: { id, ...request } }  — HTTP 201
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const body = await request.json();
    const { category, urgency, description, photoUrl, bookingCode } = body;

    // Required field validation.
    if (!category || !description || !bookingCode) {
      return NextResponse.json(
        { success: false, error: 'category, description, and bookingCode are required.' },
        { status: 400 }
      );
    }

    // Category validation.
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        {
          success: false,
          error: `category must be one of: ${VALID_CATEGORIES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    // Urgency validation — default to 'medium' when omitted.
    const resolvedUrgency = urgency || 'medium';
    if (!VALID_URGENCIES.includes(resolvedUrgency)) {
      return NextResponse.json(
        {
          success: false,
          error: `urgency must be one of: ${VALID_URGENCIES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    const doc = {
      category,
      urgency: resolvedUrgency,
      description: String(description).trim(),
      photoUrl: photoUrl || null,
      bookingCode,
      status: 'open',
      createdAt: new Date().toISOString(),
      notes: '',
    };

    const docRef = await adminDb.collection('maintenance').add(doc);

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...doc } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/maintenance] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create maintenance request.' },
      { status: 500 }
    );
  }
}
