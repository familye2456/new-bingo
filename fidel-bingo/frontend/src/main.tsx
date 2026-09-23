import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';

const root = ReactDOM.createRoot(document.getElementById('root')!);

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
  renderApp();
} else {
  renderSplash();

  const absoluteFallback = setTimeout(renderApp, 4000);

  registerSW({
    immediate: true,

    onRegisteredSW(_swUrl, registration) {
      clearTimeout(absoluteFallback);
      if (!registration) { renderApp(); return; }

      if (registration.active && !registration.installing && !registration.waiting) {
        renderApp();
        return;
      }

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
      renderApp();
    },
  });

  // Listen for the SW 'activated' event with isUpdate=true — show update screen
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready.then((reg) => {
      // Watch for a new SW becoming active (autoUpdate fires skipWaiting automatically)
      const checkForUpdate = (sw: ServiceWorker) => {
        sw.addEventListener('statechange', function handler() {
          if (this.state === 'activated') {
            sw.removeEventListener('statechange', handler);
            window.dispatchEvent(new CustomEvent('sw-update-available'));
          }
        });
      };

      if (reg.waiting) checkForUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        if (reg.installing) checkForUpdate(reg.installing);
      });
    }).catch(() => {});
  }
}
