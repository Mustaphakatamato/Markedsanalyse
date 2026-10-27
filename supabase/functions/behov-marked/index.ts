// Fra ordregiverens behov i almindeligt sprog til et marked: CPV-koder,
// afgrænsning og et forslag til opdeling.
//
// HVORFOR AI HER OG IKKE ANDRE STEDER I MARKEDSANALYSEN: det svære første
// skridt for en ordregiver er at finde de rigtige CPV-koder blandt 9.454 —
// det kræver at oversætte "rengøring af skoler og daginstitutioner" til
// nomenklaturens sprog. Alt efter det skridt bygger på registre, ikke på
// modellen.
//
// MODELLEN MÅ IKKE KUNNE OPFINDE EN KODE. Sprogmodeller husker CPV-koder
// upræcist, og en kode med forkert betegnelse i udbudsmaterialet er direkte
// forkert (se cpvService.js om de opdigtede koder, appen havde før). Derfor:
//   1. Hver foreslået kode slås op i cpv_koder. Findes den ikke, forsvinder
//      den — og det tælles i svaret, så det ikke sker lydløst.
//   2. Betegnelsen kommer altid fra tabellen, aldrig fra modellen.
//   3. Modellen leverer også søgeord, som køres gennem den samme
//      CPV-søgning som CpvVaelger. Det giver rigtige koder, også når modellens
//      egne bud var forkerte.
//
// Svaret er et FORSLAG. UI'et anvender intet, før ordregiveren har bekræftet.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { handlePreflight, json } from "../_shared/http.ts";
import { callGroqStructured } from "../_shared/groq.ts";

// Samme model som bid-gonogo og bid-questions: kun GPT-OSS-modellerne
// understøtter strict JSON-schema på Groq (se bid-questions/index.ts).
const MODEL = "openai/gpt-oss-120b";

const serviceKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, {
  auth: { persistSession: false }
});

const ER_CPV = /^\d{8}$/;

// ---------------------------------------------------------------------------
// BETEGNELSESTJEKKET. At slå koden op i cpv_koder fanger kun opdigtede koder.
// Det fangede ikke det, der faktisk sker: modellen rammer forbi på en kode,
// der TILFÆLDIGVIS findes og betyder noget helt andet. Målt 2026-10-27 gav
// "rengøring af skoler" koderne 90420000 (Behandling af spildevand) og
// 90410000 (Bortskaffelse af spildevand), og en IT-driftsaftale gav 33110000
// (Udstyr til billeddannelse til medicinsk, dental og veterinær brug) — alle
// tre findes, alle tre er forkerte, og kasseredeKoder stod på 0.
//
// Derfor skriver modellen nu selv, hvilken betegnelse den TROR koden har.
// Handler den om noget andet end tabellens, kendte modellen ikke koden, og
// den ryger. Tabellens betegnelse er fortsat den eneste, der vises.
//
// Tjekket skal hellere kassere en rigtig kode end slippe en forkert igennem:
// en forkert CPV-kode står synligt galt i udbudsmaterialet, mens en kode, der
// mangler, stadig kan findes via søgeordene og CpvVaelger.

// Ord, der går igen i snesevis af CPV-betegnelser. Et sammenfald på dem alene
// viser ingenting — "udstyr" matcher både kontorudstyr og scannere til
// hospitaler, og var præcis det, der ville have reddet 33110000.
// Noteret som de AFKORTEDE former, fordi afkortningen sker først: ellers
// slipper "tjenesteydelser" forbi en liste, der kun kender "tjenester", og
// giver så match med enhver anden betegnelse, der også begynder med
// "tjeneste" — fx affald mod spildevand.
const GENERISKE_STAMMER = new Set([
  "udstyr", "tjenes", "ydelse", "servic", "virkso", "produk", "materi",
  "divers", "andre", "øvrige", "forbin", "arbejd", "anlæg", "system",
  "løsnin", "brug", "dele", "tilbeh", "appara", "artikl", "varer", "typer",
  "vedrør", "forske", "almind", "specie", "tilhør"
]);

// Afkortning til seks tegn frem for rigtig stammereduktion: det dækker
// bøjninger som rengøring/rengørings og bygning/bygninger, uden at skulle
// have en dansk ordliste med ind i funktionen.
function betydendeOrd(tekstvaerdi: string): Set<string> {
  return new Set(
    tekstvaerdi
      .toLowerCase()
      .replace(/[^a-zæøåäöüé0-9]+/g, " ")
      .split(" ")
      .map((o) => o.slice(0, 6))
      .filter((o) => o.length >= 4 && !GENERISKE_STAMMER.has(o))
  );
}

// Ét betydende ord til fælles er nok. Tærsklen er bevidst lav: modellen
// formulerer sig sjældent ordret som nomenklaturen, og målet er at fange de
// grove forbiere, ikke at kræve et ordret citat.
function betegnelsenPasser(modellens: string, tabellens: string): boolean {
  const a = betydendeOrd(modellens);
  if (!a.size) return false;
  const b = betydendeOrd(tabellens);
  for (const ord of a) if (b.has(ord)) return true;
  return false;
}
const MAKS_TEKST = 4000;

const SYSTEM_PROMPT = `Du hjælper en dansk offentlig ordregiver med at afgrænse leverandørmarkedet før et udbud.

Du får ordregiverens behovsbeskrivelse. Svar med:
- cpvForslag: 2-5 CPV-koder (otte cifre, uden kontrolciffer) der dækker det, der skal KØBES. Foretræk koder på det niveau, hvor markedet typisk byder — ikke for bredt (hele hovedgrupper) og ikke for smalt. Hver kode får:
  - betegnelse: den officielle danske betegnelse, du mener koden har i CPV-nomenklaturen. Skriv den, som du tror den står der — ikke en omskrivning og ikke en beskrivelse af behovet. Den bliver holdt op mod nomenklaturen, og koden sorteres fra, hvis de to ikke handler om det samme. Er du i tvivl om en kodes betegnelse, så lad være med at foreslå koden.
  - begrundelse: én sætning, der henviser til behovet.
- soegeord: 3-6 korte danske søgeord, sådan som de står i CPV-nomenklaturens betegnelser (fx "rengøring", "vinduespudsning", "kantinedrift").
- afgraensning.omfatter og afgraensning.omfatterIkke: hver 1-4 korte punkter om hvad markedet dækker, og hvad der ligger tæt på men uden for.
- opdelingsforslag: én eller to sætninger om opgaven naturligt kan deles i delkontrakter (geografisk, fagligt eller efter størrelse) — eller en tom streng, hvis behovet ikke giver grundlag for at sige noget.

Opfind ikke oplysninger, der ikke står i behovet. Svar altid på dansk.`;

// Andet trins prompt. Modellen får rigtige koder fra nomenklaturen og skal
// kun pege. Den må gerne svare tomt: et behov, hvor ingen af kandidaterne
// passer, skal ikke presses ind i en kode, der er lidt forkert.
const VAELG_PROMPT = `Du hjælper en dansk offentlig ordregiver med at vælge CPV-koder til et udbud.

Du får behovet og en liste med KANDIDATKODER fra den officielle CPV-nomenklatur.

Vælg de 2-5 koder fra listen, der bedst dækker det, der skal KØBES. Regler:
- Du må KUN vælge koder, der står i listen. Find aldrig på en kode.
- Vælg det niveau, markedet typisk byder på — ikke hele hovedgrupper, og ikke en enkelt detalje af en større opgave.
- Mange kandidater er fundet ved ordsøgning og passer slet ikke til behovet. Dem lader du ligge.
- Passer ingen af kandidaterne, så svar med en tom liste frem for det nærmeste.
- Hver valgt kode får en begrundelse på én sætning, der henviser til behovet.

Svar altid på dansk.`;

const VAELG_SCHEMA = {
  type: "object",
  properties: {
    valg: {
      type: "array",
      items: {
        type: "object",
        properties: { kode: { type: "string" }, begrundelse: { type: "string" } },
        required: ["kode", "begrundelse"],
        additionalProperties: false
      }
    }
  },
  required: ["valg"],
  additionalProperties: false
};

const SCHEMA = {
  type: "object",
  properties: {
    cpvForslag: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kode: { type: "string" },
          betegnelse: { type: "string" },
          begrundelse: { type: "string" }
        },
        required: ["kode", "betegnelse", "begrundelse"],
        additionalProperties: false
      }
    },
    soegeord: { type: "array", items: { type: "string" } },
    afgraensning: {
      type: "object",
      properties: {
        omfatter: { type: "array", items: { type: "string" } },
        omfatterIkke: { type: "array", items: { type: "string" } }
      },
      required: ["omfatter", "omfatterIkke"],
      additionalProperties: false
    },
    opdelingsforslag: { type: "string" }
  },
  required: ["cpvForslag", "soegeord", "afgraensning", "opdelingsforslag"],
  additionalProperties: false
};

type Node = Record<string, unknown>;

function tekst(v: unknown): string {
  if (typeof v !== "string") return "";
  // Modellen skriver hård bindestreg (U+2011) i sammensatte ord — "it‑drift",
  // "backup‑service". Den ligner en bindestreg, men er et andet tegn, og et
  // søgeord med den i rammer intet i nomenklaturen. Samme for tankestreger.
  return v.replace(/[\u2010-\u2015]/g, "-").trim().slice(0, MAKS_TEKST);
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Brug POST." }, { status: 405 });
  }

  let krop: Record<string, unknown>;
  try {
    krop = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i kroppen." }, { status: 400 });
  }

  const behov = (krop.behov ?? {}) as Record<string, unknown>;
  const hvad = tekst(behov.hvad);
  if (hvad.length < 5) {
    return json({ error: "Beskriv hvad der skal anskaffes (mindst et par ord)." }, { status: 400 });
  }

  // Kun de felter, der siger noget om markedet. Den nuværende leverandørs navn
  // sendes ikke med: det ville trække forslaget mod den leverandørs profil
  // frem for mod behovet.
  const beskrivelse = [
    // Titlen står FØRST, fordi den ofte er det eneste sted, fagområdet er
    // nævnt. "Driftsleverandør til hel stack" uden titlen "IT infrastruktur"
    // blev læst som bygningsdrift og gav Drift af losseplads og Anlæg af
    // kloakker (konstateret 2026-10-27). Ordregiveren skriver fagområdet i
    // titlen og gentager det sjældent i beskrivelsen.
    tekst(krop.titel) && `Udbuddets titel: ${tekst(krop.titel)}`,
    `Hvad skal anskaffes: ${hvad}`,
    // Størrelsesordenen afgør, hvilket niveau i nomenklaturen der er det
    // rigtige: en aftale til 600 mio. over otte år er en hel driftsstak, ikke
    // en enkeltydelse.
    Number(krop.anslaaetVaerdi) > 0 &&
      `Anslået samlet kontraktværdi: ${Math.round(Number(krop.anslaaetVaerdi))} DKK`,
    tekst(behov.formaal) && `Formål: ${tekst(behov.formaal)}`,
    tekst(behov.geografi) && `Leveringssted: ${tekst(behov.geografi)}`,
    behov.varighedAar && `Kontraktens varighed: ${Number(behov.varighedAar)} år`,
    tekst(behov.saerligeKrav) && `Særlige krav: ${tekst(behov.saerligeKrav)}`,
    behov.opdeling === "ja" && "Ordregiveren overvejer delkontrakter.",
    behov.opdeling === "nej" && "Ordregiveren forventer ét samlet udbud."
  ]
    .filter(Boolean)
    .join("\n");

  const resultat = await callGroqStructured({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: beskrivelse }
    ],
    responseFormat: { name: "markedsforslag", schema: SCHEMA },
    // GPT-OSS er en ræsonnerende model, og tænke-tokenne tæller MED i
    // max_completion_tokens. Med 1500 og fuld ræsonnering brugte modellen
    // budgettet op, før JSON'en var skrevet færdig, og Groq svarede 400:
    // "max completion tokens reached before generating a valid document"
    // (genskabt 2026-10-27 med en fyldig behovsbeskrivelse — en kort slap
    // igennem, hvilket er grunden til at det ikke blev fanget med det samme).
    //
    // Derfor begge dele: lav ræsonnering, fordi opgaven er at slå koder op og
    // ikke at tænke langt, og et loft med luft til at svaret faktisk kan blive
    // færdigt. Selve dokumentet er bundet af systemprompten (2-5 koder, 3-6
    // søgeord, 1-4 punkter pr. liste) og fylder et par hundrede tokens.
    reasoningEffort: "low",
    maxTokens: 4096
  });

  if (!resultat.ok) {
    return json({ error: resultat.message }, { status: resultat.status });
  }

  let forslag: {
    cpvForslag: { kode: string; betegnelse: string; begrundelse: string }[];
    soegeord: string[];
    afgraensning: { omfatter: string[]; omfatterIkke: string[] };
    opdelingsforslag: string;
  };
  try {
    forslag = JSON.parse(resultat.content);
  } catch {
    return json({ error: "Kunne ikke fortolke modellens svar som JSON." }, { status: 502 });
  }

  // ------------------------------------------------ valider koderne
  // "72222300-0" afkortes ved bindestregen, ligesom i marked-vindere.
  const foreslaaede = (forslag.cpvForslag ?? [])
    .map((f) => ({
      kode: String(f.kode).split("-")[0].trim(),
      modellensBetegnelse: tekst(f.betegnelse),
      begrundelse: tekst(f.begrundelse)
    }))
    .filter((f) => ER_CPV.test(f.kode))
    .slice(0, 8);

  const { data: fundne, error: opslagFejl } = await supabase
    .from("cpv_koder")
    .select("kode, tekst")
    .in("kode", foreslaaede.length ? foreslaaede.map((f) => f.kode) : ["-"]);

  if (opslagFejl) {
    return json({ error: `CPV-opslag fejlede: ${opslagFejl.message}` }, { status: 500 });
  }

  const betegnelse = new Map((fundne ?? []).map((r: Node) => [String(r.kode), String(r.tekst)]));
  const set = new Set<string>();
  const cpvForslag: { kode: string; tekst: string; begrundelse: string }[] = [];
  const kasserede: {
    kode: string;
    grund: "findes-ikke" | "betegnelse-passer-ikke";
    modellensBetegnelse: string;
    tabellensBetegnelse: string | null;
  }[] = [];

  for (const f of foreslaaede) {
    if (set.has(f.kode)) continue;
    set.add(f.kode);

    const tabellens = betegnelse.get(f.kode) ?? null;
    if (tabellens == null) {
      kasserede.push({
        kode: f.kode,
        grund: "findes-ikke",
        modellensBetegnelse: f.modellensBetegnelse,
        tabellensBetegnelse: null
      });
      continue;
    }

    if (!betegnelsenPasser(f.modellensBetegnelse, tabellens)) {
      kasserede.push({
        kode: f.kode,
        grund: "betegnelse-passer-ikke",
        modellensBetegnelse: f.modellensBetegnelse,
        tabellensBetegnelse: tabellens
      });
      continue;
    }

    // Betegnelsen kommer fra tabellen, aldrig fra modellen — modellens egen
    // har gjort sit arbejde nu, hvor den er brugt til at efterprøve koden.
    cpvForslag.push({ kode: f.kode, tekst: tabellens, begrundelse: f.begrundelse });
  }

  // ------------------------------------------------ byg kandidatpuljen
  // Modellens KODER er upålidelige, men dens BETEGNELSER er som regel rigtige:
  // den kaldte 90730000 for "Rengøring af offentlige bygninger" og 30213100
  // for "Servere" — forkerte koder, men præcise beskrivelser af det søgte.
  // Derfor søges der på betegnelserne ved siden af søgeordene. Puljen må gerne
  // indeholde skrald; den bliver sorteret af modellen i andet trin.
  const soegetekster = [
    ...new Set(
      [
        ...(forslag.soegeord ?? []).map((o) => tekst(o)),
        ...foreslaaede.map((f) => f.modellensBetegnelse)
      ]
        .map((o) => o.trim())
        .filter((o) => o.length >= 3)
    )
  ].slice(0, 12);

  const traf = await Promise.all(
    soegetekster.map(async (ord) => {
      const { data } = await supabase.rpc("soeg_cpv", { soegetekst: ord, maks: 6 });
      return ((data ?? []) as Node[]).map((r) => ({
        kode: String(r.kode),
        tekst: String(r.tekst),
        soegeord: ord
      }));
    })
  );

  const pulje = traf.flat().filter((t) => !set.has(t.kode) && set.add(t.kode)).slice(0, 40);

  // ------------------------------------------------ trin 2: modellen VÆLGER
  // Hele grunden til at dette trin findes: en sprogmodel kan ikke huske
  // ottecifrede koder, men den kan godt pege på de rigtige blandt en liste.
  // Her kan den per konstruktion ikke ramme forbi — den må kun svare med
  // koder, der står i puljen, og det efterprøves.
  const valgte: { kode: string; tekst: string; begrundelse: string }[] = [];
  if (pulje.length) {
    const puljetekst = pulje.map((k) => `${k.kode} ${k.tekst}`).join("\n");
    const valg = await callGroqStructured({
      model: MODEL,
      messages: [
        { role: "system", content: VAELG_PROMPT },
        { role: "user", content: `BEHOVET:\n${beskrivelse}\n\nKANDIDATKODER:\n${puljetekst}` }
      ],
      responseFormat: { name: "kodevalg", schema: VAELG_SCHEMA },
      reasoningEffort: "low",
      maxTokens: 4096
    });

    if (valg.ok) {
      try {
        const svar = JSON.parse(valg.content) as { valg: { kode: string; begrundelse: string }[] };
        const iPuljen = new Map(pulje.map((k) => [k.kode, k.tekst]));
        const set2 = new Set<string>();
        for (const v of svar.valg ?? []) {
          const kode = String(v.kode).split("-")[0].trim();
          const tabellens = iPuljen.get(kode);
          // Finder modellen på en kode, der ikke stod i puljen, ryger den —
          // så er vi tilbage ved at den husker frem for at vælge.
          if (!tabellens || set2.has(kode)) continue;
          set2.add(kode);
          valgte.push({ kode, tekst: tabellens, begrundelse: tekst(v.begrundelse) });
        }
      } catch {
        // Et ufortolkeligt valg skal ikke vælte forslaget: puljen står
        // stadig som søgeforslag, og ordregiveren kan vælge selv.
      }
    }
  }

  // Trin 2's valg står forrest. Modellens egne koder, der overlevede
  // betegnelsestjekket, lægges efter — de er efterprøvet, bare ikke udvalgt.
  const valgteSet = new Set(valgte.map((v) => v.kode));
  const samletForslag = [...valgte, ...cpvForslag.filter((f) => !valgteSet.has(f.kode))].slice(0, 6);

  const iForslag = new Set(samletForslag.map((f) => f.kode));
  const flereMuligheder = pulje.filter((k) => !iForslag.has(k.kode)).slice(0, 12);

  return json({
    cpvForslag: samletForslag,
    flereMuligheder,
    // Hvor mange af modellens egne koder der blev sorteret fra. Står i UI'et,
    // så ordregiveren kan se, at listen er filtreret — ikke bare kortere.
    // Tallet beholdes som tal af hensyn til UI'et; kasserede har detaljerne,
    // så en forkert sortering kan ses frem for at skulle gættes.
    kasseredeKoder: kasserede.length,
    kasserede,
    afgraensning: {
      omfatter: (forslag.afgraensning?.omfatter ?? []).map(tekst).filter(Boolean).slice(0, 4),
      omfatterIkke: (forslag.afgraensning?.omfatterIkke ?? []).map(tekst).filter(Boolean).slice(0, 4)
    },
    opdelingsforslag: tekst(forslag.opdelingsforslag),
    model: MODEL
  });
});
