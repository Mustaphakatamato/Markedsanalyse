// Mock kandidat-leverandører. Bruges i markedsanalysen på et udbud til at pege på
// hvem der typisk er relevante spillere for en given CPV-kode. Kobles til det
// virkelige virksomhedsopslag via navnet (se pages/TenderPage.jsx).
export const suppliers = [
  {
    id: 1,
    name: "Atea",
    description:
      "IT-infrastruktur, cloud services og sikkerhedsløsninger til større organisationer.",
    region: "Nordics",
    size: "Enterprise",
    marketPosition: "Market leader",
    cpvMatches: ["72222300-0", "72400000-4", "72227000-2"],
    certifications: ["ISO 27001", "ISO 9001", "ISAE 3402"],
    services: ["Cloud", "Infrastruktur", "Sikkerhed", "Managed workplace", "Netværk"]
  },
  {
    id: 2,
    name: "Netcompany",
    description: "Digital transformation, offentlige platforme og integrationsløsninger.",
    region: "EU",
    size: "Enterprise",
    marketPosition: "Public sector specialist",
    cpvMatches: ["72227000-2", "72222300-0"],
    certifications: ["ISO 27001", "ISAE 3000", "ISO 14001"],
    services: ["Udvikling", "Offentlig IT", "Platforme", "Integration", "Forvaltning"]
  },
  {
    id: 3,
    name: "T-Systems",
    description:
      "Enterprise outsourcing, cloud og managed services med international leverancemodel.",
    region: "Global",
    size: "Enterprise",
    marketPosition: "Global player",
    cpvMatches: ["72222300-0", "72400000-4", "72227000-2"],
    certifications: ["ISO 27001", "ISO 22301", "SOC 2"],
    services: ["Outsourcing", "Cloud", "Managed Services", "SAP drift", "Hybrid drift"]
  },
  {
    id: 4,
    name: "LINK Mobility",
    description:
      "Kommunikationsplatform og messaging-services med stærkt fokus på SMS og omnichannel.",
    region: "Nordics",
    size: "Mid-market",
    marketPosition: "Niche player",
    cpvMatches: ["64212000-5", "72400000-4"],
    certifications: ["ISO 27001", "GDPR-ready processer"],
    services: [
      "SMS gateway",
      "Notifikationer",
      "Kommunikationsplatform",
      "Omnichannel messaging",
      "API integration"
    ]
  }
];

export function getRelevanceScore(supplier, cpv) {
  let score = supplier.cpvMatches.includes(cpv) ? 8 : 3;
  if (supplier.marketPosition === "Market leader" || supplier.marketPosition === "Global player") {
    score += 0.5;
  }
  return Math.min(10, Number(score.toFixed(1)));
}
