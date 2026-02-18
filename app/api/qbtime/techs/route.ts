import { NextRequest, NextResponse } from 'next/server';

const TSHEETS_BASE = 'https://rest.tsheets.com/api/v1';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token) {
      return NextResponse.json({ error: 'API token is required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // 1. Fetch all groups to find "TECHNICIANS"
    const groupsRes = await fetch(`${TSHEETS_BASE}/groups`, { headers });
    if (!groupsRes.ok) {
      const text = await groupsRes.text();
      return NextResponse.json(
        { error: `Failed to fetch groups: ${groupsRes.status} ${text}` },
        { status: groupsRes.status }
      );
    }

    const groupsData = await groupsRes.json();
    const groups = groupsData.results?.groups || {};

    // Find the "TECHNICIANS" group (case-insensitive)
    let techGroupId: string | null = null;
    for (const [id, group] of Object.entries(groups) as [string, any][]) {
      if (group.name?.toUpperCase() === 'TECHNICIANS') {
        techGroupId = id;
        break;
      }
    }

    if (!techGroupId) {
      return NextResponse.json(
        { error: 'Group "TECHNICIANS" not found', availableGroups: Object.values(groups).map((g: any) => g.name) },
        { status: 404 }
      );
    }

    // 2. Fetch users in that group
    const usersRes = await fetch(
      `${TSHEETS_BASE}/users?group_ids=${techGroupId}&active=yes`,
      { headers }
    );
    if (!usersRes.ok) {
      const text = await usersRes.text();
      return NextResponse.json(
        { error: `Failed to fetch users: ${usersRes.status} ${text}` },
        { status: usersRes.status }
      );
    }

    const usersData = await usersRes.json();
    const users = usersData.results?.users || {};

    // 3. Map to simple tech objects
    const techs = Object.values(users).map((u: any) => ({
      id: String(u.id),
      name: u.display_name || `${u.first_name} ${u.last_name}`.trim(),
      firstName: u.first_name,
      lastName: u.last_name,
    }));

    return NextResponse.json({ techs, groupId: techGroupId });
  } catch (err: any) {
    console.error('QB Time Techs API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
