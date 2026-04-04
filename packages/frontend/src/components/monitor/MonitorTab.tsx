import { useChannelStore } from '../../stores/channelStore';

export function MonitorTab() {
  const { channels } = useChannelStore();

  return (
    <div className="glass-panel p-6" role="tabpanel" id="panel-monitor">
      <h2 className="text-lg font-semibold mb-4">Active Calls</h2>
      {channels.length === 0 ? (
        <p className="text-ct-muted text-sm">No active calls.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ct-muted border-b border-ct-border">
                <th className="pb-2 pr-4">Channel</th>
                <th className="pb-2 pr-4">Caller</th>
                <th className="pb-2 pr-4">Callee</th>
                <th className="pb-2 pr-4">State</th>
                <th className="pb-2 pr-4">Duration</th>
                <th className="pb-2">SIP User</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => (
                <tr key={ch.id} className="border-b border-ct-border/30 hover:bg-ct-surface/50">
                  <td className="py-2 pr-4 font-mono text-xs">{ch.id}</td>
                  <td className="py-2 pr-4">{ch.callerNum}</td>
                  <td className="py-2 pr-4">{ch.calleeNum}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      ch.state === 'answered' ? 'bg-ct-green/10 text-ct-green' :
                      ch.state === 'ringing' ? 'bg-ct-yellow/10 text-ct-yellow' :
                      'bg-ct-muted/10 text-ct-muted'
                    }`}>
                      {ch.state}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono">{ch.duration}s</td>
                  <td className="py-2">{ch.sipUser}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
