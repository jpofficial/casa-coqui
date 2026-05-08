import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ success: true, data: [] });
}

export async function POST(request) {
  return NextResponse.json({ success: true, data: {} });
}
