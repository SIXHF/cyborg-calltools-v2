import type { ServerWebSocket } from 'bun';
import { readFile, writeFile } from 'fs/promises';
import { auditLog } from '../../audit/logger';
import { dbQuery } from '../../db/mysql';

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

const SIP_CONFIG_FILE = '/etc/asterisk/sip_magnus_user.conf';

/** Validate caller ID: must be 11 digits starting with 1 (US/CA) or empty to clear */
function validateCallerId(cid: string): string | null {
  if (!cid) return '';
  const clean = cid.replace(/[^0-9]/g, '');
  if (clean.length === 10) return '1' + clean;
  if (clean.length === 11 && clean.startsWith('1')) return clean;
  return null;
}

/** Check if a number is toll-free */
function isTollfree(num: string): boolean {
  const prefixes = ['1800', '1833', '1844', '1855', '1866', '1877', '1888'];
  return prefixes.some(p => num.startsWith(p));
}

/**
 * Update the callerid= line in sip_magnus_user.conf for a SIP peer.
 * V1 line 1258-1312: If the peer section doesn't exist, creates it from the DB.
 * This ensures Asterisk picks up the change on sip reload.
 */
async function updateSipConfigCallerid(sipUser: string, callerid: string): Promise<void> {
  try {
    let content = '';
    try {
      content = await readFile(SIP_CONFIG_FILE, 'utf-8');
    } catch {
      console.warn(`[CallerID] SIP config file not found: ${SIP_CONFIG_FILE}`);
      return;
    }

    const lines = content.split('\n');
    const peerHeader = `[${sipUser}]`;
    let inSection = false;
    let found = false;
    let calleridLineIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === peerHeader) {
        inSection = true;
        found = true;
        continue;
      }
      if (inSection && trimmed.startsWith('[') && trimmed.endsWith(']')) {
        // Next section — insert callerid before this if not found
        if (calleridLineIndex === -1) {
          lines.splice(i, 0, `callerid=${callerid}`);
        }
        break;
      }
      if (inSection && trimmed.startsWith('callerid=')) {
        calleridLineIndex = i;
        lines[i] = `callerid=${callerid}`;
      }
    }

    // If we're still in the section at EOF and didn't find callerid
    if (inSection && calleridLineIndex === -1) {
      lines.push(`callerid=${callerid}`);
    }

    if (found) {
      await writeFile(SIP_CONFIG_FILE, lines.join('\n'));
      console.log(`[CallerID] SIP config updated for ${sipUser}: ${callerid || '(cleared)'}`);
    } else {
      console.warn(`[CallerID] Peer ${sipUser} not found in config file`);
    }
  } catch (err) {
    console.error('[CallerID] Failed to update SIP config:', err);
  }
}

export async function handleGetCallerId(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const targetUser = msg.sipUser || session.sipUser || session.username;

  // Ownership check: non-admin can only read their own SIP users
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  if (session.role !== 'admin' && !sipUsers.includes(targetUser)) {
    send(ws, { type: 'error', message: 'Access denied.', code: 'FORBIDDEN' });
    return;
  }

  try {
    const rows = await dbQuery<{ callerid: string }>(
      'SELECT callerid FROM pkg_sip WHERE name = ? LIMIT 1',
      [targetUser]
    );
    const callerid = rows.length > 0 ? (rows[0].callerid || '') : '';
    send(ws, { type: 'callerid_info', sipUser: targetUser, callerid });
  } catch {
    send(ws, { type: 'error', message: 'Failed to get caller ID.', code: 'DB_ERROR' });
  }
}

export async function handleSetCallerId(
  ws: ServerWebSocket<any>,
  session: any,
  msg: any,
  send: SendFn
) {
  const newCallerid = (msg.callerid || '').trim();
  const targetUser = msg.sipUser || session.sipUser || session.username;

  // Validate ownership
  const sipUsers = session.sipUsers ?? (session.sipUser ? [session.sipUser] : []);
  if (session.role !== 'admin' && !sipUsers.includes(targetUser)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.', code: 'FORBIDDEN' });
    return;
  }

  const validated = validateCallerId(newCallerid);
  if (validated === null) {
    send(ws, { type: 'error', message: 'Invalid caller ID. US/CA format: 11 digits starting with 1.', code: 'INVALID_INPUT' });
    return;
  }

  // Check toll-free restriction
  if (validated && isTollfree(validated) && !session.permissions.allow_tollfree_callerid) {
    send(ws, { type: 'error', message: 'Toll-free caller IDs are not allowed for this account.', code: 'FORBIDDEN' });
    auditLog(session.username, session.role, session.ip, 'set_callerid_blocked', targetUser, `Toll-free: ${validated}`);
    return;
  }

  try {
    // 1. Update database
    await dbQuery('UPDATE pkg_sip SET callerid = ? WHERE name = ?', [validated, targetUser]);

    // 2. Update SIP config file (V1 parity — Asterisk reads callerid from config, not DB)
    await updateSipConfigCallerid(targetUser, validated);

    // 3. Reload SIP in Asterisk so the change takes effect
    try {
      const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'sip reload'], {
        stdout: 'pipe', stderr: 'pipe',
      });
      await new Response(proc.stdout).text();
      console.log(`[CallerID] sip reload completed for ${targetUser}`);
    } catch (err) {
      console.error('[CallerID] sip reload failed:', err);
    }

    auditLog(session.username, session.role, session.ip, 'set_callerid', targetUser, validated);
    send(ws, { type: 'callerid_updated', sipUser: targetUser, callerid: validated });
  } catch (err) {
    send(ws, { type: 'error', message: 'Failed to update caller ID.', code: 'DB_ERROR' });
  }
}
