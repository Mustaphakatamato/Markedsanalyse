// Proxy til Erhvervsstyrelsens regnskabsindeks — et åbent, ikke-autentificeret
// Elasticsearch-endpoint der søges på cvrNummer.
//
// Skal serverside af to grunde: kilden findes kun over http:// (en
// https-serveret app må ikke kalde den — mixed content), og den svarer
// undertiden ekstremt langsomt. Edge Functions har 150s wall clock på
// free-plan, så et 120s-kald går igennem, men uden margin. Derfor cachen.

import { handlePreflight, json, sha256Hex } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const SEARCH_URL = "http://distribution.virk.dk/offentliggoerelser/_search";

// Nye regnskaber offentliggøres løbende, så et døgn er passende.
const TTL_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  const rawBody = await req.text();
  if (!rawBody) {
    return json({ error: "Tom request body." }, { status: 400 });
  }

  // Søgningen er en JSON-forespørgsel; dens hash er en stabil cache-nøgle.
  const queryHash = await sha256Hex(rawBody);

  const cached = await readCache<unknown>(
    "regnskab_search_cache",
    "query_hash",
    queryHash,
    "payload",
    TTL_MS
  );
  if (cached) return json(cached, { headers: { "X-Cache": "HIT" } });

  let data: unknown;
  try {
    const upstream = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody
    });

    if (!upstream.ok) {
      return json(
        { error: `Regnskabssøgning fejlede (HTTP ${upstream.status}).` },
        { status: upstream.status }
      );
    }

    data = await upstream.json();
  } catch (err) {
    return json(
      { error: `Kunne ikke nå Erhvervsstyrelsen: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  await writeCache("regnskab_search_cache", { query_hash: queryHash, payload: data });

  return json(data, { headers: { "X-Cache": "MISS" } });
});
