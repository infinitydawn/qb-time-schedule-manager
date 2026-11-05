import { getQBHeaders, TSHEETS_BASE } from '@/utils/qbtoken';
import { ReviewUser } from '@/types/review';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QB Time returns "0000-00-00" when a user has never submitted / been approved.
const cleanDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.startsWith('0000') ? d : '');

export function toReviewUser(u: any): ReviewUser {
  return {
    id: String(u.id),
    name: u.display_name || `${u.first_name || ''} ${u.last_name || ''}`.trim(),
    approvedTo: cleanDate(u.approved_to),
    submittedTo: cleanDate(u.submitted_to),
    mobile: !!u.permissions?.mobile,
    timeTracking: !!u.permissions?.time_tracking,
  };
}

/** GET /users?ids=... (active and inactive), paged. */
export async function fetchUsersByIds(ids: string[]): Promise<Record<string, ReviewUser>> {
  const out: Record<string, ReviewUser> = {};
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const headers = getQBHeaders();
  // Keep URLs short: chunk the id list.
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    let page = 1;
    let more = true;
    while (more) {
      const params = new URLSearchParams({
        ids: chunk.join(','),
        active: 'both',
        limit: '200',
        page: String(page),
      });
      const res = await fetch(`${TSHEETS_BASE}/users?${params}`, { headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(`QuickBooks users error ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
      }
      for (const u of Object.values(data.results?.users || {}) as any[]) {
        out[String(u.id)] = toReviewUser(u);
      }
      more = !!data.more;
      page++;
    }
  }
  return out;
}

/** PUT /users with a single user update; throws with QB's per-item message on failure. */
export async function updateUser(update: Record<string, unknown>): Promise<void> {
  const headers = getQBHeaders();
  const res = await fetch(`${TSHEETS_BASE}/users`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ data: [update] }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`QuickBooks error ${res.status}: ${data?.error?.message || JSON.stringify(data)}`);
  }
  const results = Object.values(data.results?.users || {}) as any[];
  const failed = results.find(r => r._status_code && r._status_code !== 200);
  if (failed) {
    const extra = failed._status_extra ? ` (${failed._status_extra})` : '';
    throw new Error(`${failed._status_message || 'Update failed'}${extra}`);
  }
}

export const dayBefore = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
};
