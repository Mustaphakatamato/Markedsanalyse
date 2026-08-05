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
// - In dev/preview this goes through the Vite proxy at /api/ted (see
//   vite.config.js) because TED's API does not send CORS headers.
// - No "sort" request field exists, but the query language itself supports
//   a trailing "SORT BY <field> DESC/ASC" clause.

const TED_SEARCH_URL = "/api/ted/v3/notices/search";

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
  const response = await fetch(TED_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: RESULT_FIELDS, page, limit })
  });

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
 * Tries an exact phrase match first; if that comes back empty, retries with
 * a looser (unquoted) match on the same term as a fallback.
 *
 * @param {string} companyName
 * @param {{ page?: number, limit?: number }} [options]
 * @returns {Promise<{ notices: object[], total: number, usedFallback: boolean }>}
 */
export async function searchWonContractsByCompany(companyName, options = {}) {
  const name = companyName.trim();
  if (!name) return { notices: [], total: 0, usedFallback: false };

  const { page = 1, limit = 25 } = options;

  const exactQuery = `winner-name="${escapeQueryPhrase(name)}"`;
  let data = await postSearch(exactQuery, { page, limit });
  let usedFallback = false;

  if (!data.notices?.length && name.split(/\s+/).length > 1) {
    // Fall back to the first word unquoted — TED's phrase match is strict
    // about legal suffixes (A/S, ApS, etc.), so a full exact phrase often
    // misses even real matches.
    const looseTerm = name.split(/\s+/)[0];
    data = await postSearch(`winner-name=${looseTerm}`, { page, limit });
    usedFallback = true;
  }

  return {
    notices: (data.notices || []).map(normalizeNotice),
    total: data.totalNoticeCount || 0,
    usedFallback
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
