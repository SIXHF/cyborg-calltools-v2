import { useUiStore } from '../../stores/uiStore';

export function Toast() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  // Show only the latest toast (V1 behavior — single toast, not a stack)
  const latest = toasts[toasts.length - 1];

  return (
    <div
      className="fixed bottom-10 right-4 left-4 sm:left-auto z-[9999] max-w-[400px]"
      style={{ pointerEvents: 'auto' }}
      aria-live="polite"
    >
      <div
        className={`px-4 py-2.5 rounded-lg text-[13px] font-medium shadow-lg border ${
          latest.type === 'error'
            ? 'bg-[#1a1117] border-ct-red text-ct-red'
            : latest.type === 'success'
            ? 'bg-ct-surface-solid border-ct-green text-ct-green'
            : 'bg-ct-surface-solid border-ct-accent text-ct-text'
        }`}
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        role="alert"
      >
        <span className="mr-2">{latest.message}</span>
        <button
          onClick={() => removeToast(latest.id)}
          className="text-ct-muted hover:text-ct-text text-xs float-right"
          aria-label="Dismiss"
        >
          X
        </button>
      </div>
    </div>
  );
}
