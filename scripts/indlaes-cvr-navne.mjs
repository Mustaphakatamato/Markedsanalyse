// Indlæser navneindekset over aktive danske virksomheder fra Datafordelerens
// CVR-fildownload til Postgres.
//
// HVORFOR: Datafordelerens GraphQL-tjeneste kan kun filtrere strenge med "eq"
// og "in" — der findes ingen "contains". Fritekstsøgning på firmanavn er
// derfor umulig direkte mod kilden, og det er netop appens vigtigste indgang.
// Ved at holde et navneindeks i egen database kan vi søge ordentligt, og
// detaljerne hentes bagefter fra Datafordeleren på CVR-nummeret, hvor der
// ingen begrænsning er.
//
// HVORFOR IKKE EN EDGE FUNCTION: filerne fylder 168 MB og 567 MB udpakket.
// Edge Functions har 256 MB hukommelse og 150 sekunders levetid.
//
// KØRSEL:  node scripts/indlaes-cvr-navne.mjs
//          node scripts/indlaes-cvr-navne.mjs --behold   (genbrug hentede filer)
//
// Filerne hos Datafordeleren gendannes natten til lørdag og gemmes syv dage,
// så en ugentlig kørsel er passende.

import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

const ARBEJDSMAPPE = ".cvr-data";
const BATCH = 1000;
const BEHOLD_FILER = process.argv.includes("--behold");

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

async function hentOgUdpak(entitet, apiKey) {
  const zipSti = path.join(ARBEJDSMAPPE, `${entitet}.zip`);

  const findesAllerede = await stat(zipSti).then(() => true).catch(() => false);
  if (!(BEHOLD_FILER && findesAllerede)) {
    process.stdout.write(`Henter ${entitet}… `);
    const url =
      `https://api.datafordeler.dk/FileDownloads/GetFile?Register=CVR` +
      `&LatestTotalForEntity=${entitet}&type=current&format=CSV&apiKey=${encodeURIComponent(apiKey)}`;

    const svar = await fetch(url);
    if (!svar.ok) {
      // URL'en indeholder API-nøglen og må ikke med i fejlbeskeden.
      throw new Error(`Kunne ikke hente ${entitet}: HTTP ${svar.status}`);
    }
    const data = Buffer.from(await svar.arrayBuffer());
    await writeFile(zipSti, data);
    console.log(`${(data.length / 1048576).toFixed(1)} MB`);
  } else {
    console.log(`Genbruger hentet ${entitet}.zip`);
  }

  await execFileAsync("unzip", ["-o", "-q", zipSti, "-d", ARBEJDSMAPPE]);

  const { stdout } = await execFileAsync("unzip", ["-Z1", zipSti]);
  return path.join(ARBEJDSMAPPE, stdout.trim().split("\n")[0]);
}

// ------------------------------------------------------------------ skrivning

async function skrivBatch(rækker, env) {
  const svar = await fetch(`${kræv(env, "VITE_SUPABASE_URL")}/rest/v1/cvr_virksomhed_indeks`, {
    method: "POST",
    headers: {
      apikey: kræv(env, "SUPABASE_SERVICE_ROLE_KEY"),
      Authorization: `Bearer ${kræv(env, "SUPABASE_SERVICE_ROLE_KEY")}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rækker)
  });

  if (!svar.ok) {
    throw new Error(`Skrivning fejlede: HTTP ${svar.status} — ${(await svar.text()).slice(0, 300)}`);
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
  for await (const r of csvObjekter(virksomhedFil)) {
    if (r.id && r.CVRNummer) enhedTilCvr.set(r.id, Number(r.CVRNummer));
  }
  console.log(`${enhedTilCvr.size.toLocaleString("da-DK")} aktive virksomheder`);

  // Trin 2: navnene. Filen dækker ALLE CVR-enheder — også personer — så vi
  // beholder kun rækker hvis enhed står i kortet ovenfor.
  const navnFil = await hentOgUdpak("Navn", apiKey);
  process.stdout.write("Læser navne og skriver til databasen… ");

  const batch = [];
  let skrevet = 0;
  const setCvr = new Set();

  for await (const r of csvObjekter(navnFil)) {
    const cvr = enhedTilCvr.get(r.CVREnhedsId);
    if (cvr === undefined) continue;

    // Kun det gældende navn: åben virknings- og registreringsperiode.
    if (r.virkningTil || r.registreringTil) continue;
    if (!r.vaerdi) continue;

    // Enkelte enheder har flere åbne navnerækker; første vundne er nok.
    if (setCvr.has(cvr)) continue;
    setCvr.add(cvr);

    batch.push({ cvr, navn: r.vaerdi, status: "aktiv", ophoert: false, opdateret: new Date().toISOString() });

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

  console.log(`\nSkrev ${skrevet.toLocaleString("da-DK")} navne.`);

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
}

main().catch((err) => {
  console.error("\nFEJL:", err.message);
  process.exit(1);
});
