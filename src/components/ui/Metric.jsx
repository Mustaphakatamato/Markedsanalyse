// Én linje nøgletal: etiket til venstre, tal til højre.
//
// Tallene sættes i tabularnumre (.num), så kolonner flugter lodret når man
// scanner ned gennem en liste. Det er hele grunden til at det er en komponent
// og ikke bare to divs — reglen skal gælde alle steder, og den blev allerede
// skrevet af i hånden på tværs af siderne.
//
// tone farver KUN tallet, og kun med de betydningsbærende farver: se
// index.css om hvorfor grøn/gul/rød aldrig bruges dekorativt.

export function Figure({ children, tone }) {
  const toneClass = tone ? ` metric__value--${tone}` : "";
  return <span className={`metric__value num${toneClass}`}>{children}</span>;
}

export default function MetricRow({ label, value, tone }) {
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <Figure tone={tone}>{value}</Figure>
    </div>
  );
}
