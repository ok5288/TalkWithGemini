import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  ACCESS_ATTEMPTS_COOKIE,
  ACCESS_SESSION_COOKIE,
} from "../lib/security/accessControl";
import {
  ALLOW_INSECURE_HTTP_COOKIES_ENV,
  getSecurityCookieOptions,
} from "../lib/security/cookiePolicy";
import {
  API_PROOF_SESSION_COOKIE,
  API_PROOF_ERROR_CODES,
  createRequestProofHeaders,
  createRequestProofSessionResponse,
  clearRequestProofSigningKeyForTesting,
} from "../lib/security/requestProof";
import { middleware } from "../middleware";
import { clearRequestRateLimitBuckets } from "../lib/security/requestGuards";
import {
  MemoryRateLimitStore,
  setRateLimitStoreForTesting,
} from "../lib/security/rateLimitStore";

interface CookieJarLike {
  setCookie(cookie: string, url: string): Promise<unknown>;
  getCookieString(url: string): Promise<string>;
}

interface CookieJarModule {
  CookieJar: new () => CookieJarLike;
}

const { CookieJar } = createRequire(import.meta.url)(
  "jsdom",
) as CookieJarModule;

function extractCookie(response: Response, name: string) {
  return response.headers.get("set-cookie")?.match(new RegExp(`${name}=[^;]*`));
}

function makeVerifyRequest(password: string): NextRequest {
  return new NextRequest("https://neo.test/api/access/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

function makeVerifyRequestAt(
  url: string,
  password: string,
  cookie = "",
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ password }),
  });
}

async function storeResponseCookies(
  jar: CookieJarLike,
  response: Response,
  url: string,
): Promise<void> {
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const setCookies = getSetCookie
    ? getSetCookie.call(response.headers)
    : [response.headers.get("set-cookie")].filter((value): value is string =>
        Boolean(value),
      );

  for (const setCookie of setCookies) {
    await jar.setCookie(setCookie, url);
  }
}

function makeProtectedRequest(
  url: string,
  cookie: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      origin: new URL(url).origin,
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
  });
}

describe("security cookie policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearRequestProofSigningKeyForTesting();
    clearRequestRateLimitBuckets();
    setRateLimitStoreForTesting(null);
  });

  it.each(["1", " true ", "YES", "on"])(
    "allows plain HTTP cookies for %s",
    (value) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, value);

      expect(getSecurityCookieOptions().secure).toBe(false);
    },
  );

  it.each([undefined, "", "0", "false", "no", "off", "random"])(
    "keeps production cookies Secure for %s",
    (value) => {
      vi.stubEnv("NODE_ENV", "production");
      if (value === undefined) {
        vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "");
      } else {
        vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, value);
      }

      expect(getSecurityCookieOptions().secure).toBe(true);
    },
  );

  it.each(["development", "test"])("keeps %s cookies non-Secure", (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "");

    expect(getSecurityCookieOptions().secure).toBe(false);
  });

  it("defaults to Secure when the runtime switch is actually absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, undefined);

    expect(process.env[ALLOW_INSECURE_HTTP_COOKIES_ENV]).toBeUndefined();
    expect(getSecurityCookieOptions().secure).toBe(true);
  });

  it("applies one runtime policy to access and request-proof cookies", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "on");
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    const { POST } = await import("../app/api/access/verify/route");
    const accessResponse = await POST(makeVerifyRequest("secret"));
    const accessSetCookie = accessResponse.headers.get("set-cookie") || "";

    expect(extractCookie(accessResponse, ACCESS_SESSION_COOKIE)).toBeTruthy();
    expect(extractCookie(accessResponse, ACCESS_ATTEMPTS_COOKIE)).toBeTruthy();
    expect(accessSetCookie).toContain(`${ACCESS_SESSION_COOKIE}=`);
    expect(accessSetCookie).toContain(`${ACCESS_ATTEMPTS_COOKIE}=`);
    expect(accessSetCookie).toContain("HttpOnly");
    expect(accessSetCookie).toMatch(/SameSite=lax/i);
    expect(accessSetCookie).not.toContain("Secure");

    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "stable-proof-key");
    const proofResponse = await createRequestProofSessionResponse();
    const proofSetCookie = proofResponse.headers.get("set-cookie") || "";

    expect(proofSetCookie).toContain(`${API_PROOF_SESSION_COOKIE}=`);
    expect(proofSetCookie).toContain("HttpOnly");
    expect(proofSetCookie).toMatch(/SameSite=lax/i);
    expect(proofSetCookie).not.toContain("Secure");
  });

  it("uses Secure cookies for all three cookies by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_INSECURE_HTTP_COOKIES", "false");
    vi.stubEnv("ACCESS_PASSWORD", "secret");

    const { POST } = await import("../app/api/access/verify/route");
    const accessResponse = await POST(makeVerifyRequest("secret"));
    const accessSetCookie = accessResponse.headers.get("set-cookie") || "";
    expect(accessSetCookie).toContain(`${ACCESS_SESSION_COOKIE}=`);
    expect(accessSetCookie).toContain(`${ACCESS_ATTEMPTS_COOKIE}=`);
    expect(accessSetCookie).toContain("Secure");

    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "stable-proof-key");
    const proofResponse = await createRequestProofSessionResponse();
    expect(proofResponse.headers.get("set-cookie") || "").toContain(
      `${API_PROOF_SESSION_COOKIE}=`,
    );
    expect(proofResponse.headers.get("set-cookie") || "").toContain("Secure");
  });

  it("reproduces the remote HTTP cookie failure and the explicit opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    const { POST } = await import("../app/api/access/verify/route");

    const defaultJar = new CookieJar();
    const defaultLogin = await POST(
      makeVerifyRequestAt("http://neo.test/api/access/verify", "secret"),
    );
    await storeResponseCookies(
      defaultJar,
      defaultLogin,
      "http://neo.test/api/access/verify",
    );
    expect(await defaultJar.getCookieString("http://neo.test/api/config")).toBe(
      "",
    );
    expect(
      (await middleware(new NextRequest("http://neo.test/api/config"))).status,
    ).toBe(401);

    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "true");
    const optInJar = new CookieJar();
    const optInLogin = await POST(
      makeVerifyRequestAt("http://neo.test/api/access/verify", "secret"),
    );
    await storeResponseCookies(
      optInJar,
      optInLogin,
      "http://neo.test/api/access/verify",
    );
    const optInCookie = await optInJar.getCookieString(
      "http://neo.test/api/config",
    );
    expect(optInCookie).toContain(`${ACCESS_SESSION_COOKIE}=`);
    expect(
      (
        await middleware(
          new NextRequest("http://neo.test/api/config", {
            headers: { cookie: optInCookie },
          }),
        )
      ).status,
    ).toBe(200);

    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "false");
    const httpsJar = new CookieJar();
    const httpsLogin = await POST(
      makeVerifyRequestAt("https://neo.test/api/access/verify", "secret"),
    );
    await storeResponseCookies(
      httpsJar,
      httpsLogin,
      "https://neo.test/api/access/verify",
    );
    const httpsCookie = await httpsJar.getCookieString(
      "https://neo.test/api/config",
    );
    expect(httpsCookie).toContain(`${ACCESS_SESSION_COOKIE}=`);
    expect(
      (
        await middleware(
          new NextRequest("https://neo.test/api/config", {
            headers: { cookie: httpsCookie },
          }),
        )
      ).status,
    ).toBe(200);
  });

  it("keeps hosted request proof signed and rejects a replay over HTTP opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "on");
    vi.stubEnv("DEPLOYMENT_MODE", "hosted");
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("BYOK_PRIVATE_KEY_PEM", "stable-proof-key");
    setRateLimitStoreForTesting(new MemoryRateLimitStore());

    const jar = new CookieJar();
    const bootstrapResponse = await middleware(
      new NextRequest("http://neo.test/api/request-proof/session"),
    );
    await storeResponseCookies(
      jar,
      bootstrapResponse,
      "http://neo.test/api/request-proof/session",
    );
    const bootstrap = (await bootstrapResponse.json()) as {
      clientKey: string;
      serverTime: number;
    };
    const cookie = await jar.getCookieString("http://neo.test/api/chat");
    expect(cookie).toContain(`${API_PROOF_SESSION_COOKIE}=`);

    const proofHeaders = await createRequestProofHeaders({
      clientKey: bootstrap.clientKey,
      method: "POST",
      target: "/api/chat",
      timestamp: bootstrap.serverTime,
      nonce: "http-proof-nonce",
    });
    const first = await middleware(
      makeProtectedRequest("http://neo.test/api/chat", cookie, proofHeaders),
    );
    expect(first.status).toBe(200);

    const replay = await middleware(
      makeProtectedRequest("http://neo.test/api/chat", cookie, proofHeaders),
    );
    const replayData = await replay.json();
    expect(replay.status).toBe(401);
    expect(replayData).toMatchObject({
      code: API_PROOF_ERROR_CODES.invalid,
      statusCode: 401,
    });

    const unsigned = await middleware(
      makeProtectedRequest("http://neo.test/api/chat", cookie),
    );
    expect(unsigned.status).toBe(401);
  });

  it("secures failed-attempt cookies and their successful clear operation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ACCESS_PASSWORD", "secret");
    vi.stubEnv(ALLOW_INSECURE_HTTP_COOKIES_ENV, "");
    const { POST } = await import("../app/api/access/verify/route");

    const jar = new CookieJar();
    const failed = await POST(
      makeVerifyRequestAt("https://neo.test/api/access/verify", "wrong"),
    );
    await storeResponseCookies(
      jar,
      failed,
      "https://neo.test/api/access/verify",
    );
    const failedSetCookies = failed.headers.getSetCookie();
    const failedAttemptCookie = failedSetCookies.find((cookie) =>
      cookie.startsWith(`${ACCESS_ATTEMPTS_COOKIE}=`),
    );
    expect(failedAttemptCookie).toContain("Secure");
    expect(failedAttemptCookie).toContain("HttpOnly");
    expect(failedAttemptCookie).toMatch(/SameSite=lax/i);

    const success = await POST(
      makeVerifyRequestAt(
        "https://neo.test/api/access/verify",
        "secret",
        await jar.getCookieString("https://neo.test/api/access/verify"),
      ),
    );
    const successSetCookies = success.headers.getSetCookie();
    const clearAttemptCookie = successSetCookies.find((cookie) =>
      cookie.startsWith(`${ACCESS_ATTEMPTS_COOKIE}=`),
    );
    expect(clearAttemptCookie).toContain("Max-Age=0");
    expect(clearAttemptCookie).toContain("Secure");
    expect(clearAttemptCookie).toContain("HttpOnly");
    expect(clearAttemptCookie).toMatch(/SameSite=lax/i);
  });
});
