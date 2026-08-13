// Indlæser CPV-nomenklaturen på dansk fra eForms-SDK'et til Postgres.
//
// HVORFOR: en ordregiver skal angive CPV-koder for sit udbud, og betegnelsen
// skal være den officielle. Appen havde tidligere fire hardkodede koder med
// opdigtede betegnelser — 64212000 stod som "SMS gateway og beskedtjenester",
// men hedder "Mobiltelefontjeneste".
//
// KILDE: codelists/cpv.gc i OP-TED/eForms-SDK. GenericCode-XML på 32 MB med
// samtlige EU-sprog; vi bruger "code" og "dan_label". Filen ligger i samme
// SDK som eForms-skemaerne, TED-parsingen allerede bygger på.
//
// KØRSEL:  node scripts/indlaes-cpv.mjs
//
// CPV 2008 har været uændret siden 2008, så dette er en engangskørsel —
// modsat CVR-indekset, der skal genindlæses ugentligt. Kør den igen hvis EU
// udgiver en ny CPV-udgave.

import { readFile } from "node:fs/promises";

const KILDE = "https://raw.githubusercontent.com/OP-TED/eForms-SDK/develop/codelists/cpv.gc";
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

// CPV-koder er hierarkiske gennem efterstillede nuller: 45000000 er
// hovedgruppen "Bygge- og anlægsarbejder", 45100000 en gruppe under den.
// Forælderen findes ved at nulstille sidste ikke-nul-ciffer.
function overordnetKode(kode) {
  const cifre = kode.split("");
  for (let i = cifre.length - 1; i >= 1; i--) {
    if (cifre[i] !== "0") {
      cifre[i] = "0";
      return cifre.join("");
    }
  }
  return null; // 8 nuller findes ikke, men vær eksplicit
}

// Niveau = hvor mange betydende cifre efter de to første. Bruges til at
// rangere brede koder over smalle i søgningen.
function niveauFor(kode) {
  const halen = kode.slice(2).replace(/0+$/, "");
  return 1 + halen.length;
}

// Afkodning af de fem XML-entiteter GenericCode bruger. En rigtig XML-parser
// ville være overkill for et fladt format som dette, og ville kræve en
// afhængighed for en engangskørsel.
function afkod(tekst) {
  return tekst
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function skrivBatch(rækker, env) {
  const svar = await fetch(`${kræv(env, "VITE_SUPABASE_URL")}/rest/v1/cpv_koder`, {
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

async function main() {
  const env = await laesEnv();
  kræv(env, "SUPABASE_SERVICE_ROLE_KEY");

  process.stdout.write("Henter cpv.gc… ");
  const svar = await fetch(KILDE);
  if (!svar.ok) throw new Error(`Kunne ikke hente kodelisten: HTTP ${svar.status}`);
  const xml = await svar.text();
  console.log(`${(xml.length / 1048576).toFixed(1)} MB`);

  process.stdout.write("Udtrækker koder og danske betegnelser… ");
  const koder = [];
  for (const [, blok] of xml.matchAll(/<Row>([\s\S]*?)<\/Row>/g)) {
    const kode = blok.match(/ColumnRef="code">\s*<SimpleValue>(.*?)<\/SimpleValue>/s)?.[1]?.trim();
    const dansk = blok.match(/ColumnRef="dan_label">\s*<SimpleValue>([\s\S]*?)<\/SimpleValue>/)?.[1]?.trim();
    if (!kode || !dansk) continue;
    koder.push({
      kode,
      tekst: afkod(dansk),
      niveau: niveauFor(kode),
      overordnet: overordnetKode(kode)
    });
  }
  console.log(`${koder.length.toLocaleString("da-DK")} koder`);

  if (koder.length < 9000) {
    throw new Error(
      `Kun ${koder.length} koder udtrukket — forventet ~9.454. ` +
      "Formatet i cpv.gc er sandsynligvis ændret; kontrollér ColumnRef-navnene."
    );
  }

  // Forældre skal findes, før børnene kan pege på dem (fremmednøgle). Sorteret
  // på niveau skrives hovedgrupperne først.
  koder.sort((a, b) => a.niveau - b.niveau || a.kode.localeCompare(b.kode));

  // En forælderkode behøver ikke findes i nomenklaturen — nulstiller man
  // sidste ciffer i 03110000 fås 03100000, som findes, men det gælder ikke
  // overalt. Ukendte forældre sættes til null frem for at bryde indlæsningen.
  const kendte = new Set(koder.map((k) => k.kode));
  let uden = 0;
  for (const k of koder) {
    if (k.overordnet && !kendte.has(k.overordnet)) {
      k.overordnet = null;
      uden++;
    }
  }
  if (uden) console.log(`  ${uden} koder havde en forælder der ikke findes — sat til null`);

  process.stdout.write("Skriver… ");
  for (let i = 0; i < koder.length; i += BATCH) {
    await skrivBatch(koder.slice(i, i + BATCH), env);
  }
  console.log(`${koder.length.toLocaleString("da-DK")} koder skrevet.`);
}

main().catch((err) => {
  console.error("\nFEJL:", err.message);
  process.exit(1);
});
