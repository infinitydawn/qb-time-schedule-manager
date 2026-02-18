import { NextRequest, NextResponse } from 'next/server';

const TSHEETS_BASE = 'https://rest.tsheets.com/api/v1';

export async function POST(req: NextRequest) {
  try {
    const { token } = (await req.json()) as { token: string };

    if (!token) {
      return NextResponse.json({ error: 'API token is required' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // 1. Fetch all custom fields
    const fieldsRes = await fetch(`${TSHEETS_BASE}/customfields`, { headers });
    const fieldsData = await fieldsRes.json();

    if (!fieldsRes.ok) {
      return NextResponse.json(
        { error: `Failed to fetch custom fields: ${fieldsRes.status}` },
        { status: fieldsRes.statusText ? 500 : fieldsRes.status }
      );
    }

    const rawFields = fieldsData.results?.customfields || {};
    const fields = Object.values(rawFields).map((f: any) => ({
      id: String(f.id),
      name: f.name,
      required: f.required || false,
      type: f.ui_preference, // "drop_down", "text", etc
      appliesToJobcodes: f.applies_to || 'both',
    }));

    // 2. Fetch custom field items (dropdown options) for each field
    const fieldsWithItems = await Promise.all(
      fields.map(async (field: any) => {
        const itemsRes = await fetch(
          `${TSHEETS_BASE}/customfielditems?customfield_id=${field.id}`,
          { headers }
        );
        const itemsData = await itemsRes.json();
        const rawItems = itemsData.results?.customfielditems || {};
        const items = Object.values(rawItems).map((item: any) => ({
          id: String(item.id),
          name: item.name,
          active: item.active,
        })).filter((item: any) => item.active);

        return { ...field, items };
      })
    );

    return NextResponse.json({ customFields: fieldsWithItems });
  } catch (err: any) {
    console.error('QB Time Custom Fields API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
