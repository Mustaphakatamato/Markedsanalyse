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

Fungerende MVP med tre flows og seks live datakilder. Backend'en består af otte
Edge Functions med cache i Postgres. Der er endnu ingen brugerkonti, og udbud
gemmes stadig i browserens `localStorage` — de migreres dog frem ved
skemaændringer, så et udbud ikke går tabt (se `ProjectsContext`).

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
— opret et udbud og afdæk leverandørmarkedet før udbuddet. Alt bygger på
rigtige kilder:
- **CPV-koder** søges blandt de 9.454 officielle danske betegnelser. Flere pr.
  udbud — et IT-driftsudbud rammer sjældent kun én kode
- **Brancheforslag**: der findes ingen officiel oversættelse fra CPV til
  branchekode, så den udledes af data — vinderne af nylige danske udbud i
  CPV-feltet slås op i CVR, og deres faktiske brancher foreslås med andele og
  dækningsgrad. Forslaget bekræftes eller rettes af ordregiveren, aldrig
  automatisk
- **Markedsbillede**: hvor mange virksomheder findes der reelt, hvad laver de,
  hvor ligger de, og hvilke selskabsformer består markedet af — grundlaget for
  "opdel eller forklar" (udbudslovens § 49)
- **Kandidatliste** med shortliste. Nøgletal hentes kun for de shortlistede,
  da hvert opslag koster to kald mod Erhvervsstyrelsen
- **Seneste kontrakttildelinger** i CPV-feltet fra TED
- **Udskriv som bilag** — print-CSS'en viser shortlisten, ikke hele listen

Forskellen på dette og Tilbudsgiver-radaren er populationen: radaren viser dem,
der har vundet et EU-udbud før, mens markedsanalysen viser hele CVR-registret.
Bruger man kun det første som leverandørliste, bekræfter man de store og
skjuler resten — stik imod formålet med en markedsanalyse.

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

Én ting er stadig hardcodet og markeret som demo-data i UI'et:

| Hvad | Fil |
|---|---|
| ESG-rapportering — CSR-rapport, klimarapportering, whistleblowerordning (deterministisk pr. CVR) | [`esgService.js`](src/services/esgService.js) |

De to øvrige forsvandt med markedsanalysemodulet. `data/suppliers.js` havde
fire hardkodede leverandører med en relevans-score, der var `8 hvis CPV-koden
matcher, ellers 3`, og alle fire blev vist uanset hvilket marked man kiggede
på. `data/cpvOptions.js` havde fire CPV-koder med **opdigtede** betegnelser —
`64212000` stod som "SMS gateway og beskedtjenester", men hedder officielt
"Mobiltelefontjeneste". Begge er erstattet af rigtige kilder.

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
  indlaes-cvr-indeks.mjs     Ugentlig indlæsning af markedsindekset
  indlaes-eu-sanktioner.mjs  Ugentlig indlæsning af sanktionslisten
supabase/
  functions/   cvr-soeg, cvr-datafordeler, ted, ted-notice, regnskab-search,
               regnskab-doc, sanktionstjek + _shared/
  migrations/  Cache-tabeller, markedsindeks og sanktionsliste
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

### Markedsindekset

Tabellen `cvr_virksomhed_indeks` dækker samtlige **870.564 aktive danske
virksomheder** og løser to ting, Datafordeleren ikke kan svare på direkte.
Dens GraphQL kan kun filtrere strenge med `eq` og `in` — ingen `contains` —
og tillader kun ét rodfelt pr. forespørgsel:

1. **Navnesøgning.** Appens vigtigste indgang er at skrive et firmanavn.
   Trigram-indekset gør at delvise navne og stavefejl rammer: `netcompny`
   finder stadig Netcompany A/S. Rangeringen ligger i `soeg_virksomhed()`,
   så databasen kan bruge indekset til både at filtrere og sortere.
2. **Markedsafdækning.** `soeg_marked()` og `marked_statistik()` finder
   populationen i et sæt brancher, valgfrit afgrænset på kommune. Det er
   den eneste kilde i appen der viser hele markedet — TED kender kun dem,
   der har vundet et EU-udbud før, hvilket systematisk skjuler mindre og
   nye leverandører.

Indekset holder navn, hovedbranche, bibrancher, kommune, postnummer og
selskabsform. Dækningen er 100 % på alle felter undtagen bibrancher, som kun
10,7 % af virksomhederne har. Detaljer (ansatte, adresse, kreditstatus)
hentes stadig pr. CVR-nummer, hvor der ingen begrænsning er.

**Branchekoderne er DB25 (NACE Rev. 2.1), ikke DB07.** IT-området blev
omstruktureret ved overgangen: `621000` Computerprogrammering og `622000`
Computerkonsulentbistand har afløst de gamle `620100`/`620200`. Et par
hundrede virksomheder står stadig med efterladte DB07-koder. En hardkodet
DB07-kode giver derfor et tomt marked uden at fejle synligt.

Data indlæses med [`scripts/indlaes-cvr-indeks.mjs`](scripts/indlaes-cvr-indeks.mjs):

```bash
node scripts/indlaes-cvr-indeks.mjs             # normal ugentlig kørsel
node scripts/indlaes-cvr-indeks.mjs --toerloeb  # læs og tæl, skriv intet
```

Scriptet kræver `DATAFORDELER_API_KEY` og `SUPABASE_SERVICE_ROLE_KEY` i `.env`.
Det henter fem bulkfiler — Virksomhed, Navn, Branche, Adressering og
Virksomhedsform — der alle joiner på `CVREnhedsId`. Kør altid uden `--behold`,
så alle fem stammer fra samme ugentlige snapshot; blandes to snapshots, får
nogle virksomheder branche uden navn.

Kør `--toerloeb` efter ændringer i parsingen. Den rapporterer dækningsgrad pr.
felt uden at skrive, og falder én af dem markant, har kilden ændret et
kolonnenavn — det skal opdages før skrivningen, fordi en rigtig kørsel rydder
de rækker den ikke rørte.

Skrivningen sker i batches på 500 med op til fem forsøg pr. batch. Det er ikke
overforsigtighed: med fire indekser at vedligeholde — heriblandt et GIN-indeks
— rammer en upsert nu og da Supabases `statement_timeout` på 8 sekunder.
Under indlæsningen 13. august skete det fire gange ud af ~1.740 batches, og
hver enkelt lykkedes ved andet forsøg. Upserten er idempotent
(`merge-duplicates` på primærnøglen), så et gentaget forsøg er ufarligt.

Scriptet kan ikke køre som Edge Function — filerne fylder over 1 GB udpakket,
mod 256 MB tilgængelig hukommelse. Datafordeleren gendanner filerne natten til
lørdag og gemmer dem syv dage, så en ugentlig kørsel er passende.

**Efter hver indlæsning skal markedsvisningerne genopbygges:**

```sql
refresh materialized view public.marked_dim;
refresh materialized view public.branche_tekst;
analyze public.marked_dim;
```

Det tager omkring 32 sekunder og kan derfor ikke udløses af scriptet selv —
PostgREST afbryder efter 8. Springes trinnet over, svarer markedsopslagene på
forrige uges data uden at fejle, hvilket er værre end en fejl. Scriptet
minder om det til sidst.

### Hvorfor markedsopslagene går gennem `marked_dim`

`soeg_marked()` og `marked_statistik()` læser ikke direkte fra
`cvr_virksomhed_indeks`, men fra det materialiserede view `marked_dim`, som
holder én smal række pr. (virksomhed, branchekode) — både hovedbranche og
bibrancher, 987.202 rækker i alt.

Målt på produktionsdata tog kernescanningen 2.689 ms direkte mod indekstabellen
og 123 ms mod `marked_dim`. Forskellen er ikke indeksering — begge planer bruger
indeks korrekt — men at 33.727 **brede** rækker skal hentes fra 16.030 diskblokke,
mod 9.898 blokke for de smalle. Hele `marked_statistik()` kører nu på ~200 ms.

Optællingen sker på virksomhedsniveau med `count(distinct)`, ikke som en sum af
antal pr. branchekode. En virksomhed kan ramme markedet gennem både sin
hovedbranche og en bibranche, og ville ellers tælle med flere gange.

`prBranche` grupperer på virksomhedens **egen** hovedbranche, ikke på de søgte
koder. Det er bevidst: søger man på fire IT-koder og får holdingselskaber,
designbureauer og ingeniørrådgivere med i svaret, er det signalet om at
markedet er bredere end de koder man startede med.

### Fra CPV til branchekoder

Der findes ingen officiel oversættelse mellem CPV (hvad der købes) og DB25
(hvad en virksomhed laver). `brancheforslag_for_navne()` udleder den i stedet
af data, vi allerede har: slå TED-vinderne i et CPV-felt op i CVR, og se hvilke
brancher de faktisk har. Det er efterprøvbart og kan vises for ordregiveren.

Målt på de 100 seneste danske tildelinger pr. kode (2026-08-13):

| CPV | Navne matchet | Peger på |
|---|---|---|
| 72222300 IT-drift | 67 % | `622000` + `621000` = 65 % |
| 45000000 Bygge/anlæg | 93 % | `410000` 21 %, derefter fagene |
| 79600000 Rekruttering | 78 % | `782000` 27 % |
| 90500000 Affald | 92 % | `494100` + `382100` + `381100` = 40 % |

**Forslaget må aldrig anvendes automatisk.** To fejlkilder er systematiske:
vinderen er ofte moderselskabet, så holdingbrancher (`642120`, `649990`) dukker
op i stedet for driftsbranchen — og under rekruttering ligger `464620`
Engroshandel med hospitalsartikler på 21 % uden en oplagt forklaring.
Ordregiveren skal se andelene og kunne rette i dem.

Navnematchningen er bevidst konservativ: kun eksakt match på normaliseret navn
eller kernenavn (navnet uden selskabsform). Fuzzy match ville trække tilfældige
brancher ind i fordelingen. Begge sider sammenlignes i begge former, fordi
selskabsformen kan mangle hos enten TED eller CVR — det alene hævede
match-raten for bygge/anlæg fra 76 % til 93 %.

Normaliseringen ligger i SQL (`navn_normaliser`, `navn_kerne`) og ikke kun i
`tedService.js`, fordi opslaget skal kunne bruge et udtryksindeks. De to
implementeringer skal holdes ens — der er en paritetstest for netop det.

### CPV-nomenklaturen

9.454 koder med officielle danske betegnelser i `cpv_koder`, søgbare på både
kode og tekst gennem `soeg_cpv()`. Indlæses med
[`scripts/indlaes-cpv.mjs`](scripts/indlaes-cpv.mjs) fra eForms-SDK'ets
`codelists/cpv.gc` — samme SDK som eForms-skemaerne bag TED-parsingen.

Det er en engangskørsel: CPV 2008 har været uændret siden 2008. Kør den igen,
hvis EU udgiver en ny udgave.

Betegnelserne skal komme herfra og ikke fra kode. Appen havde tidligere fire
hardkodede koder med **opdigtede** betegnelser — `64212000` stod som "SMS
gateway og beskedtjenester", men hedder officielt "Mobiltelefontjeneste"
(sms-tjenester er `64212100`). En opdigtet betegnelse i udbudsmaterialet ville
være direkte forkert.

Teksterne fylder 315 KB rå og ligger derfor i databasen frem for i bundlen,
som i dag er 72 KB gzipped i alt. Søgningen er et debounced fjernopslag,
samme mønster som firmanavne.

### Test af migrationer

```bash
npm i -D embedded-postgres    # én gang, ~144 MB
npm run test:db
```

[`scripts/test-migrationer.mjs`](scripts/test-migrationer.mjs) kører hele
migrationskæden fra bunden mod en rigtig PostgreSQL 17 — samme major version
som produktionen — og afprøver funktionerne med data, der rammer de kendte
kanttilfælde. **Kør den efter enhver ændring i `supabase/migrations/`.**

Den findes fordi der ikke er nogen anden vej til at afprøve en migration, før
den rammer produktion: der er ingen staging-database, og at parse SQL'en fanger
kun syntaks — og slet ikke inde i funktionskroppe, som bare er strenge. Testen
har allerede fanget tre fejl, der ellers var gået igennem: `IS DISTINCT FROM
ALL` findes ikke i SQL, `prBranche` skiftede betydning ved en omskrivning, og
navnematchningen fandt ikke "Beta IT ApS" ud fra "Beta IT".

Paritetstesten mellem SQL og JavaScript læser reglerne **ud af**
`src/services/tedService.js` frem for at gentage dem. Ændrer nogen dem dér,
fejler testen — i stedet for at bestå på en forældet kopi.

`embedded-postgres` står med vilje ikke i `package.json`: den henter en
PostgreSQL-binary pr. platform som optionalDependency, og Vercel ville så
hente Linux-udgaven ved hvert deploy — 144 MB for en test, der aldrig kører
der. Scriptet siger selv til, hvis modulet mangler.

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
