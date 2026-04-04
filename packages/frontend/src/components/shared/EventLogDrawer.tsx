import { useState } from 'react';
import { useUiStore } from '../../stores/uiStore';

export function EventLogDrawer() {
  const { eventLog, eventLogExpanded: expanded, toggleEventLog: setExpandedToggle } = useUiStore();
  const setExpanded = (v: boolean) => { if (v !== expanded) setExpandedToggle(); };

  const lastEvent = eventLog[0] ?? '';

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[100]"
      style={{
        background: 'rgba(13, 17, 23, 0.95)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid #21262d',
        boxShadow: '0 -4px 16px rgba(0,0,0,0.3)',
        height: expanded ? 220 : 36,
        transition: 'height 0.25s ease',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none border-b border-ct-border-solid"
        onClick={() => setExpanded(!expanded)}
      >
        <h3 className="text-xs font-semibold text-ct-muted tracking-wider">EVENT LOG</h3>
        <span className="text-[11px] text-ct-muted-dark font-mono overflow-hidden text-ellipsis whitespace-nowrap flex-1 mx-4">
          {lastEvent}
        </span>
        <div className="flex gap-2 items-center">
          {expanded && eventLog.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); useUiStore.getState().clearEventLog(); }}
              className="text-[10px] text-ct-muted-dark hover:text-ct-red transition-colors"
            >
              Clear
            </button>
          )}
          <span className="text-[10px] text-ct-muted-dark">{eventLog.length} events</span>
          <span className="text-ct-muted text-xs">{expanded ? '▼' : '▲'}</span>
        </div>
      </div>

      {/* Log entries */}
      <div
        className="overflow-y-auto px-4 py-1.5 font-mono text-xs text-ct-muted"
        style={{ maxHeight: 170 }}
      >
        {eventLog.length === 0 ? (
          <div className="text-ct-muted-dark py-2">[--:--:--] Waiting for connection...</div>
        ) : (
          eventLog.map((entry, i) => (
            <div key={i} className="py-0.5">
              {entry}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
