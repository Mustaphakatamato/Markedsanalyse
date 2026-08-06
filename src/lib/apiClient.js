// Ét sted der ved hvor backend'en ligger.
//
// Tidligere gik alle eksterne kald gennem Vite-proxier defineret i
// vite.config.js. De fandtes kun i `vite dev` og `vite preview`, så en
// bygget app kunne ikke hostes statisk — proxierne var der simpelthen ikke.
// Nu kaldes Supabase Edge Functions i stedet, og de kaldes ENS i udvikling og
// produktion. Netop den forskel mellem dev og prod var problemet; den skal
// ikke genopfindes et andet sted.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !PUBLISHABLE_KEY) {
  // Fejl højlydt ved opstart frem for at lade hvert enkelt kald fejle med en
  // uforståelig netværksfejl senere.
  throw new Error(
    "VITE_SUPABASE_URL og VITE_SUPABASE_PUBLISHABLE_KEY skal være sat. Se .env.example."
  );
}

const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

// Nøglen er offentlig (den ligger i browser-bundlet og er designet til det).
// Den beskytter ikke data — funktionerne afviser blot kald uden den, så de
// ikke kan bruges som gratis åben proxy af tilfældige.
function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${PUBLISHABLE_KEY}`, ...extra };
}

export function functionUrl(path) {
  return `${FUNCTIONS_BASE}${path}`;
}

export function getFromFunction(path) {
  return fetch(functionUrl(path), { headers: authHeaders() });
}

export function postToFunction(path, body) {
  return fetch(functionUrl(path), {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body)
  });
}
