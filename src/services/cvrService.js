// CVR (Det Centrale Virksomhedsregister) opslag via cvrapi.dk — gratis,
// ingen login, men:
// - 50 opslag/dag pr. IP (giver "QUOTA_EXCEEDED" når loftet er nået)
// - kræver en custom User-Agent-header, som browsere ikke selv kan sætte,
//   derfor går kaldet gennem /api/cvr-proxyen (se vite.config.js), som
//   sætter headeren server-side.
//
// Denne API leverer stamdata (navn, adresse, branche, status, ansatte) — den
// indeholder IKKE regnskabstal. Økonomi/nøgletal håndteres derfor separat i
// financialsService.js (mock).

const CVR_SEARCH_URL = "/api/cvr/api";

function normalizeCompany(raw) {
  return {
    cvr: raw.vat != null ? String(raw.vat) : null,
    name: raw.name || null,
    address: raw.address || null,
    zipcode: raw.zipcode || null,
    city: raw.city || null,
    fullAddress: [raw.address, [raw.zipcode, raw.city].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
    companyType: raw.companydesc || raw.companycode || null,
    industryCode: raw.industrycode || null,
    industryDesc: raw.industrydesc || null,
    startDate: raw.startdate || null,
    endDate: raw.enddate || null,
    employeesRange: raw.employees || null,
    phone: raw.phone || null,
    email: raw.email || null,
    active: !raw.enddate
  };
}

/**
 * Look up a Danish company by name or CVR number via cvrapi.dk.
 *
 * @param {string} query Company name or 8-digit CVR number
 * @returns {Promise<{ status: "ok", company: object } | { status: "not_found" | "quota_exceeded", message: string }>}
 */
export async function lookupCompany(query) {
  const term = query.trim();
  if (!term) return { status: "not_found", message: "Angiv et firmanavn eller CVR-nummer." };

  const isCvrNumber = /^\d{8}$/.test(term);
  const param = isCvrNumber ? `search=${term}` : `search=${encodeURIComponent(term)}`;

  const response = await fetch(`${CVR_SEARCH_URL}?${param}&country=dk`);
  const data = await response.json().catch(() => null);

  if (!data) {
    return { status: "not_found", message: "Kunne ikke læse svar fra CVR-opslaget." };
  }

  if (data.error === "QUOTA_EXCEEDED") {
    return {
      status: "quota_exceeded",
      message: "Dagligt opslagsloft på CVR-opslag er nået (50/dag). Prøv igen i morgen."
    };
  }

  if (data.error) {
    return { status: "not_found", message: "Virksomheden blev ikke fundet." };
  }

  return { status: "ok", company: normalizeCompany(data) };
}
