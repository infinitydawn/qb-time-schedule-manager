import { NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

export async function POST() {
  try {
    const headers = getQBHeaders();

    // 1. Fetch all groups to find "PROJECT MANAGERS"
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

    // Find the project managers group (name configurable via env var)
    const pmGroupName = (process.env.QBTIME_PM_GROUP || 'PROJECT MANAGERS').toUpperCase();
    let pmGroupId: string | null = null;
    for (const [id, group] of Object.entries(groups) as [string, any][]) {
      if (group.name?.toUpperCase() === pmGroupName) {
        pmGroupId = id;
        break;
      }
    }

    if (!pmGroupId) {
      return NextResponse.json(
        { error: `Group "${pmGroupName}" not found`, availableGroups: Object.values(groups).map((g: any) => g.name) },
        { status: 404 }
      );
    }

    // 2. Fetch users in that group
    const usersRes = await fetch(
      `${TSHEETS_BASE}/users?group_ids=${pmGroupId}&active=yes`,
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

    // 3. Map to simple PM objects
    const pms = Object.values(users).map((u: any) => ({
      id: String(u.id),
      name: (u.display_name || `${u.first_name} ${u.last_name}`.trim()).toUpperCase(),
      firstName: u.first_name,
      lastName: u.last_name,
    }));

    return NextResponse.json({ pms, groupId: pmGroupId });
  } catch (err: any) {
    console.error('QB Time PMs API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
