import { NextRequest, NextResponse } from 'next/server';
import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { TimesheetCreate, TimesheetUpdate } from '@/types/review';
import { jobcodeNamesFrom, mapTimesheet } from '@/utils/qbTimesheets';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/;

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
    const body = (await req.json()) as { entries?: TimesheetEntry[]; create?: TimesheetCreate };
    // Single entry from the Timesheet Editor (review mode)
    if (body.create) return createOne(body.create);
    const { entries } = body;

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: 'No timesheet entries provided' }, { status: 400 });
    }

    const headers = getQBHeaders();

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

// ─── PUT /api/qbtime/timesheets  TimesheetUpdate ─────────────────────
// Edits one existing timesheet (Timesheet Editor in review mode) and returns it re-read
// from QB, so the caller sees the date it actually landed on.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as TimesheetUpdate;
    const id = String(body?.id || '');
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'A timesheet id is required' }, { status: 400 });
    }

    const update: Record<string, unknown> = { id: Number(id) };
    if (body.start !== undefined) update.start = body.start;
    if (body.end !== undefined) update.end = body.end;
    if (body.date !== undefined) update.date = body.date;
    if (body.duration !== undefined) update.duration = Math.round(Number(body.duration));
    if (body.jobcodeId !== undefined) update.jobcode_id = Number(body.jobcodeId);
    if (body.notes !== undefined) update.notes = body.notes;
    if (body.customfields && Object.keys(body.customfields).length > 0) update.customfields = body.customfields;

    if (update.start !== undefined && !ISO_WITH_OFFSET.test(String(update.start))) {
      return NextResponse.json({ error: 'Time in must be an ISO 8601 date-time with offset' }, { status: 400 });
    }
    if (update.end !== undefined && update.end !== '' && !ISO_WITH_OFFSET.test(String(update.end))) {
      return NextResponse.json({ error: 'Time out must be an ISO 8601 date-time with offset' }, { status: 400 });
    }

    const headers = getQBHeaders();
    const res = await fetch(`${TSHEETS_BASE}/timesheets`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ data: [update] }),
    });
    const data = await res.json().catch(() => ({}));
    const result = Object.values(data?.results?.timesheets || {})[0] as any;
    if (!res.ok || !result || (result._status_code && result._status_code !== 200)) {
      const msg = result?._status_message || data?.error?.message || `HTTP ${res.status}`;
      const extra = result?._status_extra ? ` (${result._status_extra})` : '';
      console.error('[timesheets PUT] QB rejected update', JSON.stringify({ update, status: res.status, data }));
      return NextResponse.json({ error: `QuickBooks rejected the change: ${msg}${extra}` }, { status: 502 });
    }

    // Re-read so jobName / date / duration / state reflect what QB stored
    const params = new URLSearchParams({ ids: id, on_the_clock: 'both' });
    const getRes = await fetch(`${TSHEETS_BASE}/timesheets?${params}`, { headers });
    const getData = await getRes.json().catch(() => ({}));
    const raw = Object.values(getData?.results?.timesheets || {})[0] as any;
    const source = raw || result;
    const names = jobcodeNamesFrom(getData, jobcodeNamesFrom(data));
    return NextResponse.json({ timesheet: mapTimesheet(source, names) });
  } catch (err: any) {
    console.error('QB Time Timesheet update error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

/** POST { create } — one regular (time in/out) entry; returns it re-read from QB. */
async function createOne(c: TimesheetCreate) {
  if (!/^\d+$/.test(String(c?.userId || '')) || !/^\d+$/.test(String(c?.jobcodeId || ''))) {
    return NextResponse.json({ error: 'A tech and a job are required' }, { status: 400 });
  }
  if (!ISO_WITH_OFFSET.test(c.start || '') || !ISO_WITH_OFFSET.test(c.end || '')) {
    return NextResponse.json({ error: 'Time in and time out must be ISO 8601 date-times with offset' }, { status: 400 });
  }

  const entry: Record<string, unknown> = {
    user_id: Number(c.userId),
    jobcode_id: Number(c.jobcodeId),
    type: 'regular',
    start: c.start,
    end: c.end,
    notes: c.notes || '',
  };
  const cf = Object.fromEntries(Object.entries(c.customfields || {}).filter(([, v]) => v !== ''));
  if (Object.keys(cf).length > 0) entry.customfields = cf;

  const headers = getQBHeaders();
  const res = await fetch(`${TSHEETS_BASE}/timesheets`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data: [entry] }),
  });
  const data = await res.json().catch(() => ({}));
  const result = Object.values(data?.results?.timesheets || {})[0] as any;
  if (!res.ok || !result || (result._status_code && result._status_code !== 200 && result._status_code !== 201)) {
    const msg = result?._status_message || data?.error?.message || `HTTP ${res.status}`;
    const extra = result?._status_extra ? ` (${result._status_extra})` : '';
    console.error('[timesheets create] QB rejected entry', JSON.stringify({ entry, status: res.status, data }));
    return NextResponse.json({ error: `QuickBooks rejected the entry: ${msg}${extra}` }, { status: 502 });
  }

  const params = new URLSearchParams({ ids: String(result.id), on_the_clock: 'both' });
  const getRes = await fetch(`${TSHEETS_BASE}/timesheets?${params}`, { headers });
  const getData = await getRes.json().catch(() => ({}));
  const raw = Object.values(getData?.results?.timesheets || {})[0] as any;
  const names = jobcodeNamesFrom(getData, jobcodeNamesFrom(data));
  return NextResponse.json({ timesheet: mapTimesheet(raw || result, names) });
}
