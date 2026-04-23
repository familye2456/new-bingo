import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const root = ReactDOM.createRoot(document.getElementById('root')!);

// Show a splash screen while the SW downloads and caches all assets.
// Once the SW is installed (or if there's no SW support), render the app.
function renderApp() {
  root.render(<App />);
}

function renderSplash() {
  root.render(
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#0e1a35',
      color: '#fff',
      fontFamily: 'sans-serif',
      gap: '1.5rem',
    }}>
      <img src="/icons/icon-192.svg" width={80} height={80} alt="Fidel Bingo" />
      <p style={{ fontSize: '1.1rem', opacity: 0.85 }}>Downloading app, please wait…</p>
      <div style={{
        width: 200,
        height: 6,
        background: 'rgba(255,255,255,0.15)',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: '40%',
          background: '#f59e0b',
          borderRadius: 3,
          animation: 'pwa-progress 1.4s ease-in-out infinite',
        }} />
      </div>
      <style>{`
        @keyframes pwa-progress {
          0%   { transform: translateX(-100%); width: 40%; }
          50%  { width: 60%; }
          100% { transform: translateX(350%); width: 40%; }
        }
      `}</style>
    </div>
  );
}

if (!('serviceWorker' in navigator)) {
  // No SW support — just render immediately
  renderApp();
} else {
  renderSplash();

  // Absolute fallback — if SW registration never calls back, render anyway
  const absoluteFallback = setTimeout(renderApp, 4000);

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      clearTimeout(absoluteFallback);
      if (!registration) { renderApp(); return; }

      const sw = registration.installing ?? registration.waiting ?? registration.active;

      if (registration.active && !registration.installing && !registration.waiting) {
        // SW already active from a previous install — app is ready
        renderApp();
        return;
      }

      // Wait for the installing SW to reach 'activated' state (max 2s)
      const target = registration.installing ?? registration.waiting;
      if (target) {
        let rendered = false;
        const render = () => { if (!rendered) { rendered = true; renderApp(); } };
        const timeout = setTimeout(render, 2000);
        target.addEventListener('statechange', function handler() {
          if (this.state === 'activated' || this.state === 'installed') {
            clearTimeout(timeout);
            target.removeEventListener('statechange', handler);
            render();
          }
        });
      } else {
        renderApp();
      }
    },
    onOfflineReady() {
      // All assets cached — render if not already rendered
      renderApp();
    },
  });
}
