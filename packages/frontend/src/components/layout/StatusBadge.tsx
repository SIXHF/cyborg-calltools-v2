interface StatusBadgeProps {
  connected: boolean;
}

export function StatusBadge({ connected }: StatusBadgeProps) {
  return (
    <span className={`status-badge-v1 ${connected ? 'connected' : 'disconnected'}`}>
      <span
        className="w-2 h-2 rounded-full bg-current"
        style={connected ? { animation: 'pulseGlow 2s infinite' } : undefined}
      />
      <span className="hidden sm:inline">{connected ? 'Connected' : 'Disconnected'}</span>
    </span>
  );
}
