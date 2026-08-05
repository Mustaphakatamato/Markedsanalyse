// MOCK — ESG-rapportering og compliance/sanktionstjek. Ingen standardiseret
// gratis kilde findes for ESG-data; sanktionstjek mod EU-listen kunne kobles
// på senere (samme mønster som financialsService.js: skift kroppen af
// funktionen ud, behold returformen).
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
 * @returns {{ csrReportFiled: boolean, csrReportYear: number|null, climateReporting: boolean, whistleblowerScheme: boolean, sanctionsMatch: boolean, isMock: true }}
 */
export function getESGProfile(company) {
  const seed = seedFrom(company.cvr || company.name || "ukendt");

  return {
    csrReportFiled: seed % 4 !== 0,
    csrReportYear: seed % 4 !== 0 ? 2023 + (seed % 2) : null,
    climateReporting: seed % 3 === 0,
    whistleblowerScheme: seed % 2 === 0,
    // I den store majoritet af opslag vil en rigtig sanktionstjekker
    // returnere "intet match" — så det holder vi fast som demo-standard.
    sanctionsMatch: false,
    isMock: true
  };
}
