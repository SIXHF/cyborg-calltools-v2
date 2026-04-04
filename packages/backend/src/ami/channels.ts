import { getAmiClient, type AmiEvent } from './client';

/**
 * Channel tracking service.
 * Polls Asterisk via AMI "Command" action to get active channels (same approach as V1),
 * and maintains a live channel map. Broadcasts updates to a callback on each refresh.
 */

export interface RawChannel {
  channel: string;
  context: string;
  exten: string;
  state: string;
  application: string;
  data: string;
  callerid: string;
  duration: string;
  bridgeid: string;
}

// In-memory channel list
let channelCache: RawChannel[] = [];
let channelCacheTime = 0;
const CHANNEL_CACHE_TTL = 2; // seconds

// Track answer times from AMI events for accurate duration
const channelAnswerTimes = new Map<string, number>();

// Trunk peer cache
let trunkNames = new Set<string>();
let trunkCacheTime = 0;
const TRUNK_CACHE_TTL = 120; // seconds

// Callback for channel updates
let onChannelUpdate: ((channels: RawChannel[]) => void) | null = null;

/**
 * Parse the concise channel output from Asterisk CLI.
 * Format: channel!context!exten!priority!state!application!data!callerid!accountcode!peeraddress!bridgedto!uniqueid!bridgeid
 */
function parseConciseChannels(output: string): RawChannel[] {
  const channels: RawChannel[] = [];
  for (const line of output.split('\n')) {
    if (!line.includes('!')) continue;
    const parts = line.split('!');
    if (parts.length < 7) continue;
    channels.push({
      channel: parts[0],
      context: parts[1],
      exten: parts[2],
      state: parts[4] ?? '',
      application: parts[5] ?? '',
      data: parts[6] ?? '',
      callerid: parts[7] ?? '',
      duration: parts[11] ?? '0',
      bridgeid: (parts[12] ?? '').trim(),
    });
  }
  return channels;
}

/**
 * Parse "sip show peers" output to identify trunk names.
 * Trunks don't have /username format (e.g. "junaid" is a trunk, "daniel/daniel" is a user).
 */
function parseTrunkPeers(output: string): Set<string> {
  const trunks = new Set<string>();
  for (const line of output.split('\n')) {
    const parts = line.split(/\s+/);
    if (!parts[0]) continue;
    const nameField = parts[0];
    if (nameField.startsWith('Name') || line.toLowerCase().includes('sip peers')) continue;
    if (!nameField.includes('/')) {
      trunks.add(nameField);
    }
  }
  return trunks;
}

/**
 * Run an Asterisk CLI command via subprocess (same approach as V1).
 * This is more reliable than the AMI Command action whose response
 * format varies across Asterisk versions.
 */
async function asteriskCommand(command: string): Promise<string> {
  try {
    const proc = Bun.spawn(['/usr/sbin/asterisk', '-rx', command], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderrText = await new Response(proc.stderr).text();
      console.error(`[Channels] asterisk -rx "${command}" exited ${exitCode}: ${stderrText}`);
    }
    return output;
  } catch (err) {
    console.error(`[Channels] asterisk -rx "${command}" failed:`, err);
    return '';
  }
}

/**
 * Get active channels from Asterisk.
 */
export async function getActiveChannels(useCache = false): Promise<RawChannel[]> {
  const now = Date.now() / 1000;
  if (useCache && (now - channelCacheTime) < CHANNEL_CACHE_TTL) {
    return channelCache;
  }

  try {
    const output = await asteriskCommand('core show channels concise');
    const parsed = parseConciseChannels(output);
    if (parsed.length !== channelCache.length) {
      console.log(`[Channels] Channel count changed: ${channelCache.length} -> ${parsed.length}`);
    }
    channelCache = parsed;
    channelCacheTime = now;
  } catch (err) {
    console.error('[Channels] Failed to get channels:', err);
  }

  return channelCache;
}

/**
 * Refresh trunk peer list.
 */
export async function refreshTrunkPeers(): Promise<Set<string>> {
  const now = Date.now() / 1000;
  if ((now - trunkCacheTime) < TRUNK_CACHE_TTL) {
    return trunkNames;
  }

  try {
    const output = await asteriskCommand('sip show peers');
    trunkNames = parseTrunkPeers(output);
    trunkCacheTime = now;
  } catch (err) {
    console.error('[Channels] Failed to refresh trunk peers:', err);
  }

  return trunkNames;
}

/**
 * Check if a channel belongs to a trunk (not a user endpoint).
 */
export function isTrunkChannel(channelName: string): boolean {
  const parts = channelName.split('/', 2);
  if (parts.length === 2) {
    const peer = parts[1].replace(/-[^-]+$/, '');
    if (trunkNames.has(peer)) return true;
  }
  return false;
}

/**
 * Extract agent/SIP name from channel string.
 * e.g. "SIP/nathan-000245fe" → "nathan"
 */
export function extractAgentName(channel: string): string {
  const parts = channel.split('/');
  if (parts.length >= 2) return parts[1].replace(/-[^-]+$/, '');
  return channel;
}

/**
 * Extract trunk name from Dial data.
 * e.g. "sip/cyborg-trunk/14142322867,60,L(...)" → "cyborg-trunk"
 */
export function extractTrunk(data: string): string {
  if (!data) return '';
  const m = data.match(/^sip\/([^/]+)\//i);
  return m ? m[1] : '';
}

/**
 * Filter channels for a specific user based on role.
 */
export async function getUserChannels(
  allChannels: RawChannel[],
  role: string,
  sipUsers: string[],
  targetSip?: string
): Promise<RawChannel[]> {
  const trunks = await refreshTrunkPeers();

  // Admin with no filter sees everything except trunk channels
  if (role === 'admin' && !targetSip) {
    return allChannels.filter(ch => !isTrunkChannel(ch.channel));
  }

  // Determine which SIP names to filter by
  const filterNames = targetSip ? [targetSip] : sipUsers;

  return allChannels.filter(ch =>
    filterNames.some(name => ch.channel.startsWith(`SIP/${name}-`))
  );
}

/**
 * Enrich user channels with trunk info from bridge partners (admin only).
 */
export function enrichWithTrunkInfo(userChannels: RawChannel[], allChannels: RawChannel[]): void {
  for (const ch of userChannels) {
    const bid = ch.bridgeid;
    if (!bid) continue;

    // Check if channel data already has trunk info
    if (ch.data && /^sip\/[^/]+\//i.test(ch.data)) continue;

    // Look for trunk bridge partner
    for (const partner of allChannels) {
      if (partner.channel !== ch.channel && partner.bridgeid === bid && isTrunkChannel(partner.channel)) {
        const parts = partner.channel.split('/', 2);
        if (parts.length === 2) {
          (ch as any).trunk = parts[1].replace(/-[^-]+$/, '');
        }
        break;
      }
    }
  }
}

/**
 * Format channels for the frontend Channel type.
 */
export function formatChannelsForClient(rawChannels: RawChannel[], allChannels: RawChannel[]): Record<string, unknown>[] {
  const now = Date.now() / 1000;
  return rawChannels.map(ch => {
    const agentName = extractAgentName(ch.channel);
    const trunk = (ch as any).trunk || extractTrunk(ch.data);
    const isUp = ch.state === 'Up';

    // Use tracked answer time for accurate duration
    let duration = parseInt(ch.duration) || 0;
    const answerTime = channelAnswerTimes.get(ch.channel);
    if (isUp && answerTime) {
      duration = Math.max(0, Math.floor(now - answerTime));
    }

    // Determine direction from context
    let direction: 'inbound' | 'outbound' | 'internal' = 'outbound';
    if (ch.context.includes('from-trunk') || ch.context.includes('incoming')) {
      direction = 'inbound';
    } else if (ch.context.includes('internal') || ch.context.includes('from-internal')) {
      direction = 'internal';
    }

    return {
      id: ch.channel,
      callerNum: ch.callerid || '',
      calleeNum: ch.exten || '',
      callerName: '',
      calleeName: '',
      state: isUp ? 'answered' : (ch.state === 'Ring' || ch.state === 'Ringing') ? 'ringing' : ch.state.toLowerCase(),
      direction,
      duration,
      sipUser: agentName,
      trunk: trunk || '',
      startTime: answerTime ? answerTime * 1000 : Date.now() - (duration * 1000),
      bridgedTo: ch.bridgeid || undefined,
      // Raw fields for V1 compatibility
      rawState: ch.state,
      rawData: ch.data,
      context: ch.context,
      application: ch.application,
    };
  });
}

/**
 * Set up AMI event listeners for tracking channel answer times.
 */
export function setupAmiEventListeners(): void {
  const ami = getAmiClient();
  if (!ami) return;

  ami.on('ami_event', (evt: AmiEvent) => {
    // Track when channels get answered/bridged
    if (evt.event === 'BridgeEnter' && evt.channel) {
      if (!channelAnswerTimes.has(evt.channel)) {
        channelAnswerTimes.set(evt.channel, Date.now() / 1000);
      }
    }

    // Clean up on hangup
    if (evt.event === 'Hangup' && evt.channel) {
      channelAnswerTimes.delete(evt.channel);
    }
  });
}

// Polling interval handle
let pollInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the channel polling loop.
 * Calls the registered callback with fresh channel data on each tick.
 */
export function startChannelPolling(intervalMs = 3000): void {
  if (pollInterval) return;

  // Set up AMI event listeners for answer time tracking
  setupAmiEventListeners();

  // Log first poll to confirm it works
  let firstPoll = true;
  pollInterval = setInterval(async () => {
    try {
      if (onChannelUpdate) {
        const channels = await getActiveChannels();
        if (firstPoll) {
          console.log(`[Channels] First poll: ${channels.length} channels found`);
          firstPoll = false;
        }
        onChannelUpdate(channels);
      }
    } catch (err) {
      console.error('[Channels] Poll error:', err);
    }
  }, intervalMs);

  console.log(`[Channels] Polling started (${intervalMs}ms interval)`);
}

/**
 * Register a callback to be invoked on each channel refresh.
 */
export function onChannelsRefreshed(callback: (channels: RawChannel[]) => void): void {
  onChannelUpdate = callback;
}

/**
 * Stop the channel polling loop.
 */
export function stopChannelPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
