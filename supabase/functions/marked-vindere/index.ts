// Hvem har rent faktisk vundet i dette CPV-felt hos DANSKE ordregivere?
//
// HVORFOR EN EGEN FUNKTION OG IKKE ET KALD FRA BROWSEREN: optællingen kræver
// op til fire TED-kald (250 notices er API'ets loft pr. side) OG et opslag i
// CVR-indekset for at koble vindernavnene til virksomheder. Lagt i browseren
// ville det være fem-seks rundture og et cache-lag, der ikke kan deles mellem
// brugere. Her er det ét kald, og svaret caches et døgn i Postgres.
//
// VERIFICERET DIREKTE MOD TED's API (14. august 2026), fordi to af tingene
// ikke fremgår af dokumentationen:
//
//   1. classification-cpv MATCHER HIERARKISK. En forespørgsel på 90910000
//      dækker også 90911200 — barnet giver 124 træf, forælderen 921, og
//      OR mellem dem giver stadig 921. Det betyder at en bred CPV-kode
//      afdækker hele sit felt, hvilket er nøjagtigt det, en markedsanalyse
//      skal bruge. Wildcard (9091*) tilføjer intet.
//   2. OR MELLEM URELATEREDE KODER VIRKER. 90910000 (rengøring) = 921,
//      79710000 (vagt) = 99, OR = 1012 — altså foreningsmængden minus 8
//      notices der bærer begge koder. Derfor ét samlet kald frem for ét pr.
//      kode: det halverer antallet af TED-kald og fjerner dobbelttællingen af
//      notices, der bærer flere af de valgte koder.
//
// Kun can-standard og can-social. can-desg og can-tran gav 0 træf, og
// can-modif (kontraktændringer) udelades med vilje: en ændring af en allerede
// tildelt kontrakt er ikke en ny sejr og ville tælle den samme aftale to gange.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json, sha256Hex } from "../_shared/http.ts";
import { readCache, writeCache } from "../_shared/cache.ts";

const TED_URL = "https://api.ted.europa.eu/v3/notices/search";
const TED_SIDE = 250; // API'ets maksimum, verificeret: limit=500 svarer 400
const MAKS_SIDER = 4; // 1.000 nyeste tildelinger
const TTL_MS = 24 * 60 * 60 * 1000;

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

const ER_CPV = /^\d{8}$/;

const FELTER = [
  "notice-identifier",
  "publication-number",
  "publication-date",
  "winner-name",
  "buyer-name",
  "total-value",
  "total-value-cur"
];

type Node = Record<string, unknown>;

// TED's tekstfelter er nøglet på sprog: { "dan": ["Navn"], "eng": [...] }.
// Værdierne er ens på tværs af sprog for egennavne, så første nøgle rækker.
function listeAf(felt: unknown): string[] {
  if (!felt || typeof felt !== "object") return [];
  const vaerdier = Object.values(felt as Record<string, unknown>)[0];
  if (Array.isArray(vaerdier)) return vaerdier.map((v) => String(v));
  return vaerdier ? [String(vaerdier)] : [];
}

function foersteTekst(felt: unknown): string {
  return listeAf(felt)[0] ?? "";
}

// Bevidst identisk med normalizeForMatch() i src/services/tedService.js og
// navn_normaliser() i SQL. Tre kopier af samme regel er én for mange, men
// alternativet — at sende navnene frem og tilbage for at normalisere dem ét
// sted — koster en rundtur pr. opslag. Rettes den ene, skal de andre rettes med.
function normaliser(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function hentSide(query: string, side: number): Promise<Node | null> {
  const svar = await fetch(TED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: FELTER, page: side, limit: TED_SIDE })
  });

  // TED svarer 429 ved for mange kald i træk. Én sides manglende data må ikke
  // vælte hele optællingen — den bliver bare bygget på færre notices, og det
  // fremgår af 'kilde' i svaret.
  if (!svar.ok) return null;
  return await svar.json();
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Brug POST." }, { status: 405 });
  }

  let krop: Record<string, unknown>;
  try {
    krop = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i kroppen." }, { status: 400 });
  }

  // CPV-koder er otte cifre. Et "72222300-0" fra en anden kilde afkortes ved
  // bindestregen; alt andet afvises frem for at give et tomt marked, som ville
  // ligne et rigtigt svar.
  const koder = [
    ...new Set(
      (Array.isArray(krop.cpvKoder) ? krop.cpvKoder : [])
        .map((k) => String(k).split("-")[0].trim())
        .filter(Boolean)
    )
  ].slice(0, 15);

  const ugyldige = koder.filter((k) => !ER_CPV.test(k));
  if (ugyldige.length) {
    return json(
      { error: `Ugyldige CPV-koder: ${ugyldige.join(", ")}. En CPV-kode er otte cifre.` },
      { status: 400 }
    );
  }
  if (!koder.length) {
    return json({ error: "Feltet 'cpvKoder' skal indeholde mindst én kode." }, { status: 400 });
  }

  const top = Math.min(Math.max(Number(krop.top) || 25, 1), 100);

  const cpvLed = koder.map((k) => `classification-cpv=${k}`).join(" OR ");
  const query =
    `(${cpvLed}) AND notice-type IN (can-standard can-social) AND buyer-country=DNK` +
    " SORT BY publication-date DESC";

  const cacheKey = await sha256Hex(`${query}|top=${top}`);
  const cached = await readCache<unknown>(
    "ted_vindere_cache",
    "query_hash",
    cacheKey,
    "payload",
    TTL_MS
  );
  if (cached) return json(cached);

  // ------------------------------------------------------------- hent notices
  const foersteSide = await hentSide(query, 1);
  if (!foersteSide) {
    return json({ error: "TED svarede ikke på forespørgslen. Prøv igen om lidt." }, { status: 502 });
  }

  const noticesIalt = Number(foersteSide.totalNoticeCount) || 0;
  const sider = Math.min(Math.ceil(noticesIalt / TED_SIDE), MAKS_SIDER);
  const alle: Node[] = [...((foersteSide.notices as Node[]) ?? [])];

  // Sekventielt, ikke parallelt: TED svarede 429 på fire samtidige kald under
  // afprøvningen. Fire sider i træk tager få sekunder og er langt inden for
  // Edge Function'ens levetid.
  for (let side = 2; side <= sider; side++) {
    const data = await hentSide(query, side);
    if (!data) break;
    alle.push(...((data.notices as Node[]) ?? []));
  }

  // ------------------------------------------------------------- optæl vindere
  type Post = {
    navn: string;
    antalKontrakter: number;
    antalRammeaftaler: number;
    ordregivere: Set<string>;
    sumEnkeltkontrakterDkk: number;
    senesteDato: string | null;
    senesteNotice: { publikationsnummer: string | null; ordregiver: string; url: string | null } | null;
  };

  const perNavn = new Map<string, Post>();
  let aeldsteDato: string | null = null;
  let nyesteDato: string | null = null;

  for (const notice of alle) {
    // Datoerne kommer med tidszone ("2026-08-11+02:00"); kun dagen er relevant.
    const dato = String(notice["publication-date"] ?? "").slice(0, 10) || null;
    if (dato) {
      if (!nyesteDato || dato > nyesteDato) nyesteDato = dato;
      if (!aeldsteDato || dato < aeldsteDato) aeldsteDato = dato;
    }

    const vindere = listeAf(notice["winner-name"]);
    const ordregiver = foersteTekst(notice["buyer-name"]);
    const publikationsnummer = notice["publication-number"]
      ? String(notice["publication-number"])
      : null;

    // Flere navngivne vindere = rammeaftale eller dynamisk indkøbssystem med
    // kaskade. Hver vinder tæller som en sejr, men beløbet gør IKKE: total-value
    // er rammens fælles loft, og at tilskrive det én leverandør ville
    // overdrive dens omsætning voldsomt. Samme disciplin som i
    // tedService.getMarketPlayers() og CompanyLookupPage.
    const erRamme = vindere.length > 1;
    const beloeb = typeof notice["total-value"] === "number" ? (notice["total-value"] as number) : null;
    const valuta = Array.isArray(notice["total-value-cur"])
      ? String(notice["total-value-cur"][0])
      : notice["total-value-cur"]
        ? String(notice["total-value-cur"])
        : null;

    for (const raat of vindere) {
      const navn = raat.trim();
      const noegle = normaliser(navn);
      if (!noegle) continue;

      let post = perNavn.get(noegle);
      if (!post) {
        post = {
          navn,
          antalKontrakter: 0,
          antalRammeaftaler: 0,
          ordregivere: new Set<string>(),
          sumEnkeltkontrakterDkk: 0,
          senesteDato: null,
          senesteNotice: null
        };
        perNavn.set(noegle, post);
      }

      post.antalKontrakter++;
      if (erRamme) post.antalRammeaftaler++;
      if (ordregiver) post.ordregivere.add(normaliser(ordregiver));
      if (!erRamme && beloeb != null && valuta === "DKK") {
        post.sumEnkeltkontrakterDkk += beloeb;
      }
      // Notices er sorteret faldende, så den første vi ser er den nyeste.
      if (dato && (!post.senesteDato || dato > post.senesteDato)) {
        post.senesteDato = dato;
        post.senesteNotice = {
          publikationsnummer,
          ordregiver,
          url: publikationsnummer
            ? `https://ted.europa.eu/en/notice/-/detail/${publikationsnummer}`
            : null
        };
      }
    }
  }

  // Antal FORSKELLIGE ordregivere vejer med i rangeringen, ikke kun antal
  // kontrakter. En leverandør med 12 aftaler hos 9 kommuner er et bredere
  // markedssignal end en med 12 hos den samme — den sidste kan lige så vel
  // afspejle én ordregivers indkøbsmønster som leverandørens kapacitet.
  const rangeret = [...perNavn.values()]
    .map((p) => ({
      navn: p.navn,
      antalKontrakter: p.antalKontrakter,
      antalRammeaftaler: p.antalRammeaftaler,
      antalOrdregivere: p.ordregivere.size,
      sumEnkeltkontrakterDkk: p.sumEnkeltkontrakterDkk || null,
      senesteDato: p.senesteDato,
      senesteNotice: p.senesteNotice
    }))
    .sort(
      (a, b) =>
        b.antalKontrakter - a.antalKontrakter ||
        b.antalOrdregivere - a.antalOrdregivere ||
        (b.senesteDato ?? "").localeCompare(a.senesteDato ?? "")
    )
    .slice(0, top);

  // ------------------------------------------------------- kobl til CVR
  // Uden dette er listen bare navne: man kan hverken åbne virksomhedsprofilen,
  // se hvor de ligger, eller sætte dem på shortlisten sammen med kandidaterne
  // fra CVR-listen — de deler nøgle (CVR-nummer).
  const { data: matchede, error: matchFejl } = await supabase.rpc("virksomheder_for_navne", {
    navne: rangeret.map((v) => v.navn)
  });

  if (matchFejl) {
    return json({ error: `Navneopslag i CVR fejlede: ${matchFejl.message}` }, { status: 500 });
  }

  const perSoegtNavn = new Map<string, Node>();
  for (const r of (matchede ?? []) as Node[]) {
    perSoegtNavn.set(String(r.soegt_navn), r);
  }

  const vindere = rangeret.map((v) => {
    const m = perSoegtNavn.get(v.navn);
    const entydig = m && Number(m.traf_antal) === 1;
    return {
      ...v,
      // trafAntal: 0 = ingen dansk CVR (typisk udenlandsk vinder),
      // >1 = flere aktive selskaber bærer navnet, og vi gætter ikke.
      trafAntal: m ? Number(m.traf_antal) : 0,
      cvr: entydig ? String(m!.cvr) : null,
      cvrNavn: entydig ? m!.navn : null,
      branchekode: entydig ? m!.branchekode : null,
      branchetekst: entydig ? m!.branchetekst : null,
      kommunenavn: entydig ? m!.kommunenavn : null,
      postnummer: entydig ? m!.postnummer : null,
      postdistrikt: entydig ? m!.postdistrikt : null,
      virksomhedsform: entydig ? m!.virksomhedsform : null,
      antalPenheder: entydig ? m!.antal_penheder : null,
      startdato: entydig ? m!.startdato : null,
      stoerrelsesklasse: entydig ? m!.stoerrelsesklasse : null
    };
  });

  const svar = {
    // 'kilde' er ikke pynt: uden den kan brugeren ikke vide om rangeringen
    // bygger på hele feltet eller kun de nyeste 1.000 tildelinger — og
    // forskellen kan ændre hvem der ligger øverst.
    kilde: {
      cpvKoder: koder,
      noticesIalt,
      noticesLaest: alle.length,
      afkortet: alle.length < noticesIalt,
      fraDato: aeldsteDato,
      tilDato: nyesteDato,
      vindereIalt: perNavn.size
    },
    vindere
  };

  await writeCache("ted_vindere_cache", { query_hash: cacheKey, payload: svar });

  return json(svar);
});
