// Agenten bag kontraktopslaget: fri tekst ind, konkrete TED-kandidater ud.
//
// ARBEJDSDELINGEN ER BEVIDST, og den er hele pointen med funktionen:
//
//   Sprogmodellen LÆSER kun brugerens besked og udfylder et skema
//   (cvr, kontraktnavn, ordregiver, årstal). Den får ALDRIG lov til at
//   producere fakta om kontrakten.
//
//   Koden SØGER i TED ud fra de felter og rangerer træffene. Alle tal, navne
//   og datoer i svaret kommer fra TED, ikke fra modellen.
//
// Samme disciplin som bid-gonogo: en model, der gætter et kontraktnummer eller
// en værdi, leverer noget, der ligner et rigtigt svar — og den fejl er værre
// end intet svar. Derfor er modellens output her udelukkende SØGEKRITERIER,
// som kan verificeres ved, at søgningen enten rammer noget eller ikke gør.
//
// Frontend'en henter selve kontraktdetaljen (den fulde eForms-XML) og
// leverandørens regnskabstal bagefter gennem de services, der allerede findes
// — se kontraktAgentService.js. Funktionen her stopper ved kandidatlisten,
// så den forbliver hurtig og har ét ansvar.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { callGroqStructured } from "../_shared/groq.ts";

const TED_URL = "https://api.ted.europa.eu/v3/notices/search";

// Samme model som bid-questions: opgaven er at læse en kort besked og udfylde
// fire felter. Det kræver ikke det store ræsonnement, så loftet er lavt og
// reasoning_effort sættes ikke.
const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `Du læser en besked fra en udbudsrådgiver, der leder efter en konkret kontrakt i TED (EU's udbudsdatabase). Din ENESTE opgave er at udfylde søgekriterierne nedenfor ud fra beskeden.

Du må IKKE svare på spørgsmålet, vurdere noget, eller finde på oplysninger om kontrakten. Du udfylder et søgeskema — intet andet.

Felterne:
- cvr: Et dansk CVR-nummer, hvis beskeden indeholder et. Præcis 8 cifre, uden mellemrum. Ellers tom streng.
- kontraktnavn: Den del af beskeden, der er selve kontraktens eller udbuddets navn. Tag ordene som de står — oversæt, forkort eller omformuler ALDRIG. Ellers tom streng.
- ordregiver: Navnet på den myndighed, der har udbudt, hvis beskeden nævner en. Ellers tom streng.
- aar: Et årstal, hvis beskeden nævner et. Fire cifre. Ellers tom streng.
- kommentar: Én kort dansk sætning om, hvad du forstod beskeden som. Nævn kun de felter, du rent faktisk udfyldte.

Vigtigt om CVR: et CVR-nummer i beskeden hører som udgangspunkt til LEVERANDØREN (den virksomhed, der har vundet eller budt), medmindre beskeden tydeligt siger, at det er ordregiverens.

Står der ingenting brugbart i beskeden, så lad felterne være tomme og forklar i kommentar, hvad du mangler.`;

const SCHEMA = {
  type: "object",
  properties: {
    cvr: { type: "string" },
    kontraktnavn: { type: "string" },
    ordregiver: { type: "string" },
    aar: { type: "string" },
    kommentar: { type: "string" }
  },
  required: ["cvr", "kontraktnavn", "ordregiver", "aar", "kommentar"],
  additionalProperties: false
};

// De felter kandidatlisten skal kunne vises ud fra. Holdt nede: hvert ekstra
// felt koster svar-bytes på tværs af alle træf, og detaljerne hentes alligevel
// fra den fulde XML, når brugeren vælger en kontrakt.
const RESULT_FIELDS = [
  "publication-number",
  "publication-date",
  "notice-title",
  "notice-type",
  "winner-name",
  "buyer-name",
  "organisation-identifier-buyer",
  "organisation-identifier-tenderer",
  "total-value",
  "total-value-cur"
];

const ER_CVR = /^\d{8}$/;
const ER_AAR = /^\d{4}$/;

// TED's forespørgselssprog bruger dobbelte anførselstegn som fraseafgrænser.
function escapeFrase(v: string): string {
  return v.replace(/"/g, '\\"');
}

// Ord der optræder i næsten enhver dansk udbudstitel og derfor ikke
// afgrænser noget. Uden listen ville "kontrakt om rengøring" søge på
// "kontrakt", som rammer alt.
const STOPORD = new Set([
  "kontrakt", "kontrakten", "udbud", "udbuddet", "aftale", "aftalen",
  "rammeaftale", "rammeaftalen", "delaftale", "til", "for", "og", "om",
  "med", "af", "pa", "på", "den", "det", "en", "et", "der", "som", "programmet"
]);

// Titelsøgningen bruger ~ (fuzzy) frem for = (eksakt frase). Verificeret mod
// API'et: notice-title~"konsulenter" giver 106 træf, notice-title="konsulenter"
// kun 56. Agenten skal have bred recall og så rangere — en kontrakt, brugeren
// husker navnet på omtrentligt, skal stadig kunne findes.
function titelLed(kontraktnavn: string): string[] {
  const ord = kontraktnavn
    .split(/\s+/)
    .map((o) => o.replace(/[^\p{L}\p{N}-]/gu, ""))
    .filter((o) => o.length >= 3 && !STOPORD.has(o.toLowerCase()))
    // Maks. 4 led: flere gør forespørgslen smal nok til at en enkelt
    // stavefejl i brugerens besked giver nul træf.
    .slice(0, 4);

  // Hele navnet som frase først — rammer den, er det det mest præcise træf.
  const led: string[] = [];
  if (kontraktnavn.trim().length >= 3) {
    led.push(`notice-title~"${escapeFrase(kontraktnavn.trim())}"`);
  }
  for (const o of ord) led.push(`notice-title~"${escapeFrase(o)}"`);
  return led;
}

async function soegTed(query: string, limit: number) {
  const svar = await fetch(TED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, fields: RESULT_FIELDS, page: 1, limit })
  });

  if (!svar.ok) {
    const tekst = await svar.text().catch(() => "");
    throw new Error(`TED svarede HTTP ${svar.status}${tekst ? `: ${tekst.slice(0, 160)}` : ""}`);
  }

  const data = await svar.json();
  return {
    notices: (data.notices ?? []) as Record<string, unknown>[],
    total: (data.totalNoticeCount ?? 0) as number
  };
}

// Sprog-keyede felter: { "dan": ["Navn"] } eller { "dan": "Tekst" }. Alle
// sprogvarianter samles, fordi nøglerækkefølgen er vilkårlig og et match
// sagtens kan ligge under et andet sprog end det første.
function alleTekster(felt: unknown): string {
  if (!felt) return "";
  if (typeof felt === "string") return felt;
  if (Array.isArray(felt)) return felt.join(" ");
  if (typeof felt === "object") {
    return Object.values(felt as Record<string, unknown>)
      .map((v) => (Array.isArray(v) ? v.join(" ") : String(v ?? "")))
      .join(" ");
  }
  return "";
}

// notice-title er skabelon-genereret: "Land – CPV-kategori – Projektnavn".
// Kun sidste led er substantielt; resten går igen på tværs af tusindvis af
// urelaterede notices.
function pæntTitel(felt: unknown): string {
  if (!felt) return "";
  const obj = felt as Record<string, unknown>;
  const raa = typeof felt === "string" ? felt : (obj.dan ?? Object.values(obj)[0]);
  const tekst = Array.isArray(raa) ? raa[0] : raa;
  if (!tekst) return "";
  const dele = String(tekst).split(" – ");
  return dele.length > 1 ? dele[dele.length - 1] : String(tekst);
}

function navneListe(felt: unknown): string[] {
  if (!felt) return [];
  if (Array.isArray(felt)) return felt.map(String);
  if (typeof felt === "object") {
    const v = Object.values(felt as Record<string, unknown>)[0];
    return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  }
  return [String(felt)];
}

function somListe(felt: unknown): string[] {
  if (!felt) return [];
  return (Array.isArray(felt) ? felt : [felt]).map(String);
}

function normaliser(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Kandidat {
  publikationsnummer: string | null;
  dato: string | null;
  art: string | null;
  titel: string;
  vindere: string[];
  ordregiver: string;
  ordregiverCvr: string[];
  tilbudsgiverCvr: string[];
  vaerdi: number | null;
  valuta: string | null;
  // Hvorfor denne kandidat kom med, og hvor sikkert træffet er. Vises i
  // UI'et, så brugeren kan se forskel på et CVR-træf og et løst titelmatch.
  erVinder: boolean;
  score: number;
  url: string | null;
}

function tilKandidat(n: Record<string, unknown>, cvr: string): Kandidat {
  const publikationsnummer = (n["publication-number"] as string) ?? null;
  const vindere = navneListe(n["winner-name"]);
  const tilbudsgiverCvr = somListe(n["organisation-identifier-tenderer"]);
  const valuta = somListe(n["total-value-cur"])[0] ?? null;

  return {
    publikationsnummer,
    dato: ((n["publication-date"] as string) ?? "").slice(0, 10) || null,
    art: (n["notice-type"] as string) ?? null,
    titel: pæntTitel(n["notice-title"]),
    vindere,
    ordregiver: navneListe(n["buyer-name"]).join(", "),
    ordregiverCvr: somListe(n["organisation-identifier-buyer"]),
    tilbudsgiverCvr,
    vaerdi: typeof n["total-value"] === "number" ? (n["total-value"] as number) : null,
    valuta,
    // Et CVR-træf betyder IKKE at virksomheden vandt — feltet dækker alle
    // tilbudsgivere. Målt på Atea A/S: 47 af 50 notices var reelle sejre,
    // resten var en kontrakt en konkurrent vandt, en VEAT og en
    // kontraktændring. Derfor afgøres sejren på vinderfeltet, ikke på CVR'et.
    erVinder: cvr ? tilbudsgiverCvr.includes(cvr) && vindere.length > 0 : vindere.length > 0,
    score: 0,
    url: publikationsnummer
      ? `https://ted.europa.eu/da/notice/${publikationsnummer}/pdf`
      : null
  };
}

// Rangeringen er ren kode, ikke en model: brugeren skal kunne regne ud,
// hvorfor et træf ligger øverst.
function scor(k: Kandidat, kriterier: { kontraktnavn: string; ordregiver: string; aar: string }) {
  let score = 0;

  if (kriterier.kontraktnavn) {
    const navn = normaliser(kriterier.kontraktnavn);
    const titel = normaliser(k.titel);
    if (navn && titel.includes(navn)) score += 100;
    else {
      // Delvist: hvor mange af navnets ord står i titlen.
      const ord = navn.split(" ").filter((o) => o.length >= 3);
      const traf = ord.filter((o) => titel.includes(o)).length;
      if (ord.length) score += Math.round((traf / ord.length) * 60);
    }
  }

  if (kriterier.ordregiver) {
    const og = normaliser(kriterier.ordregiver);
    if (og && normaliser(k.ordregiver).includes(og)) score += 30;
  }

  if (kriterier.aar && k.dato?.startsWith(kriterier.aar)) score += 20;

  // En tildeling, hvor virksomheden faktisk står som vinder, er næsten altid
  // det, brugeren leder efter.
  if (k.erVinder) score += 25;

  return score;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  let krop: { besked?: unknown };
  try {
    krop = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i request body." }, { status: 400 });
  }

  const besked = typeof krop.besked === "string" ? krop.besked.trim().slice(0, 1000) : "";
  if (!besked) {
    return json({ error: "Feltet 'besked' skal være en ikke-tom tekst." }, { status: 400 });
  }

  // ---- Trin 1: modellen læser beskeden og udfylder søgeskemaet -----------

  const svar = await callGroqStructured({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: besked }
    ],
    responseFormat: { name: "soegekriterier", schema: SCHEMA },
    maxTokens: 1200
  });

  if (!svar.ok) {
    return json({ error: svar.message }, { status: svar.status });
  }

  let kriterier: { cvr: string; kontraktnavn: string; ordregiver: string; aar: string; kommentar: string };
  try {
    kriterier = JSON.parse(svar.content);
  } catch {
    return json({ error: "Modellen svarede ikke med gyldig JSON." }, { status: 502 });
  }

  // Modellens felter valideres som det, de er: ubekræftet input. Et CVR på
  // syv cifre eller et årstal som "sidste år" skal falde bort her frem for at
  // blive sendt videre til TED og give et tomt resultat, der ligner et svar.
  const cvr = ER_CVR.test(kriterier.cvr?.trim() ?? "") ? kriterier.cvr.trim() : "";
  const aar = ER_AAR.test(kriterier.aar?.trim() ?? "") ? kriterier.aar.trim() : "";
  const kontraktnavn = (kriterier.kontraktnavn ?? "").trim().slice(0, 200);
  const ordregiver = (kriterier.ordregiver ?? "").trim().slice(0, 200);

  const fortolkning = { cvr, kontraktnavn, ordregiver, aar, kommentar: (kriterier.kommentar ?? "").trim() };

  if (!cvr && !kontraktnavn && !ordregiver) {
    return json({
      fortolkning,
      kandidater: [],
      forespoergsler: [],
      mangler: "Jeg kunne ikke læse hverken et CVR-nummer, et kontraktnavn eller en ordregiver ud af beskeden."
    });
  }

  // ---- Trin 2: koden søger i TED ----------------------------------------
  //
  // Der søges i FLERE trin fra snævert mod bredt, og der stoppes ved det
  // første trin, der giver træf. Ellers ville et præcist CVR+titel-match
  // drukne i de hundredvis af notices, en titelsøgning alene giver.

  const cvrLed = cvr ? `organisation-identifier-tenderer=${cvr}` : null;
  const ordregiverLed = ordregiver ? `buyer-name~"${escapeFrase(ordregiver)}"` : null;
  const titler = titelLed(kontraktnavn);

  // Hvert trin bærer HVILKE af brugerens kriterier det faktisk bruger. Uden
  // det kan et svar, der er fundet på et nedgraderet trin, ikke skelnes fra
  // et fuldtræf — og det er den farligste tilstand siden kan være i: tolv
  // urelaterede kontrakter præsenteret som "vælg den rigtige".
  //
  // Verificeret hvorfor det er nødvendigt: CVR 12345678 (en oplagt
  // pladsholder) giver 28 træf i TED — irske, tyske og hollandske
  // bekendtgørelser, hvor udbudsskribenten har tastet et dummy-nummer i
  // organisation-identifier-tenderer. Feltet er IKKE et validt dansk
  // CVR-register, det er fritekst med et tal i.
  interface Trin {
    query: string;
    bruger: ("cvr" | "navn" | "ordregiver")[];
  }

  const trin: Trin[] = [];
  if (cvrLed && titler.length) trin.push({ query: [cvrLed, titler[0]].join(" AND "), bruger: ["cvr", "navn"] });
  if (cvrLed && titler.length > 1) {
    trin.push({ query: [cvrLed, titler.slice(1).join(" AND ")].join(" AND "), bruger: ["cvr", "navn"] });
  }
  if (cvrLed && ordregiverLed) {
    trin.push({ query: [cvrLed, ordregiverLed].join(" AND "), bruger: ["cvr", "ordregiver"] });
  }
  if (ordregiverLed && titler.length) {
    trin.push({ query: [ordregiverLed, titler[0]].join(" AND "), bruger: ["ordregiver", "navn"] });
  }
  if (titler.length) trin.push({ query: titler[0], bruger: ["navn"] });
  if (titler.length > 1) trin.push({ query: titler.slice(1).join(" AND "), bruger: ["navn"] });
  // CVR ALENE står bevidst SIDST, ikke før titelsøgningen. Et CVR-træf uden
  // navnematch er det bredeste, vi kan levere — for en storleverandør er det
  // hundredvis af kontrakter — så titlen skal have haft sin chance først.
  if (cvrLed) trin.push({ query: cvrLed, bruger: ["cvr"] });
  if (ordregiverLed) trin.push({ query: ordregiverLed, bruger: ["ordregiver"] });

  // Hvad brugeren faktisk bad om — det, et trin måles imod.
  const oensket: ("cvr" | "navn" | "ordregiver")[] = [];
  if (cvr) oensket.push("cvr");
  if (kontraktnavn) oensket.push("navn");
  if (ordregiver) oensket.push("ordregiver");

  const forespoergsler: { query: string; traf: number }[] = [];
  let notices: Record<string, unknown>[] = [];
  let total = 0;
  let brugte: ("cvr" | "navn" | "ordregiver")[] = [];

  for (const t of trin) {
    const medSort = `${t.query} SORT BY publication-date DESC`;
    let r: { notices: Record<string, unknown>[]; total: number };
    try {
      r = await soegTed(medSort, 40);
    } catch {
      // Et enkelt fejlende trin må ikke vælte opslaget — der er flere at
      // prøve. Fejlen tages med i svaret, så den kan ses i UI'et.
      forespoergsler.push({ query: medSort, traf: -1 });
      continue;
    }
    forespoergsler.push({ query: medSort, traf: r.total });
    if (r.notices.length) {
      notices = r.notices;
      total = r.total;
      brugte = t.bruger;
      break;
    }
  }

  if (!notices.length) {
    return json({
      fortolkning,
      kandidater: [],
      forespoergsler,
      mangler:
        "Ingen bekendtgørelser i TED matcher. Husk at TED først har strukturerede vinderfelter fra " +
        "slutningen af 2023 — er kontrakten ældre, findes den ikke her."
    });
  }

  // ---- Trin 3: rangér og lever -------------------------------------------

  const kandidater = notices
    .map((n) => tilKandidat(n, cvr))
    .map((k) => ({ ...k, score: scor(k, { kontraktnavn, ordregiver, aar }) }))
    .sort((a, b) => b.score - a.score || (b.dato ?? "").localeCompare(a.dato ?? ""))
    .slice(0, 12);

  // Hvilke af brugerens kriterier faldt bort undervejs. Det SKAL med i
  // svaret: uden det ser et nedgraderet resultat ud som et fuldtræf.
  const ETIKET = { cvr: "CVR-nummeret", navn: "kontraktnavnet", ordregiver: "ordregiveren" };
  const udeladte = oensket.filter((k) => !brugte.includes(k));

  const nedgradering = udeladte.length
    ? `Ingen bekendtgørelser matcher alle dine kriterier. ${udeladte
        .map((k) => ETIKET[k])
        .join(" og ")} gav ingen træf, så listen nedenfor er fundet på ` +
      `${brugte.map((k) => ETIKET[k]).join(" og ")} alene — kontrollér, at det overhovedet er den rigtige kontrakt.`
    : null;

  return json({ fortolkning, kandidater, forespoergsler, total, brugte, udeladte, nedgradering, mangler: null });
});
