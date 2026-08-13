// Markedsafdækning — hvem findes der i et marked, ikke kun hvem der har
// vundet et EU-udbud før.
//
// HVORFOR DENNE KILDE FINDES: TED kender kun vindere af udbud over EU's
// tærskelværdi. Bruger man den alene som leverandørliste, bekræfter man de
// store og skjuler resten — stik imod formålet med en markedsanalyse, hvor
// spørgsmålet netop er om der er konkurrence nok, og om mindre leverandører
// kan løfte opgaven hvis den deles i delkontrakter. Kilden her er CVR:
// samtlige 870.564 aktive danske virksomheder med branche, geografi og
// selskabsform (se scripts/indlaes-cvr-indeks.mjs).
//
// Kaldene går gennem Edge Function'en "marked", fordi SQL-funktionerne
// bevidst er utilgængelige for klienten — de læser hele registret.

import { postToFunction } from "../lib/apiClient";

async function kald(krop) {
  const svar = await postToFunction("/marked", krop);

  if (!svar.ok) {
    const fejl = await svar.json().catch(() => null);
    throw new Error(fejl?.error || `Markedsopslag fejlede (HTTP ${svar.status})`);
  }

  return svar.json();
}

// Hvilke branchekoder peger et sæt TED-vindernavne på?
//
// Der findes ingen officiel oversættelse mellem CPV (hvad der købes) og DB25
// (hvad en virksomhed laver), så den udledes af data: slå vinderne op i CVR
// og se hvad de faktisk laver.
//
// SVARET ER ET FORSLAG, IKKE ET FACIT. To fejlkilder er systematiske og kan
// ikke fjernes i koden: vinderen af et udbud er ofte moderselskabet, så
// holdingbrancher (642120, 649990) optræder i stedet for driftsbranchen — og
// navnematch kan ramme et andet selskab med samme navn. Derfor returneres
// andele og dækningsgrad, så ordregiveren kan vurdere og rette. Anvend det
// aldrig automatisk.
export async function foreslaaBrancher(vindernavne) {
  const navne = [...new Set((vindernavne ?? []).map((n) => String(n).trim()).filter(Boolean))];
  if (!navne.length) {
    return { navneSlaaetOp: 0, virksomhederFundet: 0, medBranche: 0, brancher: [], daekning: 0 };
  }

  const svar = await kald({ handling: "brancheforslag", navne });

  // Dækningsgraden hører med i svaret, ikke i en note: et forslag bygget på 45
  // af 67 navne vejer anderledes end ét bygget på alle. Målt på rigtige data
  // ligger den typisk mellem 67 % og 93 % — resten er udenlandske vindere
  // uden dansk CVR-nummer.
  //
  // Brøken tæller NAVNE, ikke virksomheder. Ét TED-navn kan matche flere
  // selskaber med samme normaliserede navn ("A Rengøring" findes flere gange
  // i CVR), og en tidligere udgave dividerede virksomheder med navne — hvilket
  // gav "106 % dækning" på et rengøringsudbud.
  return {
    ...svar,
    daekning: svar.navneSlaaetOp ? svar.navneMedTraf / svar.navneSlaaetOp : 0
  };
}

// Markedets struktur: størrelse, branchesammensætning, geografi og
// selskabsformer. Fordelingen på selskabsform er det direkte grundlag for
// "opdel eller forklar" — er markedet overvejende enkeltmandsvirksomheder,
// er ét stort udbud svært at begrunde.
export function hentMarkedsstatistik(branchekoder, { kommunekoder = [] } = {}) {
  return kald({ handling: "statistik", branchekoder, kommunekoder });
}

// De konkrete virksomheder. Rangeringen er hovedbranche før bibranche og
// derefter vilkårlig-men-stabil — en meningsfuld rækkefølge kræver økonomi og
// track record, som først hentes i berigelsen. Derfor er "maks" et udsnit,
// ikke en top-liste, og det skal fremgå af UI'et.
export function soegMarked(branchekoder, { kommunekoder = [], maks = 200 } = {}) {
  return kald({ handling: "soeg", branchekoder, kommunekoder, maks })
    .then((svar) => svar.virksomheder ?? []);
}

// Hvor koncentreret er markedet? Bruges til at vurdere om der reelt er
// konkurrence. Regnes på antal virksomheder pr. branche, ikke på omsætning —
// vi har ikke omsætningstal for hele populationen, og et koncentrationstal
// bygget på de få vi har, ville være misvisende.
export function beregnKoncentration(statistik) {
  const ialt = statistik?.ialt ?? 0;
  if (!ialt) return null;

  const smaaSelskabsformer = new Set([
    "Enkeltmandsvirksomhed",
    "Personligt ejet Mindre Virksomhed"
  ]);

  const enkeltmand = (statistik.prSelskabsform ?? [])
    .filter((f) => smaaSelskabsformer.has(f.form))
    .reduce((n, f) => n + f.antal, 0);

  const topKommune = statistik.prKommune?.[0];

  return {
    ialt,
    andelEnkeltmand: enkeltmand / ialt,
    andelKunBibranche: (statistik.kunBibranche ?? 0) / ialt,
    topKommune: topKommune ? { navn: topKommune.navn, andel: topKommune.antal / ialt } : null
  };
}
