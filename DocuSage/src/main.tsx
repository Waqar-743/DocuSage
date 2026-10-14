import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "./lib/api";

// Keep the public website usable in development too. The explicit preview
// route is a UI sandbox and never evidence of native functionality.
const desktop = isTauri() || (import.meta.env.DEV && new URLSearchParams(location.search).has('desktop-preview'));
// Keep each import in its own loader. Vite can otherwise attach the last
// branch's CSS preload list to the entire conditional expression, rendering
// the native app with the marketing stylesheet in production.
const DesktopInterface = React.lazy(() => import('./App'));
const WebsiteInterface = React.lazy(() => import('./MarketingSite'));
const Interface = desktop ? DesktopInterface : WebsiteInterface;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <React.Suspense fallback={<p role="status">Loading DocuSage…</p>}>
      <Interface />
    </React.Suspense>
  </React.StrictMode>,
);
