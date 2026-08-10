// Rigtigt EU-sanktionstjek mod vores eget indeks af EU's konsoliderede
// sanktionsliste (Financial Sanctions Files) — se
// supabase/functions/sanktionstjek/index.ts for kilde og metode. Erstatter
// det tidligere hardkodede sanctionsMatch: false i esgService.js, som aldrig
// kunne finde noget, uanset hvem man slog op.
//
// Bevidst konservativt: kun eksakt navnematch, ingen fuzzy-søgning — et
// falsk positivt i en due diligence-kontekst er værre end et overset match.
// Fejler stille (returnerer null) frem for at vælte resten af opslaget, hvis
// funktionen ikke svarer — samme mønster som industryBenchmarkService.js.

import { getFromFunction } from "../lib/apiClient";

/**
 * @param {string} companyName
 * @returns {Promise<{ match: boolean, fund: Array<{ navn: string, type: string|null, programme: string|null }>, kilde: string } | null>}
 */
export async function checkSanctions(companyName) {
  const name = (companyName ?? "").trim();
  if (name.length < 2) return null;

  try {
    const response = await getFromFunction(`/sanktionstjek?navn=${encodeURIComponent(name)}`);
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return null;
    return data;
  } catch {
    return null;
  }
}
