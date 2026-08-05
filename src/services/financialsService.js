// Økonomi/nøgletal for en virksomhed. Prøver rigtig data fra
// Erhvervsstyrelsens regnskaber (regnskabService.js) først. Se den fil for
// detaljer om kilden og dens begrænsninger.
//
// getMockFinancials() nedenfor er den tidligere deterministiske demo-generator
// — den kaldes IKKE automatisk længere (for ikke at blande fabrikerede tal med
// rigtige), men findes stadig til manuel brug/test.

import { findLatestRegnskab, listAvailableRegnskaber, getFinancialsForEntry } from "./regnskabService";

/**
 * @param {{ cvr?: string, name?: string }} company
 * @returns {Promise<
 *   | { status: "ok", fiscalYearEnd, toplineLabel, topline, result, priorYearResult, equity, assets, solvencyPct, sourceUrl, isMock: false }
 *   | { status: "facts_unavailable", sourceUrl: string }
 *   | { status: "not_found" }
 *   | { status: "error", message: string }
 * >}
 */
export async function getFinancials(company) {
  if (!company?.cvr) return { status: "not_found" };

  try {
    return await findLatestRegnskab(company.cvr);
  } catch (err) {
    return { status: "error", message: err.message || "Kunne ikke hente regnskabsdata." };
  }
}

/**
 * List op til 10 års indberettede regnskaber for en virksomhed (til
 * årstals-dropdown). Kaster ikke — returnerer tom liste ved fejl.
 * @param {{ cvr?: string }} company
 * @returns {Promise<Array<{ fiscalYearEnd: string, fiscalYearStart: string|null, documents: object[] }>>}
 */
export async function getAvailableFiscalYears(company) {
  if (!company?.cvr) return [];
  try {
    return await listAvailableRegnskaber(company.cvr, { limit: 10 });
  } catch {
    return [];
  }
}

/**
 * Hent nøgletal for et specifikt år (en entry fra getAvailableFiscalYears()).
 * @param {{ fiscalYearEnd: string, documents: object[] }} entry
 */
export async function getFinancialsForYear(entry) {
  try {
    return await getFinancialsForEntry(entry);
  } catch (err) {
    return { status: "error", message: err.message || "Kunne ikke hente regnskabsdata." };
  }
}

function seedFrom(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function rangeFromSeed(seed, min, max) {
  return min + (seed % (max - min));
}

const STABILITY_LEVELS = ["Lav", "Mellem", "Mellem-høj", "Høj"];
const CREDIT_LEVELS = ["Høj risiko", "Mellem risiko", "Lav risiko"];

/**
 * Deterministisk demo-økonomi, udledt af CVR-nummeret. IKKE kaldt automatisk
 * af CompanyLookupPage — kun til manuel brug når rigtig data ikke er relevant.
 * @param {{ cvr?: string, name?: string }} company
 */
export function getMockFinancials(company) {
  const seed = seedFrom(company.cvr || company.name || "ukendt");

  const revenueDkk = rangeFromSeed(seed, 5, 500) * 1_000_000;
  const marginPct = rangeFromSeed(seed >>> 3, -5, 15);
  const resultDkk = Math.round(revenueDkk * (marginPct / 100));
  const solvencyPct = rangeFromSeed(seed >>> 5, 15, 60);
  const equityDkk = Math.round(revenueDkk * (solvencyPct / 100) * 0.6);

  return {
    revenueDkk,
    resultDkk,
    equityDkk,
    solvencyPct,
    stability: STABILITY_LEVELS[seed % STABILITY_LEVELS.length],
    creditRisk: CREDIT_LEVELS[(seed >>> 2) % CREDIT_LEVELS.length],
    yearsOfData: 3,
    isMock: true
  };
}
