import { NextRequest, NextResponse } from 'next/server';

const TSHEETS_BASE = 'https://rest.tsheets.com/api/v1';

/** Simple endpoint to verify a token works against the TSheets API */
export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'API token is required' }, { status: 400 });
    }

    const res = await fetch(`${TSHEETS_BASE}/current_user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

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
