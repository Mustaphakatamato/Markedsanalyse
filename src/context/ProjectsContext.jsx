import { createContext, useContext, useEffect, useState } from "react";

// Udbud i browserens localStorage. Der er stadig ingen brugerkonti, så et
// udbud findes kun i den browser det blev oprettet i — se README under
// "Kendte begrænsninger".

const STORAGE_KEY = "markedsanalyse.projects";

// Skemaversion. Et udbud er brugerens eget arbejde og må ikke gå tabt, fordi
// datamodellen ændrer sig — derfor migreres gamle udbud frem i stedet for at
// blive kasseret. Hæv ved BRYDENDE ændringer, og tilføj et trin i migrer().
const SKEMA_VERSION = 3;

const ProjectsContext = createContext(null);

// Standardværdier for det, version 3 lagde til. Ét sted, så et nyt udbud og
// et migreret udbud ikke kan ende med hver sin udgave af "tomt".
function nytBehov(felter = {}) {
  return {
    hvad: "",
    formaal: "",
    varighedAar: null,
    geografi: "",
    // { cvr, navn } — den nuværende kontraktholder, hvis der er en
    nuvaerende: null,
    opdeling: "ved_ikke", // ja | nej | ved_ikke
    saerligeKrav: "",
    ...felter
  };
}

// Minimumsomsætning udtrykkes som en FAKTOR på den årlige kontraktværdi, ikke
// som et beløb. Ret man værdien i behovet, følger kravet med — et fast beløb
// ville stå tilbage og pludselig ligge over lovens loft på 2×.
const STANDARD_OEKONOMIKRAV = {
  omsaetningAktiv: true,
  omsaetningFaktor: 1,
  egenkapitalAktiv: true,
  soliditetAktiv: false,
  minSoliditet: 15
};

// Version 3 gør udbuddet til en markedsdialog: en guidet behovsopgørelse,
// AI'ens forslag til marked (gemt, så det ikke koster et nyt kald ved hvert
// besøg), periode for vinderoptællingen, et krav til økonomisk formåen og de
// regnskaber, der allerede er hentet — de koster to kald mod
// Erhvervsstyrelsen pr. virksomhed og skal ikke hentes igen efter et refresh.
function migrerTilV3(v2) {
  return {
    ...v2,
    skemaVersion: SKEMA_VERSION,
    // Den gamle beskrivelse ER svaret på "hvad skal anskaffes" — er den tom,
    // er titlen det bedste bud. Felterne beholdes, så intet forsvinder.
    behov: nytBehov({ hvad: v2.beskrivelse || v2.titel || "" }),
    aiForslag: null,
    periodeAar: STANDARD_PERIODE_AAR,
    oekonomikrav: { ...STANDARD_OEKONOMIKRAV },
    regnskaber: {},
    // Et udbud med valgte brancher har allerede et marked — åbn der.
    trin: v2.branchekoder?.length ? "marked" : "behov"
  };
}

// Knapperne hed 3, 5 og 10 år, indtil det viste sig, at TED ikke har
// vinderdata længere tilbage end slutningen af 2023 — de to øverste gav
// samme tal som 3 (se PERIODER i TrinLeverandoerer). Et udbud, der blev gemt
// dengang, står med 5 og ville møde en række knapper, hvor ingen er aktiv.
//
// Ingen versionsbump til det: periodeAar er en indstilling på en kontrol,
// ikke data, der kan gå tabt, og klampningen er idempotent — den kan køre på
// hvert indlæst udbud uden at ændre noget anden gang.
const STANDARD_PERIODE_AAR = 3;

function klampPeriode(u) {
  if (!u || typeof u !== "object") return u;
  const aar = Number(u.periodeAar);
  if (Number.isFinite(aar) && aar >= 1 && aar <= STANDARD_PERIODE_AAR) return u;
  return { ...u, periodeAar: STANDARD_PERIODE_AAR };
}

function migrer(gemt) {
  if (!gemt || typeof gemt !== "object") return null;
  if (gemt.skemaVersion === SKEMA_VERSION) return klampPeriode(gemt);
  const v2 = gemt.skemaVersion === 2 ? gemt : migrerTilV2(gemt);
  return v2 ? klampPeriode(migrerTilV3(v2)) : null;
}

// Version 1 havde én CPV-kode som streng og anslået værdi som FRITEKST
// ("Fx 25 mio. DKK"), så der kunne ikke regnes på den. Version 2 har flere
// CPV-koder, værdi som tal, bekræftede branchekoder og en shortliste.
function migrerTilV2(gemt) {

  // Fritekstværdien forsøges tolket, men gættes ikke: "25 mio. DKK" bliver
  // til 25.000.000, mens noget uforståeligt bliver til null og skal udfyldes
  // igen. Et forkert tal er værre end et manglende, fordi det regnes videre på.
  const raaVaerdi = String(gemt.estimatedValue ?? "");
  const tal = raaVaerdi.replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  let vaerdi = null;
  if (tal) {
    const n = Number(tal[0]);
    if (/mio|million/i.test(raaVaerdi)) vaerdi = Math.round(n * 1_000_000);
    else if (/mia|milliard/i.test(raaVaerdi)) vaerdi = Math.round(n * 1_000_000_000);
    else if (/\d/.test(raaVaerdi) && n >= 1000) vaerdi = Math.round(n);
  }

  return {
    id: gemt.id ?? crypto.randomUUID(),
    skemaVersion: 2,
    titel: gemt.titel ?? gemt.title ?? "Uden titel",
    beskrivelse: gemt.beskrivelse ?? gemt.description ?? "",
    // v1's cpvCode var én kode uden betegnelse. Betegnelsen slås op igen i
    // UI'et, så den altid er den officielle — v1 viste opdigtede betegnelser.
    cpvKoder: gemt.cpvKoder ?? (gemt.cpvCode ? [{ kode: gemt.cpvCode, tekst: null }] : []),
    anslaaetVaerdi: gemt.anslaaetVaerdi ?? vaerdi,
    vaerdiRaa: gemt.anslaaetVaerdi != null ? null : raaVaerdi || null,
    deadline: gemt.deadline ?? null,
    branchekoder: gemt.branchekoder ?? [],
    kommunekoder: gemt.kommunekoder ?? [],
    shortliste: gemt.shortliste ?? [],
    noter: gemt.noter ?? "",
    oprettet: gemt.oprettet ?? gemt.createdAt ?? new Date().toISOString(),
    aendret: gemt.aendret ?? gemt.createdAt ?? new Date().toISOString()
  };
}

function laesUdbud() {
  try {
    const raa = localStorage.getItem(STORAGE_KEY);
    if (!raa) return [];
    const liste = JSON.parse(raa);
    return Array.isArray(liste) ? liste.map(migrer).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function ProjectsProvider({ children }) {
  const [udbud, setUdbud] = useState(laesUdbud);
  // Skrivefejl må ikke vælte appen. Safaris private mode og en fuld kvote
  // kaster begge på setItem — tidligere var dette kald ubeskyttet.
  const [gemtFejl, setGemtFejl] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(udbud));
      setGemtFejl(null);
    } catch (err) {
      setGemtFejl(
        err?.name === "QuotaExceededError"
          ? "Der er ikke plads til flere udbud i browserens lager."
          : "Udbuddet kunne ikke gemmes i denne browser (fx privat browsing)."
      );
    }
  }, [udbud]);

  const opretUdbud = (felter) => {
    const nyt = {
      id: crypto.randomUUID(),
      skemaVersion: SKEMA_VERSION,
      titel: (felter.titel ?? "").trim(),
      beskrivelse: (felter.beskrivelse ?? "").trim(),
      cpvKoder: felter.cpvKoder ?? [],
      anslaaetVaerdi: felter.anslaaetVaerdi ?? null,
      vaerdiRaa: null,
      deadline: felter.deadline || null,
      branchekoder: [],
      kommunekoder: [],
      shortliste: [],
      noter: "",
      behov: nytBehov(felter.behov),
      aiForslag: null,
      periodeAar: STANDARD_PERIODE_AAR,
      oekonomikrav: { ...STANDARD_OEKONOMIKRAV },
      regnskaber: {},
      trin: "behov",
      oprettet: new Date().toISOString(),
      aendret: new Date().toISOString()
    };
    setUdbud((forrige) => [nyt, ...forrige]);
    return nyt;
  };

  // Manglede helt i v1: et udbud kunne kun oprettes og slettes. Uden den kan
  // en markedsanalyse ikke bygges trinvis, hvilket er hele arbejdsformen —
  // man vender tilbage til den, retter branchekoder og udvider shortlisten.
  const opdaterUdbud = (id, aendringer) => {
    setUdbud((forrige) =>
      forrige.map((u) =>
        u.id === id ? { ...u, ...aendringer, aendret: new Date().toISOString() } : u
      )
    );
  };

  // Regnskaberne hentes parallelt og lander ét ad gangen. Gik de gennem
  // opdaterUdbud med et samlet objekt, ville hvert svar overskrive de andre
  // med den udgave, det selv så ved start — derfor flettes de her, i den
  // funktionelle opdatering, mod den nyeste tilstand.
  const gemRegnskaber = (id, nye) => {
    setUdbud((forrige) =>
      forrige.map((u) =>
        u.id === id ? { ...u, regnskaber: { ...u.regnskaber, ...nye } } : u
      )
    );
  };

  const sletUdbud = (id) => setUdbud((forrige) => forrige.filter((u) => u.id !== id));

  const skiftShortliste = (id, cvr) => {
    setUdbud((forrige) =>
      forrige.map((u) => {
        if (u.id !== id) return u;
        const paa = u.shortliste.includes(cvr);
        return {
          ...u,
          shortliste: paa ? u.shortliste.filter((c) => c !== cvr) : [...u.shortliste, cvr],
          aendret: new Date().toISOString()
        };
      })
    );
  };

  return (
    <ProjectsContext.Provider
      value={{
        udbud,
        gemtFejl,
        opretUdbud,
        opdaterUdbud,
        gemRegnskaber,
        sletUdbud,
        skiftShortliste
      }}
    >
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProjects() {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("useProjects skal bruges inde i en ProjectsProvider");
  return ctx;
}
