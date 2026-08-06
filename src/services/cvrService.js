// CVR-opslag mod Erhvervsstyrelsens data via Datafordeleren. Erstatter
// cvrapi.dk, som havde et loft på 50 opslag/dag pr. IP — et loft der blev
// delt af alle appens brugere, når kaldene gik gennem vores server.
//
// Opslaget er delt i to, fordi kilden er delt i to:
//
//   søgVirksomheder()  — fritekstsøgning på navn. Går mod vores EGET indeks i
//                        Postgres, indlæst ugentligt fra Datafordelerens
//                        fildownload (scripts/indlaes-cvr-navne.mjs).
//                        Nødvendigt fordi Datafordelerens GraphQL kun kan
//                        filtrere strenge med "eq" og "in" — der findes ingen
//                        "contains", så "netcompany" ville give nul træf.
//
//   hentVirksomhed()   — stamdata for ét CVR-nummer, direkte fra
//                        Datafordelerens GraphQL. Ubegrænset.
//
// Indekset dækker kun AKTIVE virksomheder, da det er hvad Datafordelerens
// "current"-udtræk indeholder. Ophørte selskaber kan ikke findes på navn, men
// hentes fint på CVR-nummer.

import { getFromFunction } from "../lib/apiClient";

const CVR_NUMMER = /^\d{8}$/;

/**
 * Søg efter virksomheder på navn — eller genkend et CVR-nummer.
 *
 * @param {string} query Firmanavn eller 8-cifret CVR-nummer
 * @returns {Promise<
 *   | { status: "cvr", cvr: string }
 *   | { status: "ok", traf: Array<{ cvr: string, navn: string }> }
 *   | { status: "not_found" | "error", message: string }
 * >}
 */
export async function søgVirksomheder(query) {
  const term = (query ?? "").trim();
  if (!term) return { status: "not_found", message: "Angiv et firmanavn eller CVR-nummer." };

  if (CVR_NUMMER.test(term)) return { status: "cvr", cvr: term };

  if (term.length < 2) {
    return { status: "not_found", message: "Søgeteksten skal være mindst to tegn." };
  }

  try {
    const response = await getFromFunction(`/cvr-soeg?q=${encodeURIComponent(term)}&maks=10`);
    const data = await response.json().catch(() => null);

    if (!response.ok || !data) {
      return { status: "error", message: data?.error || "Søgningen fejlede." };
    }

    if (!data.traf?.length) {
      return {
        status: "not_found",
        message:
          "Ingen aktiv virksomhed fundet med det navn. Er selskabet ophørt, kan du " +
          "søge på CVR-nummeret i stedet."
      };
    }

    return { status: "ok", traf: data.traf };
  } catch (err) {
    return { status: "error", message: err.message || "Søgningen fejlede." };
  }
}

/**
 * Hent stamdata for én virksomhed på CVR-nummer.
 *
 * @param {string} cvr 8-cifret CVR-nummer
 * @returns {Promise<{ status: "ok", company: object } | { status: "not_found" | "error", message?: string }>}
 */
export async function hentVirksomhed(cvr) {
  if (!CVR_NUMMER.test(cvr ?? "")) {
    return { status: "not_found", message: "Ugyldigt CVR-nummer." };
  }

  try {
    const response = await getFromFunction(`/cvr-datafordeler?cvr=${cvr}`);
    const data = await response.json().catch(() => null);

    if (!data) return { status: "error", message: "Kunne ikke læse svar fra CVR-opslaget." };

    if (data.status === "ok") return { status: "ok", company: data.company };
    if (data.status === "not_found") {
      return { status: "not_found", message: "Ingen virksomhed fundet med det CVR-nummer." };
    }

    return { status: "error", message: data.message || "Opslaget fejlede." };
  } catch (err) {
    return { status: "error", message: err.message || "Opslaget fejlede." };
  }
}
