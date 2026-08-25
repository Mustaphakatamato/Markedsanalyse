// TED (Tenders Electronic Daily) API — v3 notices search.
// Docs/expert query language: https://docs.ted.europa.eu/api/latest/
//
// Notes learned by testing directly against the API:
// - Endpoint takes POST requests, no API key needed.
// - The "fields" you request and the fields you can filter on in "query" use
//   different names in places (e.g. filter field is "classification-cpv",
//   not "cpv-code"). Below we only use fields confirmed to work.
// - Comparison operator is a single "=", not "==".
// - Quoted phrases ("Company Name A/S") do an exact-ish phrase match;
//   unquoted single words do a looser/tokenized match.
// - Kaldet går gennem Edge Function'en "ted" (supabase/functions/ted), fordi
//   TED's API ikke sender CORS-headers. Samme vej i udvikling og produktion.
// - No "sort" request field exists, but the query language itself supports
//   a trailing "SORT BY <field> DESC/ASC" clause.

import { postToFunction } from "../lib/apiClient";

const RESULT_FIELDS = [
  "notice-identifier",
  "publication-number",
  "publication-date",
  "notice-type",
  "notice-title",
  "winner-name",
  "buyer-name",
  "total-value",
  "total-value-cur"
];

function escapeQueryPhrase(value) {
  // TED's expert query language uses double quotes to delimit phrases.
  return value.replace(/"/g, '\\"');
}

function firstText(field) {
  if (!field) return "";
  // Fields like winner-name/buyer-name come back keyed by language, e.g.
  // { "dan": ["Some Name"], "eng": ["Some Name"] }
  const values = Object.values(field)[0];
  return Array.isArray(values) ? values.join(", ") : String(values ?? "");
}

// notice-title er, i modsætning til winner-name/buyer-name, EN STRENG pr.
// sprog, ikke et array — og selve strengen er skabelon-genereret: "Land –
// CPV-kategori (oversat) – Det faktiske projektnavn". Vi vil kun vise den
// sidste, substantielle del; resten er boilerplate der går igen på tværs af
// tusindvis af urelaterede notices (verificeret: frasesøgning på selve
// CPV-kategoriteksten alene gav 204 helt urelaterede træf).
function friendlyTitle(field) {
  if (!field) return null;
  const raw = field.dan ?? Object.values(field)[0];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return null;
  const parts = text.split(" – ");
  return parts.length > 1 ? parts[parts.length - 1] : text;
}

// Til verifikation skal vi se på ALLE sprogvarianter, ikke kun den første —
// nøglerækkefølgen i objektet er vilkårlig, så et rigtigt match kan sagtens
// ligge under "fra" eller "eng" mens firstText() rammer noget andet.
function allTexts(field) {
  if (!field) return "";
  return Object.values(field)
    .map((values) => (Array.isArray(values) ? values.join(" ") : String(values ?? "")))
    .join(" ");
}

// Fjerner det der typisk står i CVR, men ikke i TED's vindernavn: selskabsform
// til sidst, og "v/<indehaver>" på enkeltmandsvirksomheder (dér er personen
// efter skråstregen ejeren, ikke en del af virksomhedsnavnet).
const OWNER_MARKER = /\s+v\/.*$/i;
const LEGAL_FORM_SUFFIX = /[\s,]+(a\/s|aps|ivs|i\/s|k\/s|p\/s|a\.m\.b\.a\.|amba|smba|fmba)\.?$/i;

// Eksporteres så tedNoticeService.js kan bruge PRÆCIS samme matching, når den
// slår et firmanavn op blandt organisationerne i en notices fulde XML — to
// forskellige match-implementeringer ville kunne give modstridende svar for
// samme firma.
export function coreCompanyName(name) {
  return name.replace(OWNER_MARKER, "").replace(LEGAL_FORM_SUFFIX, "").trim();
}

// Sammenligning skal være ufølsom over for store/små bogstaver, diakritiske
// tegn (Ø/ø, é) og tegnsætning — "A/S Øresund" og "as oresund" er samme navn.
export function normalizeForMatch(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function noticeUrl(notice) {
  const publicationNumber = notice?.["publication-number"];
  return (
    notice?.links?.htmlDirect?.ENG ||
    notice?.links?.html?.ENG ||
    (publicationNumber
      ? `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}`
      : null)
  );
}

async function postSearch(query, { page = 1, limit = 25, fields = RESULT_FIELDS } = {}) {
  const response = await postToFunction("/ted", { query, fields, page, limit });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.message || `TED API fejlede (HTTP ${response.status})`);
  }

  return response.json();
}

// De ENKELTE vindernavne på notice'en, ikke firstText()'s sammensatte streng
// ("SoftwareONE, Atea A/S, KMD A/S, …") — bruges hvor vi skal tælle vindere
// hver for sig (getMarketPlayers), ikke bare vise dem.
function winnerNamesList(field) {
  if (!field) return [];
  const values = Object.values(field)[0];
  return Array.isArray(values) ? values : values ? [String(values)] : [];
}

// Antal vindere på notice'en, ikke kun det første navn firstText() viser.
// For en almindelig kontrakt er det 1. For en rammeaftale/DPS med kaskade af
// leverandører kan det være over 100 — signalet vi bruger til at afgøre om
// "value" er PENGENE DENNE VIRKSOMHED har vundet, eller rammens fælles
// loftværdi som IKKE må tilskrives én enkelt vinder. Se tedNoticeService.js
// for det rigtige per-virksomhed beløb i det sidste tilfælde.
function countWinners(field) {
  if (!field) return 0;
  const values = Object.values(field)[0];
  return Array.isArray(values) ? values.length : values ? 1 : 0;
}

// TED leverer fristen pr. delkontrakt ("deadline-date-lot") og som
// dato-med-tidszonemarkør ("2026-08-13Z"), som new Date() ikke kan læse.
// Vi viser den seneste af lotternes frister: er der først én lot tilbage at
// byde på, er udbuddet stadig åbent.
function latestDeadline(field) {
  const datoer = (Array.isArray(field) ? field : field ? [field] : [])
    .map((d) => String(d).slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  return datoer.length ? datoer[datoer.length - 1] : null;
}

function normalizeNotice(notice) {
  const currency = Array.isArray(notice["total-value-cur"])
    ? notice["total-value-cur"][0]
    : notice["total-value-cur"];
  const winnerCount = countWinners(notice["winner-name"]);

  return {
    id: notice["notice-identifier"] || notice["publication-number"],
    publicationNumber: notice["publication-number"] || null,
    date: notice["publication-date"] || null,
    noticeType: notice["notice-type"] || null,
    title: friendlyTitle(notice["notice-title"]),
    winnerName: firstText(notice["winner-name"]),
    winnerNames: winnerNamesList(notice["winner-name"]),
    winnerCount,
    // true = flere vindere delte denne notice (typisk en rammeaftale/DPS med
    // kaskade). "value" nedenfor er så notice'ens SAMLEDE loftværdi, ikke
    // hvad den enkelte virksomhed reelt fik tildelt.
    isMultiWinner: winnerCount > 1,
    buyerName: firstText(notice["buyer-name"]),
    value: typeof notice["total-value"] === "number" ? notice["total-value"] : null,
    currency: currency || null,
    // De to sidste er kun udfyldt, når kaldet har bedt om felterne
    // (ordregiversøgningen gør, de øvrige gør ikke) — de koster en del ekstra
    // svar-bytes pr. notice, og de fleste flows viser dem ikke.
    cpvCodes: [...new Set(notice["classification-cpv"] || [])],
    deadline: latestDeadline(notice["deadline-date-lot"]),
    url: noticeUrl(notice)
  };
}

/**
 * Search TED for notices won by a given company name.
 *
 * Søger først på det fulde navn som eksakt frase. Giver det ingenting, prøves
 * kernenavnet (uden selskabsform og "v/<indehaver>") — stadig som frase, aldrig
 * som løse ord. Fallback-resultater verificeres desuden mod vindernavnet, så
 * kun kontrakter der rent faktisk indeholder navnet kommer med.
 *
 * @param {string} companyName
 * @param {{ page?: number, limit?: number }} [options]
 * @returns {Promise<{ notices: object[], total: number, usedFallback: boolean }>}
 */
export async function searchWonContractsByCompany(companyName, options = {}) {
  const name = companyName.trim();
  if (!name) return { notices: [], total: 0, usedFallback: false };

  const { page = 1, limit = 25 } = options;

  const data = await postSearch(`winner-name="${escapeQueryPhrase(name)}"`, { page, limit });

  if (data.notices?.length) {
    return {
      notices: data.notices.map(normalizeNotice),
      total: data.totalNoticeCount || 0,
      usedFallback: false
    };
  }

  // TED gemmer ofte navnet uden selskabsform ("Atea" frem for "Atea A/S"), så
  // et fuldt frase-match kan misse et reelt træf. Prøv kernenavnet — men kun
  // hvis det faktisk er kortere end det fulde navn, og kun som frase. En
  // tidligere version søgte her på FØRSTE ORD uden anførselstegn, hvilket for
  // fx "Plan 5 Film v/Marc Schmidt" gav 924 urelaterede europæiske kontrakter
  // (alt med "Planungsgesellschaft", "planning", …) præsenteret som træf.
  const core = coreCompanyName(name);
  if (core.length < 3 || normalizeForMatch(core) === normalizeForMatch(name)) {
    return { notices: [], total: 0, usedFallback: false };
  }

  const fallback = await postSearch(`winner-name="${escapeQueryPhrase(core)}"`, { page, limit });

  // Frase-matchet er stadig TED's egen fortolkning — verificér at vindernavnet
  // rent faktisk indeholder kernenavnet, frem for at stole blindt på det.
  const needle = normalizeForMatch(core);
  const verified = (fallback.notices || []).filter((notice) =>
    normalizeForMatch(allTexts(notice["winner-name"])).includes(needle)
  );

  return {
    notices: verified.map(normalizeNotice),
    // Ikke fallback.totalNoticeCount: den tæller TED's ufiltrerede træf, og
    // ville overdrive antallet efter vores egen verifikation.
    total: verified.length,
    usedFallback: true
  };
}

/**
 * Search TED for recent contract-award notices under a given CPV code.
 * Used to ground a market analysis in real, recent EU-wide award data.
 *
 * @param {string} cpvCode e.g. "72222300-0" or "72222300"
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ notices: object[], total: number }>}
 */
export async function searchByCPV(cpvCode, options = {}) {
  const code = cpvCode?.split("-")[0]?.trim();
  if (!code) return { notices: [], total: 0 };

  const { limit = 10 } = options;
  const data = await postSearch(
    `classification-cpv=${code} AND notice-type=can-standard SORT BY publication-date DESC`,
    { page: 1, limit }
  );

  return {
    notices: (data.notices || []).map(normalizeNotice),
    total: data.totalNoticeCount || 0
  };
}

/**
 * Alle navngivne vindere af nylige DANSKE tildelinger under et sæt CPV-koder.
 *
 * Bruges til at udlede hvilke branchekoder et CPV-område svarer til: slå
 * vinderne op i CVR og se hvad de faktisk laver (se markedService.js). Derfor
 * returneres RÅ NAVNE uden aggregering — modsat getMarketPlayers(), som
 * rangerer efter antal sejre. Her tæller hver virksomhed én gang, uanset hvor
 * mange kontrakter den har vundet, så en enkelt storvinder ikke kommer til at
 * definere hele markedets branchekode.
 *
 * Afgrænset til buyer-country=DNK, fordi navnene skal matches mod det danske
 * CVR-register. Uden den afgrænsning ville feltet fyldes med udenlandske
 * vindere, der aldrig kan matches, og dækningsgraden ville se kunstigt lav ud.
 *
 * Ét kald pr. CPV-kode frem for én sammensat forespørgsel: TED's
 * expert query language understøtter OR, men adfærden ved OR mellem
 * classification-cpv-led er ikke verificeret mod API'et, og et forkert
 * sammensat filter ville fejle stille med for få træf.
 *
 * @param {string[]} cpvCodes
 * @param {{ perKode?: number }} [options]
 * @returns {Promise<{ navne: string[], antalNotices: number }>}
 */
export async function getWinnerNamesByCPV(cpvCodes, options = {}) {
  const { perKode = 100 } = options;
  const koder = [...new Set((cpvCodes || []).map((k) => k?.split("-")[0]?.trim()).filter(Boolean))];
  if (!koder.length) return { navne: [], antalNotices: 0 };

  const svar = await Promise.all(
    koder.map((code) =>
      postSearch(
        `classification-cpv=${code} AND notice-type=can-standard AND buyer-country=DNK` +
          " SORT BY publication-date DESC",
        { page: 1, limit: perKode }
      ).catch(() => ({ notices: [] }))
    )
  );

  const navne = new Set();
  let antalNotices = 0;
  for (const data of svar) {
    for (const notice of data.notices || []) {
      antalNotices++;
      for (const navn of winnerNamesList(notice["winner-name"])) {
        const rent = String(navn).trim();
        if (rent) navne.add(rent);
      }
    }
  }

  return { navne: [...navne], antalNotices };
}

/**
 * Find de virksomheder der historisk har vundet flest kontrakter inden for en
 * CPV-kode (valgfrit afgrænset til én ordregiver) — bruges til at pege på
 * SANDSYNLIGE KONKURRENTER til et konkret, aktivt udbud.
 *
 * Vigtig skelnen: dette er hvem der har VUNDET før, ikke hvem der vil BYDE på
 * netop dette udbud — der findes ingen offentlig kilde til bud-hensigt, kun
 * til tildelinger. UI'et der bruger dette må aldrig formulere det som "vil
 * byde", kun "har historisk vundet i dette marked".
 *
 * Samme disciplin som searchWonContractsByCompany() og
 * tedNoticeService.js: for en rammeaftale/DPS (isMultiWinner) tælles hver
 * navngiven vinder med i winCount, men ALDRIG i singleContractValueDkk —
 * rammens loftværdi må ikke tilskrives én enkelt vinder her, af samme grund
 * som i CompanyLookupPage. Vil man se en konkurrents rigtige andel af en
 * rammeaftale, er det tedNoticeService.getNoticeDetail() på den specifikke
 * notice.
 *
 * `mustInclude`, hvis angivet, GARANTERER at netop dette firmanavn er med i
 * det returnerede felt, selv hvis det ikke er blandt de `top` mest
 * vindende — inkl. med winCount:0 hvis firmaet aldrig har vundet noget i
 * dette CPV-felt. Det er lige så vigtigt et signal som en placering: "I har
 * aldrig vundet her" er reel, brugbar information, ikke en fejl at skjule.
 * Bruges til altid at kunne vise "os" i konkurrentfeltet i
 * Tilbudsgiver-radaren, uanset hvor stærk eller svag ens egen historik er.
 *
 * @param {string} cpvCode
 * @param {{ buyerName?: string, sampleSize?: number, top?: number, mustInclude?: string }} [options]
 * @returns {Promise<Array<{ name: string, winCount: number, singleContractValueDkk: number, notices: object[], isMustInclude?: true }>>}
 */
export async function getMarketPlayers(cpvCode, options = {}) {
  const code = cpvCode?.split("-")[0]?.trim();
  if (!code) return [];

  const { buyerName, sampleSize = 50, top = 6, mustInclude } = options;

  let query = `classification-cpv=${code} AND notice-type=can-standard`;
  if (buyerName?.trim()) {
    query += ` AND buyer-name="${escapeQueryPhrase(buyerName.trim())}"`;
  }
  query += " SORT BY publication-date DESC";

  const data = await postSearch(query, { page: 1, limit: sampleSize });
  const notices = (data.notices || []).map(normalizeNotice);

  const byName = new Map();
  for (const notice of notices) {
    for (const rawName of notice.winnerNames) {
      const key = normalizeForMatch(rawName);
      if (!key) continue;

      const entry = byName.get(key) || {
        name: rawName,
        winCount: 0,
        singleContractValueDkk: 0,
        notices: []
      };
      entry.winCount += 1;
      if (!notice.isMultiWinner && notice.value != null && notice.currency === "DKK") {
        entry.singleContractValueDkk += notice.value;
      }
      entry.notices.push(notice);
      byName.set(key, entry);
    }
  }

  const ranked = Array.from(byName.values()).sort(
    (a, b) => b.winCount - a.winCount || b.singleContractValueDkk - a.singleContractValueDkk
  );
  const result = ranked.slice(0, top);

  if (mustInclude?.trim()) {
    const needle = normalizeForMatch(mustInclude);
    const alreadyIn = result.some((p) => normalizeForMatch(p.name) === needle);
    if (!alreadyIn) {
      const fullMatch = ranked.find((p) => normalizeForMatch(p.name) === needle);
      result.push(
        fullMatch
          ? { ...fullMatch, isMustInclude: true }
          : { name: mustInclude, winCount: 0, singleContractValueDkk: 0, notices: [], isMustInclude: true }
      );
    } else {
      const match = result.find((p) => normalizeForMatch(p.name) === needle);
      if (match) match.isMustInclude = true;
    }
  }

  return result;
}

// TED's felter matcher kun HELE tokens, aldrig et præfiks eller en delstreng
// — MEN understøtter et efterstillet wildcard-tegn ("konsulent*"),
// verificeret ved direkte research. Det er afgørende for dansk fritekst:
// danske sammensatte ord skrives i ét ord uden mellemrum
// ("konsulentydelser", "IT-konsulentbistand"), så et helt-ord-match på
// "konsulent" alene rammer reelt ALDRIG noget (0 træf, testet), mens
// "konsulent*" rammer 428 relevante notices. Wildcard løser samtidig det
// oprindelige præfiks-problem ("Ørst*" matcher nu også "Ørsted" undervejs i
// indtastningen) — se WORD_RE nedenfor.
function wildcardWord(word) {
  // Kun bogstaver/tal/bindestreg bevares — TED's forespørgselssprog bruger
  // reserverede tegn (", (, ), *) som brugeren ellers kunne indtaste ved et
  // uheld og derved ødelægge forespørgslen.
  const cleaned = word.replace(/[^\p{L}\p{N}-]/gu, "");
  return cleaned ? `${cleaned}*` : null;
}

/**
 * Søg efter AKTIVE danske udbudsbekendtgørelser på titel eller ordregiver —
 * til at finde et konkret udbud i Tilbudsgiver-radaren uden at kende
 * notice-nummeret i forvejen.
 *
 * Hvert ord i søgeteksten wildcard-udvides og skal matche ENTEN titel eller
 * ordregiver (ordene kan ramme forskellige felter — "Ørsted konsulent"
 * finder udbud hvor "Ørsted" er ordregiveren og "konsulent" står i titlen).
 * ALLE ord skal matche ét eller andet sted, men hvert ord for sig kan matche
 * enten felt — verificeret direkte: en tilsvarende forespørgsel på "Ørsted"
 * + "rørled" gav præcis de 2 reelle Ørsted-rørlednings-udbud, intet andet.
 *
 * Afgrænset til danske ordregivere (buyer-country=DNK) SOM UDGANGSPUNKT —
 * appens primære formål er danske udbud, og uden afgrænsningen bliver
 * EU-indekset hurtigt for støjende til en forslagsliste. Kaldende kode kan
 * sætte scope: "EU" for bevidst at slå afgrænsningen fra og søge i hele
 * TED, fx når et dansk datterselskab byder under et udenlandsk moderselskab,
 * eller udbuddet ligger uden for Danmark.
 *
 * @param {string} text
 * @param {{ limit?: number, scope?: "DK"|"EU" }} [options]
 * @returns {Promise<Array<{ publicationNumber: string, title: string|null, buyerName: string, date: string|null }>>}
 */
export async function searchActiveNotices(text, options = {}) {
  const { limit = 8, scope = "DK" } = options;

  // Maks. 6 ord — dels for ikke at bygge en absurd lang forespørgsel af en
  // hel sætning indsat ved et uheld, dels fordi flere ord end det sjældent
  // giver mere præcision i en titel/ordregiver-søgning.
  const words = text
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .map(wildcardWord)
    .filter(Boolean);
  if (words.length === 0) return [];

  const clauses = words.map((w) => `(notice-title=${w} OR buyer-name=${w})`).join(" AND ");
  const countryFilter = scope === "EU" ? "" : " AND buyer-country=DNK";
  const query = `${clauses} AND notice-type=cn-standard${countryFilter} SORT BY publication-date DESC`;

  const data = await postSearch(query, { page: 1, limit });

  return (data.notices || [])
    .map(normalizeNotice)
    .filter((n) => n.publicationNumber);
}

// ---------------------------------------------------------------------------
// Ordregiversiden: hvad har en myndighed selv offentliggjort i TED
// ---------------------------------------------------------------------------

// TED's bekendtgørelsestyper grupperet, så de kan filtreres med samme tre
// begreber som vores eget indeks bruger (udbud / forhåndsmeddelelse /
// tildeling). Der findes flere typer end de nævnte — derfor er "alle"
// standardvalget, som IKKE filtrerer: en gruppe der glemte en type ville
// skjule bekendtgørelser bag noget, der ser ud som et komplet svar.
//
// Verificeret mod API'et for CVR 64942212 (Københavns Kommune, 2.419
// bekendtgørelser i alt): cn-standard 874, can-standard 905, pin-only 178,
// cn-social 78, veat 60, can-social 54, corr 177, pin-buyer 7, cn-desg 2.
// Grupperne dækker 2.158 af dem; resten er rettelser (corr) og sjældne typer,
// som kun "alle" viser.
export const TED_ARTER = [
  { vaerdi: "alle", etiket: "Alle", typer: [] },
  { vaerdi: "udbud", etiket: "Udbud", typer: ["cn-standard", "cn-social", "cn-desg"] },
  {
    vaerdi: "forhaandsmeddelelse",
    etiket: "Forhåndsmeddelelse",
    typer: ["pin-only", "pin-buyer", "pin-tran", "pin-rtl"]
  },
  {
    vaerdi: "tildeling",
    etiket: "Tildeling",
    typer: ["can-standard", "can-social", "can-desg", "veat"]
  }
];

// TED's egne typekoder er ikke til at læse for en dansk bruger. Ukendte koder
// vises råt frem for at blive skjult eller gættet på.
const TED_TYPE_ETIKET = {
  "cn-standard": "Udbud",
  "cn-social": "Udbud (light regime)",
  "cn-desg": "Projektkonkurrence",
  "can-standard": "Tildeling",
  "can-social": "Tildeling (light regime)",
  "can-desg": "Tildeling (projektkonkurrence)",
  veat: "Frivillig forudgående gennemsigtighed (VEAT)",
  "pin-only": "Forhåndsmeddelelse",
  "pin-buyer": "Forhåndsmeddelelse (køberprofil)",
  "pin-tran": "Forhåndsmeddelelse",
  "pin-rtl": "Forhåndsmeddelelse",
  corr: "Rettelse"
};

export function tedTypeEtiket(noticeType) {
  if (!noticeType) return "–";
  return TED_TYPE_ETIKET[noticeType] || noticeType;
}

// Ordregiversøgningen har brug for CPV og frist ud over standardfelterne:
// listen skal kunne læses som "hvad udbyder de, og kan man stadig byde".
const BUYER_RESULT_FIELDS = [...RESULT_FIELDS, "classification-cpv", "deadline-date-lot"];

/**
 * Søg efter de bekendtgørelser en ORDREGIVER selv har offentliggjort i TED.
 *
 * SØGER PÅ CVR-NUMMER, IKKE NAVN. TED har feltet `buyer-identifier`, som
 * indeholder ordregiverens nationale registreringsnummer — for danske
 * myndigheder CVR-nummeret. Det er verificeret direkte mod API'et og er
 * afgørende af to grunde:
 *
 *   1. Navnet er fritekst pr. bekendtgørelse. Københavns Kommune optræder
 *      under 29 navne i vores indeks alene; et navnematch rammer nogle af
 *      dem, aldrig alle.
 *   2. Rækkevidden. `buyer-identifier=64942212` giver 2.419 bekendtgørelser
 *      tilbage til august 2016, hvor vores eget udbud.dk-indeks har 887 og
 *      begynder i november 2024. Det er hele grunden til at TED er en
 *      selvstændig kilde på ordregiverprofilen og ikke bare en dublet.
 *
 * `buyer-country=DNK` står med som sikkerhedsnet: identifikatorfeltet er ikke
 * dansk-specifikt, og enkelte udenlandske ordregivere har indberettet numre
 * der kolliderer med et CVR-nummer (fx findes "99999999" 25 gange i TED).
 *
 * Uden CVR-nummer falder vi tilbage til frasesøgning på navnet — verificeret
 * mod ordregivernavnet i svaret, samme disciplin som
 * searchWonContractsByCompany().
 *
 * @param {{ cvr?: string|null, navn?: string, art?: string, page?: number, limit?: number }} options
 * @returns {Promise<{ notices: object[], total: number, viaNavn: boolean }>}
 */
export async function searchNoticesByBuyer({
  cvr = null,
  navn = "",
  art = "alle",
  page = 1,
  limit = 25
} = {}) {
  const rentCvr = /^\d{8}$/.test(String(cvr ?? "").trim()) ? String(cvr).trim() : null;
  const rentNavn = (navn || "").trim();
  if (!rentCvr && !rentNavn) return { notices: [], total: 0, viaNavn: false };

  const gruppe = TED_ARTER.find((a) => a.vaerdi === art) || TED_ARTER[0];
  const typeFilter = gruppe.typer.length ? ` AND notice-type IN (${gruppe.typer.join(" ")})` : "";

  const basis = rentCvr
    ? `buyer-identifier=${rentCvr} AND buyer-country=DNK`
    : `buyer-name="${escapeQueryPhrase(rentNavn)}"`;

  const data = await postSearch(`${basis}${typeFilter} SORT BY publication-date DESC`, {
    page,
    limit,
    fields: BUYER_RESULT_FIELDS
  });

  const notices = (data.notices || []).map(normalizeNotice);

  if (rentCvr) {
    return { notices, total: data.totalNoticeCount || 0, viaNavn: false };
  }

  // Navnesøgningen verificeres: TED's frasematch er deres egen fortolkning, og
  // et forkert træf ville her blive vist som "denne myndigheds eget udbud".
  const needle = normalizeForMatch(coreCompanyName(rentNavn));
  const verificeret = notices.filter((n) => normalizeForMatch(n.buyerName).includes(needle));

  return {
    notices: verificeret,
    // Ikke totalNoticeCount: den tæller TED's ufiltrerede træf og ville
    // overdrive antallet efter vores egen verifikation.
    total: verificeret.length,
    viaNavn: true
  };
}
