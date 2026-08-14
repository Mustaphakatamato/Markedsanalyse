// Søgning i udbud.dk's bekendtgørelser.
//
// HVORFOR DER ER ET INDEKS BAG: udbud.dk's eksterne API kan ikke søges.
// Endepunktet `fraKilde/{kilde}` tager præcis tre parametre — page, size og
// since — og hver bekendtgørelse leveres som base64-encoded eForms-XML. Vil
// man kunne filtrere på CPV-kode, er man nødt til at bygge sit eget indeks.
// Det gør scripts/indlaes-udbud-dk.mjs; her søges der bare i det.
//
// HVORFOR KILDEN STÅR PÅ HVER RÆKKE: DKUDBUD er danske udbud UNDER EU's
// tærskelværdi. De findes ikke i TED og dermed ikke i nogen af appens andre
// flows. For en tilbudsgiver er det den mest interessante delmængde, og den
// skal kunne skilles ud.

import { postToFunction } from "../lib/apiClient";

export const ARTER = [
  { vaerdi: "udbud", etiket: "Udbud" },
  { vaerdi: "forhaandsmeddelelse", etiket: "Forhåndsmeddelelse" },
  { vaerdi: "tildeling", etiket: "Tildeling" }
];

export const KILDER = [
  { vaerdi: "DKUDBUD", etiket: "Kun danske (under tærskel)" },
  { vaerdi: "TED", etiket: "EU-udbud (TED)" }
];

// Kontrakttypen er eForms' egen kode; oversættelsen hører til i visningen og
// ikke i en tabel i databasen, hvor den ville skulle vedligeholdes to steder.
export const KONTRAKTTYPE = {
  works: "Bygge og anlæg",
  services: "Tjenesteydelser",
  supplies: "Varer"
};

export async function soegUdbud({
  soegetekst = "",
  cpvKoder = [],
  kilder = [],
  arter = [],
  kunAabne = false,
  sortering = "frist",
  maks = 50,
  springOver = 0
} = {}) {
  const svar = await postToFunction("/udbud-soeg", {
    soegetekst,
    cpvKoder: cpvKoder.map((k) => (typeof k === "string" ? k : k.kode)),
    kilder,
    arter,
    kunAabne,
    sortering,
    maks,
    springOver
  });

  if (!svar.ok) {
    const fejl = await svar.json().catch(() => null);
    throw new Error(fejl?.error || `Udbudssøgning fejlede (HTTP ${svar.status})`);
  }

  return svar.json();
}

// Dage til fristen, negativt hvis den er overskredet. Regnes på hele dage i
// stedet for timer: "om 3 dage" er den beslutning en tilbudsgiver træffer på,
// og et tal som "om 62 timer" tvinger dem til at regne selv.
export function dageTil(frist) {
  if (!frist) return null;
  const nu = new Date();
  const slut = new Date(frist);
  if (Number.isNaN(slut.getTime())) return null;
  return Math.ceil((slut - nu) / 86_400_000);
}
