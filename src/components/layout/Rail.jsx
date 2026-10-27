import ThemeToggle from "./ThemeToggle";
import BrandMark from "./BrandMark";
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
  // Overvågningen ("Nyt i mit felt") har ikke sit eget menupunkt: den er et
  // gemt filter på Udbudssøgning, fordi det var de samme bekendtgørelser fra
  // den samme tabel — kun med CPV-koderne valgt på forhånd og et tidsvindue.
  // Siden husker filtrene, så den vej ind koster stadig ingen valg.
  { id: "udbudssoegning", label: "Udbudssøgning", icon: "search" }
];

export default function Rail({ flows, activeView, onChangeView }) {
  const synligeFlows = flows ? NAV_ITEMS.filter((item) => flows.includes(item.id)) : NAV_ITEMS;
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
        {/* Med kun ét flow tilbage er overskriften "Flows" støj over en
            enkelt knap — den kommer igen af sig selv, når der er mere end
            én side at vælge imellem. */}
        {synligeFlows.length > 1 && <p className="rail__label">Flows</p>}
        {synligeFlows.map((item) => (
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
