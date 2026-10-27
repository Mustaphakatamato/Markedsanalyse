import ThemeToggle from "./ThemeToggle";
import BrandMark from "./BrandMark";

// Skallen når der kun er ét flow. Skinnen i venstre side svarede på "hvor er
// jeg, og hvad kan jeg ellers" — det første spørgsmål er der kun ét svar på
// nu, og det andet er der ingen. Tilbage står tre ting, der ikke var
// navigation, og de fylder en lav bjælke frem for en hel kolonne:
//
//   1. Devoteams mærke, så siden har en afsender.
//   2. Farvenøglen. Den er præmissen for at læse resten af appen — hvad der
//      er live data og hvad der er demo — og må derfor stadig stå fast ét
//      sted, ikke gentages på hvert kort.
//   3. Temavalget.
//
// Rail.jsx bliver liggende til den dag, AKTIVE_FLOWS i App.jsx igen peger på
// mere end én side.
export default function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <BrandMark />
        <span className="topbar__skel" aria-hidden="true" />
        <div className="brand-text">
          <p className="eyebrow">AI-driven tech consulting</p>
          <h1 className="top-title">Markedsanalyse</h1>
        </div>
      </div>

      <p className="topbar__note">
        Grøn = live kilde · Gul = demo-data · Rød = kræver afklaring
      </p>
      <ThemeToggle />
    </header>
  );
}
