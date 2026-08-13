// En rangeret fordeling: etiket, andelsbjælke, tal.
//
// FARVEVALGET ER IKKE ÆSTETIK. Alle fordelinger her viser STØRRELSE, ikke
// identitet — "hvor mange virksomheder er i denne branche", ikke "hvilken
// branche er dette". Størrelse er én skala, og skal derfor have én farve.
// Gav man hver branche sin egen kulør, ville farven foregive at betyde noget,
// den ikke betyder, og læseren ville lede efter et mønster i regnbuen.
//
// Farven er husets --info-blå, som TrendChart allerede bruger til dataserier.
// Den er bevidst hverken violet (som betyder "systemet gør noget") eller
// grøn/gul/rød (som betyder datakvalitet) — se farvereglerne i index.css.
//
// Tallet står som tekst ved siden af bjælken, så fordelingen kan læses uden
// at kunne se farver overhovedet, og så den overlever print i sort/hvid.

export default function Fordeling({ poster, ialt, tomTekst = "Ingen data." }) {
  if (!poster?.length) return <p className="muted small">{tomTekst}</p>;

  // Skaleres til den STØRSTE post, ikke til totalen: ellers bliver alle
  // bjælker ulæseligt korte, når fordelingen har en lang hale — og
  // sammenligningen mellem posterne er det, bjælkerne er til for.
  const stoerst = Math.max(...poster.map((p) => p.antal));

  return (
    <ul className="fordeling">
      {poster.map((p) => {
        const andel = ialt ? (p.antal / ialt) * 100 : 0;
        return (
          <li key={p.noegle} className="fordeling__post">
            <span className="fordeling__etiket" title={p.titel || p.etiket}>
              {p.etiket}
            </span>
            <span
              className="fordeling__spor"
              role="img"
              aria-label={`${p.etiket}: ${p.antal} af ${ialt}, ${andel.toFixed(1)} procent`}
            >
              <span
                className="fordeling__bjaelke"
                style={{ width: `${Math.max(1.5, (p.antal / stoerst) * 100)}%` }}
              />
            </span>
            <span className="fordeling__tal num">
              {p.antal.toLocaleString("da-DK")}
              <span className="muted"> · {andel.toFixed(andel < 10 ? 1 : 0)}%</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
