// CVR-opslag mod Datafordelerens GraphQL-tjeneste — Erhvervsstyrelsens egen
// kilde, uden cvrapi.dk's loft på 50 opslag/dag.
//
// Fire ting om tjenesten former koden nedenfor. Alle er verificeret direkte
// mod API'et, ikke læst i dokumentationen (som på flere punkter er forkert):
//
// 1. VERSIONEN ER v2. Dokumentationens eksempler bruger v3; både v1 og v3
//    svarer 404 for CVR.
//
// 2. KUN ÉT RODFELT PR. FORESPØRGSEL (fejlkode DAF-GQL-0010), og ALIASER ER
//    FORBUDT (DAF-GQL-0008). Man kan altså ikke hente navn, branche og adresse
//    i ét kald. Derfor: ét kald for at finde enhedens id, og derefter fem
//    parallelle kald — ét pr. entitet.
//
// 3. DATA LIGGER I SEPARATE ENTITETER samlet på CVREnhedsId, som IKKE er det
//    samme som CVR-nummeret (ATEA: CVR 25511484, enhedsId 4001284672).
//
// 4. DATA ER BITEMPORALT. CVR_Navn for ATEA returnerer fire navne tilbage til
//    2000; kun rækken med åben virkningsperiode er det nuværende navn.
//    pickCurrent() vælger den.

import { handlePreflight, json } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const GRAPHQL_URL = "https://graphql.datafordeler.dk/CVR/v2";
const apiKey = Deno.env.get("DATAFORDELER_API_KEY") ?? "";

// Stamdata ændrer sig sjældent. Cachen her handler ikke om kvote — den findes
// ikke længere — men om latens: seks kald mod Datafordeleren tager tid.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Node = Record<string, unknown>;

async function graphql(query: string): Promise<Node> {
  // API-nøglen sendes som query-parameter. URL'en må derfor ALDRIG logges
  // eller indgå i en fejlbesked — den ville afsløre nøglen.
  const response = await fetch(`${GRAPHQL_URL}?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/graphql-response+json"
    },
    body: JSON.stringify({ query })
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "Datafordeleren afviste nøglen. Tjek at DATAFORDELER_API_KEY er sat, og at " +
        "nøglen ikke er udløbet (den nuværende udløber 6. august 2028). En " +
        "nyoprettet nøgle virker først efter op til 15 minutter."
    );
  }

  if (!response.ok) {
    throw new Error(`Datafordeleren svarede HTTP ${response.status}.`);
  }

  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL-fejl: ${body.errors[0]?.message ?? "ukendt"}`);
  }

  return body.data ?? {};
}

async function fetchNodes(rootField: string, filter: string, fields: string, first = 100) {
  const data = await graphql(`{ ${rootField}(first: ${first}, where: { ${filter} }) { nodes { ${fields} } } }`);
  return ((data[rootField] as { nodes?: Node[] })?.nodes ?? []) as Node[];
}

// Den række der gælder nu: åben virkningsperiode og åben registreringsperiode.
// Falder tilbage til den nyeste hvis ingen er åbne — det sker for ophørte
// virksomheder, hvor alle perioder er lukket.
function pickCurrent(nodes: Node[]): Node | null {
  if (!nodes.length) return null;

  const current = nodes.find((n) => n.virkningTil == null && n.registreringTil == null);
  if (current) return current;

  return [...nodes].sort((a, b) =>
    String(b.virkningFra ?? "").localeCompare(String(a.virkningFra ?? ""))
  )[0];
}

function buildAddress(a: Node | null): string | null {
  if (!a) return null;
  const s = (k: string) => (a[k] == null ? null : String(a[k]));

  const husnummer = [s("CVRAdresse_husnummerFra"), s("CVRAdresse_husnummerTil")]
    .filter(Boolean)
    .join("-");
  const gade = [s("CVRAdresse_vejnavn"), husnummer].filter(Boolean).join(" ");
  const etage = [s("CVRAdresse_etagebetegnelse"), s("CVRAdresse_doerbetegnelse")]
    .filter(Boolean)
    .join(" ");
  const by = [s("CVRAdresse_postnummer"), s("CVRAdresse_postdistrikt")].filter(Boolean).join(" ");

  return [gade, etage, by].filter(Boolean).join(", ") || s("CVRAdresse_adresseFritekst");
}

// Beskæftigelse er kvartalsvise rækker mange år tilbage. Vi vil have den
// nyeste. Nogle virksomheder får et interval ("100-199") frem for et præcist
// antal — begge dele forekommer, så vi håndterer begge.
function pickEmployees(nodes: Node[]): string | null {
  if (!nodes.length) return null;

  const latest = [...nodes].sort((a, b) =>
    String(b.datoTil ?? b.datoFra ?? "").localeCompare(String(a.datoTil ?? a.datoFra ?? ""))
  )[0];

  if (latest.intervalFra != null && latest.intervalTil != null) {
    return `${latest.intervalFra}-${latest.intervalTil}`;
  }
  return latest.antal != null ? String(latest.antal) : null;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (!apiKey) {
    return json(
      { error: "DATAFORDELER_API_KEY er ikke sat som secret på Edge Functions." },
      { status: 500 }
    );
  }

  const cvr = new URL(req.url).searchParams.get("cvr")?.trim() ?? "";
  if (!/^\d{8}$/.test(cvr)) {
    return json({ error: "Angiv et gyldigt 8-cifret CVR-nummer i 'cvr'." }, { status: 400 });
  }

  // Deler tabel med cvrapi.dk-cachen, men med "df:"-præfiks, fordi indholdet
  // har en anden form (her: et færdignormaliseret company-objekt).
  const cacheKey = `df:${cvr}`;
  const cached = await readCache<Node>("cvr_cache", "search_term", cacheKey, "payload", TTL_MS);
  if (cached) return json({ status: "ok", company: cached }, { headers: { "X-Cache": "HIT" } });

  try {
    const virksomhed = pickCurrent(
      await fetchNodes(
        "CVR_Virksomhed",
        `CVRNummer: { eq: ${cvr} }`,
        "id CVRNummer status virksomhedStartdato virksomhedOphoersdato virkningFra virkningTil registreringTil",
        20
      )
    );

    if (!virksomhed) return json({ status: "not_found" });

    const påEnhed = `CVREnhedsId: { eq: "${String(virksomhed.id)}" }`;
    const temporale = "virkningFra virkningTil registreringTil";

    // Fem parallelle kald — ét pr. entitet, da tjenesten ikke tillader flere
    // rodfelter i samme forespørgsel.
    const [navnNodes, brancheNodes, formNodes, adresseNodes, ansatteNodes] = await Promise.all([
      fetchNodes("CVR_Navn", påEnhed, `vaerdi ${temporale}`),
      fetchNodes("CVR_Branche", påEnhed, `vaerdi vaerdiTekst ${temporale}`),
      fetchNodes("CVR_Virksomhedsform", påEnhed, `vaerdi vaerdiTekst ${temporale}`),
      fetchNodes(
        "CVR_Adressering",
        påEnhed,
        "CVRAdresse_vejnavn CVRAdresse_husnummerFra CVRAdresse_husnummerTil " +
          "CVRAdresse_etagebetegnelse CVRAdresse_doerbetegnelse CVRAdresse_postnummer " +
          `CVRAdresse_postdistrikt CVRAdresse_adresseFritekst ${temporale}`
      ),
      // Højt loft: kvartalsvise rækker siden 2014 er hurtigt over 100, og vi
      // skal have den nyeste med.
      fetchNodes("CVR_Beskaeftigelse", påEnhed, "antal intervalFra intervalTil datoFra datoTil", 1000)
    ]);

    const navn = pickCurrent(navnNodes);
    const branche = pickCurrent(brancheNodes);
    const form = pickCurrent(formNodes);
    const adresse = pickCurrent(adresseNodes);

    const company = {
      cvr: String(virksomhed.CVRNummer),
      name: (navn?.vaerdi as string) ?? null,
      fullAddress: buildAddress(adresse),
      companyType: (form?.vaerdiTekst as string) ?? null,
      industryCode: (branche?.vaerdi as string) ?? null,
      industryDesc: (branche?.vaerdiTekst as string) ?? null,
      startDate: (virksomhed.virksomhedStartdato as string) ?? null,
      endDate: (virksomhed.virksomhedOphoersdato as string) ?? null,
      employeesRange: pickEmployees(ansatteNodes),
      active: virksomhed.virksomhedOphoersdato == null,
      source: "datafordeler"
    };

    await writeCache("cvr_cache", { search_term: cacheKey, payload: company });

    return json({ status: "ok", company }, { headers: { "X-Cache": "MISS" } });
  } catch (err) {
    return json({ status: "error", message: (err as Error).message }, { status: 502 });
  }
});
