import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { requireRole } from '@/lib/api-auth';

// ---------------------------------------------------------------------------
// GET /api/supplies
// Returns all supplies ordered by name ascending.
// Requires admin role.
//
// Returns:
//   { success: true, data: [...supplies] }
// ---------------------------------------------------------------------------
export async function GET(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const snapshot = await adminDb.collection('supplies').orderBy('name', 'asc').get();
    const supplies = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({ success: true, data: supplies });
  } catch (error) {
    console.error('[GET /api/supplies]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch supplies.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/supplies
// Creates a new supply entry.
//
// Request body:
//   { name, quantity, minimum, amazonUrl, autoReorder }
//
// Returns:
//   { success: true, data: { id, ...supply } }  — HTTP 201
// ---------------------------------------------------------------------------
export async function POST(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { name, quantity, minimum, amazonUrl, autoReorder } = body;

    if (!name || quantity === undefined || quantity === null) {
      return NextResponse.json(
        { success: false, error: 'name and quantity are required.' },
        { status: 400 }
      );
    }

    const parsedQty = Number(quantity);
    if (isNaN(parsedQty) || parsedQty < 0) {
      return NextResponse.json(
        { success: false, error: 'quantity must be a non-negative number.' },
        { status: 400 }
      );
    }

    const parsedMin = minimum !== undefined && minimum !== null ? Number(minimum) : 0;
    if (isNaN(parsedMin) || parsedMin < 0) {
      return NextResponse.json(
        { success: false, error: 'minimum must be a non-negative number.' },
        { status: 400 }
      );
    }

    const supply = {
      name: String(name).trim(),
      quantity: parsedQty,
      minimum: parsedMin,
      amazonUrl: amazonUrl ? String(amazonUrl).trim() : '',
      autoReorder: Boolean(autoReorder),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const docRef = await adminDb.collection('supplies').add(supply);

    return NextResponse.json(
      { success: true, data: { id: docRef.id, ...supply } },
      { status: 201 }
    );
  } catch (error) {
    console.error('[POST /api/supplies]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create supply.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/supplies
// Partially updates an existing supply.
//
// Request body:
//   { id, ...fieldsToUpdate }
//
// Returns:
//   { success: true, data: { id, ...updatedFields } }
// ---------------------------------------------------------------------------
export async function PATCH(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required.' },
        { status: 400 }
      );
    }

    const allowedFields = ['name', 'quantity', 'minimum', 'amazonUrl', 'autoReorder'];
    const updates = {};

    for (const key of allowedFields) {
      if (fields[key] !== undefined) {
        if (key === 'quantity' || key === 'minimum') {
          const parsed = Number(fields[key]);
          if (isNaN(parsed) || parsed < 0) {
            return NextResponse.json(
              { success: false, error: `${key} must be a non-negative number.` },
              { status: 400 }
            );
          }
          updates[key] = parsed;
        } else if (key === 'autoReorder') {
          updates[key] = Boolean(fields[key]);
        } else {
          updates[key] = String(fields[key]).trim();
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update.' },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date().toISOString();

    await adminDb.collection('supplies').doc(id).update(updates);

    return NextResponse.json({ success: true, data: { id, ...updates } });
  } catch (error) {
    console.error('[PATCH /api/supplies]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update supply.' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/supplies
// Deletes a supply by ID.
//
// Request body:
//   { id }
//
// Returns:
//   { success: true }
// ---------------------------------------------------------------------------
export async function DELETE(request) {
  try {
    const { error: authError } = await requireRole(request, ['admin']);
    if (authError) return authError;

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required.' },
        { status: 400 }
      );
    }

    await adminDb.collection('supplies').doc(id).delete();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/supplies]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete supply.' },
      { status: 500 }
    );
  }
}
