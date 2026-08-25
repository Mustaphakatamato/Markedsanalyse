// Opslag på en ORDREGIVER — modstykket til cvrService's virksomhedsopslag.
//
// HVORFOR ET EGET OPSLAG: appens øvrige flows spørger "hvem kan levere". Dette
// spørger "hvad udbyder de", og det er et andet spørgsmål med en anden nøgle.
// En ordregiver findes ikke ved at slå navnet op ét sted: ordregiverfeltet i
// bekendtgørelserne er fritekst, som myndigheden selv udfylder hver gang, og
// Københavns Kommune står derfor under 29 forskellige navne i kilden
// ("Teknik- og Miljøforvaltningen", "Byggeri København", "Copenhagen
// Municipality" …). Det er CVR-nummeret, der er identiteten — både i vores
// eget indeks og i TED, hvor feltet heder buyer-identifier.
//
// Søgningen går derfor mod indekset over udbud.dk (samme tabel som
// Udbudssøgning bruger), hvor navnevarianterne er slået sammen pr. CVR. Se
// supabase/migrations/20260825120000_ordregiver_opslag.sql.

import { getFromFunction } from "../lib/apiClient";

const CVR_NUMMER = /^\d{8}$/;

/**
 * Søg efter ordregivere på navn eller CVR-nummer.
 *
 * Ét resultat pr. ordregiver (pr. CVR-nummer), ikke pr. navnevariant — og et
 * træf på ÉN variant giver hele ordregiverens bekendtgørelser. Søger man på
 * "Byggeri København", er svaret derfor Københavns Kommune med alle 887
 * bekendtgørelser, ikke de 12 der tilfældigvis bar netop det navn.
 *
 * @param {string} tekst Navn (eller del af navn) eller 8-cifret CVR-nummer
 * @param {{ maks?: number }} [options]
 * @returns {Promise<{
 *   status: "ok" | "not_found" | "error",
 *   ordregivere?: Array<{
 *     navn: string, cvr: string|null, navnevarianter: string[], antalNavne: number,
 *     antal: number, aabne: number, foerste: string, seneste: string,
 *     prKilde: Record<string, number>, prArt: Record<string, number>
 *   }>,
 *   indeksStart?: string|null,
 *   message?: string
 * }>}
 */
export async function søgOrdregivere(tekst, options = {}) {
  const term = (tekst ?? "").trim();
  if (term.length < 2) {
    return { status: "not_found", message: "Søgeteksten skal være mindst to tegn." };
  }

  const { maks = 10 } = options;

  try {
    const svar = await getFromFunction(
      `/ordregiver-soeg?q=${encodeURIComponent(term)}&maks=${maks}`
    );
    const data = await svar.json().catch(() => null);

    if (!svar.ok || !data) {
      return { status: "error", message: data?.error || "Ordregiversøgningen fejlede." };
    }

    if (!data.ordregivere?.length) {
      return {
        status: "not_found",
        // Indekset går kun tilbage til november 2024, og det er den langt
        // mest sandsynlige grund til et tomt svar for en rigtig myndighed.
        // Den skelnen skal frem, ellers ligner det "de udbyder ikke noget".
        message: CVR_NUMMER.test(term)
          ? "Ingen bekendtgørelser i indekset fra den ordregiver. Indekset dækker udbud.dk fra november 2024 — ældre udbud findes kun i TED."
          : "Ingen ordregiver i indekset matcher det navn. Prøv en kortere del af navnet, eller søg på CVR-nummeret.",
        indeksStart: data.indeksStart ?? null
      };
    }

    return {
      status: "ok",
      ordregivere: data.ordregivere,
      indeksStart: data.indeksStart ?? null
    };
  } catch (err) {
    return { status: "error", message: err.message || "Ordregiversøgningen fejlede." };
  }
}

// Fordelingen pr. art i ét tal, til profilens overskrift. Rækkefølgen er den
// samme som i ARTER (udbudService), så to lister aldrig står i forskellig
// orden på samme side.
export function opsummerArter(prArt = {}) {
  return {
    udbud: prArt.udbud ?? 0,
    forhaandsmeddelelse: prArt.forhaandsmeddelelse ?? 0,
    tildeling: prArt.tildeling ?? 0,
    andet: prArt.andet ?? 0
  };
}
