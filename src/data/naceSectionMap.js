// Kortlægning fra CVR's 6-cifrede DB07/NACE-branchekode (fx 622000) til
// Danmarks Statistiks branche-inddeling i tabel REGN50A (regnskabsstatistik
// for private byerhverv). REGN50A dækker kun markedsøkonomiske brancher —
// landbrug (A), finans/forsikring (K) og offentlige/non-market brancher
// (O-U) er ikke med, så en del virksomheder vil ikke have et branche-match.
//
// Baseret på det faste, internationale NACE Rev.2-sektionshierarki (ændrer
// sig ikke), krydset med hvilke sektioner REGN50A rent faktisk indeholder
// (fundet ved at hente tabellens metadata, se tableinfo for "REGN50A").
const NACE_DIVISION_RANGES = [
  { min: 5, max: 9, sector: "B", label: "B Råstofindvinding" },
  { min: 10, max: 33, sector: "C", label: "C Industri" },
  { min: 35, max: 35, sector: "D", label: "D Energiforsyning" },
  { min: 36, max: 39, sector: "E", label: "E Vandforsyning og renovation" },
  { min: 41, max: 43, sector: "F", label: "F Bygge og anlæg" },
  { min: 45, max: 45, sector: "45", label: "Handel med biler og motorcykler, og reparation heraf" },
  { min: 46, max: 46, sector: "46", label: "Engroshandel undtagen med motorkøretøjer og motorcykler" },
  { min: 47, max: 47, sector: "47", label: "Detailhandel undtagen med motorkøretøjer og motorcykler" },
  { min: 49, max: 53, sector: "H", label: "H Transport" },
  { min: 55, max: 56, sector: "I", label: "I Hoteller og restauranter" },
  { min: 58, max: 63, sector: "J", label: "J Information og kommunikation" },
  { min: 68, max: 68, sector: "L", label: "L Ejendomshandel og udlejning" },
  { min: 69, max: 75, sector: "M", label: "M Videnservice" },
  { min: 77, max: 82, sector: "N", label: "N Rejsebureauer, rengøring og anden operationel service" },
  { min: 95, max: 95, sector: "95", label: "Reparation af husholdningsudstyr" }
];

/**
 * @param {string|number|null} industryCode 6-cifret DB07-kode fra CVR, fx 622000
 * @returns {{ sector: string, label: string } | null}
 */
export function getIndustrySector(industryCode) {
  if (!industryCode) return null;
  const division = Math.floor(Number(industryCode) / 10000);
  if (!Number.isFinite(division)) return null;

  const match = NACE_DIVISION_RANGES.find((r) => division >= r.min && division <= r.max);
  return match ? { sector: match.sector, label: match.label } : null;
}
