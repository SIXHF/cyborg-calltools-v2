import { useEffect, useState } from 'react';
import { useChannelStore, type ExtendedChannel } from '../../stores/channelStore';
import { useAuthStore } from '../../stores/authStore';
import { wsSend } from '../../hooks/useWebSocket';
import { TransferModal } from './TransferModal';
import { AudioPlayModal } from './AudioPlayModal';

/** Format seconds into mm:ss or hh:mm:ss */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format phone number for display — matches V1's fmtPhone exactly */
function fmtPhone(num: string): string {
  if (!num) return '—';
  const d = String(num).replace(/[^0-9]/g, '');
  if (d.length === 11 && d[0] === '1') {
    return `1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  if (d.length === 10) {
    return `1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return num;
}

/** Get state tag class matching V1 */
function stateTagClass(state: string): string {
  switch (state) {
    case 'answered':
    case 'Up':
      return 'tag-up';
    case 'ringing':
    case 'Ring':
    case 'Ringing':
      return 'tag-ring';
    default:
      return 'tag-down';
  }
}

/** Get display state name */
function displayState(state: string, rawState?: string): string {
  if (rawState) return rawState;
  switch (state) {
    case 'answered': return 'Up';
    case 'ringing': return 'Ring';
    case 'hold': return 'Hold';
    case 'transfer': return 'Transfer';
    case 'hangup': return 'Down';
    default: return state;
  }
}

function ChannelRow({ ch, canDtmf, canTranscript, canAudio, canCost, isAdmin, onTransfer, onPlay }: {
  ch: ExtendedChannel;
  canDtmf: boolean;
  canTranscript: boolean;
  canAudio: boolean;
  canCost: boolean;
  isAdmin: boolean;
  onTransfer: (channel: string, sipUser: string) => void;
  onPlay: (channel: string) => void;
}) {
  const isUp = ch.state === 'answered';
  const trunk = isAdmin ? ch.trunk : '';

  // Fraud score color
  const fraudColor = ch.fraudScore !== undefined
    ? ch.fraudScore <= 30 ? '#3fb950' : ch.fraudScore <= 59 ? '#d29922' : '#f85149'
    : undefined;

  return (
    <div className="channel-row">
      {/* Top row: Agent, State, Duration, Cost, Trunk */}
      <div className="flex items-center gap-2.5 w-full flex-wrap">
        <span className="text-[15px] font-bold text-ct-accent" style={{ minWidth: 120 }}>{ch.sipUser}</span>
        <span className={`tag ${stateTagClass(ch.state)}`}>
          {displayState(ch.state, ch.rawState)}
        </span>
        <span className="font-mono text-xs text-ct-muted">
          {formatDuration(ch.duration)}
        </span>

        {canCost && isUp && ch.callCost !== undefined && (
          <span className="cost-tag">
            ${ch.callCost.toFixed(2)} @${ch.callRate?.toFixed(3)}/min
          </span>
        )}
        {canCost && ch.userBalance !== undefined && (
          <span
            className="text-xs font-semibold font-mono px-2 py-0.5 rounded-lg border"
            style={{
              color: ch.userBalance < 1 ? '#f85149' : '#3fb950',
              borderColor: ch.userBalance < 1 ? '#3d1f20' : '#1a3a2a',
              background: ch.userBalance < 1 ? '#2d111722' : '#0d281822',
            }}
          >
            Bal: ${ch.userBalance.toFixed(2)}
          </span>
        )}

        {trunk && <span className="trunk-badge">via {trunk}</span>}
      </div>

      {/* Bottom row: Call flow (caller → callee) + Actions */}
      <div className="flex items-center gap-2 w-full text-xs text-ct-muted">
        <span className="font-mono text-xs text-ct-text flex-1">
          {/* Fraud score badge */}
          {ch.fraudScore !== undefined && (
            <span
              className="fraud-badge"
              style={{ background: `${fraudColor}22`, color: fraudColor }}
              title={`Fraud Score: ${ch.fraudScore}/100`}
            >
              &#9679; {ch.fraudScore}
            </span>
          )}
          {ch.fraudScore !== undefined ? (
            <span style={{ color: fraudColor }}>{fmtPhone(ch.callerNum)}</span>
          ) : (
            fmtPhone(ch.callerNum)
          )}
          {ch.callerName && <span className="cnam-tag">{ch.callerName}</span>}
          {ch.callerState && <span className="state-tag">{ch.callerState}</span>}

          <span className="text-ct-muted mx-2 text-base align-middle">&#10132;</span>

          {fmtPhone(ch.calleeNum)}
          {ch.calleeName && <span className="cnam-tag">{ch.calleeName}</span>}
          {ch.calleeCarrier && <span className="carrier-tag">{ch.calleeCarrier}</span>}
          {ch.calleeState && <span className="state-tag">{ch.calleeState}</span>}
        </span>

        {/* Action buttons */}
        <span className="flex gap-1.5 items-center flex-shrink-0">
          {isUp && canDtmf && (
            <button
              className="btn-call-action btn-dtmf"
              onClick={() => wsSend({ cmd: 'start_listening', channel: ch.id })}
              title="Listen DTMF"
            >
              &#9834; DTMF
            </button>
          )}
          {isUp && canTranscript && (
            <button
              className="btn-call-action btn-transcript"
              onClick={() => wsSend({ cmd: 'start_transcript', channel: ch.id })}
              title="Live Transcript"
            >
              &#9998; Transcript
            </button>
          )}
          {isUp && canAudio && (
            <button
              className="btn-call-action btn-play"
              onClick={() => onPlay(ch.id)}
              title="Play Audio"
            >
              &#9654; Play
            </button>
          )}
          {isUp && (
            <button
              className="btn-call-transfer"
              onClick={() => onTransfer(ch.id, ch.sipUser)}
            >
              &#8644; Transfer
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

export function MonitorTab() {
  const { channels } = useChannelStore();
  const { role, permissions } = useAuthStore();
  const selectedSip = useAuthStore(s => s.selectedSipUser);
  const [_, setTick] = useState(0);
  const [transferTarget, setTransferTarget] = useState<{ channel: string; sipUser: string } | null>(null);
  const [audioPlayChannel, setAudioPlayChannel] = useState<string | null>(null);

  const isAdmin = role === 'admin';
  const canDtmf = isAdmin || permissions.dtmf !== false;
  const canTranscript = isAdmin || permissions.transcript !== false;
  const canAudio = isAdmin || permissions.audio_player !== false;
  const canCost = isAdmin || permissions.call_cost !== false;

  // Force re-render every 3 seconds to update durations (server broadcasts channels automatically)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(interval);
  }, []);

  // Client-side SIP filter (Bug 10.1 fix: server broadcast sends all, we filter here)
  // Client-side SIP filter — account: prefix means show all (server filtered by role)
  const filteredChannels = selectedSip && !selectedSip.startsWith('account:')
    ? channels.filter(ch => ch.sipUser === selectedSip)
    : channels;

  // Compute live durations client-side using startTime (Bug 9.2 fix)
  const now = Date.now();
  const withLiveDuration = filteredChannels.map(ch => ({
    ...ch,
    duration: ch.startTime ? Math.max(0, Math.floor((now - ch.startTime) / 1000)) : ch.duration,
  }));

  // Split into connected and ringing, sorted by duration descending
  const sortByDur = (a: ExtendedChannel, b: ExtendedChannel) => (b.duration || 0) - (a.duration || 0);
  const connected = withLiveDuration.filter(ch => ch.state === 'answered').sort(sortByDur);
  const ringing = withLiveDuration.filter(ch => ch.state !== 'answered').sort(sortByDur);
  const total = withLiveDuration.length;

  return (
    <div className="glass-panel animate-fade-in" role="tabpanel" id="panel-monitor">
      {/* Panel header */}
      <div className="panel-header">
        <h2>My Active Calls</h2>
        <div className="flex gap-2.5 items-center">
          <span className="stat-badge stat-total">T: {total}</span>
          <span className="stat-badge stat-up">UP: {connected.length}</span>
          <span className="stat-badge stat-ring">RING: {ringing.length}</span>
        </div>
      </div>

      {total === 0 ? (
        <div className="empty-state">No active calls for your extension</div>
      ) : (
        <div>
          {/* Connected calls section */}
          {connected.length > 0 && (
            <>
              <div className="channel-section-header text-ct-green">
                Connected <span className="text-ct-muted-dark font-normal">({connected.length})</span>
              </div>
              {connected.map(ch => (
                <ChannelRow
                  key={ch.id}
                  ch={ch}
                  canDtmf={canDtmf}
                  canTranscript={canTranscript}
                  canAudio={canAudio}
                  canCost={canCost}
                  isAdmin={isAdmin}
                  onTransfer={(ch, sip) => setTransferTarget({ channel: ch, sipUser: sip })}
                  onPlay={(ch) => setAudioPlayChannel(ch)}
                />
              ))}
            </>
          )}

          {/* Ringing calls section */}
          {ringing.length > 0 && (
            <>
              <div
                className="channel-section-header text-ct-yellow"
                style={connected.length > 0 ? { borderTop: '1px solid #21262d', marginTop: 4 } : undefined}
              >
                Ringing <span className="text-ct-muted-dark font-normal">({ringing.length})</span>
              </div>
              {ringing.map(ch => (
                <ChannelRow
                  key={ch.id}
                  ch={ch}
                  canDtmf={canDtmf}
                  canTranscript={canTranscript}
                  canAudio={canAudio}
                  canCost={canCost}
                  isAdmin={isAdmin}
                  onTransfer={(ch, sip) => setTransferTarget({ channel: ch, sipUser: sip })}
                  onPlay={(ch) => setAudioPlayChannel(ch)}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Transfer Modal */}
      {transferTarget && (
        <TransferModal
          channel={transferTarget.channel}
          sipUser={transferTarget.sipUser}
          onClose={() => setTransferTarget(null)}
        />
      )}

      {/* Audio Play Modal */}
      {audioPlayChannel && (
        <AudioPlayModal
          channel={audioPlayChannel}
          onClose={() => setAudioPlayChannel(null)}
        />
      )}
    </div>
  );
}
