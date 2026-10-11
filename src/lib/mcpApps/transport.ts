import {
  McpUiInitializeRequestSchema,
  McpUiInitializeResultSchema,
  McpUiInitializedNotificationSchema,
  McpUiSandboxProxyReadyNotificationSchema,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
} from "@modelcontextprotocol/sdk/types.js";

/** One transport per iframe generation. Window AND deployment origin bind identity. */
export class McpAppTransport implements Transport {
  onmessage?: Transport["onmessage"];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  private started = false;
  private closed = false;
  private draining = false;
  private requests = new Set<string>();
  private initializeId: string | null = null;
  private initializeSent = false;
  private initialized = false;
  private proxyReady = false;
  private fail(message: string) {
    this.onerror?.(new Error(message));
    void this.close();
  }
  constructor(
    private target: Window,
    private origin: string,
    private current: () => boolean,
    private host: Pick<
      Window,
      "addEventListener" | "removeEventListener"
    > = window,
  ) {}
  private receive = (event: MessageEvent) => {
    if (
      this.closed ||
      (!this.draining && !this.current()) ||
      event.source !== this.target ||
      event.origin !== this.origin
    )
      return;
    let message: JSONRPCMessage;
    try {
      // postMessage accepts structured-clone values that JSON-RPC cannot carry.
      const serialized = JSON.stringify(event.data);
      if (!serialized || new TextEncoder().encode(serialized).length > 256_000)
        return;
      const parsed = JSONRPCMessageSchema.safeParse(JSON.parse(serialized));
      if (!parsed.success) return;
      message = parsed.data;
    } catch {
      return;
    }
    if ("method" in message && message.method === "neo/mcp-app-failed") {
      this.onerror?.(new Error("proxy_failed"));
      return;
    }
    if (this.draining && "method" in message) return;
    if (
      "method" in message &&
      message.method === "ui/notifications/sandbox-proxy-ready"
    ) {
      if (
        "id" in message ||
        this.proxyReady ||
        !McpUiSandboxProxyReadyNotificationSchema.safeParse(message).success
      ) {
        this.fail("invalid_proxy_ready_notification");
        return;
      }
      this.proxyReady = true;
    }
    if (
      "method" in message &&
      message.method === "ui/notifications/initialized"
    ) {
      if (
        "id" in message ||
        !McpUiInitializedNotificationSchema.safeParse(message).success
      ) {
        this.fail("invalid_initialized_notification");
        return;
      }
      if (!this.initializeSent || this.initialized) {
        this.fail("invalid_initialization_order");
        return;
      }
      this.initialized = true;
    }
    if ("method" in message && "id" in message) {
      const key = JSON.stringify(message.id);
      if (this.requests.has(key)) {
        if (message.method === "ui/initialize")
          this.fail("duplicate_initialization");
        return;
      } // Never execute duplicate request ids.
      if (this.requests.size >= 1024) {
        this.fail("request_limit");
        return;
      }
      this.requests.add(key);
      if (message.method === "ui/initialize") {
        if (!McpUiInitializeRequestSchema.safeParse(message).success) {
          this.fail("invalid_initialize_request");
          return;
        }
        if (this.initializeId !== null) {
          this.fail("duplicate_initialization");
          return;
        }
        this.initializeId = key;
      }
      if (message.method !== "ui/initialize" && message.method !== "ping") {
        this.target.postMessage(
          {
            jsonrpc: "2.0",
            id: message.id,
            error: {
              code: -32601,
              message: "Capability unavailable in this host",
            },
          },
          this.origin,
        );
        return;
      }
    }
    this.onmessage?.(message);
  };
  async start() {
    if (this.started || this.closed) throw new Error("transport_closed");
    this.started = true;
    this.host.addEventListener("message", this.receive as EventListener);
  }
  async send(message: JSONRPCMessage) {
    if (this.closed || (!this.draining && !this.current()))
      throw new Error("instance_expired");
    const initializes =
      "id" in message && JSON.stringify(message.id) === this.initializeId;
    if (initializes && "result" in message) {
      const parsed = McpUiInitializeResultSchema.safeParse(message.result);
      if (
        !parsed.success ||
        !SUPPORTED_PROTOCOL_VERSIONS.includes(parsed.data.protocolVersion)
      ) {
        this.fail("invalid_initialize_result");
        throw new Error("invalid_initialize_result");
      }
    }
    this.target.postMessage(message, this.origin);
    if (initializes) {
      if ("result" in message) this.initializeSent = true;
      else if ("error" in message) this.fail("initialization_rejected");
    }
  }
  /** Revoke requests immediately, but accept the bounded teardown response. */
  drain() {
    this.draining = true;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.host.removeEventListener("message", this.receive as EventListener);
    this.requests.clear();
    this.onclose?.();
  }
}
