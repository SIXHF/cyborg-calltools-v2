export function AdminTab() {
  return (
    <div className="glass-panel p-6" role="tabpanel" id="panel-admin">
      <h2 className="text-lg font-semibold mb-4">Admin Panel</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">Stats</h3>
          <p className="text-ct-muted text-sm">System metrics and call statistics.</p>
        </div>
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">Permissions</h3>
          <p className="text-ct-muted text-sm">Manage user and SIP extension permissions.</p>
        </div>
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">Broadcast</h3>
          <p className="text-ct-muted text-sm">Send messages to all connected users.</p>
        </div>
      </div>
    </div>
  );
}
