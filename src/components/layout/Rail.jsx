import ThemeToggle from "./ThemeToggle";
import Icon from "../ui/Icon";

// Appens skal er en fast venstreskinne, ikke en topbar. Tre grunde:
//
//   1. Flowene er ikke faneblade i et dokument — de er selvstændige
//      arbejdsgange. En skinne viser dem alle hele tiden, også når man er
//      langt nede i en analyse.
//   2. Etiketterne er lange ("Udbud & markedsanalyse"). Vandret i en topbar
//      måtte de forkortes; lodret er der plads til hele navnet.
//   3. Arbejdsområdet får hele bredden til tabeller og grafer i stedet for at
//      dele den med navigationen.
//
// Under 1040px lægger den samme markup sig vandret i toppen (se .rail i
// index.css) — der findes bevidst ikke en separat mobilnavigation at holde
// i sync.

const NAV_ITEMS = [
  { id: "company", label: "Virksomhedsopslag", icon: "building" },
  { id: "tenders", label: "Udbud & markedsanalyse", icon: "doc" },
  { id: "bidder", label: "Tilbudsgiver-radar", icon: "radar" },
  { id: "udbudssoegning", label: "Udbudssøgning", icon: "search" }
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

export default function Rail({ activeView, onChangeView }) {
  return (
    <aside className="rail">
      <div className="rail__brand">
        <span className="brand-mark">
          <BrandMark />
        </span>
        <div className="brand-text">
          <p className="eyebrow">Market Intelligence</p>
          <h1 className="top-title">Markedsanalyse</h1>
        </div>
      </div>

      <nav className="rail__nav" aria-label="Hovednavigation">
        <p className="rail__label">Flows</p>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="rail__item"
            aria-current={activeView === item.id ? "page" : undefined}
            /* På smalle skærme vises kun ikonet — se .rail__item span i
               index.css, hvor etiketten skjules visuelt men beholdes for
               skærmlæsere. title'en giver den samme oplysning med musen. */
            title={item.label}
            onClick={() => onChangeView(item.id)}
          >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="rail__foot">
        {/* Farvenøglen står ét fast sted i skallen i stedet for at skulle
            gentages på hvert kort. Den er selve præmissen for at læse
            resten af appen, og bør derfor altid være synlig. */}
        <p className="rail__note">
          Grøn = live kilde · Gul = demo-data · Rød = kræver afklaring
        </p>
        <ThemeToggle />
      </div>
    </aside>
  );
}
