/** Deploy separately on a cookie-free origin; never serve this on the chat origin. */
export function sandboxResponse(request, env) {
  let origin;
  try {
    const url = new URL(env.MCP_APPS_HOST_ORIGIN);
    if (
      url.protocol !== "https:" ||
      url.origin === new URL(request.url).origin ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    origin = url.origin;
  } catch {
    return new Response("Invalid deployment configuration", { status: 503 });
  }
  const url = new URL(request.url);
  if (url.pathname !== "/sandbox" || url.search || request.method !== "GET")
    return new Response("Not found", { status: 404 });
  const script = `(${proxy.toString()})(${JSON.stringify(origin)})`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>MCP App sandbox</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style></head><body><script>${script}</script></body></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${origin}`,
        "Permissions-Policy":
          "camera=(), microphone=(), geolocation=(), clipboard-write=(), payment=(), usb=(), serial=(), display-capture=()",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    },
  );
}

function proxy(hostOrigin) {
  let view = null;
  let loads = 0;
  let active = true;
  const notify = (message) => parent.postMessage(message, hostOrigin);
  const fail = () => {
    active = false;
    view?.remove();
    notify({ jsonrpc: "2.0", method: "neo/mcp-app-failed" });
  };
  window.addEventListener("message", (event) => {
    if (!active) return;
    const fromHost = event.source === parent && event.origin === hostOrigin;
    const fromView =
      view && event.source === view.contentWindow && event.origin === "null";
    if (!fromHost && !fromView) return;
    let data;
    try {
      // Structured clone can carry cycles and BigInt; the protocol cannot.
      const serialized = JSON.stringify(event.data);
      if (!serialized) return;
      data = JSON.parse(serialized);
    } catch {
      return;
    }
    if (!data || data.jsonrpc !== "2.0") return;
    if (fromHost) {
      if (data.method === "ui/notifications/sandbox-resource-ready") {
        if (
          view ||
          typeof data.params?.html !== "string" ||
          data.params.html.length > 2097152
        )
          return fail();
        // The host already validated resource policy. Re-enforce local-only execution here.
        const doc = new DOMParser().parseFromString(
          data.params.html,
          "text/html",
        );
        doc
          .querySelectorAll("base,meta[http-equiv],iframe,object,embed,link")
          .forEach((el) => el.remove());
        for (const el of doc.querySelectorAll("*")) {
          for (const attr of [...el.attributes]) {
            if (
              /^on/i.test(attr.name) ||
              /^(action|formaction|target|formtarget|srcdoc|ping)$/i.test(
                attr.name,
              )
            )
              el.removeAttribute(attr.name);
            if (
              /^(src|href|poster|srcset|xlink:href)$/i.test(attr.name) &&
              !attr.value.startsWith("data:") &&
              !attr.value.startsWith("#")
            )
              el.removeAttribute(attr.name);
          }
        }
        const csp = doc.createElement("meta");
        csp.httpEquiv = "Content-Security-Policy";
        csp.content =
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'";
        doc.head.prepend(csp);
        const guard = doc.createElement("script");
        guard.textContent =
          "document.addEventListener('submit',e=>e.preventDefault(),true);document.addEventListener('click',e=>{if(e.target.closest?.('a'))e.preventDefault()},true);";
        csp.after(guard);
        view = document.createElement("iframe");
        view.setAttribute("sandbox", "allow-scripts");
        view.setAttribute("referrerpolicy", "no-referrer");
        view.title = "MCP App view";
        view.addEventListener("load", () => {
          if (++loads > 1) fail();
        });
        view.srcdoc = "<!doctype html>" + doc.documentElement.outerHTML;
        document.body.append(view);
      } else if (view) {
        view.contentWindow.postMessage(data, "*"); // Opaque origin, exact bound inner window.
      }
    } else if (fromView) {
      // Proxy-only lifecycle notifications cannot be forged by the View.
      if (
        data.method === "ui/notifications/sandbox-proxy-ready" ||
        data.method === "ui/notifications/sandbox-resource-ready" ||
        String(data.method || "").startsWith("neo/")
      )
        return;
      notify(data);
    }
  });
  notify({
    jsonrpc: "2.0",
    method: "ui/notifications/sandbox-proxy-ready",
    params: {},
  });
}

const worker = { fetch: sandboxResponse };
export default worker;
