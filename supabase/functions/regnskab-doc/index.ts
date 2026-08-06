// Proxy til de indberettede regnskabsdokumenter (XBRL/XML) hos
// regnskaber.virk.dk. Samme http-only-problem som regnskab-search.
//
// Dokumentet parses i BROWSEREN, ikke her. Edge Functions har kun 2s CPU-tid
// pr. request, og det rækker ikke til at parse et større XBRL-dokument —
// proxying er derimod async I/O og tæller ikke med.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const DOC_HOST = "regnskaber.virk.dk";
const PATH_PREFIX = "/regnskab-doc";

// Et offentliggjort årsregnskab ændrer sig ikke bagefter.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Postgres kan sagtens rumme dokumenterne, men en enkelt kæmpefil skal ikke
// kunne fylde cachen op. Over grænsen leveres dokumentet uden at blive gemt.
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

function xml(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { ...CORS_HEADERS, "Content-Type": "application/xml; charset=utf-8", ...headers }
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const incoming = new URL(req.url).pathname;
  const docPath = incoming.startsWith(PATH_PREFIX)
    ? incoming.slice(PATH_PREFIX.length)
    : incoming;

  if (!docPath || docPath === "/") {
    return json({ error: "Dokumentsti mangler." }, { status: 400 });
  }

  // Vi bygger URL'en mod en fast host, men validerer resultatet alligevel:
  // uden det tjek ville funktionen være en åben proxy, som enhver kunne bruge
  // til at hente vilkårlige adresser gennem vores projekt.
  let target: URL;
  try {
    target = new URL(docPath, `http://${DOC_HOST}`);
  } catch {
    return json({ error: "Ugyldig dokumentsti." }, { status: 400 });
  }

  if (target.host !== DOC_HOST) {
    return json({ error: "Kun dokumenter fra regnskaber.virk.dk kan hentes." }, { status: 400 });
  }

  const cacheKey = target.pathname + target.search;

  const cached = await readCache<string>(
    "regnskab_doc_cache",
    "doc_path",
    cacheKey,
    "body",
    TTL_MS
  );
  if (cached) return xml(cached, { "X-Cache": "HIT" });

  let body: string;
  try {
    const upstream = await fetch(target.toString());

    if (!upstream.ok) {
      return json(
        { error: `Kunne ikke hente regnskabsdokument (HTTP ${upstream.status}).` },
        { status: upstream.status }
      );
    }

    body = await upstream.text();
  } catch (err) {
    return json(
      { error: `Kunne ikke nå Erhvervsstyrelsen: ${(err as Error).message}` },
      { status: 502 }
    );
  }

  if (new Blob([body]).size <= MAX_CACHE_BYTES) {
    await writeCache("regnskab_doc_cache", { doc_path: cacheKey, body });
  }

  return xml(body, { "X-Cache": "MISS" });
});
