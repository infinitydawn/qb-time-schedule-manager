import { NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';

export async function POST() {
  try {
    const headers = getQBHeaders();

    // Fetch active jobcodes (active=yes), page through results
    let allJobs: any[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const res = await fetch(
        `${TSHEETS_BASE}/jobcodes?active=yes&page=${page}`,
        { headers }
      );

      if (!res.ok) {
        const text = await res.text();
        return NextResponse.json(
          { error: `Failed to fetch jobcodes: ${res.status} ${text}` },
          { status: res.status }
        );
      }

      const data = await res.json();
      const jobcodes = data.results?.jobcodes || {};
      const items = Object.values(jobcodes);

      if (items.length === 0) {
        hasMore = false;
      } else {
        allJobs = allJobs.concat(items);
        // TSheets default page size is 50; if we got fewer, we're done
        if (items.length < 50) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Map to simple job objects
    const jobs = allJobs.map((j: any) => ({
      id: String(j.id),
      name: j.name,
      parentId: j.parent_id ? String(j.parent_id) : null,
      type: j.type, // 'regular' or 'pto' or 'unpaid_break' etc.
    }));

    return NextResponse.json({ jobs });
  } catch (err: any) {
    console.error('QB Time Jobs API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
