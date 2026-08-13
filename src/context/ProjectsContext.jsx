import { createContext, useContext, useEffect, useState } from "react";

// Udbud i browserens localStorage. Der er stadig ingen brugerkonti, så et
// udbud findes kun i den browser det blev oprettet i — se README under
// "Kendte begrænsninger".

const STORAGE_KEY = "markedsanalyse.projects";

// Skemaversion. Et udbud er brugerens eget arbejde og må ikke gå tabt, fordi
// datamodellen ændrer sig — derfor migreres gamle udbud frem i stedet for at
// blive kasseret. Hæv ved BRYDENDE ændringer, og tilføj et trin i migrer().
const SKEMA_VERSION = 2;

const ProjectsContext = createContext(null);

// Version 1 havde én CPV-kode som streng og anslået værdi som FRITEKST
// ("Fx 25 mio. DKK"), så der kunne ikke regnes på den. Version 2 har flere
// CPV-koder, værdi som tal, bekræftede branchekoder og en shortliste.
function migrer(gemt) {
  if (!gemt || typeof gemt !== "object") return null;
  if (gemt.skemaVersion === SKEMA_VERSION) return gemt;

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
    skemaVersion: SKEMA_VERSION,
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
      value={{ udbud, gemtFejl, opretUdbud, opdaterUdbud, sletUdbud, skiftShortliste }}
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
