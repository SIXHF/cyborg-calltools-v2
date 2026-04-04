import { useEffect, useState, useCallback } from 'react';

/**
 * Hook to listen for specific WebSocket message types dispatched via CustomEvent.
 * Components can use this to react to specific server responses.
 */
export function useWsMessage<T = any>(type: string): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === type) {
        setData(msg as T);
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [type]);

  return data;
}

/**
 * Hook that sends a WS command and returns the response for a specific type.
 */
export function useWsRequest<T = any>(responseType: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail;
      if (msg?.type === responseType) {
        setData(msg as T);
        setLoading(false);
      }
    };
    window.addEventListener('ws-message', handler);
    return () => window.removeEventListener('ws-message', handler);
  }, [responseType]);

  const send = useCallback((cmd: Record<string, unknown>) => {
    setLoading(true);
    // Import wsSend dynamically to avoid circular deps
    import('./useWebSocket').then(({ wsSend }) => wsSend(cmd));
  }, []);

  return { data, loading, send };
}
