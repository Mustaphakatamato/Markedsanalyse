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

// De virksomheder der rent faktisk har vundet kontrakter i CPV-feltet hos
// danske ordregivere, rangeret efter antal kontrakter og antal forskellige
// ordregivere. Se supabase/functions/marked-vindere for optællingen.
//
// HVORFOR DEN FINDES VED SIDEN AF soegMarked(): en branchekode er
// virksomhedens egen registrering — en tildeling er et faktum. Til
// spørgsmålet "hvem kan løfte den her opgave" er track record det stærkeste
// signal, vi har adgang til.
//
// HVORFOR DEN IKKE ERSTATTER soegMarked(): TED kender kun udbud over EU's
// tærskelværdi. Den leverandør, der aldrig har vundet et EU-udbud, findes
// ikke her — og markedets sammensætning, som "opdel eller forklar" hviler
// på, kan ikke aflæses af en vinderliste. De to svarer på hver sit spørgsmål.
export async function hentVindere(cpvKoder, { top = 25 } = {}) {
  const koder = [...new Set((cpvKoder ?? []).map((k) => String(k).trim()).filter(Boolean))];
  if (!koder.length) return { kilde: null, vindere: [] };

  const svar = await postToFunction("/marked-vindere", { cpvKoder: koder, top });

  if (!svar.ok) {
    const fejl = await svar.json().catch(() => null);
    throw new Error(fejl?.error || `Vinderopslag fejlede (HTTP ${svar.status})`);
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

// Klasserne er ordnede fra størst til mindst, og afgrænsningen er "mindst
// denne": et filter på 'selskab' medtager også 'flere_adresser' og
// 'landsdaekkende'.
export const KLASSE_ETIKET = {
  landsdaekkende: "10+ adresser",
  flere_adresser: "Flere adresser",
  selskab: "Selskab, ét sted",
  mikro: "Enkeltmand m.v."
};

// De konkrete virksomheder — de STØRSTE først.
//
// Rangeringen sker i databasen på antal forretningssteder og selskabsform (se
// migration 20260814090000). Det er afgørende at afgrænsningen ligger dér og
// ikke her: i et rigtigt marked er 4 % af virksomhederne store nok til at
// byde på en samlet opgave, så et udsnit på 200 vilkårlige rækker rummer ca.
// otte af dem. Filtrerer man det udsnit i browseren, har man filtreret de
// forkerte 200.
//
// MÅLET ER UDSTRÆKNING, IKKE OMSÆTNING. CVR udstiller hverken ansatte eller
// omsætning i bulk. Et rådgivningshus med 300 ansatte på én adresse ligger
// derfor i samme klasse som et enmands-ApS. Rangeringen er en forsortering,
// der gør listen brugbar — de rigtige tal kommer fra regnskabsberigelsen, og
// UI'et skal sige det.
export function soegMarked(
  branchekoder,
  { kommunekoder = [], maks = 200, mindstKlasse = null, sortering = "stoerrelse" } = {}
) {
  return kald({
    handling: "soeg",
    branchekoder,
    kommunekoder,
    maks,
    // 'mikro' er bunden af skalaen og betyder det samme som intet filter.
    // Sendes den med, ville Edge Function'en afvise den som ukendt klasse.
    mindstKlasse: mindstKlasse && mindstKlasse !== "mikro" ? mindstKlasse : null,
    sortering
  }).then((svar) => svar.virksomheder ?? []);
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

  // Størrelsesfordelingen er det tal, spørgsmålet om delkontrakter reelt
  // hænger på: hvor mange i markedet er overhovedet en organisation frem for
  // en person? Nøglen kan mangle helt, hvis statistikken kommer fra en
  // database, der endnu ikke har kørt indlæsningen med P-enheder.
  const prStoerrelse = statistik.prStoerrelse ?? {};
  const antalPrKlasse = {
    mikro: prStoerrelse.mikro ?? 0,
    selskab: prStoerrelse.selskab ?? 0,
    flere_adresser: prStoerrelse.flere_adresser ?? 0,
    landsdaekkende: prStoerrelse.landsdaekkende ?? 0
  };
  const flereAdresser = antalPrKlasse.flere_adresser + antalPrKlasse.landsdaekkende;

  return {
    ialt,
    andelEnkeltmand: enkeltmand / ialt,
    andelKunBibranche: (statistik.kunBibranche ?? 0) / ialt,
    topKommune: topKommune ? { navn: topKommune.navn, andel: topKommune.antal / ialt } : null,
    antalPrKlasse,
    antalFlereAdresser: flereAdresser,
    andelFlereAdresser: flereAdresser / ialt,
    // "Ikke enkeltmandsvirksomhed" — den bredeste af de tre afgrænsninger
    // UI'et tilbyder, og den der svarer til "kan i det mindste have ansatte".
    antalOverMikro: ialt - antalPrKlasse.mikro,
    andelOverMikro: (ialt - antalPrKlasse.mikro) / ialt
  };
}
