// CPV-nomenklaturen — Common Procurement Vocabulary, 9.454 koder på dansk.
//
// HVORFOR DEN ER EN RIGTIG KILDE OG IKKE EN LISTE I KODEN: en ordregiver skal
// angive CPV-koder for sit udbud, og betegnelsen skal være den officielle.
// Appen havde tidligere fire hardkodede koder med opdigtede betegnelser —
// 64212000 stod som "SMS gateway og beskedtjenester", men hedder
// "Mobiltelefontjeneste"; sms-tjenester er 64212100. En opdigtet betegnelse i
// udbudsmaterialet ville være direkte forkert.
//
// Teksterne fylder 315 KB rå og ligger derfor i Postgres, ikke i bundlen.
// Søgningen går gennem Edge Function'en "marked" (handling "cpv").

import { postToFunction } from "../lib/apiClient";

// Søger på både kode og betegnelse, fordi brugeren kan have begge dele i
// hovedet. Brede koder rangeres over smalle: leder man efter "bygge", er
// 45000000 Bygge- og anlægsarbejder et mere sandsynligt valg end en af de
// hundredvis af underkoder, der også indeholder ordet.
export async function soegCpv(soegetekst, { maks = 20 } = {}) {
  const q = String(soegetekst ?? "").trim();
  if (q.length < 2) return [];

  const svar = await postToFunction("/marked", { handling: "cpv", q, maks });

  if (!svar.ok) {
    const fejl = await svar.json().catch(() => null);
    throw new Error(fejl?.error || `CPV-søgning fejlede (HTTP ${svar.status})`);
  }

  const { traf } = await svar.json();
  return traf ?? [];
}

// CPV-koder er hierarkiske gennem efterstillede nuller: 45000000 er
// hovedgruppen, 45100000 en gruppe under den. Bruges til at vise hvor bredt
// et valg er — en hovedgruppe dækker et helt marked, en dyb kode et hjørne.
export function erHovedgruppe(kode) {
  return typeof kode === "string" && /^\d{2}0{6}$/.test(kode);
}

// TED's søge-API vil have koden uden kontrolciffer. Nomenklaturen og appen
// bruger den 8-cifrede form, men koder skrevet af mennesker har ofte
// bindestregen med ("72222300-0") — se tedService.searchByCPV().
export function normaliserCpv(kode) {
  return String(kode ?? "").trim().split("-")[0];
}
