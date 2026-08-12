// Indlæsningstilstande. To former, med hvert sit formål:
//
//   <Working>   — en forespørgsel er i gang lige nu. Bruges hvor ventetiden
//                 er reel og uforudsigelig (TED-notice, regnskabsdokument).
//   <SkeletonRows> — pladsholder med samme form som det der kommer, så
//                 layoutet ikke hopper når data lander.
//
// Teksten står altid ved siden af animationen; prikkerne bærer aldrig
// information alene.

export function Working({ children }) {
  return (
    <span className="working" role="status">
      <span className="working__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{children}</span>
    </span>
  );
}

/**
 * @param {{ rows?: number }} props
 */
export function SkeletonRows({ rows = 5 }) {
  return (
    <div className="skeleton-rows" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton" style={{ width: `${38 + ((i * 13) % 26)}%` }} />
          <span className="skeleton" style={{ width: `${18 + ((i * 7) % 12)}%` }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Operations-chip: ét diskret kald mod en kilde, med sin egen tilstand.
 * @param {{ state?: "running"|"done"|"failed", children: React.ReactNode }} props
 */
export function OpChip({ state = "running", children }) {
  return <span className={`op op--${state}`}>{children}</span>;
}
