import { uiSourceRequestSchema } from "./types";
import { parseSourceDatasetContent } from "./content";
import type {
  UiSourceBinding,
  UiSourceContext,
  UiSourceMaterial,
  UiSourceProjection,
  UiSourceRequest,
  UiSourceStatus,
} from "./types";

export async function hashUiSourceContent(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function getUiSourceAlias(
  sessionId: string,
  sourceRef: string,
  version: string,
): Promise<string> {
  return `source-${(await hashUiSourceContent(`${sessionId}\u0000${sourceRef}\u0000${version}`)).slice(0, 16)}`;
}

export async function createUiSourceContext(
  sessionId: string,
  materials: readonly UiSourceMaterial[],
): Promise<UiSourceContext> {
  const entries = await Promise.all(
    materials
      .filter((material) => material.sessionId === sessionId)
      .map(async (material) => {
        const alias = await getUiSourceAlias(
          sessionId,
          material.sourceRef,
          material.version,
        );
        return [
          alias,
          Object.freeze({
            ...material,
            publicMetadata: material.publicMetadata
              ? Object.freeze({ ...material.publicMetadata })
              : undefined,
          }),
        ] as const;
      }),
  );
  return { sessionId, materials: new Map(entries) };
}

function status(
  material: UiSourceMaterial | undefined,
  version?: string,
  hash?: string,
  locator?: string,
): UiSourceStatus {
  if (!material) return "unavailable";
  if (material.access !== "allowed") return "access-denied";
  if (
    (version && version !== material.version) ||
    (hash && hash !== material.contentHash)
  )
    return "version-mismatch";
  if (locator && locator !== material.locator) return "unverified";
  return material.availability === "available" ? "resolved" : "unavailable";
}

export function resolveUiSources(
  requests: readonly UiSourceRequest[],
  context: UiSourceContext,
  sessionId: string,
): UiSourceBinding[] {
  return requests.slice(0, 50).map((request) => {
    const parsed = uiSourceRequestSchema.safeParse(request);
    const material =
      parsed.success && context.sessionId === sessionId
        ? context.materials.get(parsed.data.alias)
        : undefined;
    const bindingStatus =
      !parsed.success || context.sessionId !== sessionId
        ? "unverified"
        : status(material, parsed.data.version, undefined, parsed.data.locator);
    return {
      bindingId: `${parsed.success ? parsed.data.alias : "invalid"}:${material?.version ?? "unbound"}`,
      alias: parsed.success ? parsed.data.alias : "invalid",
      ...(material
        ? {
            kind: material.kind,
            sourceRef: material.sourceRef,
            version: material.version,
            contentHash: material.contentHash,
            locator: material.locator,
            capturedAt: material.capturedAt,
          }
        : {}),
      // Preserve the requested version so a forged version cannot become resolved on reread.
      ...(parsed.success && parsed.data.version
        ? { version: parsed.data.version }
        : {}),
      ...(parsed.success && parsed.data.locator
        ? { locator: parsed.data.locator }
        : {}),
      bindingStatus,
    };
  });
}

export function revalidateUiSources(
  bindings: readonly UiSourceBinding[],
  context: UiSourceContext,
): UiSourceBinding[] {
  return bindings.slice(0, 50).map((binding) => {
    const material = context.materials.get(binding.alias);
    const matches =
      material?.sessionId === context.sessionId &&
      material.sourceRef === binding.sourceRef &&
      !!binding.version &&
      !!binding.contentHash;
    return {
      ...binding,
      bindingStatus: matches
        ? status(
            material,
            binding.version,
            binding.contentHash,
            binding.locator,
          )
        : "unavailable",
    };
  });
}

/** Reject secret-bearing and local links rather than attempting token-name heuristics. */
export function publicUiSourceUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      !/^https?:$/.test(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    if (
      url.hostname === "localhost" ||
      url.hostname.endsWith(".local") ||
      !url.hostname.includes(".") ||
      /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
      url.hostname.includes(":")
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Projection requires a live context; a serialized binding is never authority. */
export function projectUiSources(
  bindings: readonly UiSourceBinding[],
  context: UiSourceContext,
  options: { publicOnly: boolean; includeContent?: boolean },
): UiSourceProjection[] {
  return revalidateUiSources(bindings, context).map((binding) => {
    const material = context.materials.get(binding.alias);
    const usable =
      material &&
      material.sessionId === context.sessionId &&
      material.sourceRef === binding.sourceRef;
    const metadata = usable ? material.publicMetadata : undefined;
    const canRetain =
      usable &&
      material.access === "allowed" &&
      (binding.bindingStatus === "resolved" ||
        (binding.bindingStatus === "unavailable" &&
          material.retentionPolicy === "fixed-snapshot" &&
          binding.contentHash === material.contentHash &&
          binding.version === material.version));
    if (options.publicOnly || !canRetain)
      return {
        title: metadata?.title ?? "",
        ...(metadata && material ? { version: material.version } : {}),
        url: publicUiSourceUrl(metadata?.url),
        bindingStatus: binding.bindingStatus,
      };
    return {
      title: material.title,
      version: material.version,
      locator: material.locator,
      extraction: material.extraction,
      capturedAt: material.capturedAt,
      bindingStatus: binding.bindingStatus,
      ...(options.includeContent ? { content: material.content } : {}),
    };
  });
}

/** Only aliases/versions and readable titles are advertised, never private IDs or URLs. */
export function deriveMessageSourceAliases(context: UiSourceContext): string {
  return JSON.stringify(
    Array.from(context.materials, ([alias, material]) => ({ alias, material }))
      .filter(
        ({ material }) =>
          material.access === "allowed" &&
          material.availability === "available",
      )
      .map(({ alias, material }) => {
        const dataset =
          material.content &&
          (material.kind === "tool" ||
            (material.kind === "attachment" &&
              /\.(csv|json)$/i.test(material.title)))
            ? parseSourceDatasetContent(material.content)
            : null;
        return {
          alias,
          version: material.version,
          title: material.title,
          ...(dataset
            ? { columns: dataset.columns, rowCount: dataset.rows.length }
            : {}),
        };
      }),
  );
}
