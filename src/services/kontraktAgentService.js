// Klientsiden af kontraktopslaget.
//
// Opslaget sker i to tempi, og opdelingen er bevidst:
//
//   1. spoergAgent()  — fri tekst ind, rangerede TED-kandidater ud. Går
//      gennem Edge Function'en "kontrakt-agent", hvor sprogmodellen læser
//      beskeden og KODEN søger. Hurtigt, og billigt nok til hvert tastetryk
//      i en samtale.
//
//   2. hentKontrakt() — den fulde kontraktdetalje for ÉN valgt kandidat,
//      plus leverandørens regnskabstal. Dyrt (en eForms-XML kan fylde
//      hundredvis af KB), så det sker først når brugeren har peget på den
//      kontrakt, der skal foldes ud.
//
// Begge trin genbruger de services, der allerede findes — tedNoticeService
// til XML-udtrækket og companyEnrichmentService til CVR/regnskab. Der er
// bevidst ikke skrevet ny udtrækslogik her: to implementeringer af "hvad står
// der i denne bekendtgørelse" ville kunne give modstridende svar om samme
// kontrakt.

import { postToFunction } from "../lib/apiClient";
import { getNoticeDetail, getTenderRequirements } from "./tedNoticeService";
import { resolveCompanyFinancials } from "./companyEnrichmentService";

/**
 * Lad agenten læse en besked og finde kandidater i TED.
 *
 * @param {string} besked
 * @returns {Promise<{
 *   fortolkning: { cvr: string, kontraktnavn: string, ordregiver: string, aar: string, kommentar: string },
 *   kandidater: object[],
 *   forespoergsler: { query: string, traf: number }[],
 *   mangler: string|null
 * }>}
 */
export async function spoergAgent(besked) {
  const svar = await postToFunction("/kontrakt-agent", { besked });

  if (!svar.ok) {
    const krop = await svar.json().catch(() => null);
    throw new Error(krop?.error || `Agenten fejlede (HTTP ${svar.status}).`);
  }

  return svar.json();
}

/**
 * Fold én kandidat ud til en fuld kontrakt- og leverandørprofil.
 *
 * Leverandørens navn tages fra kandidatens vinderfelt, ikke fra brugerens
 * besked: det er TED's egen stavemåde, og det er den, CVR-opslaget skal
 * matche imod.
 *
 * De tre opslag kører PARALLELT og fejler hver for sig. Et manglende
 * regnskab må ikke koste kontraktdetaljen — delvis data med et synligt hul er
 * bedre end en tom side, netop fordi hullet kan ses.
 *
 * @param {object} kandidat fra spoergAgent()
 * @returns {Promise<{ detalje: object|null, krav: object|null, leverandoer: object|null, fejl: string[] }>}
 */
export async function hentKontrakt(kandidat) {
  const publikationsnummer = kandidat?.publikationsnummer;
  if (!publikationsnummer) {
    return { detalje: null, krav: null, leverandoer: null, fejl: ["Kandidaten har intet publikationsnummer."] };
  }

  const leverandoerNavn = kandidat.vindere?.[0] || null;

  // getNoticeDetail tager det notice-format, tedService leverer — kandidaten
  // oversættes derfor tilbage til de feltnavne, den kender.
  const notice = {
    publicationNumber: publikationsnummer,
    winnerName: leverandoerNavn || "",
    winnerNames: kandidat.vindere || [],
    buyerName: kandidat.ordregiver || "",
    title: kandidat.titel || "",
    date: kandidat.dato || null,
    value: kandidat.vaerdi ?? null,
    currency: kandidat.valuta || null
  };

  const [detalje, krav, leverandoer] = await Promise.allSettled([
    getNoticeDetail(notice, leverandoerNavn),
    getTenderRequirements(publikationsnummer),
    leverandoerNavn ? resolveCompanyFinancials(leverandoerNavn) : Promise.resolve(null)
  ]);

  const fejl = [];
  if (detalje.status === "rejected") fejl.push(`Kontraktdetaljen: ${detalje.reason?.message ?? "ukendt fejl"}`);
  if (krav.status === "rejected") fejl.push(`Kravene: ${krav.reason?.message ?? "ukendt fejl"}`);
  if (leverandoer.status === "rejected") fejl.push(`Leverandøropslaget: ${leverandoer.reason?.message ?? "ukendt fejl"}`);

  return {
    detalje: detalje.status === "fulfilled" ? detalje.value : null,
    krav: krav.status === "fulfilled" ? krav.value : null,
    leverandoer: leverandoer.status === "fulfilled" ? leverandoer.value : null,
    fejl
  };
}

// TED's typekoder oversat — samme tabel som tedService.tedTypeEtiket, men
// kandidaterne kommer fra Edge Function'en og ikke gennem tedService, så
// etiketten slås op her. Ukendte koder vises råt frem for at blive gættet.
const ART_ETIKET = {
  "cn-standard": "Udbud",
  "cn-social": "Udbud (light regime)",
  "cn-desg": "Projektkonkurrence",
  "can-standard": "Tildeling",
  "can-social": "Tildeling (light regime)",
  "can-desg": "Tildeling (projektkonkurrence)",
  veat: "Frivillig forudgående gennemsigtighed",
  "pin-only": "Forhåndsmeddelelse",
  "pin-buyer": "Forhåndsmeddelelse (køberprofil)",
  "pin-tran": "Forhåndsmeddelelse",
  "pin-rtl": "Forhåndsmeddelelse",
  corr: "Rettelse"
};

export function artEtiket(art) {
  if (!art) return "–";
  return ART_ETIKET[art] || art;
}
