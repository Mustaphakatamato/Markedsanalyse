// Konfidensmåler for et sanktionsfund. Niveauerne kommer direkte fra
// sanktionstjekket ("høj"/"lav", se supabase/functions/sanktionstjek) — her
// gøres de bare synlige.
//
// Segmenterne er redundante: niveauet står også som tekst, og farven er
// alene et supplement. Bemærk at HØJ konfidens er det ALVORLIGE udfald her —
// måleren måler hvor sikkert fundet er, ikke hvor godt det er.

const LEVELS = {
  høj: { filled: 3, label: "Høj konfidens", modifier: "high" },
  lav: { filled: 1, label: "Lav konfidens", modifier: "low" }
};

const SEGMENTS = [0, 1, 2];

/**
 * @param {{ level: "høj"|"lav" }} props
 */
export default function ConfidenceMeter({ level }) {
  const def = LEVELS[level];
  if (!def) return null;

  return (
    <span
      className={`confidence confidence--${def.modifier}`}
      role="img"
      aria-label={`${def.label} (${def.filled} af 3)`}
    >
      <span className="confidence__track" aria-hidden="true">
        {SEGMENTS.map((i) => (
          <i key={i} className={`confidence__seg ${i < def.filled ? "is-on" : ""}`} />
        ))}
      </span>
      <span className="confidence__label">{def.label}</span>
    </span>
  );
}
