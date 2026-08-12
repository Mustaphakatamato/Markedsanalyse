// Kravbesvarelses-arbejdsområde — "begynde at svare på tilbuddet" for det
// aktuelt indlæste udbud. Svarer til Budpiloten.dks Compliance Matrix, men
// bevidst simplere: ét svar-felt + status pr. krav, ingen automatisk
// opfylder/opfylder-ikke-facit (samme begrundelse som
// tedNoticeService.getTenderRequirements — kravtekst er fri tekst).
//
// Gemmes UDELUKKENDE i localStorage, pr. udbud (nøglet på publicationNumber)
// — ingen server-side lagring, ingen deling mellem enheder. Det er en
// personlig kladdebog, ikke et indleveret dokument.

const STORAGE_PREFIX = "markedsanalyse.bidWorkspace.";

export const ANSWER_STATUSES = ["ikke_startet", "kladde", "faerdig"];

export const STATUS_LABELS = {
  ikke_startet: "Ikke startet",
  kladde: "Kladde",
  faerdig: "Færdig"
};

// Simpel, synkron streng-hash (djb2) — kun til at give hvert krav et stabilt
// lokalt ID ud fra dets eget indhold, IKKE til noget sikkerhedsformål. TED
// leverer intet stabilt ID for de enkelte krav/kriterier, så vi afleder ét
// selv: skifter ordregiveren kravteksten, får det (bevidst) et nyt ID og
// dermed et tomt svar-felt igen, fremfor at vise et gammelt svar mod en
// tekst der ikke længere passer.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * @param {{ typeCode?: string|null, category?: string, description: string }} requirement
 * @returns {string}
 */
export function requirementId(requirement) {
  return hashString(`${requirement.typeCode || ""}|${requirement.category || ""}|${requirement.description}`);
}

function storageKey(publicationNumber) {
  return `${STORAGE_PREFIX}${publicationNumber}`;
}

/**
 * @param {string} publicationNumber
 * @returns {Record<string, { answerText: string, status: string, updatedAt: string }>}
 */
export function loadWorkspace(publicationNumber) {
  if (!publicationNumber) return {};
  try {
    const raw = localStorage.getItem(storageKey(publicationNumber));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * @param {string} publicationNumber
 * @param {string} reqId
 * @param {{ answerText?: string, status?: string }} patch
 * @returns {Record<string, { answerText: string, status: string, updatedAt: string }>} Den opdaterede fulde workspace.
 */
export function saveAnswer(publicationNumber, reqId, patch) {
  const workspace = loadWorkspace(publicationNumber);
  const existing = workspace[reqId] || { answerText: "", status: "ikke_startet" };
  const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  const next = { ...workspace, [reqId]: updated };
  try {
    localStorage.setItem(storageKey(publicationNumber), JSON.stringify(next));
  } catch {
    // localStorage kan være fuld/blokeret (fx privat browsing) — svaret
    // forbliver da kun i UI'ets state for denne session, hvilket er en
    // acceptabel degradering frem for at crashe.
  }
  return next;
}

/**
 * Samlet fremdrift for et udbud — bruges til et "X af Y krav besvaret"-tal.
 * @param {Record<string, { status: string }>} workspace
 * @param {number} totalCount
 */
export function workspaceProgress(workspace, totalCount) {
  const done = Object.values(workspace).filter((r) => r.status === "faerdig").length;
  const started = Object.values(workspace).filter((r) => r.status === "kladde").length;
  return { done, started, total: totalCount };
}
