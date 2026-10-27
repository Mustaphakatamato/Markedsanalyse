// Genererer afklarende spørgsmål til ordregiver ud fra udbuddets egen
// tekst — svarer til Budpiloten.dks "Q&A Intelligence".
//
// Kørte oprindeligt på llama-3.1-8b-instant (billigere/hurtigere til en ren
// generativ opgave), men Groq afviser strict JSON-schema-mode på den model
// — verificeret direkte (400: "This model does not support response format
// json_schema"). Kun GPT-OSS-modellerne understøtter constrained decoding
// på Groq. Skiftet til gpt-oss-120b for at beholde den GARANTEREDE
// JSON-struktur (samme model som bid-gonogo) — stadig gratis tier,
// prisforskellen findes kun på papiret her.
//
// Spørgsmålene er FORSLAG til at sende via udbudsplatformens
// spørgsmål/svar-fane — appen sender intet selv.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { callGroqStructured } from "../_shared/groq.ts";

const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `Du hjælper en tilbudsgiver med at forberede afklarende spørgsmål til en ordregiver, baseret UDELUKKENDE på den udbudstekst du får.

Foreslå 5-8 konkrete, specifikke spørgsmål der:
- Adresserer reelle uklarheder eller huller i den givne tekst — ikke generiske standardspørgsmål der kunne stilles til et hvilket som helst udbud.
- Er formuleret så de kan sendes direkte til ordregiveren via udbudsplatformens spørgsmål/svar-fane.
- Ikke afslører virksomhedens egen strategi eller svagheder.

Opfind ikke krav eller detaljer der ikke står i teksten — spørg til det der reelt er uklart eller mangler.

Svar altid på dansk, uanset hvilket sprog kildeteksten er på.`;

const SCHEMA = {
  type: "object",
  properties: {
    questions: { type: "array", items: { type: "string" } }
  },
  required: ["questions"],
  additionalProperties: false
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  let body: { requirements?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i request body." }, { status: 400 });
  }

  if (!body.requirements) {
    return json({ error: "'requirements' skal angives." }, { status: 400 });
  }

  const result = await callGroqStructured({
    model: MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(body.requirements, null, 2) }
    ],
    responseFormat: { name: "afklarende_spoergsmaal", schema: SCHEMA },
    // Tænke-tokenne tæller MED i max_completion_tokens på GPT-OSS. Et lavt
    // loft rammer derfor ikke et langt svar, men et langt tankeforløb, og
    // Groq svarer 400 "max completion tokens reached before generating a
    // valid document" — se behov-marked, hvor det skete i praksis
    // 2026-10-27. Loftet er hævet frem for at skrue ned for ræsonneringen,
    // så svarets kvalitet er uændret.
    maxTokens: 4096
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
