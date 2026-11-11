import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import { reloadForNewBuild } from "./lib/stale-build";
import { sentryOptions } from "./lib/sentry-options";
import { startLanguage } from "./lib/i18n";
import "./index.css";
// TRAK-163: Arc component tokens, scoped to .arc (see the file for why).
import "./components/arc/arc-theme.css";

Sentry.init(sentryOptions({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  prod: import.meta.env.PROD,
  mode: import.meta.env.MODE,
}))

// TRAK-192: Vite says a lazy screen's file failed to load, as happens when the
// tab is older than the latest deploy. Reload once for the new release; the
// error still reaches ErrorBoundary, which shows "Trak has just been updated".
window.addEventListener('vite:preloadError', () => { reloadForNewBuild() })

// Catch unhandled promise rejections — forwards to Sentry in production.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Trak] Unhandled promise rejection:', event.reason)
  Sentry.captureException(event.reason)
  event.preventDefault()
})

if (import.meta.env.DEV) {
  // Runtime render-performance overlay — highlights components that re-render
  const { scan } = await import("react-scan");
  scan({ enabled: true, showToolbar: true });

  // Accessibility audit — logs violations to the browser console
  const axe = await import("@axe-core/react");
  const React = await import("react");
  const ReactDOM = await import("react-dom");
  axe.default(React.default, ReactDOM.default, 1000);
}

// TRAK-406: the language last picked on this device is ready before the first screen, so nothing flashes in English.
// startLanguage never fails (it stays English if the words can't load); `finally` makes sure Trak opens regardless.
void startLanguage().finally(() => {
  createRoot(document.getElementById("root")!).render(<App />);
});
