# Markedsanalyse

Værktøj til danske offentlige ordregivere, der skal researche leverandørmarkedet
inden et udbud. Slå en virksomhed op og få økonomi, EU-kontrakter og
branchesammenligning ét sted — eller opret et udbud og få et markedsbillede for
det pågældende CPV-område.

## Kør lokalt

```bash
cp .env.example .env    # udfyld de to Supabase-værdier
npm install
npm run dev             # http://localhost:3000
```

`npm run build` bygger til `dist/`, som kan hostes statisk hvor som helst.

De to variabler i `.env` er påkrævede: appen kalder alle eksterne datakilder
gennem Supabase Edge Functions, og gør det ad samme vej lokalt som i
produktion. Selve datakilderne kræver hverken nøgler eller login.

## Status

Fungerende MVP med tre flows og fem live datakilder. Backend'en består af syv
Edge Functions med cache i Postgres. Der er endnu ingen brugerkonti, og udbud
gemmes stadig i browserens `localStorage`.

## De tre flows

**Virksomhedsopslag** ([`pages/CompanyLookupPage.jsx`](src/pages/CompanyLookupPage.jsx))
— søg på navn eller CVR-nummer og få:
- CVR-stamdata (adresse, branche, selskabsform, ansatte, status)
- Regnskabstal med årsvælger, plus en udviklingsgraf over alle tilgængelige år
  (omsætning, resultat, egenkapital, balancesum, soliditetsgrad) — kan slås om
  til tabel
- Vundne EU-udbud fra TED med værdi, ordregiver og link til den enkelte notice.
  For rammeaftaler/DPS med mange vindere vises virksomhedens EGNE delkontrakter
  (lot, beløb, dato) i stedet for rammens fælles loftværdi — se
  [`tedNoticeService.js`](src/services/tedNoticeService.js)
- Risikoprofil: soliditet og overskudsgrad holdt op mod branchegennemsnittet
- ESG & compliance: rigtigt EU-sanktionstjek, plus CSR/klima/whistleblower som
  **demo-data**, se nedenfor

**Udbud & markedsanalyse** ([`pages/TenderPage.jsx`](src/pages/TenderPage.jsx))
— opret et udbud (titel, CPV-kode, deadline, anslået værdi) og få:
- Markedsnøgletal for CPV-koden — **demo-data**
- Kandidat-leverandører med relevans-score — **demo-data**
- Seneste rigtige kontrakttildelinger i markedet, hentet fra TED på CPV-koden

**Tilbudsgiver-radar** ([`pages/TilbudsgiverPage.jsx`](src/pages/TilbudsgiverPage.jsx))
— det spejlvendte flow: de to ovenstående researcher markedet FOR en
ordregiver, dette er til TILBUDSGIVEREN. Peg på et konkret, aktivt TED-udbud
(link eller notice-nummer) og få:
- Egnethedskrav udtrukket fra bekendtgørelsens fulde eForms-XML og
  kategoriseret (økonomisk/finansiel formåen, teknisk/faglig formåen,
  egnethed til at udøve erhvervet) — se
  [`tedNoticeService.getTenderRequirements()`](src/services/tedNoticeService.js).
  Kravteksten er ordregiverens egen, ukommenteret: TED har intet struktureret
  talfelt for fx et minimumsomsætningskrav (verificeret på en rigtig
  bekendtgørelse), så der er bevidst INGEN automatisk
  opfylder/opfylder-ikke-vurdering.
- Konkurrentfeltet: virksomheder der historisk har vundet flest kontrakter i
  samme CPV-felt (og samme ordregiver, hvis kendt), med deres seneste
  omsætning/soliditetsgrad — se
  [`tedService.getMarketPlayers()`](src/services/tedService.js). Dette er
  historiske VINDERE, aldrig en forudsigelse af hvem der byder — TED har
  ingen data om bud, kun om tildelinger.
- Egen profil: samme rigtige regnskabs- og TED-data som virksomhedsopslaget,
  plus branchesammenligning, til direkte sammenligning med konkurrentfeltet.

Flowene er koblet sammen: fra en kandidat-leverandør kan man hoppe direkte til
virksomhedsopslaget for den pågældende virksomhed ([`App.jsx`](src/App.jsx)).

## Datakilder

### Live — rigtig data

| Kilde | Leverer | Implementering |
|---|---|---|
| **CVR** via Datafordeleren | Stamdata på virksomhed | [`cvrService.js`](src/services/cvrService.js) |
| **Erhvervsstyrelsen** (virk.dk, XBRL) | Regnskabstal pr. regnskabsår | [`regnskabService.js`](src/services/regnskabService.js) |
| **TED** (Tenders Electronic Daily, v3) | EU-udbud og kontrakttildelinger | [`tedService.js`](src/services/tedService.js) (søgning) + [`tedNoticeService.js`](src/services/tedNoticeService.js) (fuld notice, lot-detalje) |
| **Danmarks Statistik** (tabel REGN50A) | Branchegennemsnit for nøgletal | [`industryBenchmarkService.js`](src/services/industryBenchmarkService.js) |
| **EU's konsoliderede sanktionsliste** (Financial Sanctions Files) | EU-sanktionstjek på virksomhedsnavn | [`sanctionsService.js`](src/services/sanctionsService.js) |

Hver kilde har sine egne begrænsninger — de er dokumenteret i toppen af den
enkelte servicefil. De vigtigste:

- **Datafordelerens GraphQL kan ikke fritekstsøge.** Strengfiltre understøtter
  kun `eq` og `in` — der findes ingen `contains`. Navnesøgning sker derfor mod
  et eget indeks i Postgres, se nedenfor. Tjenesten har desuden to
  begrænsninger der ikke står i dokumentationen: kun ét rodfelt pr.
  forespørgsel, og aliaser er forbudt. Versionen er `v2`, ikke `v3` som
  eksemplerne viser.
- **Navnesøgning finder kun aktive virksomheder.** Datafordelerens
  `current`-udtræk indeholder ikke ophørte selskaber. De kan stadig slås op på
  CVR-nummer.
- **Regnskabsdata er kun tilgængelige over `http://`** og svarer nogle gange
  ekstremt langsomt. Store/børsnoterede selskaber, der indberetter i
  ESEF/IFRS-format, kan ikke parses — de vises som "nøgletal kunne ikke
  udtrækkes" med link til det indberettede regnskab.
- **TED dækker kun udbud over EU's tærskelværdi.** Mindre danske kontrakter
  findes ikke her.
- **TED's søge-API kan ikke bruges til at afgøre hvad én virksomhed vandt i en
  rammeaftale.** For en notice med flere vindere leverer `/notices/search`
  vindernavne og beløb som PARALLELLE ARRAYS uden noget felt der pålideligt
  binder det ene til det andet — verificeret på SKI's standardsoftware-
  rammeaftale (294230-2024): `winner-name` havde 210 indgange, `tender-lot-
  identifier` 211, `tender-identifier` 209. At zippe dem sammen efter indeks
  ville kunne give en virksomhed et forkert beløb. `tedNoticeService.js`
  henter derfor i stedet notice'ens FULDE eForms-XML og joiner rigtigt på
  ID'er (Organisation → TenderingParty → LotTender), samme "global scan,
  aldrig gæt på position"-tilgang som XBRL-parsingen i `regnskabService.js`.
- **Danmarks Statistik dækker kun private byerhverv** — landbrug, finans og
  offentlige brancher mangler (se [`naceSectionMap.js`](src/data/naceSectionMap.js)).
  Tallene er 1-2 år efterslæbte.
- **Sanktionstjekket bruger kun eksakt navnematch**, bevidst — ingen
  fuzzy/trigram-søgning, fordi et falsk positivt er værre end et overset match
  i en due diligence-kontekst. Stavevarianter og translitterationer kan derfor
  undslippe. Korte enkeltords-match (fx et fornavn der også er alias for en
  udpeget person) flager som "kræver verifikation", ikke som et sikkert match
  — se konfidens-logikken i [`supabase/functions/sanktionstjek/index.ts`](supabase/functions/sanktionstjek/index.ts).

### Demo-data

Tre ting er hardcodet og markeret som demo-data i UI'et:

| Hvad | Fil |
|---|---|
| ESG-rapportering — CSR-rapport, klimarapportering, whistleblowerordning (deterministisk pr. CVR) | [`esgService.js`](src/services/esgService.js) |
| Kandidat-leverandører — 4 virksomheder med relevans-score | [`data/suppliers.js`](src/data/suppliers.js) |
| Markedsnøgletal pr. CPV-kode — 4 koder med trend, kontraktstørrelse, modenhed | [`data/cpvOptions.js`](src/data/cpvOptions.js) |

## Arkitektur

```
src/
  lib/         apiClient.js — ét sted der ved hvor backend'en ligger.
               format.js — fælles tal-/dato-formattering (delt mellem sider)
  services/    Ét adapter-lag pr. datakilde — returnerer normaliserede objekter,
               så UI'et ikke kender kildernes formater
  data/        Demo-data (suppliers, cpvOptions) + naceSectionMap (branchekoder → DST-sektor)
  context/     ProjectsContext — udbud i localStorage
  components/  layout/Rail+ThemeToggle (app-skallen: fast venstreskinne, som
               under 1040px lægger sig vandret i toppen — samme markup),
               charts/TrendChart (håndtegnet SVG, ingen chart-lib),
               ui/ (SourceBadge, StatusChip, ConfidenceMeter, Loading, Icon —
               små præsentationskomponenter, ingen datahentning)
  pages/       CompanyLookupPage, TenderPage, TilbudsgiverPage
scripts/
  indlaes-cvr-navne.mjs      Ugentlig indlæsning af navneindekset
  indlaes-eu-sanktioner.mjs  Ugentlig indlæsning af sanktionslisten
supabase/
  functions/   cvr-soeg, cvr-datafordeler, ted, ted-notice, regnskab-search,
               regnskab-doc, sanktionstjek + _shared/
  migrations/  Cache-tabeller, navneindeks og sanktionsliste
```

Appen har ingen router og ingen UI-afhængigheder — kun React og Vite. Navigation
mellem de tre views er `useState` i `App.jsx`.

Designsystemet ligger samlet i [`src/index.css`](src/index.css) som CSS-variabler,
uden Tailwind eller andet UI-framework. To regler styrer paletten, og de er
begge dokumenteret i toppen af filen:

1. **Farve er signal, ikke pynt.** Grøn = live kilde, gul = demo-data, rød =
   kræver afklaring. De tre farver bruges aldrig dekorativt — hvis de gør,
   holder de op med at betyde noget, og datakvaliteten er det eneste en
   ordregiver ikke må tage fejl af.
2. **Violet er maskinen.** Husets accent markerer kun der hvor systemet selv
   gør noget: appens mærke, aktiv rute, fokusring, primær handling,
   "arbejder nu"-tilstande og AI-genereret indhold. Den ligger bevidst langt
   fra grøn/gul/rød og kan derfor aldrig forveksles med et datasignal.

Sidernes indgang (søgefelt / valgt udbud) står på en mørk `.console`-flade.
Den overskriver hele token-sættet lokalt med de mørke, allerede
kontrastvaliderede værdier, så kilde-badges, chips og målere virker uændret
ovenpå den — og betyder præcis det samme dér som alle andre steder.

### Backend

Syv Edge Functions står mellem browseren og datakilderne. De findes fordi
kilderne ikke kan kaldes direkte: TED sender ingen CORS-headers, cvrapi.dk
kræver en `User-Agent` browsere ikke må sætte, og Erhvervsstyrelsens data
findes kun over `http://`. `sanktionstjek` slår i stedet op i vores eget
indeks af sanktionslisten, og `ted-notice` er en ren proxy til TED's fulde
eForms-XML pr. notice — parsingen sker i browseren, samme 2s CPU-loft-
begrundelse som XBRL-parsingen nedenfor.

De kaldes **ad samme vej i udvikling og produktion**. Det er bevidst: før lå
de samme fire proxier i `vite.config.js`, hvor de kun fandtes i `dev` og
`preview` — derfor kunne en bygget app ikke hostes. Genindfør ikke en dev-only
proxy.

Fire tabeller cacher svarene: CVR-opslag i syv dage, regnskabssøgninger i et
døgn, regnskabsdokumenter i 30 dage (et offentliggjort regnskab ændrer sig
ikke), TED-notices i 180 dage (en offentliggjort notice ændrer sig aldrig —
en rettelse er en ny notice med sit eget nummer). Tabellerne har RLS slået
til uden policies og er utilgængelige for klienten — kun funktionerne, som
bruger service-nøglen, kan røre dem.

### Navneindekset

Appens vigtigste indgang er at skrive et firmanavn, men Datafordeleren kan
kun matche navne præcist. Derfor holder vi et eget indeks over samtlige
**870.000 aktive danske virksomheder** i `cvr_virksomhed_indeks` — kun
CVR-nummer og navn, nok til at oversætte et navn til et nummer. Resten hentes
på nummeret, hvor der ingen begrænsning er.

Søgningen bruger et trigram-indeks, så delvise navne og stavefejl rammer:
`netcompny` finder stadig Netcompany A/S. Rangeringen ligger i SQL-funktionen
`soeg_virksomhed()`, så databasen kan bruge indekset til både at filtrere og
sortere. Indekset fylder 174 MB.

Data indlæses med [`scripts/indlaes-cvr-navne.mjs`](scripts/indlaes-cvr-navne.mjs):

```bash
node scripts/indlaes-cvr-navne.mjs
```

Scriptet kræver `DATAFORDELER_API_KEY` og `SUPABASE_SERVICE_ROLE_KEY` i `.env`.
Det kan ikke køre som Edge Function — filerne fylder 567 MB udpakket, mod 256 MB
tilgængelig hukommelse. Datafordeleren gendanner filerne natten til lørdag og
gemmer dem syv dage, så en ugentlig kørsel er passende.

XBRL-parsingen bliver i browseren med vilje: Edge Functions har kun 2s CPU-tid
pr. request, hvilket ikke rækker til et større regnskabsdokument. Proxying er
async I/O og tæller ikke med.

### Sanktionslisten

Samme mønster som navneindekset: EU's konsoliderede sanktionsliste (Financial
Sanctions Files, ~6.200 enheder / ~31.000 navnevarianter) hentes som XML og
indlæses i `eu_sanktionsliste`, så `sanktionstjek`-funktionen kan slå op uden
at kalde EU hver gang. Indlæses med
[`scripts/indlaes-eu-sanktioner.mjs`](scripts/indlaes-eu-sanktioner.mjs):

```bash
node scripts/indlaes-eu-sanktioner.mjs
```

EU opdaterer listen flere gange om ugen ved aktive sager — en ugentlig kørsel,
samme kadence som CVR-navneindekset, er passende. Kilde-URL'en bruger et fast,
offentligt kendt token (samme som open source-projektet moov-io/watchman) i
stedet for en personlig EU Login-konto — se kommentaren øverst i scriptet,
hvis den nogensinde lukkes ned.

## Kendte begrænsninger

1. **Ingen brugerkonti.** Udbud ligger stadig i `localStorage` og findes kun i
   den enkelte browser. Der er hverken login, deling eller RLS på brugerdata.
2. **Fabrikeret ESG-data.** CSR-rapport, klimarapportering og
   whistleblowerordning i [`esgService.js`](src/services/esgService.js) er
   genereret ud fra CVR-nummeret og markeret som demo-data i UI'et.
   EU-sanktionstjekket er derimod rigtig data siden 2026-08-10 (se
   [`sanctionsService.js`](src/services/sanctionsService.js)), men kun med
   eksakt navnematch — se caveat under Datakilder ovenfor.
3. **TED dækker kun over EU's tærskelværdi.** De fleste danske kontrakter
   ligger under og findes slet ikke i appen.
4. **Navnematch mod TED har en grænse.** Der er ingen CVR/VAT på vinderen i de
   felter vi henter, så koncernselskaber i andre lande med samme navn kan
   komme med.
5. **Tilbudsgiver-radaren viser kun EU-udbud** (samme TED-begrænsning som
   punkt 3), og "konkurrentfeltet" er historiske VINDERE, ikke en
   forudsigelse af hvem der byder på det konkrete udbud — den oplysning er
   ikke offentligt tilgængelig noget sted. Egnethedskravene vises som
   ordregiverens egen rå tekst, uden automatisk opfylder/opfylder
   ikke-vurdering (se `tedNoticeService.getTenderRequirements()`).

## Næste skridt

1. **Nationale udbudsdata** (Udbud.dk) — dækker de kontrakter TED ikke gør.
   Teknisk API-bruger er oprettet og login virker; afventer rolletildeling
   (`MU_API_DATASYNK`) fra Erhvervsstyrelsen før data kan hentes.
2. **Auth og udbud i Postgres**, så en markedsundersøgelse kan deles i en
   organisation.
3. **Automatisér indlæsningen** af navneindekset og sanktionslisten, så de
   ikke skal køres i hånden hver uge.
