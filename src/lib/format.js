// Fælles talformattering — dansk decimalkomma og mio.-DKK-visning bruges nu
// af flere sider (CompanyLookupPage, Tilbudsgiverradar). Ét sted, så en
// rettelse (som -0-mio.-fixet nedenfor) ikke skal laves to gange.

/**
 * @param {number|null} value
 */
export function formatDkkMio(value) {
  if (value == null) return "–";
  // For meget små selskaber (fx et lige-stiftet holdingselskab) kan et
  // negativt beløb i hele kroner (fx -4.999 DKK) afrunde til 0,0 i
  // mio.-visning — toLocaleString bevarer fortegnet på negativ nul og ville
  // vise "-0 mio. DKK", hvilket ligner en fejl. Rund selv først og kollaps
  // -0 til 0.
  const rounded = Math.round((value / 1_000_000) * 10) / 10;
  const normalized = rounded === 0 ? 0 : rounded;
  return `${normalized.toLocaleString("da-DK", { maximumFractionDigits: 1 })} mio. DKK`;
}

// Procenter skal formateres som beløbene ovenfor — dansk decimalkomma. Uden
// dette viser tallene sig som "24.3%" side om side med "5.290,5 mio. DKK".
export function formatPercent(value) {
  if (value == null) return "–";
  return `${value.toLocaleString("da-DK", { maximumFractionDigits: 1 })}%`;
}

export function formatDate(isoDate) {
  return isoDate ? isoDate.slice(0, 10) : "–";
}

// Datafordeleren/TED leverer datoer i ISO-format — vist råt stak de ud fra
// resten af siden, der er gennemført dansk.
export function formatDanishDate(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  return Number.isNaN(d.getTime()) ? isoDate : d.toLocaleDateString("da-DK");
}

// Et beløb i sin fulde, ikke-afrundede form — bruges hvor et enkelt,
// konkret beløb (en delkontrakt, en tildeling) skal kunne verificeres
// tegn-for-tegn mod kildedokumentet, i modsætning til formatDkkMio's
// afrundede oversigtstal.
export function formatAmount(value, currency) {
  return value != null ? `${value.toLocaleString("da-DK")} ${currency || ""}`.trim() : "Ikke oplyst";
}
