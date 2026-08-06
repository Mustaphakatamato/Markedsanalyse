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

Fungerende MVP med to flows og fire live datakilder. Backend'en består af fire
Edge Functions med cache i Postgres. Der er endnu ingen brugerkonti, og udbud
gemmes stadig i browserens `localStorage`.

## De to flows

**Virksomhedsopslag** ([`pages/CompanyLookupPage.jsx`](src/pages/CompanyLookupPage.jsx))
— søg på navn eller CVR-nummer og få:
- CVR-stamdata (adresse, branche, selskabsform, ansatte, status)
- Regnskabstal med årsvælger, plus en udviklingsgraf over alle tilgængelige år
  (omsætning, resultat, egenkapital, balancesum, soliditetsgrad) — kan slås om
  til tabel
- Vundne EU-udbud fra TED med værdi, ordregiver og link til den enkelte notice
- Risikoprofil: soliditet og overskudsgrad holdt op mod branchegennemsnittet
- ESG & compliance — **demo-data**, se nedenfor

**Udbud & markedsanalyse** ([`pages/TenderPage.jsx`](src/pages/TenderPage.jsx))
— opret et udbud (titel, CPV-kode, deadline, anslået værdi) og få:
- Markedsnøgletal for CPV-koden — **demo-data**
- Kandidat-leverandører med relevans-score — **demo-data**
- Seneste rigtige kontrakttildelinger i markedet, hentet fra TED på CPV-koden

Flowene er koblet sammen: fra en kandidat-leverandør kan man hoppe direkte til
virksomhedsopslaget for den pågældende virksomhed ([`App.jsx`](src/App.jsx)).

## Datakilder

### Live — rigtig data

| Kilde | Leverer | Implementering |
|---|---|---|
| **CVR** via cvrapi.dk | Stamdata på virksomhed | [`cvrService.js`](src/services/cvrService.js) |
| **Erhvervsstyrelsen** (virk.dk, XBRL) | Regnskabstal pr. regnskabsår | [`regnskabService.js`](src/services/regnskabService.js) |
| **TED** (Tenders Electronic Daily, v3) | EU-udbud og kontrakttildelinger | [`tedService.js`](src/services/tedService.js) |
| **Danmarks Statistik** (tabel REGN50A) | Branchegennemsnit for nøgletal | [`industryBenchmarkService.js`](src/services/industryBenchmarkService.js) |

Hver kilde har sine egne begrænsninger — de er dokumenteret i toppen af den
enkelte servicefil. De vigtigste:

- **cvrapi.dk: 50 opslag/dag pr. IP.** Cachen gør det til et lille problem —
  kun det første opslag på en given virksomhed koster af kvoten, resten
  serveres fra Postgres i syv dage. Kilden kræver desuden en custom
  `User-Agent`, som browsere ikke selv må sætte; den sættes i Edge Function'en.
- **Regnskabsdata er kun tilgængelige over `http://`** og svarer nogle gange
  ekstremt langsomt. Store/børsnoterede selskaber, der indberetter i
  ESEF/IFRS-format, kan ikke parses — de vises som "nøgletal kunne ikke
  udtrækkes" med link til det indberettede regnskab.
- **TED dækker kun udbud over EU's tærskelværdi.** Mindre danske kontrakter
  findes ikke her.
- **Danmarks Statistik dækker kun private byerhverv** — landbrug, finans og
  offentlige brancher mangler (se [`naceSectionMap.js`](src/data/naceSectionMap.js)).
  Tallene er 1-2 år efterslæbte.

### Demo-data

Tre ting er hardcodet og markeret som demo-data i UI'et:

| Hvad | Fil |
|---|---|
| ESG-rapportering og EU-sanktionstjek (deterministisk pr. CVR; sanktionstjek svarer altid "intet match") | [`esgService.js`](src/services/esgService.js) |
| Kandidat-leverandører — 4 virksomheder med relevans-score | [`data/suppliers.js`](src/data/suppliers.js) |
| Markedsnøgletal pr. CPV-kode — 4 koder med trend, kontraktstørrelse, modenhed | [`data/cpvOptions.js`](src/data/cpvOptions.js) |

## Arkitektur

```
src/
  lib/         apiClient.js — ét sted der ved hvor backend'en ligger
  services/    Ét adapter-lag pr. datakilde — returnerer normaliserede objekter,
               så UI'et ikke kender kildernes formater
  data/        Demo-data (suppliers, cpvOptions) + naceSectionMap (branchekoder → DST-sektor)
  context/     ProjectsContext — udbud i localStorage
  components/  layout/TopNav, charts/TrendChart (håndtegnet SVG, ingen chart-lib)
  pages/       CompanyLookupPage, TenderPage
supabase/
  functions/   ted, cvr, regnskab-search, regnskab-doc + _shared/
  migrations/  Cache-tabeller
```

Appen har ingen router og ingen UI-afhængigheder — kun React og Vite. Navigation
mellem de to views er `useState` i `App.jsx`.

### Backend

Fire Edge Functions står mellem browseren og datakilderne. De findes fordi
kilderne ikke kan kaldes direkte: TED sender ingen CORS-headers, cvrapi.dk
kræver en `User-Agent` browsere ikke må sætte, og Erhvervsstyrelsens data
findes kun over `http://`.

De kaldes **ad samme vej i udvikling og produktion**. Det er bevidst: før lå
de samme fire proxier i `vite.config.js`, hvor de kun fandtes i `dev` og
`preview` — derfor kunne en bygget app ikke hostes. Genindfør ikke en dev-only
proxy.

Tre tabeller cacher svarene: CVR-opslag i syv dage, regnskabssøgninger i et
døgn, regnskabsdokumenter i 30 dage (et offentliggjort regnskab ændrer sig
ikke). Tabellerne har RLS slået til uden policies og er utilgængelige for
klienten — kun funktionerne, som bruger service-nøglen, kan røre dem.

XBRL-parsingen bliver i browseren med vilje: Edge Functions har kun 2s CPU-tid
pr. request, hvilket ikke rækker til et større regnskabsdokument. Proxying er
async I/O og tæller ikke med.

## Kendte begrænsninger

1. **Ingen brugerkonti.** Udbud ligger stadig i `localStorage` og findes kun i
   den enkelte browser. Der er hverken login, deling eller RLS på brugerdata.
2. **Fabrikeret compliance-data.** ESG-boksen og EU-sanktionstjekket i
   [`esgService.js`](src/services/esgService.js) er genereret ud fra
   CVR-nummeret. Sanktionstjekket svarer altid "intet match". Det er markeret
   som demo-data i UI'et, men i et værktøj der skal dokumentere en
   udbudsjournal er det den farligste del af appen.
3. **TED dækker kun over EU's tærskelværdi.** De fleste danske kontrakter
   ligger under og findes slet ikke i appen.
4. **Navnematch mod TED har en grænse.** Der er ingen CVR/VAT på vinderen i de
   felter vi henter, så koncernselskaber i andre lande med samme navn kan
   komme med.

## Næste skridt

1. **Rigtigt sanktionstjek** mod EU's konsoliderede liste — gratis og officiel.
   Fjerner den fabrikerede data, og er det enkeltløft der betyder mest.
2. **Nationale udbudsdata** (Udbud.dk) — dækker de kontrakter TED ikke gør.
3. **Auth og udbud i Postgres**, så en markedsundersøgelse kan deles i en
   organisation.
4. **CVR-API'et på data.virk.dk** i stedet for cvrapi.dk — fjerner
   kvotespørgsmålet helt og giver ledelse, ejerforhold og tegningsregel.
   Gratis, men kræver en systemadgangsaftale med Erhvervsstyrelsen.
