import { useUiStore } from '../../stores/uiStore';

const BROADCAST_STYLES: Record<string, { bg: string; border: string; color: string }> = {
  orange: { bg: '#1a1700', border: '#d29922', color: '#d29922' },
  red: { bg: '#1a1117', border: '#f85149', color: '#f85149' },
  green: { bg: '#0d1a12', border: '#3fb950', color: '#3fb950' },
};

export function Toast() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  // Show only the latest toast (V1 behavior — single toast, not a stack)
  const latest = toasts[toasts.length - 1];

  // Broadcast toast uses custom colors from V1
  const isBroadcast = latest.type === 'broadcast';
  const bcStyle = isBroadcast ? BROADCAST_STYLES[latest.color || 'orange'] || BROADCAST_STYLES.orange : null;

  return (
    <div
      className="fixed right-6 left-4 sm:left-auto z-[9999] max-w-[400px]"
      style={{ bottom: 24, pointerEvents: 'auto' }}
      aria-live="polite"
    >
      <div
        className={isBroadcast ? 'rounded-lg text-[13px] font-medium shadow-lg border' :
          `py-2.5 rounded-lg text-[13px] font-medium shadow-lg border ${
          latest.type === 'error'
            ? 'bg-[#1a1117] border-ct-red text-ct-red'
            : latest.type === 'success'
            ? 'bg-ct-surface-solid border-ct-green text-ct-green'
            : 'bg-ct-surface-solid border-ct-accent text-ct-text'
        }`}
        style={isBroadcast && bcStyle ? {
          padding: '10px 18px',
          background: bcStyle.bg,
          borderColor: bcStyle.border,
          color: bcStyle.color,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
        } : {
          padding: '10px 18px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
        }}
        role="alert"
      >
        <span className="mr-2">{latest.message}</span>
        <button
          onClick={() => removeToast(latest.id)}
          className="text-current opacity-60 hover:opacity-100 text-xs float-right"
          aria-label="Dismiss"
        >
          X
        </button>
      </div>
    </div>
  );
}
