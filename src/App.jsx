import { useEffect, useState } from "react";
import Rail from "./components/layout/Rail";
import CompanyLookupPage from "./pages/CompanyLookupPage";
import TenderPage from "./pages/TenderPage";
import TilbudsgiverPage from "./pages/TilbudsgiverPage";
import UdbudssoegningPage from "./pages/UdbudssoegningPage";
import NyeUdbudPage from "./pages/NyeUdbudPage";

// Hvilket faneblad man stod på er en del af "alt bliver slettet"-oplevelsen
// ved et refresh — uden dette hopper en refresh altid tilbage til
// Virksomhedsopslag, selv midt i en Tilbudsgiver-radar-analyse. Samme
// "markedsanalyse.*"-nøglemønster som ThemeToggle/ProjectsContext.
const VIEW_STORAGE_KEY = "markedsanalyse.activeView";
const VALID_VIEWS = ["company", "tenders", "bidder", "udbudssoegning", "nyeudbud"];

function readStoredView() {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return VALID_VIEWS.includes(stored) ? stored : "company";
  } catch {
    return "company";
  }
}

export default function App() {
  const [activeView, setActiveView] = useState(readStoredView);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, activeView);
    } catch {
      /* private mode — fanebladet holder bare kun sessionen ud */
    }
  }, [activeView]);

  // Kobler de 2 flows sammen: fra en markedsanalyse kan man hoppe direkte til
  // virksomhedsopslag for en kandidat-leverandør. Token bumpes ved hvert hop,
  // så CompanyLookupPage genkører søgningen selv hvis samme navn klikkes igen.
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyQueryToken, setCompanyQueryToken] = useState(0);

  const goToCompany = (name) => {
    setCompanyQuery(name);
    setCompanyQueryToken((token) => token + 1);
    setActiveView("company");
  };

  return (
    <div className="app-shell">
      <Rail activeView={activeView} onChangeView={setActiveView} />

      {/* key på arbejdsområdet: React river træet ned og bygger det op igen
          ved hvert flow-skift, så sidens indgangsanimation (.page > *)
          faktisk kører igen i stedet for kun ved første montering. Det er
          rent visuelt — sidernes egen tilstand nulstilles alligevel, da de
          er umonteret imellem. */}
      <div className="app-main" key={activeView}>
        {activeView === "company" && (
          <CompanyLookupPage prefillQuery={companyQuery} prefillToken={companyQueryToken} />
        )}
        {activeView === "tenders" && <TenderPage onGoToCompany={goToCompany} />}
        {activeView === "bidder" && <TilbudsgiverPage onGoToCompany={goToCompany} />}
        {activeView === "udbudssoegning" && <UdbudssoegningPage />}
        {activeView === "nyeudbud" && <NyeUdbudPage />}
      </div>
    </div>
  );
}
