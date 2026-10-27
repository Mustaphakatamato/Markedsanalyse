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
const MAKS_TEKST = 4000;

const SYSTEM_PROMPT = `Du hjælper en dansk offentlig ordregiver med at afgrænse leverandørmarkedet før et udbud.

Du får ordregiverens behovsbeskrivelse. Svar med:
- cpvForslag: 2-5 CPV-koder (otte cifre, uden kontrolciffer) der dækker det, der skal KØBES. Foretræk koder på det niveau, hvor markedet typisk byder — ikke for bredt (hele hovedgrupper) og ikke for smalt. Hver kode får en begrundelse på én sætning, der henviser til behovet.
- soegeord: 3-6 korte danske søgeord, sådan som de står i CPV-nomenklaturens betegnelser (fx "rengøring", "vinduespudsning", "kantinedrift").
- afgraensning.omfatter og afgraensning.omfatterIkke: hver 1-4 korte punkter om hvad markedet dækker, og hvad der ligger tæt på men uden for.
- opdelingsforslag: én eller to sætninger om opgaven naturligt kan deles i delkontrakter (geografisk, fagligt eller efter størrelse) — eller en tom streng, hvis behovet ikke giver grundlag for at sige noget.

Opfind ikke oplysninger, der ikke står i behovet. Svar altid på dansk.`;

const SCHEMA = {
  type: "object",
  properties: {
    cpvForslag: {
      type: "array",
      items: {
        type: "object",
        properties: { kode: { type: "string" }, begrundelse: { type: "string" } },
        required: ["kode", "begrundelse"],
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
  return typeof v === "string" ? v.trim().slice(0, MAKS_TEKST) : "";
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
    `Hvad skal anskaffes: ${hvad}`,
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
    maxTokens: 1500
  });

  if (!resultat.ok) {
    return json({ error: resultat.message }, { status: resultat.status });
  }

  let forslag: {
    cpvForslag: { kode: string; begrundelse: string }[];
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
    .map((f) => ({ kode: String(f.kode).split("-")[0].trim(), begrundelse: tekst(f.begrundelse) }))
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
  const cpvForslag = foreslaaede
    .filter((f) => betegnelse.has(f.kode) && !set.has(f.kode) && set.add(f.kode))
    .map((f) => ({ kode: f.kode, tekst: betegnelse.get(f.kode)!, begrundelse: f.begrundelse }));

  // ------------------------------------------------ søgeord → rigtige koder
  const soegeord = [...new Set((forslag.soegeord ?? []).map((o) => tekst(o)).filter((o) => o.length >= 3))]
    .slice(0, 6);

  const traf = await Promise.all(
    soegeord.map(async (ord) => {
      const { data } = await supabase.rpc("soeg_cpv", { soegetekst: ord, maks: 4 });
      return ((data ?? []) as Node[]).map((r) => ({
        kode: String(r.kode),
        tekst: String(r.tekst),
        soegeord: ord
      }));
    })
  );

  const flereMuligheder = traf
    .flat()
    .filter((t) => !set.has(t.kode) && set.add(t.kode))
    .slice(0, 12);

  return json({
    cpvForslag,
    flereMuligheder,
    // Hvor mange af modellens egne koder der ikke fandtes. Står i UI'et, så
    // ordregiveren kan se, at listen er filtreret — ikke bare kortere.
    kasseredeKoder: Math.max((forslag.cpvForslag?.length ?? 0) - cpvForslag.length, 0),
    afgraensning: {
      omfatter: (forslag.afgraensning?.omfatter ?? []).map(tekst).filter(Boolean).slice(0, 4),
      omfatterIkke: (forslag.afgraensning?.omfatterIkke ?? []).map(tekst).filter(Boolean).slice(0, 4)
    },
    opdelingsforslag: tekst(forslag.opdelingsforslag),
    model: MODEL
  });
});
