// Udkast til besvarelse af ÉT konkret krav/tildelingskriterie — svarer til
// Budpiloten.dks "Dokumentgenerering / Kravbesvarelse", men afgrænset til ét
// krav ad gangen (brugerstyret, samme mønster som bid-gonogo/bid-questions)
// frem for at generere et helt tilbudsdokument i ét hug.
//
// To slags krav kan sendes ind (se `kind`), og de skal besvares med
// forskellig tone:
// - "egnethed" (M-krav): et compliance-udsagn — "vi opfylder dette fordi X".
// - "tildeling" (K-krav): et differentierende salgsargument til selve
//   tilbuddet — hvad gør VORES besvarelse stærk på netop dette kriterie.
//
// Samme "aldrig gæt, flag i stedet"-disciplin som resten af AI-featurerne:
// modellen får KUN de tal/fakta der står i company-objektet. Mangler den
// noget for at kunne skrive et konkret udsagn (fx en navngiven reference,
// et CV, et certifikat-nummer), skal den sætte en tydelig placeholder
// direkte i teksten (fx "[INDSÆT: navn på reference]") OG liste det samme i
// needs_input — aldrig opfinde en reference eller et tal for at få teksten
// til at lyde færdig.

import { CORS_HEADERS, handlePreflight, json } from "../_shared/http.ts";
import { callGroqStructured } from "../_shared/groq.ts";

const MODEL = "openai/gpt-oss-120b";

const SYSTEM_PROMPT = `Du hjælper en dansk IT/konsulentvirksomhed med at skrive et UDKAST til besvarelse af ét konkret krav eller tildelingskriterie i et EU-udbud. Udkastet er et arbejdsgrundlag brugeren selv redigerer videre på — ikke en færdig, indleveringsklar tekst.

Du får: selve kravteksten (og om det er et egnethedskrav ("egnethed") eller tildelingskriterie ("tildeling")), lidt kontekst om udbuddet, og virksomhedens egne, verificerede tal/data.

Regler, som du skal følge strengt:
- Basér udkastet UDELUKKENDE på de leverede data. Opfind ALDRIG referencer, kundenavne, CV'er, certificeringer, projekter eller tal der ikke er givet dig.
- Mangler der en konkret detalje for at kunne skrive et fuldt udsagn (fx "navn på reference", "årstal for certificering", "antal årsværk"), sæt en tydelig placeholder direkte i teksten i formatet [INDSÆT: hvad der mangler]. I needs_input skal du liste den SAMME manglende detalje, men UDEN klammerne og "INDSÆT:"-præfikset — kun selve beskrivelsen af hvad der mangler (fx "navn på reference", ikke "[INDSÆT: navn på reference]"). Lad aldrig en placeholder mangle et af stederne.
- Er kravet et egnethedskrav ("egnethed"): skriv et kort compliance-udsagn — hvordan og hvorfor virksomheden opfylder kravet, med reference til de faktiske tal du fik.
- Er kravet et tildelingskriterie ("tildeling"): skriv et kort udkast til et differentierende salgsargument — hvad gør virksomhedens besvarelse stærk på netop dette kriterie, baseret på de faktiske data du fik.
- draftAnswer skal være 3-8 sætninger, konkret, og direkte brugbar som udgangspunkt for tilbudsteksten — ingen generiske fraser eller floskler.
- Svar altid på dansk, uanset hvilket sprog kildeteksten er på.`;

const SCHEMA = {
  type: "object",
  properties: {
    draftAnswer: { type: "string" },
    needs_input: { type: "array", items: { type: "string" } }
  },
  required: ["draftAnswer", "needs_input"],
  additionalProperties: false
};

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return json({ error: "Kun POST understøttes." }, { status: 405 });
  }

  let body: { requirement?: { kind?: string }; tenderContext?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ugyldig JSON i request body." }, { status: 400 });
  }

  if (!body.requirement || !body.company) {
    return json({ error: "Både 'requirement' og 'company' skal angives." }, { status: 400 });
  }
  if (body.requirement.kind !== "egnethed" && body.requirement.kind !== "tildeling") {
    return json({ error: "'requirement.kind' skal være 'egnethed' eller 'tildeling'." }, { status: 400 });
  }

  const userMessage = [
    "## Kravet der skal besvares",
    JSON.stringify(body.requirement, null, 2),
    "",
    "## Kontekst om udbuddet",
    JSON.stringify(body.tenderContext || {}, null, 2),
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
    responseFormat: { name: "kravbesvarelse_udkast", schema: SCHEMA },
    maxTokens: 1200
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
