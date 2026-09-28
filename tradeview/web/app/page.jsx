'use client';
// The whole app is imperative (charts, Monaco, WebSocket): mount it on the client only (§14).
import { useEffect, useRef } from 'react';

export default function Page() {
  const rootRef = useRef(null);

  useEffect(() => {
    let cleanup = null;
    let cancelled = false;
    import('../src/main.js')
      .then(({ mountApp }) => {
        if (!cancelled && rootRef.current) cleanup = mountApp(rootRef.current);
      })
      .catch((err) => {
        console.error('[tradeview] failed to load the app bundle', err);
        if (rootRef.current) {
          rootRef.current.textContent = `TradeView failed to load: ${err && err.message ? err.message : err}`;
          rootRef.current.className = 'tv-root boot-error';
        }
      });
    return () => {
      cancelled = true;
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div id="tv-root" className="tv-root" ref={rootRef}>
      <div className="boot-splash">
        <span className="spinner lg" />
        <span>Loading TradeView…</span>
      </div>
      <noscript>TradeView needs JavaScript enabled.</noscript>
    </div>
  );
}
