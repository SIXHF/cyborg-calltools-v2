import type { ServerWebSocket } from 'bun';
import { dbQuery, dbExecute } from '../../db/mysql';
import { auditLog } from '../../audit/logger';
import { readdir, readFile, writeFile, unlink, mkdir, stat } from 'fs/promises';
import { join, extname } from 'path';

// Match V1 constants exactly
const MOH_BASE_DIR = '/var/lib/asterisk/moh';
const MOH_CONFIG_FILE = '/etc/asterisk/musiconhold_magnus.conf';
const SIP_CONFIG_FILE = '/etc/asterisk/sip_magnus_user.conf';
const AUDIO_DIR = '/opt/calltools-audio';
const AUDIO_MAX_SIZE = 10 * 1024 * 1024; // 10MB max upload
const AUDIO_ALLOWED_EXT = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac']);

type SendFn = (ws: ServerWebSocket<any>, msg: any) => void;

interface SessionInfo {
  token: string;
  username: string;
  role: string;
  sipUser?: string;
  sipUsers?: string[];
  permissions: Record<string, boolean>;
  ip: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function sanitizeAudioFilename(name: string): string {
  let stem = name.replace(/\.[^.]+$/, ''); // remove extension
  stem = stem.replace(/[^a-zA-Z0-9_-]/g, '_');
  stem = stem.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!stem) stem = `audio_${Math.floor(Date.now() / 1000)}`;
  return stem;
}

function ownsSipUser(session: SessionInfo, targetSip: string): boolean {
  if (session.role === 'admin') return true;
  if (session.sipUser === targetSip) return true;
  if (session.sipUsers?.includes(targetSip)) return true;
  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function getMohInfo(sipUser: string): Promise<{
  using_default: boolean;
  moh_class: string;
  files: { name: string; size: number }[];
}> {
  const rows = await dbQuery<{ mohsuggest: string | null }>(
    'SELECT mohsuggest FROM pkg_sip WHERE name = ? LIMIT 1',
    [sipUser]
  );
  const mohsuggest = rows[0]?.mohsuggest?.trim() || null;

  if (mohsuggest) {
    const mohDir = join(MOH_BASE_DIR, mohsuggest);
    const files: { name: string; size: number }[] = [];
    try {
      const entries = await readdir(mohDir);
      for (const f of entries.sort()) {
        if (f.endsWith('.wav')) {
          const s = await stat(join(mohDir, f));
          files.push({ name: f, size: s.size });
        }
      }
    } catch { /* dir may not exist */ }
    return { using_default: false, moh_class: mohsuggest, files };
  } else {
    // List default MOH files (files directly in MOH_BASE_DIR, not subdirs)
    const files: { name: string; size: number }[] = [];
    try {
      const entries = await readdir(MOH_BASE_DIR);
      for (const f of entries.sort()) {
        const fpath = join(MOH_BASE_DIR, f);
        const s = await stat(fpath);
        if (s.isFile() && f.endsWith('.wav')) {
          files.push({ name: f, size: s.size });
        }
      }
    } catch { /* dir may not exist */ }
    return { using_default: true, moh_class: 'default', files };
  }
}

async function mohReload(): Promise<void> {
  // Unload then load res_musiconhold.so to pick up new classes
  const unload = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'module unload res_musiconhold.so'], {
    stdout: 'pipe', stderr: 'pipe',
  });
  await unload.exited;
  const load = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'module load res_musiconhold.so'], {
    stdout: 'pipe', stderr: 'pipe',
  });
  await load.exited;
  console.log('[MOH] Module reloaded (unload+load)');
}

async function sipReload(): Promise<void> {
  const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', 'sip reload'], {
    stdout: 'pipe', stderr: 'pipe',
  });
  await proc.exited;
  console.log('[MOH] SIP config reloaded');
}

async function updateSipConfigMohsuggest(sipUser: string, className: string | null): Promise<void> {
  if (!(await fileExists(SIP_CONFIG_FILE))) {
    console.warn(`[MOH] SIP config file not found: ${SIP_CONFIG_FILE}`);
    return;
  }

  const content = await readFile(SIP_CONFIG_FILE, 'utf-8');
  const lines = content.split('\n');
  const newLines: string[] = [];
  let inUserBlock = false;
  let mohsuggestAdded = false;

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped === `[${sipUser}]`) {
      inUserBlock = true;
      mohsuggestAdded = false;
      newLines.push(line);
      continue;
    }

    if (inUserBlock && stripped.startsWith('[') && stripped.endsWith(']')) {
      inUserBlock = false;
    }

    if (inUserBlock) {
      if (stripped.startsWith('mohsuggest=')) {
        continue; // Skip existing mohsuggest line
      }
      if (stripped.startsWith('allowtransfer=') && className && !mohsuggestAdded) {
        newLines.push(`mohsuggest=${className}`);
        mohsuggestAdded = true;
      }
    }

    newLines.push(line);
  }

  await writeFile(SIP_CONFIG_FILE, newLines.join('\n'), 'utf-8');
  console.log(`[MOH] SIP config updated for ${sipUser}: mohsuggest=${className ?? 'removed'}`);
}

async function ensureMohClass(sipUser: string): Promise<[string, string]> {
  const className = `moh-${sipUser}`;
  const mohDir = join(MOH_BASE_DIR, className);

  await mkdir(mohDir, { recursive: true });
  // chown to asterisk — Bun.spawn for chown
  const chown = Bun.spawn(['chown', 'asterisk:asterisk', mohDir], {
    stdout: 'pipe', stderr: 'pipe',
  });
  await chown.exited;

  // Add class to config if missing
  let config = '';
  try {
    config = await readFile(MOH_CONFIG_FILE, 'utf-8');
  } catch { /* file may not exist */ }

  if (!config.includes(`[${className}]`)) {
    await writeFile(
      MOH_CONFIG_FILE,
      config + `\n[${className}]\nmode=files\ndirectory=${MOH_BASE_DIR}/${className}\n`,
      'utf-8'
    );
  }

  // Update DB
  await dbExecute(
    'UPDATE pkg_sip SET mohsuggest = ? WHERE name = ?',
    [className, sipUser]
  );

  // Reload MOH
  await mohReload();

  // Update SIP peer config and reload
  await updateSipConfigMohsuggest(sipUser, className);
  await sipReload();

  console.log(`[MOH] Class ensured for ${sipUser}: ${className}`);
  return [className, mohDir];
}

// ── Handlers ────────────────────────────────────────────────────────

export async function handleGetMoh(
  ws: ServerWebSocket<any>,
  session: SessionInfo,
  msg: any,
  send: SendFn
): Promise<void> {
  if (!session.permissions.moh) {
    send(ws, { type: 'error', message: 'Hold music management is disabled for your account.' });
    return;
  }

  const targetSip = msg.targetSip || session.sipUser || session.username;
  if (!ownsSipUser(session, targetSip)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.' });
    return;
  }

  const info = await getMohInfo(targetSip);
  send(ws, {
    type: 'moh_info',
    using_default: info.using_default,
    moh_class: info.moh_class,
    files: info.files,
    timestamp: Date.now() / 1000,
  });
}

export async function handleSetMoh(
  ws: ServerWebSocket<any>,
  session: SessionInfo,
  msg: any,
  send: SendFn
): Promise<void> {
  if (!session.permissions.moh) {
    send(ws, { type: 'error', message: 'Hold music management is disabled for your account.' });
    return;
  }

  const targetSip = msg.targetSip || session.sipUser || session.username;
  if (!ownsSipUser(session, targetSip)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.' });
    return;
  }

  if (msg.useDefault) {
    // Revert to default MOH
    await dbExecute('UPDATE pkg_sip SET mohsuggest = NULL WHERE name = ?', [targetSip]);
    await mohReload();
    await updateSipConfigMohsuggest(targetSip, null);
    await sipReload();

    console.log(`[MOH] ${targetSip} reverted to default MOH`);
    auditLog(session.username, session.role, session.ip, 'set_moh_default', targetSip);

    const info = await getMohInfo(targetSip);
    send(ws, {
      type: 'moh_updated',
      using_default: true,
      moh_class: 'default',
      files: info.files,
      timestamp: Date.now() / 1000,
    });
    return;
  }

  const filename = (msg.filename || '').trim();
  if (!filename || filename.includes('..') || filename.includes('/')) {
    send(ws, { type: 'error', message: 'Invalid filename.' });
    return;
  }

  // Check file exists in shared audio library
  const srcPath = join(AUDIO_DIR, filename);
  if (!(await fileExists(srcPath))) {
    send(ws, { type: 'error', message: 'Audio file not found.' });
    return;
  }

  try {
    const [className, mohDir] = await ensureMohClass(targetSip);

    // Clear existing files in MOH dir
    try {
      const existing = await readdir(mohDir);
      for (const f of existing) {
        const fpath = join(mohDir, f);
        const s = await stat(fpath);
        if (s.isFile()) await unlink(fpath);
      }
    } catch { /* dir may be empty */ }

    // Copy selected file
    const destPath = join(mohDir, filename);
    const srcContent = await readFile(srcPath);
    await writeFile(destPath, srcContent);
    // Fix ownership
    const chown = Bun.spawn(['chown', 'asterisk:asterisk', destPath], {
      stdout: 'pipe', stderr: 'pipe',
    });
    await chown.exited;

    await mohReload();

    console.log(`[MOH] ${targetSip} set MOH to ${filename} (class: ${className})`);
    auditLog(session.username, session.role, session.ip, 'set_moh', targetSip, filename);

    const info = await getMohInfo(targetSip);
    send(ws, {
      type: 'moh_updated',
      using_default: false,
      moh_class: className,
      files: info.files,
      timestamp: Date.now() / 1000,
    });
  } catch (e) {
    send(ws, { type: 'error', message: `Failed to set MOH: ${e}` });
  }
}

export async function handleUploadMoh(
  ws: ServerWebSocket<any>,
  session: SessionInfo,
  msg: any,
  send: SendFn
): Promise<void> {
  if (!session.permissions.moh) {
    send(ws, { type: 'error', message: 'Hold music management is disabled for your account.' });
    return;
  }

  const targetSip = msg.targetSip || session.sipUser || session.username;
  if (!ownsSipUser(session, targetSip)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.' });
    return;
  }

  const filename = (msg.filename || '').trim();
  const audioData = msg.data || '';

  if (!filename || !audioData) {
    send(ws, { type: 'error', message: 'Missing filename or audio data.' });
    return;
  }

  const ext = extname(filename).toLowerCase();
  if (!AUDIO_ALLOWED_EXT.has(ext)) {
    send(ws, {
      type: 'error',
      message: `Unsupported format. Allowed: ${[...AUDIO_ALLOWED_EXT].join(', ')}`,
    });
    return;
  }

  let rawBytes: Buffer;
  try {
    rawBytes = Buffer.from(audioData, 'base64');
  } catch {
    send(ws, { type: 'error', message: 'Invalid audio data.' });
    return;
  }

  if (rawBytes.length > AUDIO_MAX_SIZE) {
    send(ws, { type: 'error', message: `File too large (max ${AUDIO_MAX_SIZE / 1024 / 1024}MB).` });
    return;
  }

  const safeName = sanitizeAudioFilename(filename);

  let mohDir: string | undefined;
  let tmpPath: string | undefined;

  try {
    const [className, dir] = await ensureMohClass(targetSip);
    mohDir = dir;

    tmpPath = join(mohDir, `_tmp_${safeName}${ext}`);
    const wavPath = join(mohDir, `${safeName}.wav`);

    await writeFile(tmpPath, rawBytes);

    // Convert to 8kHz mono WAV via sox
    const proc = Bun.spawn(
      ['sox', tmpPath, '-r', '8000', '-c', '1', '-b', '16', wavPath],
      { stdout: 'pipe', stderr: 'pipe' }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`sox conversion failed: ${stderr.slice(0, 200)}`);
    }

    // Fix ownership
    const chown = Bun.spawn(['chown', 'asterisk:asterisk', wavPath], {
      stdout: 'pipe', stderr: 'pipe',
    });
    await chown.exited;

    await mohReload();

    console.log(`[MOH] ${targetSip} uploaded MOH file: ${safeName}.wav`);
    auditLog(session.username, session.role, session.ip, 'upload_moh', targetSip, `${safeName}.wav`);

    const info = await getMohInfo(targetSip);
    send(ws, {
      type: 'moh_updated',
      using_default: false,
      moh_class: className,
      files: info.files,
      timestamp: Date.now() / 1000,
    });
  } catch (e) {
    send(ws, { type: 'error', message: `Upload failed: ${e}` });
  } finally {
    // Clean up temp file
    if (tmpPath) {
      try { await unlink(tmpPath); } catch { /* may not exist */ }
    }
  }
}

export async function handleDeleteMoh(
  ws: ServerWebSocket<any>,
  session: SessionInfo,
  msg: any,
  send: SendFn
): Promise<void> {
  if (!session.permissions.moh) {
    send(ws, { type: 'error', message: 'Hold music management is disabled for your account.' });
    return;
  }

  const targetSip = msg.targetSip || session.sipUser || session.username;
  if (!ownsSipUser(session, targetSip)) {
    send(ws, { type: 'error', message: 'Access denied for this SIP user.' });
    return;
  }

  const filename = (msg.filename || '').trim();
  if (!filename || filename.includes('..') || filename.includes('/')) {
    send(ws, { type: 'error', message: 'Invalid filename.' });
    return;
  }

  const className = `moh-${targetSip}`;
  const mohDir = join(MOH_BASE_DIR, className);
  const filepath = join(mohDir, filename);

  if (!(await fileExists(filepath))) {
    send(ws, { type: 'error', message: 'File not found.' });
    return;
  }

  try {
    await unlink(filepath);
    console.log(`[MOH] ${targetSip} deleted MOH file: ${filename}`);
    auditLog(session.username, session.role, session.ip, 'delete_moh', targetSip, filename);

    // If directory is now empty, revert to default
    const remaining = (await readdir(mohDir)).filter(f => f.endsWith('.wav'));
    if (remaining.length === 0) {
      await dbExecute('UPDATE pkg_sip SET mohsuggest = NULL WHERE name = ?', [targetSip]);
      await updateSipConfigMohsuggest(targetSip, null);
      console.log(`[MOH] ${targetSip} MOH dir empty, reverted to default`);
    }

    // Reload MOH and SIP
    await mohReload();
    await sipReload();

    const info = await getMohInfo(targetSip);
    send(ws, {
      type: 'moh_updated',
      using_default: info.using_default,
      moh_class: info.moh_class,
      files: info.files,
      timestamp: Date.now() / 1000,
    });
  } catch (e) {
    send(ws, { type: 'error', message: `Delete failed: ${e}` });
  }
}
