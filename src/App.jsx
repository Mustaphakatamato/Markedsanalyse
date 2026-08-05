import { useState } from "react";
import TopNav from "./components/layout/TopNav";
import CompanyLookupPage from "./pages/CompanyLookupPage";
import TenderPage from "./pages/TenderPage";

export default function App() {
  const [activeView, setActiveView] = useState("company");

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
      <TopNav activeView={activeView} onChangeView={setActiveView} />

      {activeView === "company" && (
        <CompanyLookupPage prefillQuery={companyQuery} prefillToken={companyQueryToken} />
      )}
      {activeView === "tenders" && <TenderPage onGoToCompany={goToCompany} />}
    </div>
  );
}
