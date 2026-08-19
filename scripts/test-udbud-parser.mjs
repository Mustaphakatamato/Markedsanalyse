// Afprøver den hjemmelavede XML-parser i indlaes-udbud-dk.mjs.
//
// HVORFOR: parseren er skrevet i hånden frem for at trække en afhængighed ind
// (samme begrundelse som CSV-læseren i indlaes-cvr-indeks.mjs), og en
// hjemmelavet parser skal kunne efterprøves. Fejler den stille på ét felt,
// bliver hele søgesiden ubrugelig på en måde, der ligner "der er bare ikke
// noget der matcher".
//
// To slags tjek:
//   1. syntetiske dokumenter for de kanttilfælde, der er nemme at tage fejl af
//   2. rigtige bekendtgørelser fra udbud.dk, hvis de ligger i .udbud-proever/
//      (hentes med --hent, kræver adgang i .env)
//
// KØRSEL:  node scripts/test-udbud-parser.mjs
//          node scripts/test-udbud-parser.mjs --hent   (hent friske prøver først)

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseXml,
  udtraek,
  samlFrist,
  afkodEntiteter,
  rensCvr,
  fjernDubletter
} from "./indlaes-udbud-dk.mjs";

const PRØVEMAPPE = ".udbud-proever";
const HENT = process.argv.includes("--hent");

let fejl = 0;
const tjek = (navn, ok, detalje = "") => {
  console.log(`  ${ok ? "OK  " : "FEJL"}  ${navn}${detalje ? ` — ${detalje}` : ""}`);
  if (!ok) fejl++;
};

// ------------------------------------------------------------- syntetiske

console.log("\n=== XML-parseren ===");

const doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<!-- en kommentar med <tags> og > i -->
<cn:ContractNotice xmlns:cn="urn:x" xmlns:cbc="urn:y">
  <cbc:IssueDate>2025-07-07+02:00</cbc:IssueDate>
  <cbc:Tom/>
  <cbc:MedAttr currencyID="DKK" listName="cpv">22000000</cbc:MedAttr>
  <cbc:Entiteter>A &amp; B &lt;C&gt; &#65; &#x42;</cbc:Entiteter>
  <cbc:Cdata><![CDATA[rå <tekst> & tegn]]></cbc:Cdata>
  <cac:Gentaget xmlns:cac="urn:z">
    <cbc:Kode>en</cbc:Kode>
  </cac:Gentaget>
  <cac:Gentaget xmlns:cac="urn:z">
    <cbc:Kode>to</cbc:Kode>
  </cac:Gentaget>
</cn:ContractNotice>`);

tjek("rodelementets lokale navn", doc.navn === "ContractNotice", doc.navn);

const find = (k, n) => {
  const stak = [...k.boern];
  while (stak.length) {
    const x = stak.shift();
    if (x.navn === n) return x;
    stak.push(...x.boern);
  }
  return null;
};

tjek("navnerumspræfiks fjernes fra elementnavne", !!find(doc, "IssueDate"));
tjek("tekstindhold læses", find(doc, "IssueDate")?.tekst.trim() === "2025-07-07+02:00");
tjek("selvlukkende element bliver til en tom knude",
  find(doc, "Tom") !== null && find(doc, "Tom").boern.length === 0);
tjek("attributter læses og præfiks fjernes",
  find(doc, "MedAttr")?.attrs.currencyID === "DKK" && find(doc, "MedAttr")?.attrs.listName === "cpv");
tjek("kommentar med < og > springes over uden at forstyrre træet",
  doc.boern.length === 7, `${doc.boern.length} børn`);
tjek("entiteter afkodes (navngivne, decimale og hex)",
  find(doc, "Entiteter")?.tekst.trim() === "A & B <C> A B",
  JSON.stringify(find(doc, "Entiteter")?.tekst.trim()));
tjek("CDATA læses råt uden at blive tolket som tags",
  find(doc, "Cdata")?.tekst === "rå <tekst> & tegn",
  JSON.stringify(find(doc, "Cdata")?.tekst));
tjek("gentagne elementer bevares som separate knuder",
  doc.boern.filter((b) => b.navn === "Gentaget").length === 2);

tjek("afkodEntiteter lader ukendte entiteter stå",
  afkodEntiteter("&ukendt; &amp;") === "&ukendt; &");

console.log("\n=== frister ===");

const frist = (xml) => samlFrist(parseXml(xml));
tjek("dato + klokkeslæt sættes sammen med klokkeslættets zone",
  frist("<P><EndDate>2025-08-25+02:00</EndDate><EndTime>23:59:00+02:00</EndTime></P>") ===
    "2025-08-25T23:59:00+02:00");
// Uden klokkeslæt ville en frist se udløbet ud kl. 00:00 på selve dagen.
tjek("dato uden klokkeslæt bliver til døgnets slutning",
  frist("<P><EndDate>2025-08-25+02:00</EndDate></P>") === "2025-08-25T23:59:59+02:00");
tjek("dato uden zone får Z",
  frist("<P><EndDate>2025-08-25</EndDate></P>") === "2025-08-25T23:59:59Z");
tjek("ingen slutdato giver ingen frist", frist("<P><EndTime>10:00:00</EndTime></P>") === null);

const somDato = new Date(frist("<P><EndDate>2025-08-25+02:00</EndDate><EndTime>23:59:00+02:00</EndTime></P>"));
tjek("den samlede frist er et gyldigt tidsstempel", !Number.isNaN(somDato.getTime()),
  somDato.toISOString?.());

console.log("\n=== CVR-numre fra CompanyID ===");

// Alle værdier nedenfor er set i rigtige bekendtgørelser. Feltet bruges til
// at slå ordregiveren op i CVR, så et forkert nummer peger på en anden
// virksomhed — derfor er reglen streng frem for hjælpsom.
for (const [raa, forventet] of [
  ["29190909", "29190909"],
  ["ORG-22139118", "22139118"],
  ["ORG-34 05 11 78", "34051178"],
  ["14 81 48 33", "14814833"],
  ["ORG-null", null],
  ["PUBL", null],
  // Finsk momsnummer: reducerer til otte cifre, men er ikke et CVR-nummer.
  // Netop derfor afvises alt med bogstaver i.
  ["FI25620708", null],
  ["980921565", null],
  ["3779526", null],
  ["", null],
  [null, null]
]) {
  tjek(`rensCvr(${JSON.stringify(raa)}) = ${JSON.stringify(forventet)}`,
    rensCvr(raa) === forventet, JSON.stringify(rensCvr(raa)));
}

// ------------------------------------------------------ dubletter i et batch

console.log("\n=== dubletter fra kilden ===");

// FUNDET I PRODUKTION 19. august 2026: en fuld indlæsning væltede efter 18.300
// læste bekendtgørelser, fordi ét batch indeholdt samme (noticeId,
// noticeVersion) to gange. PostgREST svarede HTTP 500, SQLSTATE 21000 —
// Postgres nægter at upserte samme primærnøgle to gange i én kommando. Fejlen
// kom først 40 minutter inde i kørslen, så den skal fanges her frem for der.
const r = (id, version, titel) => ({ notice_id: id, notice_version: version, titel });

const udenDubletter = fjernDubletter([r("a", "01", "x"), r("b", "01", "y")]);
tjek("rækker med forskellige nøgler beholdes alle", udenDubletter.length === 2,
  udenDubletter.map((x) => x.notice_id).join(","));

const medDublet = fjernDubletter([r("a", "01", "foerste"), r("b", "01", "y"), r("a", "01", "sidste")]);
tjek("samme notice_id OG version foldes sammen til én", medDublet.length === 2,
  medDublet.map((x) => `${x.notice_id}/${x.notice_version}`).join(","));
tjek("den sidste forekomst vinder",
  medDublet.find((x) => x.notice_id === "a").titel === "sidste",
  medDublet.find((x) => x.notice_id === "a").titel);

// Versionen er en DEL af primærnøglen: to versioner af samme bekendtgørelse er
// to rækker, og at folde dem sammen ville tabe en rettelse.
const toVersioner = fjernDubletter([r("a", "01", "x"), r("a", "02", "y")]);
tjek("samme notice_id i to versioner er to rækker", toVersioner.length === 2,
  toVersioner.map((x) => x.notice_version).join(","));

// Map bevarer indsættelsesrækkefølgen, og en nøgle der sættes igen beholder
// sin oprindelige plads. 'a' skal altså blive stående FØRST med den sidste
// værdi — ikke flytte ned, hvor dublettten stod. Rækkefølgen betyder ikke
// noget for upserten, men et skifte i den ville være et tegn på, at
// sammenfoldningen er skrevet om til noget andet end den er nu.
tjek("de tilbageblevne rækker beholder deres oprindelige rækkefølge",
  fjernDubletter([r("a", "01"), r("b", "01"), r("a", "01"), r("c", "01")])
    .map((x) => x.notice_id).join(",") === "a,b,c",
  fjernDubletter([r("a", "01"), r("b", "01"), r("a", "01"), r("c", "01")])
    .map((x) => x.notice_id).join(","));

tjek("tomt batch giver tomt resultat", fjernDubletter([]).length === 0);

// ------------------------------------------------------ rigtige dokumenter

if (HENT) {
  console.log("\nHenter friske prøver fra udbud.dk…");
  const env = {};
  for (const l of (await readFile(".env", "utf8")).split("\n")) {
    const i = l.indexOf("=");
    if (i > 0 && !l.startsWith("#")) env[l.slice(0, i)] = l.slice(i + 1).trim();
  }
  const basic = Buffer.from(`${env.UDBUD_DK_BRUGER}:${env.UDBUD_DK_PASSWORD_PROD}`).toString("base64");
  const t = await fetch("https://erst.virk.dk/auth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const token = (await t.json()).access_token;
  await mkdir(PRØVEMAPPE, { recursive: true });

  for (const kilde of ["DKUDBUD", "TED"]) {
    const r = await fetch(
      `https://api.udbud.dk/udbud/ekstern-data/bekendtgoerelse/v1/fraKilde/${kilde}?size=25&page=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const d = await r.json();
    for (const [i, b] of d.bekendtgoerelser.entries()) {
      await writeFile(path.join(PRØVEMAPPE, `${kilde}-${i}.json`), JSON.stringify(b));
    }
    console.log(`  ${kilde}: ${d.bekendtgoerelser.length} prøver gemt i ${PRØVEMAPPE}/`);
  }
}

const filer = await readdir(PRØVEMAPPE).catch(() => []);
if (!filer.length) {
  console.log(
    `\nIngen prøver i ${PRØVEMAPPE}/ — kør med --hent for at afprøve mod rigtige ` +
    "bekendtgørelser. De syntetiske tjek ovenfor er kørt."
  );
} else {
  console.log(`\n=== rigtige bekendtgørelser (${filer.length} prøver) ===`);

  const raekker = [];
  for (const f of filer.filter((f) => f.endsWith(".json"))) {
    const container = JSON.parse(await readFile(path.join(PRØVEMAPPE, f), "utf8"));
    const xml = Buffer.from(container.bekendtgoerelseXml, "base64").toString("utf8");
    raekker.push({ fil: f, xml, ...udtraek(container, xml) });
  }

  tjek("alle prøver kunne parses", raekker.length === filer.filter((f) => f.endsWith(".json")).length);

  const andel = (p) => raekker.filter(p).length / raekker.length;

  tjek("alle har et notice_id", raekker.every((r) => r.notice_id));
  tjek("alle har en art der ikke er 'andet'", andel((r) => r.art !== "andet") === 1,
    [...new Set(raekker.map((r) => r.art))].join(", "));
  tjek("mindst 95 % har titel", andel((r) => r.titel) >= 0.95,
    `${Math.round(andel((r) => r.titel) * 100)} %`);
  tjek("mindst 95 % har CPV-koder", andel((r) => r.cpv_koder.length) >= 0.95,
    `${Math.round(andel((r) => r.cpv_koder.length) * 100)} %`);
  tjek("mindst 90 % har ordregivernavn", andel((r) => r.ordregiver) >= 0.9,
    `${Math.round(andel((r) => r.ordregiver) * 100)} %`);

  tjek("CPV-koder er otte cifre",
    raekker.every((r) => r.cpv_koder.every((k) => /^\d{8}$/.test(k))),
    JSON.stringify([...new Set(raekker.flatMap((r) => r.cpv_koder))].filter((k) => !/^\d{8}$/.test(k)).slice(0, 5)));

  tjek("hoved-CPV indgår altid i cpv_koder",
    raekker.every((r) => !r.cpv_hoved || r.cpv_koder.includes(r.cpv_hoved.split("-")[0])));

  tjek("alle frister er gyldige tidsstempler",
    raekker.every((r) => !r.frist || !Number.isNaN(new Date(r.frist).getTime())),
    JSON.stringify(raekker.map((r) => r.frist).filter((f) => f && Number.isNaN(new Date(f).getTime())).slice(0, 3)));

  tjek("CVR-numre er otte cifre hvor de findes",
    raekker.every((r) => !r.ordregiver_cvr || /^\d{8}$/.test(r.ordregiver_cvr)),
    JSON.stringify([...new Set(raekker.map((r) => r.ordregiver_cvr))].filter((c) => c && !/^\d{8}$/.test(c)).slice(0, 5)));

  // Kilden udledes af om publikationsnummeret er tomt. Er den regel forkert,
  // ryger hele skellet mellem "findes i TED" og "findes kun i Danmark" — og
  // det er præcis dét, søgesiden er til for.
  tjek("kilden matcher filnavnet den blev hentet under",
    raekker.every((r) => r.fil.startsWith(r.kilde)),
    raekker.filter((r) => !r.fil.startsWith(r.kilde)).map((r) => `${r.fil}->${r.kilde}`).join(", "));

  // Selve pointen med at have en parser: at værdierne ligner rigtige data og
  // ikke bare er ikke-tomme. En stikprøve printes til øjesyn.
  console.log("\n  Stikprøve:");
  for (const r of raekker.slice(0, 5)) {
    console.log(
      `    [${r.kilde}/${r.art}] ${String(r.titel).slice(0, 52)}\n` +
      `      cpv=${r.cpv_koder.slice(0, 4).join(",")} ordregiver=${r.ordregiver} (${r.ordregiver_cvr})\n` +
      `      frist=${r.frist} værdi=${r.anslaaet_vaerdi} ${r.valuta ?? ""}`
    );
  }
}

console.log(`\n${fejl === 0 ? "Alle tjek bestået." : `${fejl} fejl.`}`);
process.exit(fejl === 0 ? 0 : 1);
