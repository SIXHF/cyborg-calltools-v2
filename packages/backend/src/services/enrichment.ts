/**
 * Channel enrichment service — fires async CNAM + fraud lookups
 * after get_channels, sends cnam_update message to the client.
 * Uses in-memory cache with 30-minute TTL for CNAM, 1-hour for fraud.
 */

import type { ServerWebSocket } from 'bun';
import { lookupCnam } from './cnam';
import { checkFraud } from './fraud';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

// CNAM cache: number -> { name, carrier, type, state, city, ts }
const cnamCache = new Map<string, { name: string; carrier?: string; type?: string; state?: string; city?: string; ts: number }>();
const CNAM_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Fraud cache: number -> { score, ts }
const fraudCache = new Map<string, { score: number; ts: number }>();
const FRAUD_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// In-flight dedup: prevent multiple lookups for same number
const inFlightCnam = new Set<string>();
const inFlightFraud = new Set<string>();

/** Normalize phone number for cache key */
function normalize(num: string): string {
  const clean = num.replace(/\D/g, '');
  if (clean.length === 10) return '1' + clean;
  return clean;
}

/** Generic CNAM values to filter out */
const GENERIC_CNAM = new Set([
  'WIRELESS CALLER', 'TOLL FREE', 'TOLLFREE NUMBER', 'TOLL FREE NUMBER',
  'UNAVAILABLE', 'UNKNOWN', 'UNKNOWN NAME', 'NO NAME', 'CALLER',
  'WIRELESS', 'LANDLINE', 'VOIP', 'CELL PHONE', 'MOBILE',
]);

/**
 * Fire async CNAM + fraud lookups for channel numbers, then send cnam_update.
 * Non-blocking — call this after sending channel_update.
 */
export async function enrichChannels(
  ws: ServerWebSocket<any>,
  send: SendFn,
  channels: any[],
  canCnam: boolean,
  canFraud: boolean,
) {
  if (!canCnam && !canFraud) return;
  if (!channels || channels.length === 0) return;

  // Collect unique numbers to look up
  const numbers = new Set<string>();
  for (const ch of channels) {
    if (ch.callerNum) numbers.add(normalize(ch.callerNum));
    if (ch.calleeNum) numbers.add(normalize(ch.calleeNum));
  }

  // Filter out short internal extensions
  const toLookup = [...numbers].filter(n => n.length >= 10);
  if (toLookup.length === 0) return;

  const cnamMap: Record<string, any> = {};
  const now = Date.now();

  // Lookup CNAM for each number (cached or fresh)
  if (canCnam) {
    const lookups = toLookup.map(async (num) => {
      // Check cache
      const cached = cnamCache.get(num);
      if (cached && (now - cached.ts) < CNAM_CACHE_TTL) {
        cnamMap[num] = cached;
        return;
      }

      // Dedup in-flight
      if (inFlightCnam.has(num)) return;
      inFlightCnam.add(num);

      try {
        const result = await lookupCnam(num);
        const entry = {
          name: result.name && !GENERIC_CNAM.has(result.name.toUpperCase().trim()) ? result.name : '',
          carrier: result.carrier || '',
          type: result.type || '',
          state: result.state || '',
          city: result.city || '',
          ts: now,
        };
        cnamCache.set(num, entry);
        cnamMap[num] = entry;
      } catch {
        // Silently skip failed lookups
      } finally {
        inFlightCnam.delete(num);
      }
    });

    // Run all lookups in parallel (with a concurrency limit)
    await Promise.allSettled(lookups);
  }

  // Lookup fraud for caller numbers only
  if (canFraud) {
    const callerNums = channels
      .filter(ch => ch.callerNum)
      .map(ch => normalize(ch.callerNum))
      .filter(n => n.length >= 10);

    for (const num of callerNums) {
      const cached = fraudCache.get(num);
      if (cached && (now - cached.ts) < FRAUD_CACHE_TTL) {
        if (!cnamMap[num]) cnamMap[num] = {};
        cnamMap[num].fraud_score = cached.score;
        continue;
      }

      if (inFlightFraud.has(num)) continue;
      inFlightFraud.add(num);

      try {
        const result = await checkFraud(num);
        fraudCache.set(num, { score: result.score, ts: now });
        if (!cnamMap[num]) cnamMap[num] = {};
        cnamMap[num].fraud_score = result.score;
      } catch {
        // Skip
      } finally {
        inFlightFraud.delete(num);
      }
    }
  }

  // Only send if we have data
  if (Object.keys(cnamMap).length === 0) return;

  try {
    send(ws, {
      type: 'cnam_update' as any,
      cnam_map: cnamMap,
    } as any);
  } catch {
    // Client disconnected
  }
}
