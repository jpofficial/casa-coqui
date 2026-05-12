import { NextResponse } from 'next/server';
import { getFirestore } from 'firebase-admin/firestore';
import { requireRole } from '@/lib/api-auth';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

// F14: this route runs on Vercel, NOT Cloud Functions. It constructs its own
// SFN client — does NOT import functions/lib/aws-sfn-bridge (ESLint blocks
// that import; the bridge module reads Firebase secrets, not Vercel env).

const COOLDOWN_MS = 30_000;
const MAX_REGEN = 3;

let _sfn = null;
function getSfn() {
  if (_sfn) return _sfn;
  _sfn = new SFNClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.BRIDGE_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.BRIDGE_AWS_SECRET_ACCESS_KEY,
    },
  });
  return _sfn;
}

export async function POST(req, { params }) {
  const auth = await requireRole(req, ['admin', 'cohost']);
  if (!auth.ok) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });

  const messageId = params.id;
  const db = getFirestore();
  const ref = db.collection('airbnb_messages').doc(messageId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ success: false, error: 'not_found' }, { status: 404 });

  const cur = snap.data();
  const agentRun = cur._agentRun || {};
  if ((agentRun.regenerateCount || 0) >= MAX_REGEN) {
    return NextResponse.json({ success: false, error: 'rate_limit_count' }, { status: 429 });
  }
  if (agentRun.lastRegenerateAt) {
    const last = agentRun.lastRegenerateAt.toMillis ? agentRun.lastRegenerateAt.toMillis() : new Date(agentRun.lastRegenerateAt).getTime();
    if (Date.now() - last < COOLDOWN_MS) {
      return NextResponse.json({ success: false, error: 'rate_limit_cooldown' }, { status: 429 });
    }
  }

  const stateMachineArn = process.env.REPLY_DRAFT_STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    return NextResponse.json({ success: false, error: 'missing_sfn_arn' }, { status: 500 });
  }

  const input = {
    message: {
      id: messageId,
      body: cur.body,
      guestName: cur.guestName,
      threadKey: cur.threadKey,
    },
    _routedBy: 'regenerate',
  };

  let executionArn = null;
  try {
    const out = await getSfn().send(new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(input),
    }));
    executionArn = out.executionArn;
  } catch (e) {
    return NextResponse.json({ success: false, error: 'sfn_start_failed', message: e.message }, { status: 502 });
  }

  await ref.update({
    '_agentRun.regenerateCount': (agentRun.regenerateCount || 0) + 1,
    '_agentRun.lastRegenerateAt': new Date(),
    '_agentRun.routedBy': 'regenerate',
    draftStatus: 'pending',
  });

  return NextResponse.json({ success: true, data: { executionArn } });
}
