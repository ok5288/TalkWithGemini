/**
 * Shared policy for cookies that carry server-side access or request-proof
 * state.
 *
 * Production cookies are Secure by default. A deployment that is intentionally
 * served over plain HTTP can opt into the diagnostic/compatibility path with
 * ALLOW_INSECURE_HTTP_COOKIES=true (or 1, yes, on). This is read at request
 * time so runtime environment changes are reflected without a rebuild.
 */
export const ALLOW_INSECURE_HTTP_COOKIES_ENV = "ALLOW_INSECURE_HTTP_COOKIES";

function isTruthyEnvironmentValue(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

export function allowInsecureHttpCookies(): boolean {
  return isTruthyEnvironmentValue(process.env[ALLOW_INSECURE_HTTP_COOKIES_ENV]);
}

export function shouldUseSecureCookies(): boolean {
  return process.env.NODE_ENV === "production" && !allowInsecureHttpCookies();
}

export function getSecurityCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(),
    path: "/",
  };
}
