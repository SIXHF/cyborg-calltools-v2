/**
 * Channel enrichment service — fires async CNAM + fraud lookups
 * after get_channels, sends cnam_update message to the client.
 * Uses in-memory cache with 30-minute TTL for CNAM, 1-hour for fraud.
 */

import type { ServerWebSocket } from 'bun';
import { lookupCnam } from './cnam';
import { checkFraud } from './fraud';
import { readFile, writeFile } from 'fs/promises';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

// Cache file paths — shared with V1
const CNAM_CACHE_FILE = '/opt/cnam-cache.json';
const FRAUD_CACHE_FILE = '/opt/fraud-cache.json';

// CNAM cache: number -> { name, carrier, type, state, city, ts }
const cnamCache = new Map<string, { name: string; carrier?: string; type?: string; state?: string; city?: string; ts: number }>();
const CNAM_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days (match V1)

// Fraud cache: number -> { score, ts }
const fraudCache = new Map<string, { score: number; name?: string; ts: number }>();
const FRAUD_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Load caches from disk on startup
let cachesLoaded = false;
async function loadCachesFromDisk() {
  if (cachesLoaded) return;
  cachesLoaded = true;

  try {
    const raw = await readFile(CNAM_CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    let count = 0;
    for (const [num, entry] of Object.entries(data)) {
      const e = entry as any;
      cnamCache.set(num, {
        name: e.caller_name || e.name || '',
        carrier: e.carrier || '',
        type: e.carrier_type || e.type || '',
        state: e.state || '',
        city: e.city || '',
        ts: (e.ts || 0) * 1000, // V1 uses seconds, we use ms
      });
      count++;
    }
    console.log(`[Enrichment] Loaded ${count} CNAM cache entries from disk`);
  } catch (err) {
    console.log('[Enrichment] No CNAM cache file found, starting fresh');
  }

  try {
    const raw = await readFile(FRAUD_CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    let count = 0;
    for (const [num, entry] of Object.entries(data)) {
      const e = entry as any;
      fraudCache.set(num, {
        score: e.fraud_score ?? e.score ?? 0,
        name: e.name || '',
        ts: Date.now(), // No timestamp in V1 fraud cache, treat as fresh
      });
      count++;
    }
    console.log(`[Enrichment] Loaded ${count} fraud cache entries from disk`);
  } catch (err) {
    console.log('[Enrichment] No fraud cache file found, starting fresh');
  }
}

// Save CNAM cache to disk periodically
let lastCnamSave = 0;
async function saveCnamCache() {
  const now = Date.now();
  if (now - lastCnamSave < 60_000) return; // Max once per minute
  lastCnamSave = now;
  try {
    const obj: Record<string, any> = {};
    for (const [num, entry] of cnamCache) {
      obj[num] = {
        caller_name: entry.name,
        carrier: entry.carrier,
        carrier_type: entry.type,
        state: entry.state,
        city: entry.city,
        ts: entry.ts / 1000, // Back to seconds for V1 compat
      };
    }
    await writeFile(CNAM_CACHE_FILE, JSON.stringify(obj));
  } catch {}
}

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

  // Load V1 caches on first call
  await loadCachesFromDisk();

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

    // Run all lookups in parallel
    await Promise.allSettled(lookups);

    // Persist cache to disk
    saveCnamCache().catch(() => {});
  }

  // Lookup fraud for caller numbers only (parallel)
  if (canFraud) {
    const callerNums = [...new Set(
      channels.filter(ch => ch.callerNum).map(ch => normalize(ch.callerNum)).filter(n => n.length >= 10)
    )];

    const fraudLookups = callerNums.map(async (num) => {
      const cached = fraudCache.get(num);
      if (cached && (now - cached.ts) < FRAUD_CACHE_TTL) {
        if (!cnamMap[num]) cnamMap[num] = {};
        cnamMap[num].fraud_score = cached.score;
        return;
      }
      if (inFlightFraud.has(num)) return;
      inFlightFraud.add(num);
      try {
        const result = await checkFraud(num);
        fraudCache.set(num, { score: result.score, ts: now });
        if (!cnamMap[num]) cnamMap[num] = {};
        cnamMap[num].fraud_score = result.score;
      } catch {} finally { inFlightFraud.delete(num); }
    });
    await Promise.allSettled(fraudLookups);

    // Save fraud cache to disk
    try {
      const obj: Record<string, any> = {};
      for (const [num, entry] of fraudCache) {
        obj[num] = { fraud_score: entry.score, name: entry.name || '' };
      }
      await writeFile(FRAUD_CACHE_FILE, JSON.stringify(obj));
    } catch {}
  }

  // Only send if we have data
  if (Object.keys(cnamMap).length === 0) return;

  try {
    send(ws, {
      type: 'cnam_update',
      cnam_map: cnamMap,
    });
  } catch {
    // Client disconnected
  }
}
