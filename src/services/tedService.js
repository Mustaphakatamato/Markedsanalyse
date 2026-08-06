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

function coreCompanyName(name) {
  return name.replace(OWNER_MARKER, "").replace(LEGAL_FORM_SUFFIX, "").trim();
}

// Sammenligning skal være ufølsom over for store/små bogstaver, diakritiske
// tegn (Ø/ø, é) og tegnsætning — "A/S Øresund" og "as oresund" er samme navn.
function normalizeForMatch(text) {
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

function normalizeNotice(notice) {
  const currency = Array.isArray(notice["total-value-cur"])
    ? notice["total-value-cur"][0]
    : notice["total-value-cur"];

  return {
    id: notice["notice-identifier"] || notice["publication-number"],
    publicationNumber: notice["publication-number"] || null,
    date: notice["publication-date"] || null,
    noticeType: notice["notice-type"] || null,
    winnerName: firstText(notice["winner-name"]),
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
