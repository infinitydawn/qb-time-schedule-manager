import { NextRequest, NextResponse } from 'next/server';

const TSHEETS_BASE = 'https://rest.tsheets.com/api/v1';

interface TimesheetEntry {
  user_id: number;
  jobcode_id: number;
  type: string;
  start: string;
  end: string;
  notes: string;
  date: string;
  customfields?: Record<string, string>;
}

export async function POST(req: NextRequest) {
  try {
    const { token, entries } = (await req.json()) as {
      token: string;
      entries: TimesheetEntry[];
    };

    if (!token) {
      return NextResponse.json({ error: 'API token is required' }, { status: 400 });
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: 'No timesheet entries provided' }, { status: 400 });
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // --- Step 1: Fetch ALL custom fields ---
    const fieldsRes = await fetch(`${TSHEETS_BASE}/customfields`, { headers });
    const fieldsData = await fieldsRes.json();
    const rawFields = fieldsData.results?.customfields || {};
    const allFields = Object.values(rawFields) as any[];

    console.log('[timesheets] Custom fields found:', allFields.map((f: any) => ({
      id: f.id, name: f.name, required: f.required, type: f.type, applies_to: f.applies_to
    })));

    // --- Step 2: For each timesheet custom field, fetch items and find "(none)" ---
    const cfMap: Record<string, string> = {};

    for (const field of allFields) {
      if (field.applies_to !== 'timesheet') continue;

      if (field.type === 'managed-list') {
        const itemsRes = await fetch(
          `${TSHEETS_BASE}/customfielditems?customfield_id=${field.id}`,
          { headers }
        );
        const itemsData = await itemsRes.json();
        const rawItems = itemsData.results?.customfielditems || {};
        const items = Object.values(rawItems) as any[];

        console.log(`[timesheets] Field "${field.name}" (${field.id}) items:`,
          items.filter((i: any) => i.active).map((i: any) => ({ id: i.id, name: i.name }))
        );

        // Find "(none)" or "none" or "N/A" item
        const noneItem = items.find((i: any) =>
          i.active && (
            i.name.toLowerCase() === '(none)' ||
            i.name.toLowerCase() === 'none' ||
            i.name.toLowerCase() === 'n/a' ||
            i.name.trim() === ''
          )
        );

        if (noneItem) {
          cfMap[String(field.id)] = String(noneItem.id);
          console.log(`[timesheets] → Using "${noneItem.name}" (${noneItem.id}) for field "${field.name}"`);
        } else {
          console.warn(`[timesheets] → No "(none)" item found for "${field.name}"! Will try empty string.`);
          cfMap[String(field.id)] = '';
        }
      } else {
        // free-form text field — pass empty string
        cfMap[String(field.id)] = '';
        console.log(`[timesheets] Field "${field.name}" (${field.id}) is free-form, using ""`);
      }
    }

    console.log('[timesheets] Final customfields map:', cfMap);

    // --- Step 3: Inject customfields into every entry ---
    const enrichedEntries = entries.map((entry) => {
      const { customfields: clientCF, ...rest } = entry;
      return {
        ...rest,
        customfields: { ...cfMap, ...(clientCF && Object.keys(clientCF).length > 0 ? clientCF : {}) },
      };
    });

    console.log('[timesheets] Enriched entries:', JSON.stringify(enrichedEntries, null, 2));

    // --- Step 4: Send to TSheets in batches of 50 ---
    const BATCH_SIZE = 50;
    const results: any[] = [];
    const errors: any[] = [];

    for (let i = 0; i < enrichedEntries.length; i += BATCH_SIZE) {
      const batch = enrichedEntries.slice(i, i + BATCH_SIZE);

      const res = await fetch(`${TSHEETS_BASE}/timesheets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: batch }),
      });

      const data = await res.json();
      console.log('[timesheets] TSheets response:', res.status, JSON.stringify(data, null, 2));

      if (!res.ok) {
        errors.push({ batch: i / BATCH_SIZE + 1, status: res.status, error: data });
        continue;
      }

      const timesheets = data.results?.timesheets || {};
      for (const [key, ts] of Object.entries(timesheets) as [string, any][]) {
        if (ts._status_code === 200 || ts._status_code === 201) {
          results.push({ id: ts.id, user_id: ts.user_id, status: 'ok' });
        } else {
          errors.push({ key, status: ts._status_code, message: ts._status_message, extra: ts._status_extra });
        }
      }
    }

    return NextResponse.json({
      created: results.length,
      failed: errors.length,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error('QB Time Timesheets API error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
