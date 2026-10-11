import {
  getIntelligentUiSandboxDocument,
  INTELLIGENT_UI_SANDBOX_CSP,
} from "@/lib/intelligentUi/sandbox";

export function GET() {
  return new Response(getIntelligentUiSandboxDocument(), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": INTELLIGENT_UI_SANDBOX_CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=()",
    },
  });
}
