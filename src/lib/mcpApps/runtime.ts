import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { McpAppTransport } from "./transport";
import { MCP_APP_INIT_TIMEOUT, MCP_APP_TEARDOWN_TIMEOUT } from "./policy";

export type McpAppPhase = "loading" | "initializing" | "ready" | "failed";

/** Request/response display host. A null client prevents implicit server forwarding. */
export function createMcpAppRuntime(options: {
  target: Window;
  origin: string;
  html: string;
  result: { content: { type: "text"; text: string }[] };
  current: () => boolean;
  onPhase: (phase: McpAppPhase) => void;
  onHeight: (height: number) => void;
  theme: "light" | "dark";
  locale: string;
}) {
  let disposed = false;
  let initialized = false;
  let proxyReady = false;
  let loadCount = 0;
  let contextRevision = 0;
  let sentContextRevision = -1;
  let contextFlush: Promise<void> | null = null;
  let ready = false;
  const current = () => !disposed && options.current();
  const transport = new McpAppTransport(
    options.target,
    options.origin,
    current,
  );
  let hostContext = {
    theme: options.theme,
    locale: options.locale,
    displayMode: "inline" as const,
    availableDisplayModes: ["inline" as const],
    containerDimensions: { maxHeight: 720 },
    platform: "web" as const,
  };
  const bridge = new AppBridge(
    null,
    { name: "neo-chat", version: "2.6.0" },
    { sandbox: { permissions: {}, csp: {} } },
    { hostContext },
  );
  const snapshotHostContext = () => ({
    ...hostContext,
    availableDisplayModes: [...hostContext.availableDisplayModes],
    containerDimensions: { ...hostContext.containerDimensions },
  });
  const sendFullHostContext = async () => {
    // AppBridge.setHostContext() intentionally sends only changed fields in
    // SDK 1.7.5. The runtime contract requires a complete context before tool
    // data, so use the SDK's public low-level sender with an immutable snapshot.
    await bridge.sendHostContextChange(snapshotHostContext());
  };
  const flushContextAfterReady = () => {
    if (contextFlush || !ready || disposed) return;
    contextFlush = (async () => {
      try {
        while (ready && current() && sentContextRevision < contextRevision) {
          const revision = contextRevision;
          await sendFullHostContext();
          if (!current()) return;
          sentContextRevision = revision;
        }
      } catch {
        if (current()) fail();
      } finally {
        contextFlush = null;
        if (ready && current() && sentContextRevision < contextRevision) {
          flushContextAfterReady();
        }
      }
    })();
  };
  const timer = setTimeout(() => fail(), MCP_APP_INIT_TIMEOUT);
  function fail() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    options.onPhase("failed");
    void bridge.close();
  }
  bridge.onerror = fail;
  transport.onerror = fail;
  bridge.onsandboxready = () => {
    if (!current()) return;
    if (proxyReady) {
      fail();
      return;
    }
    proxyReady = true;
    void bridge
      .sendSandboxResourceReady({
        html: options.html,
        sandbox: "allow-scripts",
      })
      .catch(fail);
  };
  bridge.oninitialized = () => {
    if (!current() || !proxyReady || initialized) {
      fail();
      return;
    }
    initialized = true;
    clearTimeout(timer);
    void (async () => {
      try {
        // A theme/locale update can arrive between ui/initialized and this
        // await. Keep sending complete snapshots until the latest revision is
        // on the wire, then expose ready to the rest of the host.
        while (current() && sentContextRevision < contextRevision) {
          const revision = contextRevision;
          await sendFullHostContext();
          if (!current()) return;
          sentContextRevision = revision;
        }
        if (!current()) return;
        ready = true;
        options.onPhase("ready");
        // Arguments are deliberately omitted from this restricted profile.
        await bridge.sendToolInput({ arguments: {} });
        if (current()) await bridge.sendToolResult(options.result);
      } catch {
        if (current()) fail();
      }
    })();
  };
  bridge.onsizechange = ({ height }) => {
    if (
      current() &&
      initialized &&
      typeof height === "number" &&
      Number.isFinite(height)
    )
      options.onHeight(Math.max(120, Math.min(720, height)));
  };
  bridge.onrequestteardown = fail;
  return {
    async start() {
      options.onPhase("initializing");
      await bridge.connect(transport);
    },
    loaded() {
      if (++loadCount > 1) fail();
    },
    context(theme: "light" | "dark", locale: string) {
      if (!current()) return;
      hostContext = { ...hostContext, theme, locale };
      contextRevision += 1;
      if (ready) flushContextAfterReady();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      transport.drain();
      if (initialized) {
        try {
          await bridge.teardownResource(
            {},
            { timeout: MCP_APP_TEARDOWN_TIMEOUT },
          );
        } catch {
          /* Bounded cleanup; capabilities already revoked. */
        }
      }
      await bridge.close();
    },
  };
}
