import { useMemo, useState } from "react";

export default function App() {
  const [query, setQuery] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [selectedCPV, setSelectedCPV] = useState("72222300-0");
  const [compareSuppliers, setCompareSuppliers] = useState([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResults, setAiResults] = useState([]);
  const [activeSection, setActiveSection] = useState("dashboard");

  const cpvOptions = [
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

  const suppliers = [
    {
      id: 1,
      name: "Atea",
      description:
        "IT-infrastruktur, cloud services og sikkerhedsløsninger til større organisationer.",
      region: "Nordics",
      countries: ["Danmark", "Sverige", "Norge", "Finland"],
      size: "Enterprise",
      employees: "8.000+",
      marketPosition: "Market leader",
      ownership: "Børsnoteret",
      certifications: ["ISO 27001", "ISO 9001", "ISAE 3402"],
      cpvMatches: ["72222300-0", "72400000-4", "72227000-2"],
      pricingModel: "Managed service + transitionsprojekt",
      contact: {
        name: "Mette Andersen",
        title: "Public Sector Director",
        email: "mette.andersen@atea.demo",
        phone: "+45 20 00 00 01"
      },
      details: {
        services: ["Cloud", "Infrastruktur", "Sikkerhed", "Managed workplace", "Netværk"],
        references: ["DSB", "Region Hovedstaden", "SKI-kunder", "Statens IT"],
        technologies: ["Azure", "SAP", "Cisco", "VMware", "M365"],
        risks: [
          "Høj eksponering mod større offentlige kunder",
          "Bred portefølje kan gøre specialtilpasning dyrere"
        ],
        summary:
          "Relevant til større drifts- og infrastrukturudbud, især hvor der er behov for nordisk tilstedeværelse, cloud-kompetence og moden governance.",
        requirementFit: [
          { label: "24/7 drift og support", score: 95 },
          { label: "SAP-integration", score: 82 },
          { label: "Lokal dansk leverance", score: 93 },
          { label: "Skalerbar transition", score: 88 }
        ],
        commercialSignals: [
          "Stærk offentlig sektor-position i Danmark",
          "Velegnet til større multi-lot eller samlede driftsmodeller",
          "Kan være mindre attraktiv ved meget nicheprægede use cases"
        ]
      },
      financials: {
        revenue: "22 mia. DKK",
        stability: "Høj",
        creditRisk: "Lav",
        publicSectorShare: "35%"
      },
      contracts: [
        {
          title: "Drift og infrastruktur",
          authority: "DSB",
          value: "25 mio. DKK",
          year: "2025",
          relevance: "Høj"
        },
        {
          title: "Cloud transformation",
          authority: "Region Hovedstaden",
          value: "40 mio. DKK",
          year: "2024",
          relevance: "Høj"
        },
        {
          title: "Workplace services",
          authority: "Statslig myndighed",
          value: "18 mio. DKK",
          year: "2023",
          relevance: "Mellem"
        }
      ]
    },
    {
      id: 2,
      name: "Netcompany",
      description:
        "Digital transformation, offentlige platforme og integrationsløsninger.",
      region: "EU",
      countries: ["Danmark", "Storbritannien", "Norge", "Holland"],
      size: "Enterprise",
      employees: "7.500+",
      marketPosition: "Public sector specialist",
      ownership: "Børsnoteret",
      certifications: ["ISO 27001", "ISAE 3000", "ISO 14001"],
      cpvMatches: ["72227000-2", "72222300-0"],
      pricingModel: "Projekt + forvaltning / platform drift",
      contact: {
        name: "Søren Holm",
        title: "Bid Director",
        email: "soren.holm@netcompany.demo",
        phone: "+45 20 00 00 02"
      },
      details: {
        services: ["Udvikling", "Offentlig IT", "Platforme", "Integration", "Forvaltning"],
        references: ["ATP", "Skatteforvaltningen", "EU-institutioner", "Kommuner"],
        technologies: ["Java", "Cloud", "Microservices", "API management", "Data platforms"],
        risks: [
          "Mindre fokus på ren infrastrukturdrift",
          "Høj afhængighed af komplekse transformationsprojekter"
        ],
        summary:
          "Særligt relevant hvor udbuddet har et stort integrations- eller transformationsspor, og hvor offentlig sektor-erfaring og business forankring vejer tungt.",
        requirementFit: [
          { label: "24/7 drift og support", score: 72 },
          { label: "SAP-integration", score: 76 },
          { label: "Lokal dansk leverance", score: 89 },
          { label: "Skalerbar transition", score: 85 }
        ],
        commercialSignals: [
          "Meget stærk track record i det offentlige Danmark",
          "God til integration og krav med høj proceskompleksitet",
          "Mindre oplagt hvis fokus er klassisk infra outsourcing alene"
        ]
      },
      financials: {
        revenue: "11 mia. DKK",
        stability: "Høj",
        creditRisk: "Lav",
        publicSectorShare: "50%"
      },
      contracts: [
        {
          title: "Platform modernization",
          authority: "ATP",
          value: "55 mio. DKK",
          year: "2025",
          relevance: "Høj"
        },
        {
          title: "Integrationsydelser",
          authority: "Kommune X",
          value: "12 mio. DKK",
          year: "2024",
          relevance: "Høj"
        },
        {
          title: "Fællesoffentlig løsning",
          authority: "Statslig enhed",
          value: "28 mio. DKK",
          year: "2023",
          relevance: "Mellem"
        }
      ]
    },
    {
      id: 3,
      name: "T-Systems",
      description:
        "Enterprise outsourcing, cloud og managed services med international leverancemodel.",
      region: "Global",
      countries: ["Tyskland", "Danmark", "Polen", "Spanien", "Ungarn"],
      size: "Enterprise",
      employees: "26.000+",
      marketPosition: "Global player",
      ownership: "Datterselskab",
      certifications: ["ISO 27001", "ISO 22301", "SOC 2"],
      cpvMatches: ["72222300-0", "72400000-4", "72227000-2"],
      pricingModel: "Outsourcing + run-rate + transformationsspor",
      contact: {
        name: "Anna Fischer",
        title: "Strategic Pursuit Lead",
        email: "anna.fischer@tsystems.demo",
        phone: "+49 30 00 00 03"
      },
      details: {
        services: ["Outsourcing", "Cloud", "Managed Services", "SAP drift", "Hybrid drift"],
        references: ["Deutsche Bahn", "EU agencies", "Internationale enterprise-kunder"],
        technologies: ["SAP", "AWS", "Private Cloud", "Hybrid drift", "ServiceNow"],
        risks: [
          "International governance kan gøre lokal koordinering tungere",
          "Kan være mindre attraktiv i mindre udbud"
        ],
        summary:
          "God kandidat til større outsourcing- og driftsudbud, især hvor skalerbarhed, enterprise-governance og multi-country leverance er vigtigt.",
        requirementFit: [
          { label: "24/7 drift og support", score: 96 },
          { label: "SAP-integration", score: 91 },
          { label: "Lokal dansk leverance", score: 61 },
          { label: "Skalerbar transition", score: 94 }
        ],
        commercialSignals: [
          "Særligt stærk i store og komplekse enterprise-setups",
          "Kontrakterne er ofte længere og mere governance-tunge",
          "Mindre oplagt hvis ordregiver ønsker en meget lokal eller mindre leverancemodel"
        ]
      },
      financials: {
        revenue: "32 mia. DKK",
        stability: "Høj",
        creditRisk: "Lav",
        publicSectorShare: "20%"
      },
      contracts: [
        {
          title: "Enterprise outsourcing",
          authority: "Deutsche Bahn",
          value: "120 mio. EUR",
          year: "2025",
          relevance: "Høj"
        },
        {
          title: "Cloud managed services",
          authority: "EU Agency",
          value: "18 mio. EUR",
          year: "2024",
          relevance: "Mellem"
        },
        {
          title: "SAP run services",
          authority: "Utility company",
          value: "22 mio. EUR",
          year: "2023",
          relevance: "Høj"
        }
      ]
    },
    {
      id: 4,
      name: "LINK Mobility",
      description:
        "Kommunikationsplatform og messaging-services med stærkt fokus på SMS og omnichannel.",
      region: "Nordics",
      countries: ["Danmark", "Sverige", "Norge", "Finland"],
      size: "Mid-market",
      employees: "700+",
      marketPosition: "Niche player",
      ownership: "Børsnoteret",
      certifications: ["ISO 27001", "GDPR-ready processer"],
      cpvMatches: ["64212000-5", "72400000-4"],
      pricingModel: "Licens / forbrug + integration",
      contact: {
        name: "Julie Madsen",
        title: "Nordic Public Lead",
        email: "julie.madsen@link.demo",
        phone: "+45 20 00 00 04"
      },
      details: {
        services: [
          "SMS gateway",
          "Notifikationer",
          "Kommunikationsplatform",
          "Omnichannel messaging",
          "API integration"
        ],
        references: ["Nordiske offentlige kunder", "Transport- og utility-sektoren"],
        technologies: ["API", "Messaging", "Email", "Automation", "Notification engine"],
        risks: [
          "Mere nichepræget end fuld infrastrukturleverandør",
          "Afhænger af use case og integrationskrav"
        ],
        summary:
          "Meget relevant til udbud om SMS gateway, notifikationer og kommunikationsflows, særligt hvis time-to-market, brugerrejser og events er vigtigt.",
        requirementFit: [
          { label: "24/7 drift og support", score: 78 },
          { label: "SAP-integration", score: 81 },
          { label: "Lokal dansk leverance", score: 84 },
          { label: "Skalerbar transition", score: 70 }
        ],
        commercialSignals: [
          "Stærk nicheposition på messaging og notifikationer",
          "Kan fungere godt som single-purpose eller specialiseret lot",
          "Mindre egnet til brede infrastrukturudbud"
        ]
      },
      financials: {
        revenue: "2,1 mia. DKK",
        stability: "Mellem-høj",
        creditRisk: "Mellem",
        publicSectorShare: "18%"
      },
      contracts: [
        {
          title: "SMS og notifikationer",
          authority: "Offentlig kunde",
          value: "6 mio. DKK",
          year: "2025",
          relevance: "Høj"
        },
        {
          title: "Kommunikationsplatform",
          authority: "Transportvirksomhed",
          value: "4 mio. DKK",
          year: "2024",
          relevance: "Høj"
        },
        {
          title: "Borgerkommunikation",
          authority: "Nordisk myndighed",
          value: "3 mio. DKK",
          year: "2023",
          relevance: "Mellem"
        }
      ]
    }
  ];

  const selectedMarket = cpvOptions.find((c) => c.code === selectedCPV) || cpvOptions[0];

  const getRelevanceScore = (supplier, cpv = selectedCPV, prompt = "") => {
    let score = supplier.cpvMatches.includes(cpv) ? 7 : 3;

    const combinedText = [
      supplier.name,
      supplier.description,
      ...(supplier.details.services || []),
      ...(supplier.details.technologies || []),
      ...(supplier.details.references || []),
      ...(supplier.countries || [])
    ]
      .join(" ")
      .toLowerCase();

    const promptTerms = prompt
      .toLowerCase()
      .split(/[,\s]+/)
      .filter((term) => term.length > 2);

    const matchedTerms = promptTerms.filter((term) => combinedText.includes(term)).length;
    score += Math.min(matchedTerms, 3);

    if (
      supplier.marketPosition === "Market leader" ||
      supplier.marketPosition === "Global player"
    ) {
      score += 0.5;
    }

    return Math.min(10, Number(score.toFixed(1)));
  };

  const filteredSuppliers = useMemo(() => {
    return suppliers.filter((supplier) => {
      const text =
        `${supplier.name} ${supplier.description} ${supplier.region} ${supplier.size} ${supplier.marketPosition} ${supplier.countries.join(" ")}`.toLowerCase();

      const matchesQuery = query ? text.includes(query.toLowerCase()) : true;
      const matchesCPV = selectedCPV ? supplier.cpvMatches.includes(selectedCPV) : true;

      return matchesQuery && matchesCPV;
    });
  }, [query, selectedCPV]);

  const comparedSupplierData = suppliers.filter((supplier) =>
    compareSuppliers.includes(supplier.id)
  );

  const marketStats = useMemo(() => {
    const enterpriseCount = filteredSuppliers.filter((s) => s.size === "Enterprise").length;
    const nicheCount = filteredSuppliers.filter(
      (s) => s.marketPosition === "Niche player"
    ).length;

    const avgRelevance = filteredSuppliers.length
      ? (
          filteredSuppliers.reduce(
            (sum, supplier) => sum + getRelevanceScore(supplier),
            0
          ) / filteredSuppliers.length
        ).toFixed(1)
      : "0.0";

    return {
      supplierCount: filteredSuppliers.length,
      enterpriseShare: filteredSuppliers.length
        ? Math.round((enterpriseCount / filteredSuppliers.length) * 100)
        : 0,
      nicheShare: filteredSuppliers.length
        ? Math.round((nicheCount / filteredSuppliers.length) * 100)
        : 0,
      avgRelevance
    };
  }, [filteredSuppliers]);

  const topSuppliers = [...filteredSuppliers]
    .sort((a, b) => getRelevanceScore(b) - getRelevanceScore(a))
    .slice(0, 3);

  const toggleCompare = (supplierId) => {
    setCompareSuppliers((prev) => {
      if (prev.includes(supplierId)) return prev.filter((id) => id !== supplierId);
      if (prev.length >= 3) return prev;
      return [...prev, supplierId];
    });
  };

  const runAiSuggestion = () => {
    const ranked = [...suppliers]
      .map((supplier) => ({
        ...supplier,
        score: getRelevanceScore(supplier, selectedCPV, aiPrompt)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    setAiResults(ranked);
    setActiveSection("ai");
  };

  const NavButton = ({ id, label }) => (
    <button
      onClick={() => setActiveSection(id)}
      className={`nav-button ${activeSection === id ? "active" : ""}`}
    >
      {label}
    </button>
  );

  const RequirementBar = ({ label, score }) => (
    <div className="requirement-bar-wrap">
      <div className="requirement-bar-header">
        <span>{label}</span>
        <span>{score}%</span>
      </div>
      <div className="requirement-bar-bg">
        <div className="requirement-bar-fill" style={{ width: `${score}%` }} />
      </div>
    </div>
  );

  if (selectedSupplier) {
    const relevanceScore = getRelevanceScore(selectedSupplier);

    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-inner">
            <div>
              <p className="eyebrow">Pitch demo</p>
              <h1 className="top-title">Leverandørprofil</h1>
            </div>
            <div className="button-row">
              <button className="btn btn-secondary" onClick={() => setSelectedSupplier(null)}>
                ← Tilbage til oversigt
              </button>
              <button className="btn btn-primary" onClick={() => setActiveSection("suppliers")}>
                Gå til leverandørlisten
              </button>
            </div>
          </div>
        </header>

        <main className="page">
          <section className="hero hero-profile">
            <div className="hero-grid">
              <div>
                <p className="eyebrow light">Supplier intelligence</p>
                <h2 className="hero-title">{selectedSupplier.name}</h2>
                <p className="hero-text">{selectedSupplier.description}</p>

                <div className="tag-row">
                  <span className="tag dark">{selectedSupplier.region}</span>
                  <span className="tag dark">{selectedSupplier.size}</span>
                  <span className="tag dark">{selectedSupplier.marketPosition}</span>
                  <span className="tag dark">{selectedSupplier.employees}</span>
                </div>
              </div>

              <div className="metrics-grid">
                <div className="metric-card dark">
                  <p>Relevansscore</p>
                  <h3>{relevanceScore}/10</h3>
                  <span>Ift. {selectedMarket.label}</span>
                </div>
                <div className="metric-card dark">
                  <p>Finansiel stabilitet</p>
                  <h3>{selectedSupplier.financials.stability}</h3>
                  <span>Kreditrisiko: {selectedSupplier.financials.creditRisk}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="grid two-one">
            <div className="card">
              <h3>Kort vurdering</h3>
              <p className="muted">{selectedSupplier.details.summary}</p>

              <div className="grid two-col inner-gap">
                <div>
                  <p className="section-label">Match på centrale kravtyper</p>
                  <div className="stack">
                    {selectedSupplier.details.requirementFit.map((item, index) => (
                      <RequirementBar key={index} label={item.label} score={item.score} />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="section-label">Kommercielle signaler</p>
                  <ul className="list">
                    {selectedSupplier.details.commercialSignals.map((signal, index) => (
                      <li key={index}>{signal}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="card">
              <h3>Kontakt og outline</h3>
              <div className="stack text-sm">
                <div>
                  <strong>Primær kontakt</strong>
                  <p>{selectedSupplier.contact.name}</p>
                  <p className="muted">{selectedSupplier.contact.title}</p>
                </div>
                <div>
                  <strong>Kontaktoplysninger</strong>
                  <p>{selectedSupplier.contact.email}</p>
                  <p>{selectedSupplier.contact.phone}</p>
                </div>
                <div>
                  <strong>Prismodel</strong>
                  <p>{selectedSupplier.pricingModel}</p>
                </div>
                <div>
                  <strong>Lande</strong>
                  <p>{selectedSupplier.countries.join(", ")}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="grid three-col">
            <div className="card">
              <h3>Services</h3>
              <ul className="list">
                {selectedSupplier.details.services.map((service, index) => (
                  <li key={index}>{service}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3>Teknologier</h3>
              <ul className="list">
                {selectedSupplier.details.technologies.map((tech, index) => (
                  <li key={index}>{tech}</li>
                ))}
              </ul>
            </div>

            <div className="card">
              <h3>Certificeringer</h3>
              <ul className="list">
                {selectedSupplier.certifications.map((cert, index) => (
                  <li key={index}>{cert}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="grid two-one-wide">
            <div className="card">
              <div className="space-between">
                <h3>Vundne kontrakter / relevante udbud</h3>
                <span className="pill">Demo-data</span>
              </div>

              <div className="stack">
                {selectedSupplier.contracts.map((contract, index) => (
                  <div className="subcard" key={index}>
                    <div className="space-between mobile-stack">
                      <div>
                        <strong>{contract.title}</strong>
                        <p className="muted">Ordregiver: {contract.authority}</p>
                      </div>
                      <div className="align-right">
                        <p>Værdi: {contract.value}</p>
                        <p>År: {contract.year}</p>
                        <p>Relevans: {contract.relevance}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <h3>Økonomi og risikoprofil</h3>
              <div className="stack text-sm">
                <div className="space-between"><span>Omsætning</span><strong>{selectedSupplier.financials.revenue}</strong></div>
                <div className="space-between"><span>Finansiel stabilitet</span><strong>{selectedSupplier.financials.stability}</strong></div>
                <div className="space-between"><span>Kreditrisiko</span><strong>{selectedSupplier.financials.creditRisk}</strong></div>
                <div className="space-between"><span>Andel offentlige kunder</span><strong>{selectedSupplier.financials.publicSectorShare}</strong></div>

                <div className="divider" />

                <div>
                  <strong>Primære risici</strong>
                  <ul className="list">
                    {selectedSupplier.details.risks.map((risk, index) => (
                      <li key={index}>{risk}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section className="card cta-card">
            <div>
              <p className="eyebrow">Pitch-moment</p>
              <h3>Klar til at blive vist til en ordregiver</h3>
              <p className="muted">
                Profilen samler markedsdata, kontraktspor, teknisk fit og risikobillede i ét view.
              </p>
            </div>

            <div className="button-row">
              <button className="btn btn-secondary" onClick={() => toggleCompare(selectedSupplier.id)}>
                {compareSuppliers.includes(selectedSupplier.id)
                  ? "Fjern fra sammenligning"
                  : "Tilføj til sammenligning"}
              </button>
              <button className="btn btn-primary" onClick={() => setSelectedSupplier(null)}>
                Tilbage til platformen
              </button>
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar sticky">
        <div className="topbar-inner">
          <div>
            <p className="eyebrow">Pitch-ready demo</p>
            <h1 className="top-title">Market Intelligence Platform</h1>
          </div>

          <div className="header-badges">
            <span className="pill">Ordregiver-view</span>
            <span className="pill">Supplier intelligence</span>
            <span className="pill">AI search</span>
          </div>
        </div>
      </header>

      <div className="page layout">
        <aside className="sidebar">
          <div className="card">
            <p className="eyebrow">Navigation</p>
            <div className="stack small-gap">
              <NavButton id="dashboard" label="Dashboard" />
              <NavButton id="market" label="Market overview" />
              <NavButton id="suppliers" label="Leverandører" />
              <NavButton id="compare" label="Sammenligning" />
              <NavButton id="ai" label="AI-assistent" />
            </div>
          </div>

          <div className="card">
            <p className="eyebrow">Til demo</p>
            <div className="stack text-sm">
              <p>Vis hvordan en ordregiver kan gå fra marked → leverandør → kontraktspor → vurdering.</p>
              <p>Brug CPV-skiftet til at demonstrere, at platformen skifter marked og foreslår relevante aktører.</p>
            </div>
          </div>
        </aside>

        <main className="content">
          <section className="hero">
            <div className="hero-grid">
              <div>
                <p className="eyebrow light">SaaS mockup til offentlige indkøbere</p>
                <h2 className="hero-title">
                  Research markeder, forstå leverandører og forbered bedre udbud.
                </h2>
                <p className="hero-text">
                  En platform hvor ordregivere kan søge på CPV-koder, analysere markedet, se relevante leverandører, sammenligne dem og bruge AI til at finde de bedste kandidater.
                </p>

                <div className="button-row">
                  <button className="btn btn-light" onClick={() => setActiveSection("market")}>
                    Se market overview
                  </button>
                  <button className="btn btn-outline-light" onClick={() => setActiveSection("suppliers")}>
                    Se leverandører
                  </button>
                </div>
              </div>

              <div className="metrics-grid">
                <div className="metric-card dark">
                  <p>Valgt marked</p>
                  <h3>{selectedMarket.label}</h3>
                  <span>{selectedMarket.code}</span>
                </div>
                <div className="metric-card dark">
                  <p>Identificerede leverandører</p>
                  <h3>{marketStats.supplierCount}</h3>
                  <span>Match på valgt marked</span>
                </div>
                <div className="metric-card dark">
                  <p>Markedstrend</p>
                  <h3>{selectedMarket.trend}</h3>
                  <span>Demo-estimat</span>
                </div>
                <div className="metric-card dark">
                  <p>Sammenligning</p>
                  <h3>{compareSuppliers.length}/3</h3>
                  <span>Klar til side-by-side view</span>
                </div>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="filters-grid">
              <div>
                <label>CPV / marked</label>
                <select
                  className="input"
                  value={selectedCPV}
                  onChange={(e) => setSelectedCPV(e.target.value)}
                >
                  {cpvOptions.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.code} · {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Søgeterm</label>
                <input
                  className="input"
                  placeholder="Fx SAP, SMS gateway, cloud drift"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div>
                <label>AI prompt</label>
                <input
                  className="input"
                  placeholder="Fx leverandører med SAP og nordisk footprint"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                />
              </div>

              <div className="button-row align-end">
                <button className="btn btn-primary" onClick={() => setActiveSection("market")}>
                  Opdater marked
                </button>
                <button className="btn btn-secondary" onClick={runAiSuggestion}>
                  Kør AI-forslag
                </button>
              </div>
            </div>
          </section>

          {(activeSection === "dashboard" || activeSection === "market") && (
            <section className="stack section-gap">
              <div className="grid four-col">
                <div className="card metric-simple">
                  <p>Typisk kontraktstørrelse</p>
                  <h3>{selectedMarket.avgContract}</h3>
                </div>
                <div className="card metric-simple">
                  <p>Markedsmodenhed</p>
                  <h3>{selectedMarket.maturity}</h3>
                </div>
                <div className="card metric-simple">
                  <p>Enterprise-andel</p>
                  <h3>{marketStats.enterpriseShare}%</h3>
                </div>
                <div className="card metric-simple">
                  <p>Gennemsnitlig relevans</p>
                  <h3>{marketStats.avgRelevance}/10</h3>
                </div>
              </div>

              <div className="grid two-one">
                <div className="card">
                  <div className="space-between">
                    <h3>Market overview</h3>
                    <span className="pill">{selectedMarket.code}</span>
                  </div>

                  <div className="grid two-col inner-gap">
                    <div>
                      <p className="section-label">Markedskarakteristika</p>
                      <ul className="list">
                        <li>Leverandørmarked med {marketStats.supplierCount} synlige kandidater i dette demo-view</li>
                        <li>Enterprise-andel på ca. {marketStats.enterpriseShare}%</li>
                        <li>Nicheandel på ca. {marketStats.nicheShare}%</li>
                        <li>Typisk egnet til mini-markedsdialog før kravfastsættelse</li>
                      </ul>
                    </div>
                    <div>
                      <p className="section-label">Trends</p>
                      <ul className="list">
                        <li>Øget fokus på cloud og standardiserede services</li>
                        <li>Højere vægt på integrationer og driftsgovernance</li>
                        <li>Mere dokumentation om sikkerhed, compliance og transition</li>
                        <li>Specialiserede nicheaktører fungerer godt i delområder / lots</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h3>Market map</h3>
                  <div className="stack">
                    {topSuppliers.map((supplier) => (
                      <div key={supplier.id} className="subcard">
                        <div className="space-between">
                          <div>
                            <strong>{supplier.name}</strong>
                            <p className="muted small">{supplier.marketPosition}</p>
                          </div>
                          <strong>{getRelevanceScore(supplier)}/10</strong>
                        </div>

                        <div className="progress-bg">
                          <div
                            className="progress-fill"
                            style={{ width: `${getRelevanceScore(supplier) * 10}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          {(activeSection === "dashboard" || activeSection === "suppliers") && (
            <section>
              <div className="section-header">
                <div>
                  <h3>Leverandører</h3>
                  <p className="muted">
                    Profiler med kontraktspor, tekniske signaler, certificeringer og risikobillede.
                  </p>
                </div>
                <div className="muted small">
                  Klik på en profil eller vælg leverandører til sammenligning
                </div>
              </div>

              <div className="grid two-col">
                {filteredSuppliers.map((supplier) => (
                  <div className="card supplier-card" key={supplier.id}>
                    <div className="space-between">
                      <div>
                        <h4>{supplier.name}</h4>
                        <p className="muted">{supplier.description}</p>
                      </div>
                      <span className="pill">{getRelevanceScore(supplier)}/10</span>
                    </div>

                    <div className="tag-row">
                      <span className="tag">{supplier.region}</span>
                      <span className="tag">{supplier.size}</span>
                      <span className="tag">{supplier.marketPosition}</span>
                      <span className="tag">{supplier.employees}</span>
                    </div>

                    <div className="grid two-col inner-gap">
                      <div className="subcard">
                        <p className="small muted">Seneste kontrakt</p>
                        <strong>{supplier.contracts[0].title}</strong>
                        <p className="small muted">{supplier.contracts[0].authority}</p>
                      </div>
                      <div className="subcard">
                        <p className="small muted">Certificering</p>
                        <strong>{supplier.certifications[0]}</strong>
                        <p className="small muted">+ {supplier.certifications.length - 1} flere</p>
                      </div>
                    </div>

                    <div className="stack">
                      <RequirementBar label="Match på marked" score={getRelevanceScore(supplier) * 10} />
                      <RequirementBar
                        label="Lokal og operativ modenhed"
                        score={supplier.details.requirementFit[2].score}
                      />
                    </div>

                    <div className="button-row">
                      <button className="btn btn-primary" onClick={() => setSelectedSupplier(supplier)}>
                        Åbn profil
                      </button>
                      <button className="btn btn-secondary" onClick={() => toggleCompare(supplier.id)}>
                        {compareSuppliers.includes(supplier.id)
                          ? "Fjern fra sammenligning"
                          : "Sammenlign"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(activeSection === "dashboard" || activeSection === "compare") && (
            <section className="card">
              <div className="section-header">
                <div>
                  <h3>Sammenligning</h3>
                  <p className="muted">
                    Vælg op til tre leverandører og få et hurtigt side-by-side overblik.
                  </p>
                </div>

                <div className="button-row">
                  <span className="pill">{compareSuppliers.length}/3 valgt</span>
                  <button className="btn btn-secondary" onClick={() => setCompareSuppliers([])}>
                    Nulstil
                  </button>
                </div>
              </div>

              {comparedSupplierData.length >= 2 ? (
                <div className="grid three-col">
                  {comparedSupplierData.map((supplier) => (
                    <div className="card compare-inner" key={supplier.id}>
                      <h4>{supplier.name}</h4>
                      <p className="muted">{supplier.marketPosition}</p>

                      <div className="stack text-sm">
                        <p><strong>Region:</strong> {supplier.region}</p>
                        <p><strong>Størrelse:</strong> {supplier.size}</p>
                        <p><strong>Relevans:</strong> {getRelevanceScore(supplier)}/10</p>
                        <p><strong>Prismodell:</strong> {supplier.pricingModel}</p>
                        <p><strong>Certificeringer:</strong> {supplier.certifications.join(", ")}</p>
                        <p><strong>Topteknologier:</strong> {supplier.details.technologies.slice(0, 3).join(", ")}</p>
                        <p><strong>Referencer:</strong> {supplier.details.references.slice(0, 2).join(", ")}</p>
                      </div>

                      <div className="stack">
                        {supplier.details.requirementFit.slice(0, 3).map((item, index) => (
                          <RequirementBar key={index} label={item.label} score={item.score} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h4>Vælg mindst to leverandører for at aktivere sammenligningen</h4>
                  <p className="muted">Brug knappen “Sammenlign” på leverandørkortene nedenfor.</p>
                </div>
              )}
            </section>
          )}

          {(activeSection === "dashboard" || activeSection === "ai") && (
            <section className="card">
              <div className="section-header">
                <div>
                  <h3>AI-assistent</h3>
                  <p className="muted">
                    Skriv din behovsbeskrivelse og få forslag til relevante leverandører.
                  </p>
                </div>
                <button className="btn btn-primary" onClick={runAiSuggestion}>
                  Foreslå leverandører
                </button>
              </div>

              <textarea
                className="textarea"
                placeholder="Fx: Giv mig relevante leverandører til en SMS gateway med SAP integration i Norden og offentlige referencer"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />

              {aiResults.length > 0 ? (
                <div className="grid three-col">
                  {aiResults.map((supplier) => (
                    <div className="card compare-inner" key={supplier.id}>
                      <div className="space-between">
                        <div>
                          <h4>{supplier.name}</h4>
                          <p className="small muted">{supplier.marketPosition}</p>
                        </div>
                        <span className="pill">{supplier.score}/10</span>
                      </div>

                      <p className="muted">{supplier.details.summary}</p>

                      <div className="stack text-sm">
                        <p><strong>Fit:</strong> {supplier.details.services.slice(0, 2).join(", ")}</p>
                        <p><strong>Referencer:</strong> {supplier.details.references.slice(0, 2).join(", ")}</p>
                      </div>

                      <button className="btn btn-secondary" onClick={() => setSelectedSupplier(supplier)}>
                        Åbn profil
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h4>AI-svar vises her</h4>
                  <p className="muted">
                    Prøv fx: “leverandører med SAP, cloud drift og nordisk footprint”.
                  </p>
                </div>
              )}
            </section>
          )}

          <section className="card cta-card">
            <div>
              <p className="eyebrow">Sådan bruger du demoen</p>
              <h3>Tag den med ud til en ordregiver</h3>
              <p className="muted">
                Start i dashboardet, skift CPV-kode, vis market overview, åbn 2-3 leverandørprofiler og afslut med AI-søgning eller sammenligning.
              </p>
            </div>

            <div className="grid two-col">
              <div className="subcard">
                <strong>1. Marked</strong>
                <p className="muted small">Vælg CPV og vis trends</p>
              </div>
              <div className="subcard">
                <strong>2. Leverandører</strong>
                <p className="muted small">Vis profiler og kontraktspor</p>
              </div>
              <div className="subcard">
                <strong>3. Sammenlign</strong>
                <p className="muted small">Vurder fit og modenhed</p>
              </div>
              <div className="subcard">
                <strong>4. AI-hjælp</strong>
                <p className="muted small">Kort pathway fra behov til shortlist</p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
