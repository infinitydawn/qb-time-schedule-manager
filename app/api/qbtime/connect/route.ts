import { NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

/** Simple endpoint to verify the server-side token works against the TSheets API */
export async function POST() {
  try {
    const headers = getQBHeaders();

    const res = await fetch(`${TSHEETS_BASE}/current_user`, { headers });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Authentication failed: ${res.status} ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    const users = data.results?.users || {};
    const currentUser = Object.values(users)[0] as any;

    return NextResponse.json({
      connected: true,
      user: currentUser
        ? {
            id: currentUser.id,
            name: `${currentUser.first_name} ${currentUser.last_name}`.trim(),
            company: currentUser.company_name,
          }
        : null,
    });
  } catch (err: any) {
    console.error('QB Time connect error:', err);
    return NextResponse.json(
      { error: err.message || 'Connection failed' },
      { status: 500 }
    );
  }
}
