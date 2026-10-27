// Sandsynlige tilbudsgivere — én liste ud af to kilder.
//
// HVORFOR ÉN LISTE: markedsanalysen havde to faner, "Hele markedet" (CVR) og
// "Har vundet før" (TED), og ordregiveren skulle selv lægge dem sammen i
// hovedet. Spørgsmålet er ét — hvem vil sandsynligvis byde — så svaret skal
// også være det. Kilderne beholder hver sin rolle: CVR viser hvem der FINDES
// i markedet, TED hvem der har VUNDET i det.
//
// INGEN SORT-BOKS-SCORE. Hver leverandør får mærker, der hver for sig kan
// efterprøves ("vundet 4 kontrakter i feltet", "ligger i Aarhus"). Et samlet
// tal på 0-100 ville se præcist ud uden at være det, og en ordregiver skal
// kunne forklare, hvorfor netop disse blev inviteret til dialog.

import { findLatestRegnskab } from "./regnskabService";
import { hentVirksomhed } from "./cvrService";

// EU's SMV-definition (henstilling 2003/361/EF): under 250 ansatte OG enten
// en omsætning på højst 50 mio. EUR eller en balance på højst 43 mio. EUR.
// Omregnet med kurs 7,46 og rundet ned, så en grænsesag ikke kaldes SMV.
export const SMV_GRAENSE = {
  ansatte: 250,
  omsaetningDkk: 373_000_000,
  balanceDkk: 320_000_000
};

// Klasserne fra markedsindekset, størst først. Bruges til forsortering.
const KLASSE_RANG = { landsdaekkende: 3, flere_adresser: 2, selskab: 1, mikro: 0 };

// CVR angiver ansatte som et interval ("10-19"). Ét tal behandles som et
// interval af bredde nul.
export function tolkAnsatte(raa) {
  if (raa == null) return null;
  const tal = String(raa).match(/\d+/g)?.map(Number) ?? [];
  if (!tal.length) return null;
  return { fra: tal[0], til: tal[1] ?? tal[0] };
}

// Nøgletal for én virksomhed, i den form markedsdialogen gemmer dem.
//
// Returnerer aldrig et kast: kaldes i en løkke over mange virksomheder, og én
// der ikke kan slås op, må ikke vælte de øvrige. Manglende tal er en normal
// tilstand — ESEF/IFRS-regnskaber kan ikke parses, og nystartede har intet.
export async function hentNoegletal(cvr) {
  const [regnskab, stamdata] = await Promise.all([
    findLatestRegnskab(cvr).catch((err) => ({ status: "error", message: err.message })),
    hentVirksomhed(cvr).catch(() => ({ status: "error" }))
  ]);

  const ok = regnskab?.status === "ok";
  // Kun nettoomsætning er omsætning. Mange små selskaber indberetter kun
  // bruttofortjenesten, som altid er MINDRE end omsætningen — den er derfor en
  // sikker nedre grænse, men aldrig et svar på hvad omsætningen er.
  const erOmsaetning = ok && regnskab.toplineLabel === "Nettoomsætning";
  const erBrutto = ok && regnskab.toplineLabel === "Bruttofortjeneste";

  return {
    status: ok ? "ok" : regnskab?.status === "facts_unavailable" ? "ingen_tal" : regnskab?.status === "not_found" ? "intet_regnskab" : "fejl",
    aar: ok ? String(regnskab.fiscalYearEnd ?? "").slice(0, 4) || null : null,
    omsaetning: erOmsaetning ? regnskab.topline : null,
    omsaetningNedre: erBrutto ? regnskab.topline : null,
    resultat: ok ? regnskab.result ?? null : null,
    egenkapital: ok ? regnskab.equity ?? null : null,
    balance: ok ? regnskab.assets ?? null : null,
    soliditet: ok ? regnskab.solvencyPct ?? null : null,
    ansatte: stamdata?.status === "ok" ? stamdata.company?.employeesRange ?? null : null,
    kilde: regnskab?.sourceUrl ?? null,
    hentet: new Date().toISOString()
  };
}

// Henter for mange CVR-numre med et loft over samtidige kald.
// Erhvervsstyrelsens regnskabsserver er langsom og svarer dårligt på et
// stormløb; fire ad gangen holder tempoet uden at fremprovokere timeouts.
// onEnkelt kaldes, så snart hver enkelt er klar — listen fyldes op løbende.
export async function hentNoegletalForMange(cvrNumre, onEnkelt, { samtidige = 4 } = {}) {
  const koe = [...new Set(cvrNumre.filter(Boolean))];
  const arbejdere = Array.from({ length: Math.min(samtidige, koe.length) }, async () => {
    while (koe.length) {
      const cvr = koe.shift();
      const tal = await hentNoegletal(cvr);
      onEnkelt(cvr, tal);
    }
  });
  await Promise.all(arbejdere);
}

// SMV eller ej. Tre svar, aldrig et gæt forklædt som et faktum:
//   smv / ikke_smv   — afgjort ud fra hentede tal
//   smv_estimat      — ingen tal, men markedsindekset tyder på en mindre
//                      virksomhed (færre end 10 adresser)
//   ukendt           — hverken tal eller indeks at gå efter
export function smvStatus(leverandoer, noegletal) {
  const ansatte = tolkAnsatte(noegletal?.ansatte);
  if (ansatte && ansatte.fra >= SMV_GRAENSE.ansatte) return "ikke_smv";

  const omsaetning = noegletal?.omsaetning;
  const balance = noegletal?.balance;
  const storOmsaetning = omsaetning != null && omsaetning > SMV_GRAENSE.omsaetningDkk;
  const storBalance = balance != null && balance > SMV_GRAENSE.balanceDkk;
  // Begge finansielle lofter skal være overskredet — det er et ELLER-krav i
  // definitionen, så én lille af de to rækker.
  if (storOmsaetning && storBalance) return "ikke_smv";
  if (storOmsaetning && balance == null) return "ikke_smv";

  if (ansatte && ansatte.til < SMV_GRAENSE.ansatte && (omsaetning != null || balance != null)) {
    return "smv";
  }

  const klasse = leverandoer.stoerrelsesklasse;
  if (klasse && klasse !== "landsdaekkende") return "smv_estimat";
  return "ukendt";
}

export const SMV_ETIKET = {
  smv: "SMV",
  ikke_smv: "Stor virksomhed",
  smv_estimat: "SMV (estimat)",
  ukendt: "Ukendt"
};

function normaliser(tekst) {
  return String(tekst ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Lokal = virksomhedens kommune er nævnt i behovets leveringssted. Bevidst
// enkelt: leveringsstedet er fritekst, og et "ligger i nabokommunen" ville
// kræve geografi, appen ikke har. Hellere et smalt mærke, der er rigtigt.
function erLokal(kommunenavn, geografi) {
  const kommune = normaliser(kommunenavn).replace(/ kommune$/, "");
  const sted = normaliser(geografi);
  return kommune.length >= 3 && sted.includes(kommune);
}

// Slår CVR-kandidater og TED-vindere sammen til én liste med mærker.
//
// Rækkefølgen bygger KUN på de mærker, der kendes uden regnskab (vundet,
// branche, lokal, nuværende), og dernæst på antal sejre og størrelse. Ellers
// ville listen hoppe rundt, efterhånden som regnskaberne kommer ind, og de
// første 25 — dem, der hentes regnskab for — ville afhænge af hvilke regnskaber
// der tilfældigvis var hentet. Størrelsesmærket vises, men sorterer ikke.
export function samlLeverandoerer({ kandidater = [], vindere = [], dialog }) {
  const valgteBrancher = new Set((dialog.branchekoder ?? []).map((b) => b.kode));
  const nuvaerendeCvr = dialog.behov?.nuvaerende?.cvr ?? null;
  const geografi = dialog.behov?.geografi ?? "";

  const perNoegle = new Map();

  for (const k of kandidater) {
    perNoegle.set(k.cvr, {
      noegle: k.cvr,
      cvr: k.cvr,
      navn: k.navn,
      branchekode: k.branchekode,
      branchetekst: k.branchetekst,
      kommunenavn: k.kommunenavn,
      postnummer: k.postnummer,
      postdistrikt: k.postdistrikt,
      virksomhedsform: k.virksomhedsform,
      stoerrelsesklasse: k.stoerrelsesklasse,
      antalPenheder: k.antalPenheder,
      iMarkedet: true,
      hovedbranche: !!k.trafHovedbranche,
      sejre: null
    });
  }

  for (const v of vindere) {
    // Uden entydigt CVR-match (udenlandsk vinder eller flere selskaber med
    // samme navn) står vinderen på navnet — den kan ikke shortlistes eller
    // få nøgletal, men den hører med i billedet af hvem der vinder.
    const noegle = v.cvr ?? `navn:${normaliser(v.navn)}`;
    const sejre = {
      antal: v.antalKontrakter,
      rammeaftaler: v.antalRammeaftaler,
      ordregivere: v.antalOrdregivere,
      sumDkk: v.sumEnkeltkontrakterDkk,
      seneste: v.senesteDato,
      tildelinger: v.tildelinger ?? []
    };
    const findes = perNoegle.get(noegle);
    if (findes) {
      findes.sejre = sejre;
      continue;
    }
    perNoegle.set(noegle, {
      noegle,
      cvr: v.cvr,
      navn: v.cvrNavn || v.navn,
      tedNavn: v.navn,
      ukendtCvr: !v.cvr,
      trafAntal: v.trafAntal,
      branchekode: v.branchekode,
      branchetekst: v.branchetekst,
      kommunenavn: v.kommunenavn,
      postnummer: v.postnummer,
      postdistrikt: v.postdistrikt,
      virksomhedsform: v.virksomhedsform,
      stoerrelsesklasse: v.stoerrelsesklasse,
      antalPenheder: v.antalPenheder,
      iMarkedet: false,
      hovedbranche: false,
      sejre
    });
  }

  const liste = [...perNoegle.values()].map((l) => {
    const maerker = [];
    if (l.cvr && l.cvr === nuvaerendeCvr) maerker.push("nuvaerende");
    if (l.sejre?.antal) maerker.push("vundet");
    if (l.iMarkedet || valgteBrancher.has(l.branchekode)) maerker.push("branche");
    if (geografi && erLokal(l.kommunenavn, geografi)) maerker.push("lokal");
    return { ...l, maerker };
  });

  return liste.sort(
    (a, b) =>
      b.maerker.length - a.maerker.length ||
      (b.sejre?.antal ?? 0) - (a.sejre?.antal ?? 0) ||
      (KLASSE_RANG[b.stoerrelsesklasse] ?? -1) - (KLASSE_RANG[a.stoerrelsesklasse] ?? -1) ||
      (b.antalPenheder ?? 0) - (a.antalPenheder ?? 0)
  );
}

// Størrelse passer, når omsætningen — eller bruttofortjenesten, som er en
// nedre grænse for den — mindst svarer til ét års kontraktværdi. Det er et
// signal om kapacitet, ikke et egnethedskrav; kravet sættes i trin 4.
export function stoerrelsePasser(noegletal, aarligVaerdi) {
  if (!aarligVaerdi || !noegletal) return false;
  const kendt = noegletal.omsaetning ?? noegletal.omsaetningNedre;
  return kendt != null && kendt >= aarligVaerdi;
}

export const MAERKE_ETIKET = {
  nuvaerende: "Nuværende leverandør",
  vundet: "Vundet i feltet",
  branche: "Rette branche",
  lokal: "Lokal",
  stoerrelse: "Størrelse passer"
};

// Antal leverandører, der vurderes som "sandsynlige tilbudsgivere": dem der
// automatisk hentes nøgletal for, og som kravsimulatoren regner på.
export const ANTAL_SANDSYNLIGE = 25;
