// Den faste CPV-overvågning: hvilke felter "Nye udbud" holder øje med.
//
// HVORFOR DEN STÅR I KODEN OG IKKE I EN INDSTILLING: listen er ikke et filter
// man skruer på fra gang til gang — den er en beskrivelse af, hvad huset kan
// levere, og den ændrer sig én gang om året, ikke én gang om dagen. Står den i
// koden, kan den læses, ændres i en commit og gennemgås som alt andet; lå den
// i localStorage, kunne den forsvinde med en ryddet browser, og ingen ville
// kunne se hvad der blev overvåget i går.
//
// HVORFOR TRE FELTER MED HVER SIN BREDESTE KODE: matchet er hierarkisk (se
// src/lib/cpv.js). 48000000, 72000000 og 79400000 afgør derfor hele resultatet
// helt alene — de øvrige 76 koder er dækket af dem. De står med alligevel, og
// det er med vilje: de er den liste, feltet blev DEFINERET ud fra, og uden dem
// ville "overvåger vi dataanalyse?" kræve at man selv regnede hierarkiet ud.
// UI'et lader derfor de tre brede koder styre søgningen og viser resten som
// dokumentation for, hvad de dækker.
//
// ADVARSLEN PÅ 79400000 hører til her og ikke i UI'et: koden er
// "Virksomhedsrådgivning og administrativ rådgivning", og som præfiks tager
// den ALT under 794 med — også ledelses-, HR- og marketingrådgivning uden en
// linje kode i sig. Sikkerhedsrådgivning (79417000) og rådgivning om indkøb
// (79418000) er de to, feltet er med for. Bliver støjen for stor, er svaret at
// slå feltet fra i UI'et eller sætte 'kunUdvalgte' på det.

export const OVERVAAGEDE_FELTER = [
  {
    id: "programpakker",
    // Den bredeste kode i feltet. Den ER søgningen; resten er dokumentation.
    kode: "48000000",
    navn: "Programpakker og informationssystemer",
    kort: "Programpakker",
    koder: [
      { kode: "48000000", tekst: "Programpakker og informationssystemer" },
      { kode: "48100000", tekst: "Branchespecifik programpakke" },
      { kode: "48200000", tekst: "Programpakke til netværk, internet og intranet" },
      {
        kode: "48300000",
        tekst:
          "Programpakke til oprettelse af dokumenter, tegning, billedbehandling, tidsplanlægning og produktivitetsovervågning"
      },
      {
        kode: "48326100",
        tekst: "Digitalt kortlægningssystem"
      },
      {
        kode: "48400000",
        tekst: "Programpakke til forvaltning af forretningstransaktioner og privatsager"
      },
      { kode: "48500000", tekst: "Programpakke til kommunikations- og multimedieformål" },
      { kode: "48600000", tekst: "Database- og operativsystemprogrampakke" },
      { kode: "48610000", tekst: "Databasesystemer" },
      { kode: "48612000", tekst: "System til databasestyring" },
      { kode: "48700000", tekst: "Værktøjsprogrampakke" },
      { kode: "48730000", tekst: "Sikkerhedsprogrampakke" },
      { kode: "48731000", tekst: "Filsikkerhedsprogrampakke" },
      { kode: "48800000", tekst: "Informationssystemer og servere" },
      { kode: "48900000", tekst: "Diverse programpakker og computersystemer" },
      { kode: "48980000", tekst: "Programmeringssprog og -værktøjer" },
      { kode: "48985000", tekst: "Programmeringssprog" }
    ]
  },
  {
    id: "it-tjenester",
    kode: "72000000",
    navn: "It-tjenester: rådgivning, programmeludvikling, internet og support",
    kort: "It-tjenester",
    koder: [
      {
        kode: "72000000",
        tekst: "It-tjenester: rådgivning, programmeludvikling, internet og support"
      },
      { kode: "72100000", tekst: "Konsulentvirksomhed vedrørende maskinel" },
      { kode: "72130000", tekst: "Konsulentvirksomhed vedrørende planlægning af databehandlingsanlæg" },
      { kode: "72150000", tekst: "Konsulentvirksomhed vedrørende edb-revision og maskinel" },
      { kode: "72200000", tekst: "Programmering af software og konsulentvirksomhed" },
      { kode: "72210000", tekst: "Programmeringsservice i forbindelse med programmelpakker" },
      {
        kode: "72211000",
        tekst: "Programmeringsservice i forbindelse med systemer og brugerprogrammel"
      },
      { kode: "72212000", tekst: "Programmeringsservice i forbindelse med applikationsprogrammel" },
      { kode: "72212100", tekst: "Branchespecifik programmeludvikling" },
      { kode: "72212311", tekst: "Udvikling af programmel til dokumenthåndtering" },
      { kode: "72212422", tekst: "Udvikling af programsuiter" },
      { kode: "72212517", tekst: "Udvikling af it-programmel" },
      { kode: "72212730", tekst: "Udvikling af sikkerhedsprogrammel" },
      { kode: "72212731", tekst: "Udvikling af filsikkerhedsprogrammel" },
      { kode: "72212732", tekst: "Udvikling af datasikkerhedsprogrammel" },
      { kode: "72212920", tekst: "Udvikling af programmel til kontorautomatisering" },
      { kode: "72220000", tekst: "Konsulentvirksomhed i forbindelse med systemer og teknik" },
      { kode: "72221000", tekst: "Konsulentvirksomhed i forbindelse med forretningsanalyser" },
      {
        kode: "72222000",
        tekst: "Strategisk gennemgang og planlægning af informationssystemer eller -teknologi"
      },
      {
        kode: "72222100",
        tekst: "Strategisk gennemgang af informationssystemer eller -teknologi"
      },
      { kode: "72222200", tekst: "Planlægning af informationssystemer eller -teknologi" },
      { kode: "72222300", tekst: "Tjenesteydelser i forbindelse med informationsteknologi" },
      { kode: "72223000", tekst: "Gennemgang af behov for informationsteknologi" },
      { kode: "72224000", tekst: "Konsulentvirksomhed i forbindelse med projektstyring" },
      { kode: "72224100", tekst: "Planlægning af implementering af et system" },
      { kode: "72224200", tekst: "Planlægning af kvalitetssikring af systemer" },
      { kode: "72225000", tekst: "Vurdering og gennemgang af systemkvalitetssikring" },
      {
        kode: "72226000",
        tekst: "Konsulentvirksomhed i forbindelse med afleveringsprøve for basisprogrammel"
      },
      { kode: "72227000", tekst: "Konsulentvirksomhed i forbindelse med integration af programmel" },
      { kode: "72228000", tekst: "Konsulentvirksomhed i forbindelse med integration af maskinel" },
      { kode: "72230000", tekst: "Udvikling af kundespecificeret programmel" },
      { kode: "72240000", tekst: "Systemanalyse og programmering" },
      { kode: "72243000", tekst: "Programmeringstjenester" },
      { kode: "72245000", tekst: "Systemanalyse og programmering på kontraktbasis" },
      { kode: "72246000", tekst: "Systemrådgivning" },
      { kode: "72252000", tekst: "Edb-arkivering" },
      { kode: "72253000", tekst: "Help-desk og støttetjenester" },
      { kode: "72253100", tekst: "Help-desk-tjenester" },
      { kode: "72253200", tekst: "Systemsupport" },
      { kode: "72254100", tekst: "Systemafprøvning" },
      { kode: "72263000", tekst: "Implementering af programmel" },
      { kode: "72266000", tekst: "Konsulentvirksomhed i forbindelse med programmel" },
      { kode: "72268000", tekst: "Levering af programmel" },
      { kode: "72300000", tekst: "Datatjenester" },
      { kode: "72310000", tekst: "Databehandling" },
      { kode: "72311100", tekst: "Konvertering af data" },
      { kode: "72312100", tekst: "Dataforberedelse" },
      { kode: "72316000", tekst: "Dataanalyse" },
      { kode: "72319000", tekst: "Levering af data" },
      {
        kode: "72330000",
        tekst: "Indholds- eller datastandardiserings- eller -klassificeringstjenester"
      },
      { kode: "72400000", tekst: "Internettjenester" },
      { kode: "72500000", tekst: "Servicevirksomhed i forbindelse med datamater" },
      { kode: "72512000", tekst: "Forvaltning af dokumenter" },
      { kode: "72513000", tekst: "Kontorautomatisering" },
      { kode: "72590000", tekst: "Professionel servicevirksomhed i forbindelse med edb" },
      { kode: "72600000", tekst: "Support- og konsulentvirksomhed i forbindelse med edb" },
      { kode: "72700000", tekst: "Datamatnetværkstjenester" },
      { kode: "72800000", tekst: "Revision og testning af computer" },
      { kode: "72900000", tekst: "Computer backup og katalogkonvertering" }
    ]
  },
  {
    id: "raadgivning",
    kode: "79400000",
    navn: "Virksomhedsrådgivning og administrativ rådgivning samt beslægtede tjenesteydelser",
    kort: "Rådgivning",
    // Se noten øverst: 794 er det ene felt, hvor den brede kode trækker
    // ikke-it med ind. Advarslen vises i UI'et frem for at være skjult her.
    advarsel:
      "79400000 dækker al virksomheds- og administrativ rådgivning — også opgaver uden it i sig.",
    koder: [
      {
        kode: "79400000",
        tekst: "Virksomhedsrådgivning og administrativ rådgivning samt beslægtede tjenesteydelser"
      },
      { kode: "79417000", tekst: "Sikkerhedsrådgivning" },
      { kode: "79418000", tekst: "Rådgivning vedrørende indkøb" }
    ]
  }
];

// Alle koder i overvågningen, fladt. Bruges til at vise "79 koder" og til at
// slå en kodes betegnelse op, når den står på et udbudskort.
export const OVERVAAGEDE_KODER = OVERVAAGEDE_FELTER.flatMap((f) => f.koder);

export const KODE_TEKST = new Map(OVERVAAGEDE_KODER.map((k) => [k.kode, k.tekst]));

// Vinduerne. 7 dage er standard: en uge fanger det, der er kommet til siden
// man sidst så efter, også hen over en weekend, uden at listen fyldes med det
// man allerede har taget stilling til.
export const VINDUER = [
  { dage: 1, etiket: "24 timer" },
  { dage: 7, etiket: "7 dage" },
  { dage: 30, etiket: "30 dage" }
];

export const STANDARD_VINDUE = 7;
