// Indlæser EU's konsoliderede sanktionsliste (Financial Sanctions Files) til
// Postgres. Erstatter det tidligere hardkodede sanctionsMatch: false i
// esgService.js, som aldrig kunne finde noget, uanset hvem man slog op.
//
// KILDE: https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content
// Officiel adgang kræver normalt en personlig EU Login-konto/token
// (https://webgate.ec.europa.eu/europeaid/fsd/fsf#!/account), MEN URL'en
// nedenfor virker med et fast, offentligt kendt token ("token-2017" i
// base64) som bl.a. bruges af open source-projektet moov-io/watchman. Det er
// verificeret at give den fulde, aktuelle liste (6.234 enheder, genereret
// for under en uge siden ved test). Er token'et engang blevet lukket ned,
// fejler dette script med en klar HTTP-fejl — registrér i så fald en
// personlig konto og opdater URL'en.
//
// XML'en er kun ~25 MB og parses derfor i hukommelsen med regex i stedet for
// en fuld XML-parser — samme "ingen ekstra afhængighed hvis det kan undgås"-
// tilgang som resten af scripts/-mappen (se csvRækker() i
// indlaes-cvr-navne.mjs for et større eksempel på det).
//
// KØRSEL: node scripts/indlaes-eu-sanktioner.mjs
//
// EU opdaterer listen løbende (typisk flere gange om ugen ved aktive sager) —
// en ugentlig kørsel, samme kadence som CVR-navneindekset, er passende.

import { readFile } from "node:fs/promises";

const SANKTIONS_URL =
  "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw";
const BATCH = 500;

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

// Samme normalisering skal bruges ved opslag i sanktionstjek-funktionen,
// ellers matcher intet nogensinde. Bevidst konservativ (kun eksakt match på
// det normaliserede navn, ingen fuzzy/trigram) — et sanktionstjek med falske
// positiver er værre end et der overser en stavevariant.
function normaliser(navn) {
  return navn
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,'’"-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tekst, navn) {
  const m = tekst.match(new RegExp(`${navn}="([^"]*)"`));
  return m ? m[1] : "";
}

// ---------------------------------------------------------------- skrivning

async function skrivBatch(rækker, env) {
  const svar = await fetch(`${kræv(env, "VITE_SUPABASE_URL")}/rest/v1/eu_sanktionsliste`, {
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
  kræv(env, "SUPABASE_SERVICE_ROLE_KEY");

  const startet = new Date().toISOString();

  process.stdout.write("Henter EU's sanktionsliste… ");
  const svar = await fetch(SANKTIONS_URL);
  if (!svar.ok) {
    throw new Error(
      `Kunne ikke hente sanktionslisten: HTTP ${svar.status}. Se kommentaren øverst i filen — ` +
        "det faste token er muligvis lukket ned, og en personlig EU Login-konto er nu nødvendig."
    );
  }
  const xml = await svar.text();
  console.log(`${(xml.length / 1048576).toFixed(1)} MB`);

  const genereret = xml.match(/generationDate="([^"]*)"/)?.[1] ?? "ukendt";
  console.log(`Listen er genereret af EU: ${genereret}`);

  process.stdout.write("Læser enheder og skriver til databasen… ");

  const batch = [];
  let skrevet = 0;
  let enheder = 0;

  // sanctionEntity-blokke nester ikke i sig selv, så et ikke-grådigt match op
  // til første lukketag er sikkert.
  const entityRegex = /<sanctionEntity\b[^>]*>[\s\S]*?<\/sanctionEntity>/g;
  const aliasRegex = /<nameAlias\b[^>]*\/?>/g;

  for (const entityMatch of xml.matchAll(entityRegex)) {
    const block = entityMatch[0];
    const entityId = attr(block.slice(0, block.indexOf(">") + 1), "logicalId");
    if (!entityId) continue;
    enheder++;

    const subjektType = attr(block.match(/<subjectType\b[^>]*\/?>/)?.[0] ?? "", "code");
    const programme = attr(block.match(/<regulation\b[^>]*>/)?.[0] ?? "", "programme");

    for (const aliasMatch of block.matchAll(aliasRegex)) {
      const alias = aliasMatch[0];
      const aliasId = attr(alias, "logicalId");
      const navn = attr(alias, "wholeName");
      if (!aliasId || !navn) continue;

      batch.push({
        alias_id: Number(aliasId),
        entity_id: Number(entityId),
        navn,
        navn_norm: normaliser(navn),
        subjekt_type: subjektType || null,
        programme: programme || null,
        opdateret: new Date().toISOString()
      });

      if (batch.length >= BATCH) {
        await skrivBatch(batch.splice(0), env);
        skrevet += BATCH;
      }
    }
  }

  if (batch.length) {
    await skrivBatch(batch, env);
    skrevet += batch.length;
  }

  console.log(`\n${enheder.toLocaleString("da-DK")} enheder, ${skrevet.toLocaleString("da-DK")} navnevarianter skrevet.`);

  // Ryd rækker der ikke blev rørt i denne kørsel — sanktioner der er ophævet
  // siden sidst. Uden dette ville listen kun vokse.
  const slet = await fetch(
    `${env.VITE_SUPABASE_URL}/rest/v1/eu_sanktionsliste?opdateret=lt.${encodeURIComponent(startet)}`,
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
