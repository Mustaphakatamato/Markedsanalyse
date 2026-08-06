// Proxy til TED (Tenders Electronic Daily) v3 notices search.
//
// Hvorfor en proxy: api.ted.europa.eu sender ingen Access-Control-Allow-Origin,
// så browseren blokerer direkte kald.
//
// Ingen cache her — TED svarer hurtigt, har intet kaldsloft, og
// kontrakttildelinger opdateres løbende.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";

const TED_URL = "https://api.ted.europa.eu/v3/notices/search";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i request body." }, { status: 400 });
  }

  try {
    const upstream = await fetch(TED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  } catch (err) {
    return json({ error: `Kunne ikke nå TED: ${(err as Error).message}` }, { status: 502 });
  }
});
