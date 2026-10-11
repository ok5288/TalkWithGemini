import { z } from "zod";

export const uiSourceRequestSchema = z
  .object({
    alias: z.string().regex(/^source-[a-f0-9]{16}$/),
    version: z.string().max(200).optional(),
    locator: z.string().max(500).optional(),
  })
  .strict();

export type UiSourceRequest = z.infer<typeof uiSourceRequestSchema>;
export type UiSourceKind =
  "attachment" | "web" | "knowledge" | "report" | "evidence" | "tool";
export type UiSourceStatus =
  | "resolved"
  | "unavailable"
  | "access-denied"
  | "version-mismatch"
  | "unverified";

/** These values come from host adapters, never generated definitions. */
export interface UiSourceMaterial {
  sessionId: string;
  sourceRef: string;
  kind: UiSourceKind;
  title: string;
  version: string;
  contentHash: string;
  capturedAt: number;
  content?: string;
  locator?: string;
  extraction?: string;
  access: "allowed" | "denied" | "unknown";
  availability: "available" | "unavailable";
  retentionPolicy: "session" | "fixed-snapshot" | "none";
  publicMetadata?: { title: string; url?: string };
}

export interface UiSourceContext {
  sessionId: string;
  materials: ReadonlyMap<string, UiSourceMaterial>;
}

/** Serializable reference. Status must be revalidated before any content use. */
export interface UiSourceBinding {
  bindingId: string;
  alias: string;
  kind?: UiSourceKind;
  sourceRef?: string;
  version?: string;
  contentHash?: string;
  locator?: string;
  capturedAt?: number;
  bindingStatus: UiSourceStatus;
}

export interface UiSourceProjection {
  title: string;
  url?: string;
  version?: string;
  locator?: string;
  extraction?: string;
  capturedAt?: number;
  content?: string;
  bindingStatus: UiSourceStatus;
}

const storedBindingSchema = z.object({
  alias: uiSourceRequestSchema.shape.alias,
  kind: z.enum([
    "attachment",
    "web",
    "knowledge",
    "report",
    "evidence",
    "tool",
  ]),
  sourceRef: z.string().min(1).max(2048),
  version: z.string().min(1).max(200),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  locator: z.string().max(2048).optional(),
  capturedAt: z.number().finite().nonnegative().optional(),
});

/** Import identities, not serialized claims of current authorization. */
export function normalizeUiSourceBindings(value: unknown): UiSourceBinding[] {
  if (!Array.isArray(value)) return [];
  const bindings: UiSourceBinding[] = [];
  const aliases = new Set<string>();
  for (const candidate of value.slice(0, 50)) {
    const parsed = storedBindingSchema.safeParse(candidate);
    if (!parsed.success || aliases.has(parsed.data.alias)) continue;
    aliases.add(parsed.data.alias);
    bindings.push({
      ...parsed.data,
      bindingId: `${parsed.data.alias}:${parsed.data.version}`,
      bindingStatus: "unverified",
    });
  }
  return bindings;
}
