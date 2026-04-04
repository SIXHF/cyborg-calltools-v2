import { appendFile, stat, rename, unlink } from 'fs/promises';

const AUDIT_LOG_FILE = process.env.AUDIT_LOG_FILE ?? '/opt/calltools-v2-audit.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ROTATIONS = 5;

interface AuditEntry {
  ts: string;
  actor: string;
  role: string;
  ip: string;
  action: string;
  target?: string;
  detail?: string;
}

/**
 * Write an audit log entry.
 * Logs all actions including permission denials (fixes gap in v1).
 */
export function auditLog(
  actor: string,
  role: string,
  ip: string,
  action: string,
  target?: string,
  detail?: string
): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    actor,
    role,
    ip,
    action,
    ...(target && { target }),
    ...(detail && { detail }),
  };

  const line = JSON.stringify(entry) + '\n';

  // Fire and forget — don't block on audit writes
  writeWithRotation(line).catch(err => {
    console.error('[Audit] Failed to write:', err);
  });
}

async function writeWithRotation(line: string): Promise<void> {
  try {
    const stats = await stat(AUDIT_LOG_FILE).catch(() => null);
    if (stats && stats.size > MAX_LOG_SIZE) {
      await rotateLog();
    }
  } catch {
    // Ignore stat errors
  }

  await appendFile(AUDIT_LOG_FILE, line, 'utf-8');
}

/**
 * Rolling log rotation: audit.log → audit.log.1 → audit.log.2 → ... → audit.log.5
 * Fixes v1 issue where only one .old backup was kept.
 */
async function rotateLog(): Promise<void> {
  // Remove oldest rotation
  try {
    await unlink(`${AUDIT_LOG_FILE}.${MAX_ROTATIONS}`);
  } catch { /* may not exist */ }

  // Shift existing rotations up
  for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
    try {
      await rename(`${AUDIT_LOG_FILE}.${i}`, `${AUDIT_LOG_FILE}.${i + 1}`);
    } catch { /* may not exist */ }
  }

  // Move current to .1
  try {
    await rename(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`);
  } catch { /* may not exist */ }
}
