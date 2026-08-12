// AI-drevet Go/No-Go-vurdering og spørgsmålsgenerering — kører på Groqs
// gratis tier (openai/gpt-oss-120b til vurderingen, llama-3.1-8b-instant til
// spørgsmål), server-side via Edge Functions (bid-gonogo/bid-questions),
// aldrig direkte fra browseren. Se supabase/functions/_shared/groq.ts for
// selve API-kaldet og den fulde begrundelse for modelvalg.
//
// Bevidst IKKE et automatisk opfylder/opfylder-ikke-facit — se
// bid-gonogo/index.ts's systemprompt. Modellen skal flage manglende data
// eksplicit frem for at gætte.

import { postToFunction } from "../lib/apiClient";

/**
 * @param {object} requirements Fra tedNoticeService.getTenderRequirements()
 * @param {object} company Kompakt objekt med virksomhedens egne tal
 * @returns {Promise<{
 *   recommendation: "go"|"no-go"|"usikkert",
 *   confidence: "høj"|"middel"|"lav",
 *   reasoning: string,
 *   key_points: string[],
 *   missing_data: string[]
 * }>}
 */
export async function getGoNoGoAssessment(requirements, company) {
  const response = await postToFunction("/bid-gonogo", { requirements, company });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || `Vurderingen fejlede (HTTP ${response.status})`);
  }
  return data;
}

/**
 * @param {object} requirements Fra tedNoticeService.getTenderRequirements()
 * @returns {Promise<{ questions: string[] }>}
 */
export async function getClarifyingQuestions(requirements) {
  const response = await postToFunction("/bid-questions", { requirements });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.error || `Kunne ikke generere spørgsmål (HTTP ${response.status})`);
  }
  return data;
}
