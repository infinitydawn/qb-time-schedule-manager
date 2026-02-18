import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

export async function POST(req: NextRequest) {
  try {
    const { customfield_id } = (await req.json()) as {
      customfield_id: string;
    };

    if (!customfield_id) {
      return NextResponse.json({ error: 'customfield_id is required' }, { status: 400 });
    }

    const headers = getQBHeaders();

    // Fetch all items for this custom field, paginating if needed
    let allItems: any[] = [];
    let page = 1;
    let more = true;

    while (more) {
      const res = await fetch(
        `${TSHEETS_BASE}/customfielditems?customfield_id=${customfield_id}&limit=200&page=${page}&active=both`,
        { headers }
      );
      const data = await res.json();

      if (!res.ok) {
        return NextResponse.json(
          { error: `TSheets error: ${res.status}`, details: data },
          { status: res.status }
        );
      }

      const rawItems = data.results?.customfielditems || {};
      const items = Object.values(rawItems).map((item: any) => ({
        id: String(item.id),
        customfield_id: String(item.customfield_id),
        name: item.name,
        short_code: item.short_code || '',
        active: item.active,
        last_modified: item.last_modified,
      }));

      allItems = allItems.concat(items);
      more = data.more === true;
      page++;
    }

    return NextResponse.json({ items: allItems, total: allItems.length });
  } catch (err: any) {
    console.error('QB Time Custom Field Items API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
