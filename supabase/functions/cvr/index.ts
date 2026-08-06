// Proxy til CVR-opslag via cvrapi.dk.
//
// To grunde til at det skal serverside:
//  1. cvrapi.dk kræver en custom User-Agent (ellers INVALID_UA). Det er en
//     "forbidden header" browsere ikke selv må sætte.
//  2. Der er et loft på 50 opslag/dag pr. IP. Cachen nedenfor er hele
//     pointen — gentagne opslag på samme virksomhed koster ikke af kvoten.

import { handlePreflight, json } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const CVR_URL = "https://cvrapi.dk/api";
const USER_AGENT = "MarkedsanalysePlatform - demo@markedsanalyse.dk";

// Stamdata ændrer sig sjældent; en uge er rigeligt friskt til markedsafdækning.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const search = new URL(req.url).searchParams.get("search")?.trim();
  if (!search) {
    return json({ error: "Parameteren 'search' mangler." }, { status: 400 });
  }

  const cacheKey = search.toLowerCase();

  const cached = await readCache<unknown>("cvr_cache", "search_term", cacheKey, "payload", TTL_MS);
  if (cached) return json(cached, { headers: { "X-Cache": "HIT" } });

  let data: Record<string, unknown>;
  try {
    const upstream = await fetch(
      `${CVR_URL}?search=${encodeURIComponent(search)}&country=dk`,
      { headers: { "User-Agent": USER_AGENT } }
    );
    data = await upstream.json();
  } catch (err) {
    return json({ error: `Kunne ikke nå CVR: ${(err as Error).message}` }, { status: 502 });
  }

  // Kun rigtige træf gemmes. Ville vi cache fejl, ville et enkelt
  // QUOTA_EXCEEDED eller en midlertidig nedetid blive fastfrosset i syv dage
  // for netop den søgning.
  if (!data.error) {
    await writeCache("cvr_cache", { search_term: cacheKey, payload: data });
  }

  return json(data, { headers: { "X-Cache": "MISS" } });
});
