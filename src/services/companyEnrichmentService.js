// Fra et firmanavn til CVR-nummer og seneste regnskab.
//
// HVORFOR ET EGET LAG: både tilbudsgiver-radaren og markedsanalysen står med
// samme problem — de har en liste af NAVNE (TED-vindere, kandidatleverandører)
// og skal bruge tal. To implementeringer af den matchning ville kunne give
// forskellige svar for samme firma, og matchningen er præcis dét, der er
// nemmest at gøre lidt for løst.
//
// Matchningen er bevidst konservativ: kun et navn der reelt matcher, aldrig
// det første tilfældige træf. Et forkert CVR-nummer ville tilskrive en
// virksomhed en anden virksomheds økonomi — i en due diligence-sammenhæng er
// det værre end ingen tal, fordi det ligner et svar.
//
// Bemærk begrænsningen den arver fra TED: der er ingen CVR eller VAT på
// vinderen i de felter vi henter, så et koncernselskab i et andet land med
// samme navn kan komme med. Se README under "Kendte begrænsninger".

import { søgVirksomheder } from "./cvrService";
import { findLatestRegnskab } from "./regnskabService";
import { coreCompanyName, normalizeForMatch } from "./tedService";

// Rækkefølgen er rangeringen: et eksakt navnematch slår altid et kernenavn.
// Kernenavnet (uden selskabsform) bruges kun hvis det er langt nok til at
// være entydigt — "IT A/S" ville ellers matche hvad som helst med "it" i.
export function pickBestCvrMatch(candidates, name) {
  const fullNeedle = normalizeForMatch(name);
  const core = coreCompanyName(name);
  const coreNeedle = core.length >= 3 ? normalizeForMatch(core) : null;

  return (
    candidates.find((k) => normalizeForMatch(k.navn) === fullNeedle) ||
    candidates.find((k) => coreNeedle && normalizeForMatch(k.navn).includes(coreNeedle)) ||
    null
  );
}

// Returnerer altid et objekt, aldrig et kast: kaldes typisk i en løkke over
// mange virksomheder, hvor én der ikke kan slås op ikke må vælte de øvrige.
// Manglende data er en normal tilstand her, ikke en fejl — udenlandske
// vindere har intet dansk CVR-nummer.
export async function resolveCompanyFinancials(name) {
  const search = await søgVirksomheder(name);
  if (search.status !== "ok") return { cvr: null, financials: null };

  const match = pickBestCvrMatch(search.traf, name);
  if (!match) return { cvr: null, financials: null };

  const financials = await findLatestRegnskab(match.cvr);
  return { cvr: match.cvr, financials };
}

// Beriger en liste af navne parallelt. Hvert opslag koster to kald
// (navneindeks + regnskab), så en liste på 50 er 100 kald — kald den derfor
// med de kandidater brugeren faktisk har valgt at se på, ikke med hele
// markedet. Fejler stille pr. virksomhed.
export async function resolveMany(names, { maks = 25 } = {}) {
  const unikke = [...new Set(names.filter(Boolean))].slice(0, maks);

  const resultater = await Promise.all(
    unikke.map(async (navn) => {
      try {
        return { navn, ...(await resolveCompanyFinancials(navn)) };
      } catch {
        return { navn, cvr: null, financials: null };
      }
    })
  );

  return new Map(resultater.map((r) => [r.navn, r]));
}
