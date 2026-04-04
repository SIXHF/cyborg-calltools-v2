const TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? '';

export interface CnamLookupResult {
  name: string;
  carrier?: string;
  type?: string;
}

/**
 * Lookup CNAM (Caller Name) via Telnyx API.
 */
export async function lookupCnam(phoneNumber: string): Promise<CnamLookupResult> {
  if (!TELNYX_API_KEY) {
    return { name: 'CNAM not configured' };
  }

  // Normalize to E.164
  const normalized = phoneNumber.replace(/\D/g, '');
  if (normalized.length < 10) {
    return { name: 'Invalid number' };
  }

  try {
    const e164 = normalized.startsWith('1') ? `+${normalized}` : `+1${normalized}`;
    const response = await fetch(
      `https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(e164)}`,
      {
        headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      return { name: 'Lookup failed' };
    }

    const data = await response.json() as {
      data: {
        caller_name?: { caller_name?: string };
        carrier?: { name?: string; type?: string };
      };
    };

    return {
      name: data.data.caller_name?.caller_name ?? 'Unknown',
      carrier: data.data.carrier?.name,
      type: data.data.carrier?.type,
    };
  } catch {
    return { name: 'Lookup timeout' };
  }
}
