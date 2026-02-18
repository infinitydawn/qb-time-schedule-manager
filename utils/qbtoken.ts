/**
 * Server-side only: returns the QB Time API token from environment variables.
 * Never expose this to the frontend.
 */
export function getQBToken(): string | null {
  return process.env.QBTIME_TOKEN || null;
}

export const TSHEETS_BASE = process.env.TSHEETS_BASE_URL || 'https://rest.tsheets.com/api/v1';

/**
 * Build standard Authorization headers for TSheets API calls.
 * Throws if no token is configured.
 */
export function getQBHeaders(): Record<string, string> {
  const token = getQBToken();
  if (!token) {
    throw new Error('QBTIME_TOKEN environment variable is not set');
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}
