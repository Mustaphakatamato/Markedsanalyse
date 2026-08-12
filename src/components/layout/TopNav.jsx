import ThemeToggle from "./ThemeToggle";

const NAV_ITEMS = [
  { id: "company", label: "Virksomhedsopslag" },
  { id: "tenders", label: "Udbud & markedsanalyse" }
];

// Monogram i stedet for et logo vi ikke har: fire datapunkter og en linje —
// samme figur som grafen på virksomhedsopslaget.
function BrandMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.5 12.4L6.2 8.1l3 2.6 5.3-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14.5" cy="4.7" r="1.9" fill="currentColor" />
    </svg>
  );
}

export default function TopNav({ activeView, onChangeView }) {
  return (
    <header className="topbar sticky">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark">
            <BrandMark />
          </span>
          <div className="brand-text">
            <p className="eyebrow">Market Intelligence</p>
            <h1 className="top-title">Markedsanalyse</h1>
          </div>
        </div>

        <div className="topbar-tools">
          <nav className="nav-switch" aria-label="Hovednavigation">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={activeView === item.id ? "page" : undefined}
                onClick={() => onChangeView(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
