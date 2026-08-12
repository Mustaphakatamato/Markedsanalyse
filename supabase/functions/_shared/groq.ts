// Fælles Groq-klient — OpenAI-kompatibelt chat completions-endpoint
// (https://api.groq.com/openai/v1/chat/completions), verificeret direkte mod
// Groqs egen dokumentation før noget blev bygget. Bruges af bid-gonogo og
// bid-questions.
//
// Gratis tier (verificeret): 30 req/min på begge modeller vi bruger,
// 1.000 req/dag på openai/gpt-oss-120b, 14.400 req/dag på
// llama-3.1-8b-instant. Rigeligt til personlig, manuel brug — men kaldene
// SKAL fejle pænt (ikke crashe siden) hvis grænsen alligevel rammes en dag,
// derfor den eksplicitte 429-håndtering nedenfor.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export interface GroqMessage {
  role: "system" | "user";
  content: string;
}

export interface GroqStructuredRequest {
  model: string;
  messages: GroqMessage[];
  // JSON Schema strict mode: alle felter i schema SKAL være i required,
  // og objekter skal have additionalProperties:false — Groqs egen
  // begrænsning for constrained decoding, ikke noget vi vælger til.
  responseFormat: { name: string; schema: Record<string, unknown> };
  reasoningEffort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export type GroqResult =
  | { ok: true; content: string }
  | { ok: false; status: number; message: string };

export async function callGroqStructured(req: GroqStructuredRequest): Promise<GroqResult> {
  const apiKey = Deno.env.get("GROQ_API_KEY") ?? "";
  if (!apiKey) {
    return { ok: false, status: 500, message: "GROQ_API_KEY er ikke sat som secret." };
  }

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    max_completion_tokens: req.maxTokens ?? 2048,
    response_format: {
      type: "json_schema",
      json_schema: { name: req.responseFormat.name, strict: true, schema: req.responseFormat.schema }
    }
  };
  if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;

  let upstream: Response;
  try {
    upstream = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    return { ok: false, status: 502, message: `Kunne ikke nå Groq: ${(err as Error).message}` };
  }

  if (upstream.status === 429) {
    return {
      ok: false,
      status: 429,
      message: "Groqs gratis kvote er nået lige nu (30 kald/min eller dagsgrænsen) — prøv igen om lidt."
    };
  }

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return { ok: false, status: upstream.status, message: `Groq svarede ${upstream.status}: ${errText.slice(0, 300)}` };
  }

  const data = await upstream.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, status: 502, message: "Groq svarede uden indhold." };
  }

  return { ok: true, content };
}
