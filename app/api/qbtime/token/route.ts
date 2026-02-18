import { NextResponse } from 'next/server';
import { getQBToken } from '@/utils/qbtoken';

// Returns whether a QB token is configured (never exposes the actual token).
export async function GET() {
  const token = getQBToken();
  return NextResponse.json({ configured: !!token });
}
