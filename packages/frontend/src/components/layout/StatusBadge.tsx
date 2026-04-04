interface StatusBadgeProps {
  connected: boolean;
}

export function StatusBadge({ connected }: StatusBadgeProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-2 h-2 rounded-full ${
          connected ? 'bg-ct-green animate-pulse' : 'bg-ct-red'
        }`}
      />
      <span className={`text-xs font-medium ${connected ? 'text-ct-green' : 'text-ct-red'}`}>
        {connected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
}
