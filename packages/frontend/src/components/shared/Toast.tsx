import { useUiStore } from '../../stores/uiStore';

export function Toast() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[9999] flex flex-col gap-2 max-w-sm" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`glass-panel px-4 py-3 rounded-lg shadow-lg flex items-start gap-3 animate-slide-in ${
            toast.type === 'error'
              ? 'border-ct-red/50'
              : toast.type === 'success'
              ? 'border-ct-green/50'
              : 'border-ct-accent/50'
          }`}
          role="alert"
        >
          <span
            className={`text-sm flex-1 ${
              toast.type === 'error'
                ? 'text-ct-red'
                : toast.type === 'success'
                ? 'text-ct-green'
                : 'text-ct-text'
            }`}
          >
            {toast.message}
          </span>
          <button
            onClick={() => removeToast(toast.id)}
            className="text-ct-muted hover:text-ct-text text-xs"
            aria-label="Dismiss"
          >
            X
          </button>
        </div>
      ))}
    </div>
  );
}
