/** Inert template parsing never attaches untrusted resources to a document.
 * Keep this function self-contained: the fixed sandbox embeds its source. */
export function prepareIntelligentHtml(source: string, executable = false) {
  const template = document.createElement("template");
  template.innerHTML = source;
  const scripts: Array<{ source?: string; url?: string; type?: "module" }> = [];
  const styles: string[] = [];
  const resources: Array<{
    kind: "script" | "style";
    source?: string;
    url?: string;
    integrity?: string;
    type?: "module";
  }> = [];
  const forbidden = new Set(
    "iframe frame frameset object embed base portal fencedframe".split(" "),
  );
  const isHttps = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  const isCdn = (value: string, font = false) => {
    if (!isHttps(value)) return false;
    const url = new URL(value);
    return (
      (url.origin === "https://cdn.jsdelivr.net" &&
        url.pathname.startsWith("/npm/")) ||
      (url.origin === "https://cdnjs.cloudflare.com" &&
        url.pathname.startsWith("/ajax/libs/")) ||
      url.origin === "https://unpkg.com" ||
      (font && url.origin === "https://fonts.googleapis.com")
    );
  };
  const safeMedia = (value: string) =>
    value.startsWith("data:image/") || (executable && isHttps(value));
  const safeSrcset = (value: string) => {
    let rest = value.trim();
    if (!rest) return false;
    while (rest) {
      const token = rest.match(/^[^\s]+/)?.[0];
      if (!token) return false;
      rest = rest.slice(token.length).trimStart();
      const url = token.replace(/,+$/, "");
      if (!safeMedia(url)) return false;
      if (token.endsWith(",")) continue;
      const comma = rest.indexOf(",");
      const descriptor = (comma < 0 ? rest : rest.slice(0, comma)).trim();
      if (
        descriptor &&
        !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor)
      )
        return false;
      rest = comma < 0 ? "" : rest.slice(comma + 1).trimStart();
    }
    return true;
  };
  const reject = (message: string) => {
    if (executable) throw new Error(message);
  };
  function visit(root: DocumentFragment, inert = false) {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      const tag = element.localName.toLowerCase();
      if (tag === "meta") {
        if (element.hasAttribute("http-equiv"))
          reject("Unsupported capability: http-equiv");
        element.remove();
        continue;
      }
      if (forbidden.has(tag)) {
        reject(`Unsupported capability: ${tag}`);
        element.remove();
        continue;
      }
      if (tag === "script") {
        const type = (element.getAttribute("type") || "").trim().toLowerCase();
        // Data blocks stay in the DOM for generated scripts to read. Previews
        // still remove every script element, including data blocks.
        if (
          executable &&
          ["application/json", "application/ld+json"].includes(type)
        )
          continue;
        const url = element.getAttribute("src");
        if (executable && !inert) {
          if (
            type &&
            !["text/javascript", "application/javascript", "module"].includes(
              type,
            )
          )
            throw new Error("Unsupported script type");
          if (url && !isCdn(url)) throw new Error("Unsupported script source");
          const script = {
            ...(url ? { url } : { source: element.textContent || "" }),
            ...(type === "module" ? { type: "module" as const } : {}),
          };
          scripts.push(script);
          resources.push({
            kind: "script",
            ...script,
            integrity: element.getAttribute("integrity") || undefined,
          });
        }
        element.remove();
        continue;
      }
      if (tag === "link") {
        const url = element.getAttribute("href") || "";
        if (
          executable &&
          !inert &&
          element.getAttribute("rel") === "stylesheet"
        ) {
          if (!isCdn(url, true))
            throw new Error("Unsupported stylesheet source");
          styles.push(url);
          resources.push({
            kind: "style",
            url,
            integrity: element.getAttribute("integrity") || undefined,
          });
        }
        element.remove();
        continue;
      }
      for (const attr of Array.from(element.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith("on")) {
          if (!executable) element.removeAttribute(attr.name);
          continue;
        }
        if (
          [
            "action",
            "method",
            "enctype",
            "formmethod",
            "formenctype",
            "formaction",
            "target",
            "formtarget",
            "ping",
            "srcdoc",
            "autofocus",
          ].includes(name)
        ) {
          reject(`Unsupported capability: ${name}`);
          element.removeAttribute(attr.name);
          continue;
        }
        if (
          [
            "src",
            "href",
            "xlink:href",
            "poster",
            "background",
            "srcset",
          ].includes(name)
        ) {
          const fragment = value.startsWith("#");
          const media = [
            "img",
            "audio",
            "video",
            "source",
            "track",
            "image",
            "feimage",
            "input",
          ].includes(tag);
          const safe =
            fragment ||
            (media &&
              (name === "srcset" ? safeSrcset(value) : safeMedia(value)));
          if (!safe || (["a", "area"].includes(tag) && !fragment)) {
            if (executable && !media) reject(`Unsupported URL: ${name}`);
            element.removeAttribute(attr.name);
          }
        }
      }
      if (
        !executable &&
        ["button", "input", "select", "textarea"].includes(tag)
      )
        element.setAttribute("disabled", "");
      if (tag === "template")
        visit((element as HTMLTemplateElement).content, true);
    }
  }
  visit(template.content);
  return { html: template.innerHTML, scripts, styles, resources };
}

export function createIntelligentHtmlPreview(source: string): string {
  const { html } = prepareIntelligentHtml(source);
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><style>html,body{background:transparent;margin:0}body{font:14px system-ui;overflow-wrap:anywhere}*{box-sizing:border-box}canvas,svg,img,video{max-width:100%}</style></head><body>${html}</body></html>`;
}
