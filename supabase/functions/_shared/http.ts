// Fælles HTTP-hjælpere for proxy-funktionerne.
//
// Funktionerne her erstatter de Vite-proxier der tidligere lå i
// vite.config.js. De fandtes kun i dev og preview, hvilket gjorde appen
// umulig at hoste statisk — derfor bor de nu i Edge Functions, som kaldes
// både lokalt og i produktion.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response("ok", { headers: CORS_HEADERS });
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const extra = (init.headers ?? {}) as Record<string, string>;
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json", ...extra }
  });
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
