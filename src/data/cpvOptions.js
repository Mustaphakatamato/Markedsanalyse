// Mock CPV/marked-data. Bruges til at give kontekst om et marked (typisk
// kontraktstørrelse, modenhed, trend) i markedsanalysen for et udbud.
export const cpvOptions = [
  {
    code: "72222300-0",
    label: "IT-infrastruktur og drift",
    trend: "+8% YoY",
    avgContract: "25-60 mio. DKK",
    maturity: "Høj"
  },
  {
    code: "72227000-2",
    label: "Integration og platforme",
    trend: "+11% YoY",
    avgContract: "10-40 mio. DKK",
    maturity: "Høj"
  },
  {
    code: "64212000-5",
    label: "SMS gateway og beskedtjenester",
    trend: "+6% YoY",
    avgContract: "3-12 mio. DKK",
    maturity: "Mellem"
  },
  {
    code: "72400000-4",
    label: "Internet- og cloud services",
    trend: "+14% YoY",
    avgContract: "15-80 mio. DKK",
    maturity: "Høj"
  }
];
