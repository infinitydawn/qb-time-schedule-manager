import { NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

export async function POST() {
  try {
    const headers = getQBHeaders();

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
