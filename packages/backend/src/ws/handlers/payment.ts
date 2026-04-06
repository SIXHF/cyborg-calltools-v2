import type { ServerWebSocket } from 'bun';
import { dbQuery } from '../../db/mysql';
import { auditLog } from '../../audit/logger';
import { createHash } from 'crypto';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

/** Cached Heleket credentials */
let heleketCache: { merchantId: string; apiKey: string; time: number } | null = null;

async function getHeleketCredentials(): Promise<{ merchantId: string; apiKey: string } | null> {
  const now = Date.now();
  if (heleketCache && now - heleketCache.time < 300_000) {
    return heleketCache;
  }

  const rows = await dbQuery<any>(
    "SELECT client_id, client_secret FROM pkg_method_pay WHERE payment_method = 'Heleket' LIMIT 1"
  );
  if (!rows.length || !rows[0].client_id || !rows[0].client_secret) return null;

  heleketCache = {
    merchantId: rows[0].client_id,
    apiKey: rows[0].client_secret,
    time: now,
  };
  return heleketCache;
}

/** Compute Heleket API signature: md5(base64(json_body) + api_key) */
function heleketSign(jsonBody: string, apiKey: string): string {
  const encoded = Buffer.from(jsonBody, 'utf-8').toString('base64');
  return createHash('md5').update(encoded + apiKey).digest('hex');
}

/** Broadcast function — set from router */
let _broadcastFn: ((msg: any) => void) | null = null;
export function setPaymentBroadcast(fn: (msg: any) => void) { _broadcastFn = fn; }

export async function handleCreatePayment(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const amount = parseFloat(msg.amount);
  if (isNaN(amount) || amount < 50 || amount > 10000) {
    send(ws, { type: 'error', message: 'Amount must be between $50 and $10,000.', code: 'INVALID_INPUT' });
    return;
  }

  const creds = await getHeleketCredentials();
  if (!creds) {
    send(ws, { type: 'error', message: 'Payment method not configured.', code: 'NOT_CONFIGURED' });
    return;
  }

  const orderId = `${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}-${session.username}-${session.userId ?? 0}`;
  const formattedAmount = amount.toFixed(2);

  const body: Record<string, any> = {
    amount: formattedAmount,
    currency: 'USDT',
    order_id: orderId,
    url_callback: 'https://sip.osetec.net/mbilling/index.php/heleket',
    url_success: 'https://sip.osetec.net/beta/',
    url_return: 'https://sip.osetec.net/beta/',
    is_payment_multiple: false,
    lifetime: 3600,
    subtract: 100,
  };

  // Match PHP json_encode: compact, escaped slashes
  let jsonBody = JSON.stringify(body);
  jsonBody = jsonBody.replace(/\//g, '\\/');

  const sign = heleketSign(jsonBody, creds.apiKey);

  try {
    const response = await fetch('https://api.heleket.com/v1/payment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        merchant: creds.merchantId,
        sign,
      },
      body: jsonBody,
      signal: AbortSignal.timeout(30_000),
    });

    const result = await response.json() as any;

    if (result?.result?.url) {
      auditLog(session.username, session.role, session.ip, 'create_payment', orderId, formattedAmount);
      send(ws, {
        type: 'payment_created',
        payment_url: result.result.url,
        order_id: orderId,
        amount: formattedAmount,
      });
      // V1 line 5941-5953: notify admin sessions about new invoice
      if (_broadcastFn) {
        _broadcastFn({
          type: 'admin_billing_alert',
          event: 'invoice_created',
          username: session.username || session.sipUser || 'unknown',
          amount: parseFloat(formattedAmount),
          order_id: orderId,
        });
      }
    } else {
      const errorMsg = result?.message || 'Unknown error';
      console.error('[Payment] Heleket error:', JSON.stringify(result));
      send(ws, { type: 'error', message: `Invoice creation failed: ${errorMsg}`, code: 'PAYMENT_ERROR' });
    }
  } catch (err) {
    console.error('[Payment] Heleket request failed:', err);
    send(ws, { type: 'error', message: 'Payment service unavailable.', code: 'PAYMENT_ERROR' });
  }
}
