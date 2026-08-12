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

async function postSearch(query, { page = 1, limit = 25 } = {}) {
  const response = await postToFunction("/ted", { query, fields: RESULT_FIELDS, page, limit });

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
 * Afgrænset til danske ordregivere (buyer-country=DNK) — appens formål er
 * danske udbud, og uden afgrænsningen bliver EU-indekset for støjende til en
 * forslagsliste. En dansk virksomhed under et udenlandsk moderselskab vil
 * derfor kunne mangle her.
 *
 * @param {string} text
 * @param {{ limit?: number }} [options]
 * @returns {Promise<Array<{ publicationNumber: string, title: string|null, buyerName: string, date: string|null }>>}
 */
export async function searchActiveNotices(text, options = {}) {
  const { limit = 8 } = options;

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
  const query = `${clauses} AND notice-type=cn-standard AND buyer-country=DNK SORT BY publication-date DESC`;

  const data = await postSearch(query, { page: 1, limit });

  return (data.notices || [])
    .map(normalizeNotice)
    .filter((n) => n.publicationNumber);
}
