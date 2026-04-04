export function ToolsTab() {
  return (
    <div className="glass-panel p-6" role="tabpanel" id="panel-tools">
      <h2 className="text-lg font-semibold mb-4">Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">DTMF Capture</h3>
          <p className="text-ct-muted text-sm">Select a channel to capture DTMF tones.</p>
        </div>
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">Live Transcription</h3>
          <p className="text-ct-muted text-sm">Real-time speech-to-text for active calls.</p>
        </div>
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">CNAM Lookup</h3>
          <p className="text-ct-muted text-sm">Look up caller name and carrier information.</p>
        </div>
        <div className="glass-panel p-4">
          <h3 className="text-sm font-medium text-ct-accent mb-2">Quick Dial</h3>
          <p className="text-ct-muted text-sm">Originate calls from your SIP extensions.</p>
        </div>
      </div>
    </div>
  );
}
