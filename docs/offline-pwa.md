# Local offline PWA

Neo Chat registers its Service Worker only when `DEPLOYMENT_MODE=local`.
Hosted deployments proactively unregister `/sw.js` and delete cache names owned
by Neo Chat. This prevents a deployment from accidentally retaining offline
history behavior after it moves from local to hosted mode.

On the first online load, the app caches its navigation shell, manifest, icons,
and the same-origin `/_next/static/` resources used by that build. A subsequent
offline navigation can hydrate the normal client application and read the
browser's existing IndexedDB and OPFS data. If shell preparation was incomplete,
a small localized fallback asks the user to reconnect once.

Offline mode is deliberately read-only. Session navigation, local global
search, knowledge-file reading, and backup export remain available. Message
sending and mutation, model generation, MCP, synchronization, web search,
external RAG, voice providers, and reindexing stay disabled until the browser
is online.

The Service Worker never caches:

- `/api/*` or event-stream requests;
- external origins;
- `/_next/image` responses;
- file, media, or upload routes;
- IndexedDB or OPFS content.

Navigation uses network-first behavior. Versioned static assets use
cache-first behavior, and old Neo Chat cache versions are removed during
activation. When a new worker is ready, the app shows an explicit reload action
instead of replacing a running conversation without consent.

Clearing browser site data removes both the offline shell and all local app
data. The deployment access password is a server gate, not an operating-system
device lock; protect the browser profile and device account when retaining
sensitive offline history.
