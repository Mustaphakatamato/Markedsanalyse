// Kilde-badge — appens "citation": hvert kort siger hvor tallene kommer fra,
// på selve kortet, ikke i en fodnote et andet sted.
//
// FARVEN BÆRER TILLIDSNIVEAUET, IKKE KILDENS IDENTITET: grøn = live kilde,
// gul = demo-data. Identiteten står i initialerne og navnet, som altid er
// med. Hue-kodning pr. kilde ville udvande netop det signal, og det er det
// eneste på siden en ordregiver ikke må tage fejl af.
//
// Kilderne svarer 1:1 til Datakilder-tabellen i README.

const SOURCES = {
  cvr: { mark: "CVR", label: "CVR · Datafordeleren", kind: "live" },
  erst: { mark: "ERST", label: "Erhvervsstyrelsen · XBRL", kind: "live" },
  ted: { mark: "TED", label: "TED · EU-udbud", kind: "live" },
  dst: { mark: "DST", label: "Danmarks Statistik", kind: "live" },
  eu: { mark: "EU", label: "EU's sanktionsliste", kind: "live" },
  demo: { mark: "DEMO", label: "Demo-data", kind: "demo" }
};

/**
 * @param {{ source: keyof typeof SOURCES, label?: string, title?: string }} props
 */
export default function SourceBadge({ source, label, title }) {
  const def = SOURCES[source];
  if (!def) return null;

  return (
    <span
      className={`source source--${def.kind}`}
      title={title || (def.kind === "live" ? `Live kilde: ${def.label}` : "Fabrikeret demo-data")}
    >
      <span className="source__mark">{def.mark}</span>
      <span className="source__text">{label || def.label}</span>
    </span>
  );
}
