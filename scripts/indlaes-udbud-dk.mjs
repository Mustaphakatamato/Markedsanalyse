// Indlæser udbud.dk's bekendtgørelser til Postgres, så de kan søges.
//
// HVORFOR: udbud.dk's eksterne API kan ikke søges. `fraKilde/{kilde}` tager
// præcis tre parametre — page, size og since — og har hverken CPV-,
// ordregiver- eller fritekstfilter. Hver bekendtgørelse leveres som
// base64-encoded eForms-XML. Det er et bulk-synk-endpoint til systemer, der
// bygger deres eget indeks, og det er dét vi gør her.
//
// HVORFOR DET ER UMAGEN VÆRD: 1.169 af bekendtgørelserne kommer fra kilden
// DKUDBUD — danske udbud UNDER EU's tærskelværdi, som slet ikke findes i TED.
// De 22.491 øvrige er TED-bekendtgørelser, og de er med, fordi en
// tilbudsgiver skal kunne søge ét sted.
//
// KØRSEL:  node scripts/indlaes-udbud-dk.mjs              (inkrementelt)
//          node scripts/indlaes-udbud-dk.mjs --fuld       (alt forfra)
//          node scripts/indlaes-udbud-dk.mjs --toerloeb   (læs og tæl, skriv intet)
//          node scripts/indlaes-udbud-dk.mjs --demo       (mod DEMO-miljøet)
//          node scripts/indlaes-udbud-dk.mjs --kilde DKUDBUD
//
// --kilde afgrænser til én kilde. DKUDBUD er de 1.169 danske bekendtgørelser
// under EU's tærskelværdi og fylder ~2 MB; ALLE er 23.660 og fylder ~25 MB.
// Forskellen er værd at kende, når pladsen er knap: TED-delen kan i forvejen
// søges gennem TED's eget API (se src/services/tedService.js), mens DKUDBUD
// ikke findes nogen andre steder. Standard er ALLE.
//
// Inkrementelt er standard: scriptet spørger databasen om det seneste
// registreringstidspunkt og henter kun det, der er kommet til siden. Første
// kørsel er nødt til at være --fuld (~1 GB XML fordelt på 237 sider).
//
// VIGTIGT om rækkefølgen: API'et returnerer IKKE bekendtgørelserne sorteret
// efter registreringstidspunkt (verificeret — side 1 gav 2025-07, 2025-12,
// 2025-02 i den rækkefølge). Derfor kan man ikke stoppe tidligt, når man ser
// en gammel post, og vandmærket trækkes bevidst en time tilbage: en
// bekendtgørelse registreret mens forrige kørsel læste, ville ellers kunne
// springes over. Upserten er idempotent, så overlappet er gratis.

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const KILDER = ["ALLE", "TED", "DKUDBUD"];

const SIDESTOERRELSE = 100;
const BATCH = 200;
// Tokenet lever 600 sekunder. Fornys i god tid før, så en langsom side ikke
// kan nå at gøre det ugyldigt midt i kørslen.
const TOKEN_LEVETID_MS = 8 * 60 * 1000;
// Overlap ved inkrementel hentning, se noten om rækkefølge ovenfor.
const VANDMAERKE_OVERLAP_MS = 60 * 60 * 1000;

export const MILJOEER = {
  prod: {
    token: "https://erst.virk.dk/auth/token",
    api: "https://api.udbud.dk/udbud",
    pw: "UDBUD_DK_PASSWORD_PROD"
  },
  demo: {
    token: "https://erstpreprod.virk.dk/auth/token",
    api: "https://api-demo.udbud.dk/udbud",
    pw: "UDBUD_DK_PASSWORD_DEMO"
  }
};

// ---------------------------------------------------------------- opsætning

async function laesEnv() {
  const tekst = await readFile(".env", "utf8");
  const env = {};
  for (const linje of tekst.split("\n")) {
    const t = linje.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    env[t.slice(0, i)] = t.slice(i + 1).trim();
  }
  return env;
}

function kræv(env, navn) {
  const v = env[navn];
  if (!v || v.startsWith("INDSAET") || v.startsWith("INDSÆT")) {
    throw new Error(`${navn} mangler i .env`);
  }
  return v;
}

// ------------------------------------------------------------- XML-parsning
//
// Node har ingen indbygget XML-parser, og eForms-dokumenterne skal læses ét
// felt ad gangen fra en dyb struktur. Samme situation som CSV-læseren i
// indlaes-cvr-indeks.mjs, og samme svar: en lille parser vi kan læse, frem
// for en afhængighed hele projektet skal slæbe rundt på.
//
// Den håndterer det eForms rent faktisk indeholder: navnerum med præfiks
// (der ignoreres — vi matcher på det LOKALE navn, samme disciplin som
// XBRL-parsingen i regnskabService.js), attributter, tomme elementer,
// kommentarer, CDATA og XML-deklarationen. Den validerer ikke, for
// dokumenterne kommer fra en maskine og er skemavaliderede i forvejen.

const ENTITETER = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function afkodEntiteter(s) {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (hel, krop) => {
    if (krop[0] === "#") {
      const kode = krop[1] === "x" || krop[1] === "X"
        ? parseInt(krop.slice(2), 16)
        : parseInt(krop.slice(1), 10);
      return Number.isFinite(kode) ? String.fromCodePoint(kode) : hel;
    }
    return ENTITETER[krop] ?? hel;
  });
}

function lokaltNavn(navn) {
  const i = navn.indexOf(":");
  return i === -1 ? navn : navn.slice(i + 1);
}

function parseAttributter(raa) {
  const attrs = {};
  for (const m of raa.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"|([\w:.-]+)\s*=\s*'([^']*)'/g)) {
    const navn = m[1] ?? m[3];
    const vaerdi = m[2] ?? m[4];
    attrs[lokaltNavn(navn)] = afkodEntiteter(vaerdi);
  }
  return attrs;
}

function parseXml(xml) {
  const rod = { navn: "#rod", attrs: {}, boern: [], tekst: "" };
  const stak = [rod];
  let i = 0;

  while (i < xml.length) {
    const start = xml.indexOf("<", i);
    if (start === -1) break;

    if (start > i) {
      const tekst = xml.slice(i, start);
      if (tekst.trim()) stak[stak.length - 1].tekst += afkodEntiteter(tekst);
    }

    // Kommentar, CDATA, deklaration og DOCTYPE: springes over som blokke,
    // fordi de kan indeholde "<" og ">" der ellers ville blive læst som tags.
    if (xml.startsWith("<!--", start)) {
      i = xml.indexOf("-->", start);
      i = i === -1 ? xml.length : i + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", start)) {
      const slut = xml.indexOf("]]>", start);
      const indhold = xml.slice(start + 9, slut === -1 ? xml.length : slut);
      stak[stak.length - 1].tekst += indhold;
      i = slut === -1 ? xml.length : slut + 3;
      continue;
    }
    if (xml.startsWith("<?", start) || xml.startsWith("<!", start)) {
      i = xml.indexOf(">", start);
      i = i === -1 ? xml.length : i + 1;
      continue;
    }

    const slut = xml.indexOf(">", start);
    if (slut === -1) break;
    const indre = xml.slice(start + 1, slut);

    if (indre.startsWith("/")) {
      if (stak.length > 1) stak.pop();
      i = slut + 1;
      continue;
    }

    const selvlukkende = indre.endsWith("/");
    const krop = selvlukkende ? indre.slice(0, -1) : indre;
    const mellemrum = krop.search(/\s/);
    const navn = lokaltNavn(mellemrum === -1 ? krop : krop.slice(0, mellemrum));
    const attrs = mellemrum === -1 ? {} : parseAttributter(krop.slice(mellemrum));

    const knude = { navn, attrs, boern: [], tekst: "" };
    stak[stak.length - 1].boern.push(knude);
    if (!selvlukkende) stak.push(knude);

    i = slut + 1;
  }

  return rod.boern[0] ?? rod;
}

// ------------------------------------------------------- opslag i XML-træet

// Null-tolerant: opslagene kædes sammen (find projektet, find navnet i det),
// og et manglende led undervejs er en normal tilstand — ikke alle
// bekendtgørelsestyper har alle sektioner. Kastede den her, ville en enkelt
// afvigende bekendtgørelse vælte hele indlæsningen.
function* alle(knude, navn) {
  if (!knude) return;
  for (const barn of knude.boern) {
    if (barn.navn === navn) yield barn;
    yield* alle(barn, navn);
  }
}

const foerste = (knude, navn) => alle(knude, navn).next().value ?? null;
const barn = (knude, navn) => knude?.boern.find((b) => b.navn === navn) ?? null;

function tekst(knude, navn) {
  const k = navn ? foerste(knude, navn) : knude;
  const t = k?.tekst?.trim();
  return t || null;
}

// Sti frem for fritsøgning, hvor navnet er tvetydigt: 'Name' findes både på
// projektet og på hver organisation, og et frit opslag ville ramme den
// forkerte.
function viaSti(knude, ...sti) {
  let k = knude;
  for (const navn of sti) {
    k = barn(k, navn);
    if (!k) return null;
  }
  return k;
}

// ------------------------------------------------- eForms -> vores rækkeform

const ART_PR_ROD = {
  ContractNotice: "udbud",
  PriorInformationNotice: "forhaandsmeddelelse",
  ContractAwardNotice: "tildeling"
};

// CompanyID er i praksis et rodet felt. Set i 50 rigtige bekendtgørelser:
// "29190909", "ORG-22139118", "ORG-34 05 11 78", "14 81 48 33", "ORG-null",
// "PUBL", "FI25620708" (finsk momsnummer) og "980921565" (norsk
// organisationsnummer). Kun et rigtigt dansk CVR-nummer må slippe igennem —
// feltet bruges til at slå virksomheden op i CVR, og et forkert nummer ville
// pege på en helt anden virksomhed.
//
// Derfor: valgfrit "ORG-"-præfiks fjernes, mellemrum og skilletegn fjernes, og
// resten skal være præcis otte cifre UDEN bogstaver undervejs. Sidste led er
// det, der skiller "14 81 48 33" (dansk CVR med mellemrum) fra "FI25620708",
// som ellers også ville reducere til otte cifre.
function rensCvr(raa) {
  if (!raa) return null;
  const udenPraefiks = raa.trim().replace(/^ORG-/i, "");
  if (!/^[\d\s.-]+$/.test(udenPraefiks)) return null;
  const cifre = udenPraefiks.replace(/[\s.-]/g, "");
  return /^\d{8}$/.test(cifre) ? cifre : null;
}

// Ordregiveren står ikke i ContractingParty — dér står kun en reference
// ("ORG-0001") ind i UBLExtensions/.../Organizations. Uden opslaget ville
// feltet blive et id i stedet for et navn.
function findOrdregiver(rod) {
  const refId = tekst(viaSti(rod, "ContractingParty", "Party", "PartyIdentification"), "ID");

  const organisationer = [...alle(rod, "Organization")]
    .map((org) => {
      const firma = barn(org, "Company");
      if (!firma) return null;
      return {
        id: tekst(viaSti(firma, "PartyIdentification"), "ID"),
        navn: tekst(viaSti(firma, "PartyName"), "Name"),
        cvr: rensCvr(tekst(viaSti(firma, "PartyLegalEntity"), "CompanyID"))
      };
    })
    .filter(Boolean);

  const traf =
    organisationer.find((o) => refId && o.id === refId) ?? organisationer[0] ?? null;

  return { navn: traf?.navn ?? null, cvr: traf?.cvr ?? null };
}

function tilTal(raa) {
  if (raa == null) return null;
  const n = Number(raa);
  return Number.isFinite(n) ? n : null;
}

// EndDate er "2025-08-25+02:00" og EndTime "23:59:00+02:00" — hver med sin
// egen tidszoneangivelse. Sat sammen til ét gyldigt tidsstempel; uden
// klokkeslæt bruges døgnets slutning, da en frist ellers ville se udløbet ud
// hele den dag, den faktisk gælder.
function samlFrist(periode) {
  const dato = tekst(periode, "EndDate");
  if (!dato) return null;
  const m = dato.match(/^(\d{4}-\d{2}-\d{2})(.*)$/);
  if (!m) return null;
  const [, dag, zone] = m;

  const klokken = tekst(periode, "EndTime");
  if (klokken) {
    const km = klokken.match(/^(\d{2}:\d{2}:\d{2})(.*)$/);
    if (km) return `${dag}T${km[1]}${km[2] || zone || "Z"}`;
  }
  return `${dag}T23:59:59${zone || "Z"}`;
}

function udtraek(container, xml) {
  const rod = parseXml(xml);

  const cpvHoved = tekst(
    foerste(rod, "MainCommodityClassification"),
    "ItemClassificationCode"
  );

  const cpvAlle = new Set();
  for (const navn of ["MainCommodityClassification", "AdditionalCommodityClassification"]) {
    for (const k of alle(rod, navn)) {
      const kode = tekst(k, "ItemClassificationCode");
      if (kode) cpvAlle.add(kode.split("-")[0].trim());
    }
  }

  // Flere delkontrakter kan have hver sin frist. Den SENESTE bruges: så længe
  // ét delkontrakt stadig kan bydes på, er bekendtgørelsen åben, og at vise
  // den som lukket ville skjule en reel mulighed.
  let frist = null;
  for (const p of alle(rod, "TenderSubmissionDeadlinePeriod")) {
    const f = samlFrist(p);
    if (f && (!frist || f > frist)) frist = f;
  }

  // Værdien tages fra projektets rod, hvor den findes: dét er den samlede
  // anslåede værdi. Findes den kun pr. delkontrakt, lægges de sammen — men
  // aldrig begge dele, som ville tælle dobbelt.
  const rodProjekt = barn(rod, "ProcurementProject");
  const rodBeloeb = rodProjekt
    ? viaSti(rodProjekt, "RequestedTenderTotal", "EstimatedOverallContractAmount")
    : null;

  let vaerdi = null;
  let valuta = null;
  if (rodBeloeb) {
    vaerdi = tilTal(rodBeloeb.tekst.trim());
    valuta = rodBeloeb.attrs.currencyID ?? null;
  } else {
    for (const lot of alle(rod, "ProcurementProjectLot")) {
      const b = viaSti(barn(lot, "ProcurementProject"), "RequestedTenderTotal", "EstimatedOverallContractAmount");
      if (!b) continue;
      const n = tilTal(b.tekst.trim());
      if (n == null) continue;
      vaerdi = (vaerdi ?? 0) + n;
      valuta = valuta ?? b.attrs.currencyID ?? null;
    }
  }

  const projekt = rodProjekt ?? barn(foerste(rod, "ProcurementProjectLot"), "ProcurementProject");
  const ordregiver = findOrdregiver(rod);

  return {
    notice_id: container.noticeId,
    notice_version: container.noticeVersion || "01",
    publikationsnummer: container.noticePublicationNumber || null,
    kilde: container.noticePublicationNumber ? "TED" : "DKUDBUD",
    registreringstidspunkt: container.registreringsTidspunkt,
    subtype: tekst(foerste(rod, "NoticeSubType"), "SubTypeCode"),
    art: ART_PR_ROD[rod.navn] ?? "andet",
    titel: tekst(projekt, "Name"),
    beskrivelse: tekst(projekt, "Description"),
    kontrakttype: tekst(projekt, "ProcurementTypeCode"),
    ordregiver: ordregiver.navn,
    ordregiver_cvr: ordregiver.cvr,
    cpv_hoved: cpvHoved,
    cpv_koder: [...cpvAlle],
    frist,
    anslaaet_vaerdi: vaerdi,
    valuta,
    nuts: tekst(foerste(rod, "RealizedLocation"), "CountrySubentityCode"),
    dokument_url: tekst(foerste(rod, "ExternalReference"), "URI")
  };
}

// ----------------------------------------------------------------- udbud.dk

// Tokenet caches på tværs af sider. Miljøet gemmes med, så et skift fra DEMO
// til PROD i samme proces ikke genbruger et token, der hører til det andet.
let token = null;
let tokenHentet = 0;
let tokenMiljoe = null;

async function hentToken(env, miljoe) {
  if (token && tokenMiljoe === miljoe.token && Date.now() - tokenHentet < TOKEN_LEVETID_MS) {
    return token;
  }

  const basic = Buffer.from(
    `${kræv(env, "UDBUD_DK_BRUGER")}:${kræv(env, miljoe.pw)}`
  ).toString("base64");

  const svar = await fetch(miljoe.token, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      // grant_type SKAL være en form-parameter. OpenAPI-specen viser den som
      // query-parameter, hvilket giver "Parameteren 'grant_type' mangler".
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  if (!svar.ok) {
    // Kroppen kan indeholde brugernavnet; kun status videregives.
    throw new Error(`Kunne ikke hente token fra udbud.dk: HTTP ${svar.status}`);
  }

  token = (await svar.json()).access_token;
  tokenHentet = Date.now();
  tokenMiljoe = miljoe.token;
  return token;
}

const HENT_FORSØG = 4;

async function hentSide(env, { miljoe, kilde, side, siden }) {
  const url = new URL(`${miljoe.api}/ekstern-data/bekendtgoerelse/v1/fraKilde/${kilde}`);
  url.searchParams.set("page", String(side));
  url.searchParams.set("size", String(SIDESTOERRELSE));
  if (siden) url.searchParams.set("since", siden);

  for (let forsøg = 1; ; forsøg++) {
    try {
      const t = await hentToken(env, miljoe);
      const svar = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });

      // 416 = siden findes ikke; det er sådan API'et siger "ikke mere".
      if (svar.status === 416) return null;
      if (svar.status === 401) {
        // Tokenet nåede at udløbe. Tving et nyt og prøv igen.
        token = null;
        throw new Error("token udløbet");
      }
      if (!svar.ok) throw new Error(`HTTP ${svar.status}`);
      return await svar.json();
    } catch (e) {
      if (forsøg >= HENT_FORSØG) throw new Error(`Side ${side} fejlede: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * forsøg));
    }
  }
}

// ----------------------------------------------------------------- database

async function restKald(env, sti, init = {}) {
  const nøgle = kræv(env, "SUPABASE_SERVICE_ROLE_KEY");
  return fetch(`${kræv(env, "VITE_SUPABASE_URL")}/rest/v1/${sti}`, {
    ...init,
    headers: {
      apikey: nøgle,
      Authorization: `Bearer ${nøgle}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

const SKRIV_FORSØG = 5;

// udbud.dk leverer den SAMME bekendtgørelse mere end én gang. Fundet ved en
// fuld indlæsning 19. august 2026: efter 18.300 læste bekendtgørelser indeholdt
// ét batch to rækker med samme (noticeId, noticeVersion), og PostgREST svarede
// HTTP 500, SQLSTATE 21000 — "ON CONFLICT DO UPDATE command cannot affect row a
// second time". Postgres nægter at upserte samme primærnøgle to gange i ÉN
// kommando; at gøre det i to kommandoer er derimod fint.
//
// Derfor foldes dubletter sammen pr. batch frem for at forsøge at rette det
// længere oppe: kilden bestemmer selv, hvad den sender, rækkefølgen er
// vilkårlig (API'et sorterer ikke), og et batch er præcis den enhed, der
// bliver én kommando. Straddler en dublet to batches, går den igennem af sig
// selv, fordi det så er to kommandoer.
//
// Den SIDSTE forekomst vinder. To rækker med samme nøgle er den samme
// bekendtgørelse i samme version og bør være identiske; er de mod forventning
// ikke, er den seneste i svaret det tætteste vi kommer på kildens egen
// opfattelse. Upserten ville i forvejen have ladet den sidste stå.
export function fjernDubletter(raekker) {
  const efterNoegle = new Map();
  // \u0000 som skilletegn: hverken notice_id (en UUID) eller notice_version
  // kan indeholde det, så to forskellige nøgler kan ikke støde sammen.
  for (const r of raekker) efterNoegle.set(`${r.notice_id}\u0000${r.notice_version}`, r);
  return [...efterNoegle.values()];
}

async function skrivBatch(env, batch, { toerloeb, log }) {
  // Returnerer hvor mange der faktisk blev skrevet — 0 i tørløb. Cron-kørslen
  // rapporterer tallet videre, og "skrev 100" om et tørløb ville være løgn.
  const raekker = fjernDubletter(batch);
  const dubletter = batch.length - raekker.length;
  if (dubletter) {
    log(`${dubletter} dublet${dubletter === 1 ? "" : "ter"} i batchen foldet sammen`);
  }
  if (toerloeb || !raekker.length) return { skrevet: 0, dubletter };

  for (let forsøg = 1; ; forsøg++) {
    let svar, netværksfejl;
    try {
      svar = await restKald(env, "udbud_bekendtgoerelse", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(raekker)
      });
    } catch (e) {
      netværksfejl = e;
    }

    if (svar?.ok) return { skrevet: raekker.length, dubletter };

    const detalje = netværksfejl
      ? netværksfejl.message
      : `HTTP ${svar.status} — ${(await svar.text()).slice(0, 250)}`;

    if (forsøg >= SKRIV_FORSØG) {
      throw new Error(`Skrivning fejlede efter ${SKRIV_FORSØG} forsøg: ${detalje}`);
    }
    log(`skriveforsøg ${forsøg}/${SKRIV_FORSØG}: ${detalje.slice(0, 90)}`);
    await new Promise((r) => setTimeout(r, 2000 * forsøg));
  }
}

export async function senesteRegistrering(env, kilde) {
  // Afgrænset til den kilde vi henter: kører man --kilde DKUDBUD efter en
  // fuld ALLE-kørsel, ville et fælles vandmærke pege på den nyeste
  // TED-bekendtgørelse og springe alle ældre danske over.
  const filter = kilde === "ALLE" ? "" : `&kilde=eq.${kilde}`;
  const svar = await restKald(
    env,
    `udbud_bekendtgoerelse?select=registreringstidspunkt${filter}` +
      "&order=registreringstidspunkt.desc&limit=1"
  );
  if (!svar.ok) return null;
  const raekker = await svar.json();
  return raekker[0]?.registreringstidspunkt ?? null;
}

// ------------------------------------------------------------------- synken
//
// Delt mellem CLI'et nedenfor og den daglige cron-kørsel i api/synk-udbud.js.
// Begge skal hente PRÆCIS det samme og skrive det på PRÆCIS samme måde — lå
// løkken to steder, ville vandmærkelogikken kunne komme til at gøre to
// forskellige ting, og gaps i indekset er ikke til at se udefra.
//
// maksSider er en sikkerhedsventil for kørslen i en serverless-funktion, hvor
// der er et loft på svartiden. VIGTIGT: rammes den, kan der opstå huller i
// indekset — API'et leverer IKKE bekendtgørelserne sorteret efter
// registreringstidspunkt, så de sider vi ikke nåede kan indeholde noget
// ældre, mens vandmærket (max i tabellen) allerede er rykket frem. Derfor
// meldes det tilbage som en advarsel frem for at blive slugt, og
// dagsforbruget (~50 bekendtgørelser = 1 side) ligger så langt under loftet,
// at det kun kan ske efter et længere udfald. Sker det, er svaret en
// --fuld-kørsel, ikke en ny cron.
export async function synkroniser({
  env,
  kilde = "ALLE",
  fuld = false,
  toerloeb = false,
  miljoe = MILJOEER.prod,
  maksSider = Infinity,
  log = () => {},
  fremdrift = () => {}
} = {}) {
  let siden = null;
  if (!fuld) {
    const seneste = await senesteRegistrering(env, kilde);
    if (seneste) {
      // Formatet er ISO uden tidszone — API'et fortolker alt som
      // Europe/Copenhagen, og en medsendt zone afvises.
      siden = new Date(new Date(seneste).getTime() - VANDMAERKE_OVERLAP_MS)
        .toISOString()
        .slice(0, 19);
      log(`Inkrementelt (${kilde}): henter alt registreret efter ${siden}`);
    } else {
      log("Tabellen er tom — henter alt (svarer til --fuld).");
    }
  } else {
    log(`Fuld hentning fra kilde ${kilde}.`);
  }

  const stat = {
    kilde,
    siden,
    fuld: fuld || !siden,
    totalt: null,
    sider: 0,
    laest: 0,
    skrevet: 0,
    sprunget: 0,
    dubletter: 0,
    prKilde: { TED: 0, DKUDBUD: 0 },
    prArt: {},
    udenCpv: 0,
    udenTitel: 0,
    naaedeLoft: false
  };

  let side = 1;
  const batch = [];

  for (;;) {
    if (stat.sider >= maksSider) {
      stat.naaedeLoft = true;
      log(`Stoppede ved sideloftet (${maksSider} sider) — se noten om huller i indekset.`);
      break;
    }

    const data = await hentSide(env, { miljoe, kilde, side, siden });
    if (!data?.bekendtgoerelser?.length) break;
    stat.sider++;

    if (stat.totalt === null) {
      stat.totalt = data.totalt;
      log(`${(data.totalt ?? 0).toLocaleString("da-DK")} bekendtgørelser at hente.`);
    }

    for (const container of data.bekendtgoerelser) {
      stat.laest++;
      let raekke;
      try {
        const xml = Buffer.from(container.bekendtgoerelseXml, "base64").toString("utf8");
        raekke = udtraek(container, xml);
      } catch (e) {
        // Én ulæselig bekendtgørelse må ikke vælte en kørsel på 23.660.
        stat.sprunget++;
        log(`springer ${container.noticeId} over: ${e.message}`);
        continue;
      }

      stat.prKilde[raekke.kilde] = (stat.prKilde[raekke.kilde] ?? 0) + 1;
      stat.prArt[raekke.art] = (stat.prArt[raekke.art] ?? 0) + 1;
      if (!raekke.cpv_koder.length) stat.udenCpv++;
      if (!raekke.titel) stat.udenTitel++;

      batch.push(raekke);
      if (batch.length >= BATCH) {
        const r = await skrivBatch(env, batch.splice(0), { toerloeb, log });
        stat.skrevet += r.skrevet;
        stat.dubletter += r.dubletter;
      }
    }

    fremdrift(`side ${side} · ${stat.laest.toLocaleString("da-DK")} læst`);
    if (data.bekendtgoerelser.length < SIDESTOERRELSE) break;
    side++;
  }

  if (batch.length) {
    const r = await skrivBatch(env, batch, { toerloeb, log });
    stat.skrevet += r.skrevet;
    stat.dubletter += r.dubletter;
  }

  return stat;
}

// --------------------------------------------------------------------- kør

async function main() {
  const fuld = process.argv.includes("--fuld");
  const toerloeb = process.argv.includes("--toerloeb");
  const demo = process.argv.includes("--demo");

  const kildeArg = process.argv[process.argv.indexOf("--kilde") + 1];
  const kilde =
    process.argv.includes("--kilde") && KILDER.includes(kildeArg) ? kildeArg : "ALLE";

  const env = await laesEnv();
  const stat = await synkroniser({
    env,
    kilde,
    fuld,
    toerloeb,
    miljoe: demo ? MILJOEER.demo : MILJOEER.prod,
    log: (besked) => console.log(besked),
    fremdrift: (besked) => process.stdout.write(`\r${besked}`)
  });

  const antal = toerloeb ? stat.laest - stat.sprunget : stat.skrevet;
  console.log(`\n\n${toerloeb ? "Ville skrive" : "Skrev"} ${antal.toLocaleString("da-DK")} bekendtgørelser.`);
  console.log(`  pr. kilde:  ${Object.entries(stat.prKilde).map(([k, n]) => `${k} ${n.toLocaleString("da-DK")}`).join(" · ")}`);
  console.log(`  pr. art:    ${Object.entries(stat.prArt).map(([k, n]) => `${k} ${n.toLocaleString("da-DK")}`).join(" · ")}`);

  // Dækningsgraderne er tørløbets egentlige resultat: falder de, har kilden
  // ændret et elementnavn, og en rigtig kørsel ville skrive tomme felter.
  const pct = (n) => `${(((stat.laest - n) / Math.max(stat.laest, 1)) * 100).toFixed(1)} %`;
  if (stat.dubletter) console.log(`  dubletter:  ${stat.dubletter.toLocaleString("da-DK")} foldet sammen`);
  console.log(`  med CPV:    ${pct(stat.udenCpv)}`);
  console.log(`  med titel:  ${pct(stat.udenTitel)}`);

  if (toerloeb) console.log("\nIntet blev skrevet. Kør uden --toerloeb for at indlæse.");
}

// Parseren afprøves mod rigtige bekendtgørelser i scripts/test-udbud-parser.mjs.
// En hjemmelavet XML-parser skal kunne testes uden at kalde udbud.dk, og
// main() må derfor kun køre når filen er startet direkte.
export { parseXml, udtraek, samlFrist, findOrdregiver, afkodEntiteter, rensCvr };

// process.argv[1] mangler, når modulet indlæses gennem `node -e` eller en
// REPL. Uden vagten kaster pathToFileURL(undefined), og en import til
// afprøvning ville vælte på noget, der intet har med parseren at gøre.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("\nFEJL:", err.message);
    process.exit(1);
  });
}
