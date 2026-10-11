/** Deployment-owned origin only: no credentials, path, wildcard or user override. */
export function parseMcpSandboxOrigin(
  value: string | undefined,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !url.hostname.includes("*")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function getMcpSandboxOrigin(hostOrigin?: string): string | null {
  const origin = parseMcpSandboxOrigin(
    process.env.NEXT_PUBLIC_MCP_APPS_SANDBOX_ORIGIN,
  );
  return origin && origin !== hostOrigin ? origin : null;
}

export function areMcpAppsEnabled(
  settings: { enableIntelligentUi?: boolean; enableMcpApps?: boolean },
  hostOrigin?: string,
): boolean {
  return (
    settings.enableIntelligentUi === true &&
    settings.enableMcpApps === true &&
    !!getMcpSandboxOrigin(hostOrigin)
  );
}
