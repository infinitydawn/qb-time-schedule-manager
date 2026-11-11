/**
 * Floor / Work Type are stored in QuickBooks Time schedule event notes as:
 *
 *   Floor: <floor info>,
 *   Work Type: <Work Type 1>, <Work Type 2>
 *
 * These helpers write that block and parse it back when schedules are pulled from QB.
 *
 * A job can have several work types. They're kept in the single `workType` field as a
 * comma-separated list ("Speakers Roughing, Devices Installation"), so work type names
 * themselves can't contain commas.
 */

export interface WorkNoteFields {
  floor: string;
  workType: string;
}

// Values must stay on one line or the line-based parser can't read them back.
const oneLine = (value?: string) => (value || '').replace(/[\r\n]+/g, ' ').trim();

/** "A, b ,, A" -> ["A", "b"] (trimmed, empties and case-insensitive duplicates dropped) */
export function splitWorkTypes(value?: string | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of oneLine(value || '').split(',')) {
    const name = part.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

export const joinWorkTypes = (names: string[]) => splitWorkTypes(names.join(',')).join(', ');

export function formatWorkNotes(floor?: string, workType?: string): string {
  const f = oneLine(floor);
  const w = joinWorkTypes(splitWorkTypes(workType));
  if (!f && !w) return '';
  return `Floor: ${f},\nWork Type: ${w}`;
}

/**
 * Returns the parsed fields, or null when the notes don't contain a Floor / Work Type block.
 * Accepts either line on its own, extra text around the block, CRLF line endings and
 * any capitalisation of the labels.
 */
export function parseWorkNotes(notes?: string | null): WorkNoteFields | null {
  if (!notes) return null;
  const text = notes.replace(/\r\n?/g, '\n');
  const floorMatch = text.match(/^[ \t]*Floor[ \t]*:[ \t]*(.*?)[ \t]*,?[ \t]*$/im);
  const typeMatch = text.match(/^[ \t]*Work[ \t]*Type[ \t]*:[ \t]*(.*?)[ \t]*,?[ \t]*$/im);
  if (!floorMatch && !typeMatch) return null;
  return {
    floor: floorMatch ? floorMatch[1].trim() : '',
    workType: typeMatch ? joinWorkTypes(splitWorkTypes(typeMatch[1])) : '',
  };
}

/**
 * Hash/fingerprint helper: only include floor/workType keys when set, so schedules
 * sent before these fields existed keep the same hash and don't get re-sent.
 */
export function workNoteHashFields(floor?: string, workType?: string): Partial<WorkNoteFields> {
  const out: Partial<WorkNoteFields> = {};
  const f = oneLine(floor);
  const w = joinWorkTypes(splitWorkTypes(workType));
  if (f) out.floor = f;
  if (w) out.workType = w;
  return out;
}
