const NAV_ITEMS = [
  { id: "company", label: "Virksomhedsopslag" },
  { id: "tenders", label: "Udbud & markedsanalyse" }
];

export default function TopNav({ activeView, onChangeView }) {
  return (
    <header className="topbar sticky">
      <div className="topbar-inner">
        <div>
          <p className="eyebrow">Market Intelligence</p>
          <h1 className="top-title">Markedsanalyse</h1>
        </div>

        <nav className="button-row">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-button ${activeView === item.id ? "active" : ""}`}
              onClick={() => onChangeView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
