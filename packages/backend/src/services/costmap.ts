/**
 * Call cost computation — exact V1 logic from dtmf-monitor.py lines 2060-2138.
 * Queries pkg_prefix + pkg_rate for longest-prefix match rate lookup,
 * then computes cost using billing block formula.
 */

import { dbQuery } from '../db/mysql';

// Rate cache: "planId:prefix7" → { rate, initBlock, billingBlock, ts }
const rateCache = new Map<string, { rate: number; initBlock: number; billingBlock: number; ts: number }>();
const RATE_CACHE_TTL = 300_000; // 5 minutes (V1 line 195)

// Balance cache: sipUser → { credit, userId, idPlan, ts }
const balanceCache = new Map<string, { credit: number; userId: number; idPlan: number; ts: number }>();
const BALANCE_CACHE_TTL = 10_000; // 10 seconds (V1 line 197)

/**
 * Longest-prefix match rate lookup — V1 _lookup_rate (lines 2074-2101)
 */
async function lookupRate(idPlan: number, destination: string): Promise<{ rate: number; initBlock: number; billingBlock: number } | null> {
  const clean = destination.replace(/\D/g, '');
  if (!clean || !idPlan) return null;

  const cacheKey = `${idPlan}:${clean.slice(0, 7)}`;
  const now = Date.now();
  const cached = rateCache.get(cacheKey);
  if (cached && (now - cached.ts) < RATE_CACHE_TTL) return cached;

  try {
    // V1 SQL: longest prefix match using LIKE
    const rows = await dbQuery<any>(
      `SELECT p.id, p.prefix, r.rateinitial, r.initblock, r.billingblock
       FROM pkg_prefix p JOIN pkg_rate r ON r.id_prefix = p.id
       WHERE r.id_plan = ? AND ? LIKE CONCAT(p.prefix, '%')
       ORDER BY LENGTH(p.prefix) DESC LIMIT 1`,
      [idPlan, clean]
    );

    if (!rows.length) return null;

    const entry = {
      rate: parseFloat(rows[0].rateinitial) || 0,
      initBlock: Math.max(parseInt(rows[0].initblock) || 1, 1),
      billingBlock: Math.max(parseInt(rows[0].billingblock) || 1, 1),
      ts: now,
    };
    rateCache.set(cacheKey, entry);
    return entry;
  } catch (err) {
    console.error('[CostMap] Rate lookup error:', err);
    return null;
  }
}

/**
 * Bulk balance fetch — V1 _get_balances_bulk (lines 2104-2122)
 */
async function getBalancesBulk(sipUsers: string[]): Promise<Map<string, { credit: number; userId: number; idPlan: number }>> {
  const result = new Map<string, { credit: number; userId: number; idPlan: number }>();
  if (!sipUsers.length) return result;

  const now = Date.now();
  const toFetch: string[] = [];

  for (const sip of sipUsers) {
    const cached = balanceCache.get(sip);
    if (cached && (now - cached.ts) < BALANCE_CACHE_TTL) {
      result.set(sip, cached);
    } else {
      toFetch.push(sip);
    }
  }

  if (toFetch.length > 0) {
    try {
      const placeholders = toFetch.map(() => '?').join(',');
      const rows = await dbQuery<any>(
        `SELECT s.name, u.credit, u.id, u.id_plan
         FROM pkg_sip s JOIN pkg_user u ON s.id_user = u.id
         WHERE s.name IN (${placeholders})`,
        toFetch
      );
      for (const row of rows) {
        const entry = {
          credit: parseFloat(String(row.credit)) || 0,
          userId: row.id,
          idPlan: row.id_plan,
          ts: now,
        };
        balanceCache.set(row.name, entry);
        result.set(row.name, entry);
      }
    } catch (err) {
      console.error('[CostMap] Balance fetch error:', err);
    }
  }

  return result;
}

/**
 * Compute call cost — V1 _compute_call_cost (lines 2125-2138)
 * Uses billing block rounding: init_block minimum, then ceil to billing_block multiples
 */
function computeCallCost(durationSecs: number, rateInfo: { rate: number; initBlock: number; billingBlock: number }): number {
  if (!rateInfo || !durationSecs || durationSecs <= 0) return 0;

  const { rate, initBlock, billingBlock } = rateInfo;
  let billed: number;

  if (durationSecs <= initBlock) {
    billed = initBlock;
  } else {
    const remaining = durationSecs - initBlock;
    billed = initBlock + Math.ceil(remaining / billingBlock) * billingBlock;
  }

  return Math.round((billed / 60) * rate * 10000) / 10000; // 4 decimal places
}

/**
 * Build cost map for channels — V1 _build_cost_map (lines 1907-1958)
 * Returns: { sipUser: { cost, rate, balance } }
 */
export async function buildCostMap(
  channels: any[],
  allChannels?: any[]
): Promise<Record<string, { cost: number; rate: number; balance: number }>> {
  const costMap: Record<string, { cost: number; rate: number; balance: number }> = {};

  // Only for Up/answered channels
  const upChannels = channels.filter(ch => ch.state === 'answered' || ch.rawState === 'Up');
  if (!upChannels.length) return costMap;

  // Get unique SIP users
  const sipUsers = [...new Set(upChannels.map(ch => ch.sipUser).filter(Boolean))];
  const balances = await getBalancesBulk(sipUsers);

  for (const ch of upChannels) {
    const sipUser = ch.sipUser;
    if (!sipUser || costMap[sipUser]) continue; // One entry per SIP user

    const balInfo = balances.get(sipUser);
    if (!balInfo) continue;

    const exten = ch.calleeNum || ch.exten || '';
    if (!exten) continue;

    // Use bridge partner duration for accurate billing (V1 line 1934-1945)
    let duration = ch.duration || 0;
    if (ch.bridgedTo && allChannels) {
      for (const partner of allChannels) {
        if (partner.channel !== ch.id && partner.bridgeid === ch.bridgedTo) {
          const partnerDur = parseInt(partner.duration) || 0;
          if (partnerDur < duration) duration = partnerDur;
          break;
        }
      }
    }

    const rateInfo = await lookupRate(balInfo.idPlan, exten);
    if (!rateInfo) continue;

    const cost = computeCallCost(duration, rateInfo);
    costMap[sipUser] = {
      cost,
      rate: rateInfo.rate,
      balance: balInfo.credit,
    };
  }

  return costMap;
}
