// Go/No-Go-vurdering af et konkret udbud, mod egne, verificerede tal —
// svarer til Budpiloten.dks "6-fase AI-analyse" med konfidensscore, men
// bevidst simplere: ÉT strukturet kald, ingen automatisk
// opfylder/opfylder-ikke-facit (se samme begrundelse som
// tedNoticeService.getTenderRequirements: egnethedskrav er fri tekst uden
// noget struktureret talfelt at facittjekke imod).
//
// Modellen får AL sin viden fra request-bodyen — intet andet. Den bedes
// eksplicit flage manglende data i stedet for at gætte, samme "falske
// positiver er værre end oversete"-disciplin som resten af appen
// (sanktionstjekket, TED-matching).

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { callGroqStructured } from "../_shared/groq.ts";

const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `Du er en erfaren udbudsrådgiver der vurderer om en dansk IT/konsulentvirksomhed bør byde på et konkret EU-udbud.

Du får to ting:
1. Udbuddets egnethedskrav — ordregiverens EGEN, ukommenterede tekst. Det er IKKE et struktureret talfelt: hvis der findes konkrete tal (minimumsomsætning, antal referencer osv.), står de i selve teksten, ikke andre steder.
2. Virksomhedens egne, verificerede tal: seneste regnskab, branchesammenligning, og deres egen TED-vindshistorik.

Regler, som du skal følge strengt:
- Basér UDELUKKENDE din vurdering på de leverede data. Opfind ALDRIG tal, referencer, certificeringer eller andre fakta der ikke er givet dig.
- Er et krav uklart, eller mangler der data til at vurdere det, skal det stå EKSPLICIT i missing_data — gæt aldrig i stedet.
- "go" betyder du vurderer de læste krav som opfyldelige ud fra de givne tal. "no-go" betyder mindst ét konkret krav ikke kan opfyldes ud fra de givne tal. "usikkert" bruges når data er for tynd til en klar konklusion — det er et gyldigt og ofte det ærligste svar, ikke en fiasko.
- confidence afspejler hvor sikker DU er i selve vurderingen givet datagrundlaget — IKKE hvor godt virksomheden står. Tynd eller upræcis kravtekst giver lav confidence, uanset hvilken konklusion du lander på.
- reasoning skal være kort (3-6 sætninger), konkret, og henvise til de faktiske tal og krav du fik — ingen generiske fraser.
- key_points er 2-5 korte punkter (hver under 15 ord) der opsummerer de vigtigste faktorer.
- Svar altid på dansk, uanset hvilket sprog kildeteksten er på.`;

const SCHEMA = {
  type: "object",
  properties: {
    recommendation: { type: "string", enum: ["go", "no-go", "usikkert"] },
    confidence: { type: "string", enum: ["høj", "middel", "lav"] },
    reasoning: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    missing_data: { type: "array", items: { type: "string" } }
  },
  required: ["recommendation", "confidence", "reasoning", "key_points", "missing_data"],
  additionalProperties: false
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  let body: { requirements?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i request body." }, { status: 400 });
  }

  if (!body.requirements || !body.company) {
    return json({ error: "Både 'requirements' og 'company' skal angives." }, { status: 400 });
  }

  const userMessage = [
    "## Udbuddets egnethedskrav",
    JSON.stringify(body.requirements, null, 2),
    "",
    "## Virksomhedens egne tal",
    JSON.stringify(body.company, null, 2)
  ].join("\n");

  const result = await callGroqStructured({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage }
    ],
    responseFormat: { name: "go_no_go_vurdering", schema: SCHEMA },
    reasoningEffort: "high",
    maxTokens: 1500
  });

  if (!result.ok) {
    return json({ error: result.message }, { status: result.status });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    return json({ error: "Kunne ikke fortolke Groqs svar som JSON." }, { status: 502 });
  }

  return new Response(JSON.stringify(parsed), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
});
