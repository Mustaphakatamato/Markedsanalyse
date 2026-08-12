// Proxy til den fulde eForms-XML for én TED-notice.
//
// Hvorfor: /v3/notices/search leverer kun FLADE arrays af BT-felter (fx
// winner-name, tender-value) — for en rammeaftale med mange vindere er der
// intet pålideligt indeks der binder et vindernavn til det rigtige beløb og
// den rigtige delkontrakt. Den fulde XML derimod har rammeaftalens reelle
// struktur: efac:Organization (vinderens navn) → efac:TenderingParty →
// efac:LotTender (delkontraktens PayableAmount, TenderLot og beskrivelse).
// Se tedNoticeService.js for selve udtrækningen.
//
// Samme http-only/CORS-begrundelse som de øvrige proxier: ted.europa.eu
// sender ingen Access-Control-Allow-Origin.
//
// Dokumentet parses i BROWSEREN, ikke her — samme 2s CPU-loft-begrundelse som
// regnskab-doc. En rammeaftale-XML kan sagtens fylde flere hundrede KB.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const PATH_PREFIX = "/ted-notice/";
// TED's publication-number-format, fx "294230-2024".
const PUBLICATION_NUMBER_RE = /^\d{4,8}-\d{4}$/;

// En offentliggjort notice ændrer sig aldrig — en rettelse er en ny notice
// med sit eget nummer. Cachen kan derfor stå længe.
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

// Samme sikkerhedsnet som regnskab-doc: en enkelt kæmpefil skal ikke kunne
// fylde cachen op. Over grænsen leveres XML'en uden at blive gemt.
const MAX_CACHE_BYTES = 5 * 1024 * 1024;

function xml(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    headers: { ...CORS_HEADERS, "Content-Type": "application/xml; charset=utf-8", ...headers }
  });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const pathname = new URL(req.url).pathname;
  const publicationNumber = pathname.startsWith(PATH_PREFIX)
    ? decodeURIComponent(pathname.slice(PATH_PREFIX.length))
    : "";

  // Vi bygger URL'en mod en fast host, men valideres alligevel: uden det
  // tjek ville funktionen være en åben proxy for vilkårlige stier på
  // ted.europa.eu.
  if (!PUBLICATION_NUMBER_RE.test(publicationNumber)) {
    return json({ error: "Ugyldigt eller manglende notice-nummer." }, { status: 400 });
  }

  const cached = await readCache<string>(
    "ted_notice_cache",
    "publication_number",
    publicationNumber,
    "body",
    TTL_MS
  );
  if (cached) return xml(cached, { "X-Cache": "HIT" });

  const target = `https://ted.europa.eu/en/notice/${publicationNumber}/xml`;

  let body: string;
  try {
    const upstream = await fetch(target);

    if (!upstream.ok) {
      return json(
        { error: `Kunne ikke hente TED-notice (HTTP ${upstream.status}).` },
        { status: upstream.status }
      );
    }

    body = await upstream.text();
  } catch (err) {
    return json({ error: `Kunne ikke nå TED: ${(err as Error).message}` }, { status: 502 });
  }

  if (new Blob([body]).size <= MAX_CACHE_BYTES) {
    await writeCache("ted_notice_cache", { publication_number: publicationNumber, body });
  }

  return xml(body, { "X-Cache": "MISS" });
});
