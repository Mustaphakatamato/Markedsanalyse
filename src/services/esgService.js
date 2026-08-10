// MOCK — ESG-rapportering (CSR/klima/whistleblower). Ingen standardiseret
// gratis kilde findes for disse tre felter endnu.
//
// Sanktionstjekket, der tidligere lå her som et hardkodet sanctionsMatch:
// false, er flyttet til sanctionsService.js — det er nu et RIGTIGT opslag
// mod EU's konsoliderede sanktionsliste, ikke en mock, og skal derfor ikke
// have samme "isMock: true"-mærkat som resten af denne fil.
//
// Deterministisk pr. CVR-nummer, ligesom financialsService.js.

function seedFrom(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * @param {{ cvr?: string, name?: string }} company
 * @returns {{ csrReportFiled: boolean, csrReportYear: number|null, climateReporting: boolean, whistleblowerScheme: boolean, isMock: true }}
 */
export function getESGProfile(company) {
  const seed = seedFrom(company.cvr || company.name || "ukendt");

  return {
    csrReportFiled: seed % 4 !== 0,
    csrReportYear: seed % 4 !== 0 ? 2023 + (seed % 2) : null,
    climateReporting: seed % 3 === 0,
    whistleblowerScheme: seed % 2 === 0,
    isMock: true
  };
}
