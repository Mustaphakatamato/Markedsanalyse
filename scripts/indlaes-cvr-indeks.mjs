// Indlæser markedsindekset over aktive danske virksomheder fra Datafordelerens
// CVR-fildownload til Postgres: navn, branche, geografi, selskabsform,
// antal forretningssteder og stiftelsesdato.
//
// HVORFOR: Datafordelerens GraphQL-tjeneste kan kun filtrere strenge med "eq"
// og "in" — der findes ingen "contains". Den tillader desuden kun ét rodfelt
// pr. forespørgsel og forbyder aliaser. To ting er derfor umulige direkte mod
// kilden, og begge er kernen i appen:
//   1. fritekstsøgning på firmanavn (appens vigtigste indgang)
//   2. "alle virksomheder i branche X i kommune Y" (markedsanalysens indgang)
// Begge dele bliver mulige med et eget indeks; detaljerne hentes bagefter fra
// Datafordeleren på CVR-nummeret, hvor der ingen begrænsning er.
//
// HVORFOR IKKE EN EDGE FUNCTION: filerne fylder tilsammen over 1 GB udpakket.
// Edge Functions har 256 MB hukommelse og 150 sekunders levetid.
//
// KØRSEL:  node scripts/indlaes-cvr-indeks.mjs
//          node scripts/indlaes-cvr-indeks.mjs --behold    (genbrug hentede filer)
//          node scripts/indlaes-cvr-indeks.mjs --toerloeb  (læs og tæl, skriv intet)
//
// --toerloeb rører aldrig databasen. Brug det efter ændringer i parsingen:
// en fejl her skriver 870.000 forkerte rækker, og den forrige, rigtige
// tilstand er væk bagefter, fordi kørslen rydder rækker den ikke rørte.
//
// Skriv --max-old-space-size=4096 foran, hvis Node løber tør for hukommelse:
// indekset holdes samlet i RAM under opbygningen for at kunne skrives i ét
// gennemløb i stedet for 870.000 opdateringer.
//
// Filerne hos Datafordeleren gendannes natten til lørdag og gemmes syv dage,
// så en ugentlig kørsel er passende.
//
// ENTITETER: kun Virksomhed, Navn, Branche, Adressering, Virksomhedsform og
// Produktionsenhed udstilles som bulkfiler (verificeret 2026-08-13 — øvrige
// navne svarer 403). Antal ansatte findes IKKE som bulkfil ("Beskaeftigelse"
// svarer 404: kendt entitet, ingen aktuel fil), og hentes derfor pr. CVR
// gennem cvr-datafordeler-funktionen når en virksomhed skal beriges.
//
// DERFOR TÆLLER VI PRODUKTIONSENHEDER. Markedsanalysen skal kunne vise de
// STORE leverandører først, og uden ansatte eller omsætning for hele
// populationen er antallet af aktive forretningssteder det bedste
// størrelsessignal, der findes i bulk. Det er skarpt netop fordi det er
// skævt: 844.679 af 870.461 virksomheder har præcis ét sted, 977 har ti
// eller flere. Se supabase/migrations/20260814090000 for hvad målet
// dermed kan og ikke kan bruges til.

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const ARBEJDSMAPPE = ".cvr-data";

// 1000 rækker pr. kald ramte statement_timeout, da tabellen fik fire ekstra
// indekser at vedligeholde. 500 giver luft uden at fordoble antallet af kald
// nævneværdigt i forhold til den samlede tid.
const BATCH = 500;
const BEHOLD_FILER = process.argv.includes("--behold");
const TØRLØB = process.argv.includes("--toerloeb");

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

// Branchetekster, kommunenavne og selskabsformer gentages på tværs af
// hundredtusinder af rækker, men har kun nogle hundrede distinkte værdier.
// Uden intering ligger hver forekomst som sin egen streng i hukommelsen.
const strengePulje = new Map();
function intern(s) {
  if (!s) return null;
  const fundet = strengePulje.get(s);
  if (fundet !== undefined) return fundet;
  strengePulje.set(s, s);
  return s;
}

// En række er kun gældende hvis både virknings- og registreringsperioden er
// åben. Uden dette filter ville historiske brancheskift tælle med som nuværende.
const erGældende = (r) => !r.virkningTil && !r.registreringTil;

// ------------------------------------------------------------- CSV-parsning

// Streamende CSV-læser. Node har ingen indbygget, og filerne er for store til
// at læse ind i hukommelsen. Håndterer citerede felter, dobbelte anførselstegn
// som escape ("") og linjeskift inde i felter.
async function* csvRækker(filsti) {
  const stream = createReadStream(filsti, { encoding: "utf8", highWaterMark: 1 << 20 });

  let felt = "";
  let række = [];
  let iCitat = false;
  let forrigeVarCitat = false;

  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];

      if (iCitat) {
        if (c === '"') {
          iCitat = false;
          forrigeVarCitat = true;
        } else {
          felt += c;
        }
        continue;
      }

      if (forrigeVarCitat && c === '"') {
        // "" inde i et citeret felt = ét bogstaveligt anførselstegn
        felt += '"';
        iCitat = true;
        forrigeVarCitat = false;
        continue;
      }
      forrigeVarCitat = false;

      if (c === '"') iCitat = true;
      else if (c === ",") {
        række.push(felt);
        felt = "";
      } else if (c === "\n") {
        række.push(felt);
        yield række;
        række = [];
        felt = "";
      } else if (c !== "\r") {
        felt += c;
      }
    }
  }

  if (felt !== "" || række.length) {
    række.push(felt);
    yield række;
  }
}

async function* csvObjekter(filsti) {
  let kolonner = null;
  for await (const række of csvRækker(filsti)) {
    if (!kolonner) {
      kolonner = række;
      continue;
    }
    if (række.length === 1 && række[0] === "") continue; // afsluttende tom linje
    const o = {};
    for (let i = 0; i < kolonner.length; i++) o[kolonner[i]] = række[i] ?? "";
    yield o;
  }
}

// ------------------------------------------------------------------ hentning

// Hentningen forsøges igen ved netværksfejl. Det er ikke overforsigtighed:
// Datafordeleren afbrød Produktionsenhed-filen midt i legemet ("terminated")
// 14. august, efter at fem andre filer var hentet i samme kørsel. Uden
// gentagelse koster en enkelt afbrudt forbindelse hele kørslen — de fem
// foregående filer på tilsammen 550 MB skal hentes forfra.
const HENT_FORSØG = 4;

async function hentOgUdpak(entitet, apiKey) {
  const zipSti = path.join(ARBEJDSMAPPE, `${entitet}.zip`);

  const findesAllerede = await stat(zipSti).then(() => true).catch(() => false);
  if (!(BEHOLD_FILER && findesAllerede)) {
    process.stdout.write(`Henter ${entitet}… `);
    const url =
      `https://api.datafordeler.dk/FileDownloads/GetFile?Register=CVR` +
      `&LatestTotalForEntity=${entitet}&type=current&format=CSV&apiKey=${encodeURIComponent(apiKey)}`;

    for (let forsøg = 1; ; forsøg++) {
      try {
        const svar = await fetch(url);
        if (!svar.ok) {
          // URL'en indeholder API-nøglen og må ikke med i fejlbeskeden.
          // En HTTP-fejl er kildens svar, ikke en afbrudt forbindelse —
          // den bliver ikke bedre af at blive gentaget.
          throw Object.assign(
            new Error(`Kunne ikke hente ${entitet}: HTTP ${svar.status}`),
            { endeligt: true }
          );
        }
        const data = Buffer.from(await svar.arrayBuffer());
        await writeFile(zipSti, data);
        console.log(`${(data.length / 1048576).toFixed(1)} MB`);
        break;
      } catch (e) {
        if (e.endeligt || forsøg >= HENT_FORSØG) throw e;
        const pause = 5000 * forsøg;
        process.stdout.write(
          `\n  forsøg ${forsøg}/${HENT_FORSØG} fejlede (${e.message}), venter ${pause / 1000}s… `
        );
        await new Promise((r) => setTimeout(r, pause));
      }
    }
  } else {
    console.log(`Genbruger hentet ${entitet}.zip`);
  }

  await execFileAsync("unzip", ["-o", "-q", zipSti, "-d", ARBEJDSMAPPE]);

  const { stdout } = await execFileAsync("unzip", ["-Z1", zipSti]);
  return path.join(ARBEJDSMAPPE, stdout.trim().split("\n")[0]);
}

// ------------------------------------------------------------------ skrivning

// Supabase afbryder et kald gennem PostgREST efter 8 sekunder
// (statement_timeout). En upsert kan ramme loftet når databasen er travl, og
// et enkelt afbrudt kald må ikke koste et løb der er 150.000 rækker inde —
// derfor forsøges hver batch igen med voksende pause. Upserten er
// idempotent (merge-duplicates på primærnøglen), så et gentaget forsøg er
// ufarligt, også hvis det første faktisk nåede at gå igennem.
const FORSØG = 5;

async function skrivBatch(rækker, env) {
  if (TØRLØB) return;

  for (let forsøg = 1; ; forsøg++) {
    let svar, netværksfejl;
    try {
      svar = await fetch(`${kræv(env, "VITE_SUPABASE_URL")}/rest/v1/cvr_virksomhed_indeks`, {
        method: "POST",
        headers: {
          apikey: kræv(env, "SUPABASE_SERVICE_ROLE_KEY"),
          Authorization: `Bearer ${kræv(env, "SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rækker)
      });
    } catch (e) {
      netværksfejl = e;
    }

    if (svar?.ok) return;

    const detalje = netværksfejl
      ? netværksfejl.message
      : `HTTP ${svar.status} — ${(await svar.text()).slice(0, 300)}`;

    if (forsøg >= FORSØG) {
      throw new Error(`Skrivning fejlede efter ${FORSØG} forsøg: ${detalje}`);
    }

    const pause = 2000 * forsøg;
    process.stdout.write(`\n  forsøg ${forsøg}/${FORSØG} fejlede (${detalje.slice(0, 80)}), venter ${pause / 1000}s… `);
    await new Promise((r) => setTimeout(r, pause));
  }
}

// ---------------------------------------------------------------------- kør

async function main() {
  const env = await laesEnv();
  const apiKey = kræv(env, "DATAFORDELER_API_KEY");
  kræv(env, "SUPABASE_SERVICE_ROLE_KEY");

  await mkdir(ARBEJDSMAPPE, { recursive: true });

  const startet = new Date().toISOString();

  // Trin 1: virksomhederne. Giver koblingen CVREnhedsId -> CVR-nummer.
  // "current"-udtrækket indeholder kun aktive selskaber, hvilket er præcis
  // det en markedsafdækning skal bruge.
  const virksomhedFil = await hentOgUdpak("Virksomhed", apiKey);
  process.stdout.write("Læser virksomheder… ");

  const enhedTilCvr = new Map();
  // Stiftelsesdatoen er ikke et størrelsesmål, men den er det eneste billige
  // signal om, hvor længe en leverandør har eksisteret — og den afgør
  // rækkefølgen mellem to virksomheder med samme størrelsesscore.
  const startdatoer = new Map();
  for await (const r of csvObjekter(virksomhedFil)) {
    if (!r.id || !r.CVRNummer) continue;
    const cvr = Number(r.CVRNummer);
    enhedTilCvr.set(r.id, cvr);
    if (r.virksomhedStartdato && !startdatoer.has(cvr)) {
      startdatoer.set(cvr, r.virksomhedStartdato);
    }
  }
  console.log(`${enhedTilCvr.size.toLocaleString("da-DK")} aktive virksomheder`);

  // Trin 2: navnene. Filen dækker ALLE CVR-enheder — også personer — så vi
  // beholder kun rækker hvis enhed står i kortet ovenfor. Navnet er samtidig
  // det der afgør om en virksomhed overhovedet kommer i indekset: uden navn
  // er rækken ubrugelig i både navnesøgning og markedsopslag.
  const navnFil = await hentOgUdpak("Navn", apiKey);
  process.stdout.write("Læser navne… ");

  const poster = new Map(); // cvr -> række klar til skrivning
  for await (const r of csvObjekter(navnFil)) {
    const cvr = enhedTilCvr.get(r.CVREnhedsId);
    if (cvr === undefined || !r.vaerdi || !erGældende(r)) continue;

    // Enkelte enheder har flere åbne navnerækker; første vundne er nok.
    if (poster.has(cvr)) continue;

    poster.set(cvr, {
      cvr,
      navn: r.vaerdi,
      status: "aktiv",
      ophoert: false,
      branchekode: null,
      branchetekst: null,
      bibrancher: null,
      kommunekode: null,
      kommunenavn: null,
      postnummer: null,
      postdistrikt: null,
      virksomhedsform: null,
      virksomhedsformkode: null,
      antal_penheder: 0,
      startdato: startdatoer.get(cvr) || null,
      opdateret: startet
    });
  }
  console.log(`${poster.size.toLocaleString("da-DK")} navngivne virksomheder`);

  // Trin 3: brancher. "sekvens" 0 er hovedbranchen, 1 og opefter er
  // bibrancher. Begge dele er relevante for en markedsafdækning — en
  // virksomhed kan have IT-drift som bibranche og stadig være en reel
  // leverandør — men de holdes adskilt, så evidensstyrken kan ses i UI'et.
  const brancheFil = await hentOgUdpak("Branche", apiKey);
  process.stdout.write("Læser brancher… ");

  let medBranche = 0;
  for await (const r of csvObjekter(brancheFil)) {
    const cvr = enhedTilCvr.get(r.CVREnhedsId);
    if (cvr === undefined || !r.vaerdi || !erGældende(r)) continue;
    const post = poster.get(cvr);
    if (!post) continue;

    const kode = intern(r.vaerdi);
    if (r.sekvens === "0") {
      if (post.branchekode === null) {
        post.branchekode = kode;
        post.branchetekst = intern(r.vaerdiTekst);
        medBranche++;
      }
    } else if (kode !== post.branchekode) {
      if (post.bibrancher === null) post.bibrancher = [];
      if (!post.bibrancher.includes(kode)) post.bibrancher.push(kode);
    }
  }
  console.log(`${medBranche.toLocaleString("da-DK")} med hovedbranche`);

  // Trin 4: adresser. Filen rummer flere adressetyper pr. enhed
  // (beliggenhed, post m.fl.); kun beliggenhedsadressen fortæller hvor
  // virksomheden faktisk holder til, og det er den geografien skal bygge på.
  const adresseFil = await hentOgUdpak("Adressering", apiKey);
  process.stdout.write("Læser adresser… ");

  let medAdresse = 0;
  for await (const r of csvObjekter(adresseFil)) {
    if (r.AdresseringAnvendelse !== "beliggenhedsadresse" || !erGældende(r)) continue;
    const cvr = enhedTilCvr.get(r.CVREnhedsId);
    if (cvr === undefined) continue;
    const post = poster.get(cvr);
    if (!post || post.kommunekode !== null) continue;

    post.kommunekode = intern(r.CVRAdresse_kommunekode) ?? null;
    post.kommunenavn = intern(r.CVRAdresse_kommunenavn) ?? null;
    post.postnummer = intern(r.CVRAdresse_postnummer) ?? null;
    post.postdistrikt = intern(r.CVRAdresse_postdistrikt) ?? null;
    if (post.kommunekode) medAdresse++;
  }
  console.log(`${medAdresse.toLocaleString("da-DK")} med kommune`);

  // Trin 5: selskabsform. Skiller A/S og ApS fra enkeltmandsvirksomheder og
  // foreninger — afgørende for at vurdere om et marked reelt kan bære et
  // udbud, eller om populationen mest består af enkeltmandsvirksomheder.
  const formFil = await hentOgUdpak("Virksomhedsform", apiKey);
  process.stdout.write("Læser selskabsformer… ");

  let medForm = 0;
  for await (const r of csvObjekter(formFil)) {
    const cvr = enhedTilCvr.get(r.CVREnhedsId);
    if (cvr === undefined || !r.vaerdi || !erGældende(r)) continue;
    const post = poster.get(cvr);
    if (!post || post.virksomhedsformkode !== null) continue;

    post.virksomhedsformkode = intern(r.vaerdi);
    post.virksomhedsform = intern(r.vaerdiTekst);
    medForm++;
  }
  console.log(`${medForm.toLocaleString("da-DK")} med selskabsform`);

  // Trin 6: produktionsenheder — antallet af aktive forretningssteder.
  //
  // Filen joiner IKKE på CVREnhedsId som de øvrige; den har CVR-nummeret
  // direkte i tilknyttetVirksomhedsCVRNummer. Tre ting skal være åbne, for at
  // en enhed tæller: enheden må ikke være ophørt, tilknytningen til
  // virksomheden må ikke være ophørt (en P-enhed kan flytte til et andet
  // CVR-nummer ved et frasalg), og rækken skal være den gældende.
  const penhedFil = await hentOgUdpak("Produktionsenhed", apiKey);
  process.stdout.write("Læser produktionsenheder… ");

  let penhederIalt = 0;
  for await (const r of csvObjekter(penhedFil)) {
    if (r.produktionsenhedOphoersdato || r.tilknyttetTilVirksomhedOphoersdato) continue;
    if (!erGældende(r)) continue;
    const post = poster.get(Number(r.tilknyttetVirksomhedsCVRNummer));
    if (!post) continue;
    post.antal_penheder++;
    penhederIalt++;
  }

  const medFlereSteder = [...poster.values()].filter((p) => p.antal_penheder >= 2).length;
  console.log(
    `${penhederIalt.toLocaleString("da-DK")} enheder · ` +
    `${medFlereSteder.toLocaleString("da-DK")} virksomheder med flere end ét sted`
  );

  // Trin 7: skriv. Ét gennemløb frem for én opdatering pr. virksomhed —
  // 870.000 enkeltopdateringer gennem PostgREST ville tage timer.
  process.stdout.write(TØRLØB ? "Tørløb — samler rækker uden at skrive… " : "Skriver til databasen… ");

  const batch = [];
  let skrevet = 0;
  for (const post of poster.values()) {
    // Rækkefølgen i branchefilen er ikke garanteret, så en bibranche kan være
    // læst før hovedbranchen var kendt. Fjern overlappet nu, hvor begge dele
    // er på plads — ellers ville samme kode tælle med to gange i markedstallene.
    if (post.bibrancher) {
      post.bibrancher = post.bibrancher.filter((k) => k !== post.branchekode);
      if (post.bibrancher.length === 0) post.bibrancher = null;
    }
    batch.push(post);
    if (batch.length >= BATCH) {
      await skrivBatch(batch.splice(0), env);
      skrevet += BATCH;
      if (skrevet % 50000 === 0) process.stdout.write(`${skrevet / 1000}k… `);
    }
  }
  if (batch.length) {
    await skrivBatch(batch, env);
    skrevet += batch.length;
  }

  console.log(`\n${TØRLØB ? "Ville skrive" : "Skrev"} ${skrevet.toLocaleString("da-DK")} virksomheder.`);

  if (TØRLØB) {
    // Dækningsgraderne er det egentlige resultat af et tørløb: falder én af
    // dem markant i forhold til sidste kørsel, er et kolonnenavn eller et
    // filformat ændret hos kilden — og så ville en rigtig kørsel tømme
    // felterne i stedet for at opdatere dem.
    const pct = (n) => `${((n / poster.size) * 100).toFixed(1)} %`;
    console.log("\nDækning:");
    console.log(`  hovedbranche   ${medBranche.toLocaleString("da-DK").padStart(9)}  ${pct(medBranche)}`);
    console.log(`  kommune        ${medAdresse.toLocaleString("da-DK").padStart(9)}  ${pct(medAdresse)}`);
    console.log(`  selskabsform   ${medForm.toLocaleString("da-DK").padStart(9)}  ${pct(medForm)}`);

    const medBi = [...poster.values()].filter((p) => p.bibrancher?.length).length;
    console.log(`  bibrancher     ${medBi.toLocaleString("da-DK").padStart(9)}  ${pct(medBi)}`);

    const medPenhed = [...poster.values()].filter((p) => p.antal_penheder > 0).length;
    const medStartdato = [...poster.values()].filter((p) => p.startdato).length;
    console.log(`  p-enheder      ${medPenhed.toLocaleString("da-DK").padStart(9)}  ${pct(medPenhed)}`);
    console.log(`  startdato      ${medStartdato.toLocaleString("da-DK").padStart(9)}  ${pct(medStartdato)}`);
    // Falder denne til nul, er hele størrelsesrangeringen slået fra uden at
    // noget fejler — listen ville se rigtig ud og vise vilkårlige firmaer.
    console.log(`  flere steder   ${medFlereSteder.toLocaleString("da-DK").padStart(9)}  ${pct(medFlereSteder)}`);

    const prøve = [...poster.values()].find((p) => p.branchekode && p.kommunekode && p.virksomhedsform);
    console.log(`\nEksempelrække:\n  ${JSON.stringify(prøve)}`);
    console.log("\nIntet blev skrevet. Kør uden --toerloeb for at indlæse.");
    return;
  }

  // Ryd rækker der ikke blev rørt i denne kørsel — virksomheder der er ophørt
  // eller omdøbt siden sidst. Uden dette ville indekset kun vokse.
  const slet = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/cvr_virksomhed_indeks?opdateret=lt.${encodeURIComponent(startet)}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      }
    }
  );
  console.log(slet.ok ? "Ryddede forældede rækker." : `Oprydning fejlede: HTTP ${slet.status}`);

  // marked_dim og branche_tekst er materialiserede views — de ser ikke de
  // nye rækker før de genopbygges. Det tager ~32 sekunder tilsammen, altså
  // langt over PostgREST's statement_timeout på 8, så scriptet kan ikke selv
  // udløse det. Uden dette trin svarer markedsopslagene på forrige uges data
  // uden at fejle, hvilket er værre end en fejl.
  console.log(
    "\nHUSK at genopbygge markedsvisningerne — ellers svarer soeg_marked() og\n" +
    "marked_statistik() stadig på forrige uges data:\n\n" +
    "  refresh materialized view public.marked_dim;\n" +
    "  refresh materialized view public.branche_tekst;\n" +
    "  analyze public.marked_dim;\n"
  );
}

main().catch((err) => {
  console.error("\nFEJL:", err.message);
  process.exit(1);
});
