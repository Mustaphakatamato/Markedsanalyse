# Market Intelligence Platform

SaaS-platform til danske offentlige ordregivere, der skal researche leverandørmarkedet
inden et udbud. Gå fra marked → leverandør → screening → shortliste → dokumentation,
samlet ét sted og klar til udbudsjournalen.

## Kør lokalt

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # produktion til dist/
```

## Status

Pitch-demo videreudviklet til en struktureret app. Kører på `localStorage` (ingen
backend endnu) med mock-data der kan skiftes til live-kilder uden at røre UI'et.

### Funktioner
- **Dashboard** med projekter, nyheder og pipeline-overblik
- **Projekt-workspace** — hver markedsundersøgelse med pipeline (Identificerede →
  Screenet → Shortlistet → Inviteret), status-bar, §39 compliance-banner, noter,
  aktivitetslog
- **Leverandørsøgning** med filter-panel (størrelse, region, certifikater) og
  fritekstsøgning
- **Leverandørprofil** med CVR-data, compliance-check (EU-sanktioner), kontrakter,
  finansiel risikoprofil
- **Markedsoverblik** med markedsbrief, market map og lignende udbud
- **Overvågning** — watchlist med alert-præferencer og ugentlig digest
- **AI-assistent** (heuristisk i dag — klar til Claude API)
- **Rapport-builder** — Bilag A til udbudsjournalen med sektion-toggles og PDF-print

## Arkitektur

```
src/
  data/        Mock-data (suppliers, cpvCodes, pipeline)
  lib/         scoring.js, report.js, supabaseClient.js
  services/    Dataservice-lag (CVR, sanktioner, marked) — mock + live-struktur
  context/     ProjectContext, WatchlistContext, ToastContext (localStorage)
  components/   layout/, supplier/, project/, ui/
  pages/       Dashboard, Projects, ProjectDetail, SupplierSearch,
               SupplierProfile, MarketOverview, Watchlist, AiAssistant, ReportBuilder
supabase/
  migrations/  0001_init.sql (schema — forberedt, ikke anvendt endnu)
```

### Tre-lags dataarkitektur (jf. produktplan)
- **Lag 1 — Live:** CVR, EU-sanktioner, TED, Danmarks Statistik
- **Lag 2 — Scheduled sync:** SKI, Udbud.dk, Arbejdstilsynet, Klagenævnet
- **Lag 3 — Leverandør self-service:** serviceattest, ISAE, ESPD (upload)

`src/services/` indeholder adaptere med mock-implementering + struktur til live-kald.
Sæt `VITE_USE_LIVE_DATA=true` for at forsøge live (kræver backend-proxy pga. CORS).

## Næste skridt
1. **Backend:** Opret Supabase-projekt, kør `supabase/migrations/0001_init.sql`,
   sæt env (se `.env.example`), skift contexts til Supabase. Auth via Azure AD/SSO.
2. **Live data:** CVR + TED + Danmarks Statistik via backend-proxy.
3. **AI:** Kobl AI-assistenten på Claude API med rigtige leverandør- og markedsdata.
4. **Integrationer:** SKI-aftaler, Arbejdstilsynet, D&B/Bisnode (UBO + kredit).
