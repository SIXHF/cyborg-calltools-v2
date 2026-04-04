const TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? '';

export interface CnamLookupResult {
  name: string;
  carrier?: string;
  type?: string;
  state?: string;
  city?: string;
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
    const clean = normalized.startsWith('1') ? normalized : `1${normalized}`;
    const url = `https://api.telnyx.com/v2/number_lookup/+${clean}?type=carrier&type=caller-name&type=portability`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      console.error(`[CNAM] Telnyx API ${response.status}: ${await response.text().catch(() => '')}`);
      return { name: 'Lookup failed' };
    }

    const body = await response.json() as {
      data: {
        caller_name?: { caller_name?: string };
        carrier?: { name?: string; normalized_carrier?: string; type?: string };
        portability?: { state?: string; city?: string };
      };
    };

    const d = body.data;
    const rawCnam = d.caller_name?.caller_name ?? '';
    const rawCarrier = d.carrier?.normalized_carrier || d.carrier?.name || '';
    const carrierType = d.carrier?.type || '';

    // Filter generic CNAM values
    const genericNames = new Set([
      'WIRELESS CALLER', 'TOLL FREE', 'TOLLFREE NUMBER', 'TOLL FREE NUMBER',
      'UNAVAILABLE', 'UNKNOWN', 'UNKNOWN NAME', 'NO NAME', 'CALLER',
      'WIRELESS', 'LANDLINE', 'VOIP', 'CELL PHONE', 'MOBILE',
    ]);
    const name = genericNames.has(rawCnam.toUpperCase().trim()) ? '' : rawCnam;

    return {
      name: name || '',
      carrier: rawCarrier,
      type: carrierType,
      state: d.portability?.state,
      city: d.portability?.city,
    };
  } catch {
    return { name: 'Lookup timeout' };
  }
}
