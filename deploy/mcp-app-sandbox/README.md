# Restricted MCP Apps sandbox

This is a separate, cookie-free deployment for Neo Chat's opt-in MCP Apps
**display-only** profile. It is not the `neo-html` runner. The host uses
`@modelcontextprotocol/ext-apps@1.7.5` with MCP SDK 1.30.0 and protocol
`2026-01-26`.

## Deployment configuration

1. Assign this Worker a dedicated HTTPS origin with no application cookies,
   authentication middleware, stored user data, or other applications. Prefer a
   different registrable domain from Neo Chat; do not share domain cookies.
2. Replace `MCP_APPS_HOST_ORIGIN` in `wrangler.jsonc` with the exact HTTPS chat
   origin. Deploy the Worker separately after the release checks below.
3. Set `NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN` to the exact sandbox **origin** in
   Neo Chat's build environment, then rebuild the chat application. Paths,
   credentials, query strings, fragments and wildcards are rejected. The host
   loads only `/sandbox`. A same-origin deployment is rejected.
4. In Settings → System, enable Intelligent UI and Allow MCP application views.
   Apps is off by default. Reinstall/refresh the MCP server's tool discovery
   after enabling it, so extension-aware servers can return UI metadata.

The sandbox accepts no URL-based policy overrides and stores no resource HTML.
It receives HTML only through the standard in-memory resource notification.
Its response has independent CSP, exact `frame-ancestors`, `no-store`, and no
`X-Frame-Options: DENY`. The chat CSP adds only the configured sandbox origin.
Do not inject the chat application's global response headers into this Worker.

Check the deployment package without publishing:

```sh
corepack pnpm exec wrangler deploy --dry-run --config deploy/mcp-app-sandbox/wrangler.jsonc
```

## Supported profile

- Installed, active MCP tool metadata binds the resource URI, server and current
  function fingerprint. Tool output metadata cannot create this association.
- The host performs a signed/BYOK resource read with a 15-second deadline.
  Exactly one UTF-8 text resource with matching URI and
  `text/html;profile=mcp-app` MIME is accepted, up to 2 MiB (the existing MCP
  transport response cap may be tighter).
- The official `AppBridge` uses a null MCP client. No implicit server request
  forwarding is installed. Standard initialization, inline context/theme,
  bounded size changes and teardown are supported. Initialization times out
  after 10 seconds; teardown waits at most 2 seconds.
- Only visible text from this completed tool result is sent to the App. The
  restricted profile sends an empty input-arguments object and excludes raw
  `_meta`, images, structured hidden data, credentials and other calls.
  Applications requiring those fields are outside this profile.
- No `serverTools`, `serverResources`, chat messages, model-context updates,
  sampling, external links, downloads, clipboard, camera or microphone capability
  is declared. Unsupported requests receive JSON-RPC method-not-found errors.
  Remote `readOnlyHint` is not trusted authorization. No same-server read tool
  is exposed until a separate host-approved policy exists.
- Resources requesting network/resource/frame domains, a dedicated domain, or
  browser permissions are rejected. Inline scripts/styles and data images are
  restricted by the separate proxy CSP and opaque inner sandbox. External
  sources, navigation attributes and nested frames are removed from the initial
  document. The generated App cannot weaken either CSP.
- The original tool result remains the static fallback in reading, sharing and
  export. Arbitrary JavaScript state is not persisted. Retry is explicit.

The MCP resource API uses short-lived connections. This host does not advertise
persistent notifications or support Apps requiring continuity with the original
server tool-call session. No claim of complete MCP Apps interoperability is made.

## Evidence and release conditions

Focused tests exercise the actual pinned `AppBridge` handshake, restricted
transport, resource policy, proxy document construction, late/duplicate messages,
reload invalidation, timeouts, and the current installed-tool binding. These are
unit/contract tests, **not browser isolation or deployment evidence**.

Before enabling this experimental feature in production, separately validate
an official self-contained App fixture on the deployed two-origin setup,
response headers, cookie isolation, navigation and redirects, popup/download
blocking, browser permission denial, reload/teardown, and the no-network policy.
No real browser, E2E, deployment or live MCP server was used for this change.
CSP and sandbox do not provide a CPU/memory hard limit or prove absolutely zero
outbound navigation. Apps requiring broader permissions remain static.
