import { useState } from "react";

// Single-series line chart, hand-rolled inline SVG (no charting dependency —
// this app has none and a handful of ≤10-point lines doesn't warrant one).
// Follows the project's dataviz conventions: 2px line, ≥8px end markers with
// a surface-color ring, hairline solid gridlines, one direct label (the
// latest point), a hover crosshair + tooltip. No legend — a single series
// doesn't need one; the section header names it.
//
// Linjefarven er --chart-line, som er kontrastvalideret mod kortfladen i
// BEGGE tilstande — se kommentaren ved tokenet i index.css. Fladen under
// linjen er samme hue ved lav alpha; den er ren kontekst og bærer ingen
// aflæsning, derfor stilles der ikke kontrastkrav til den.

const WIDTH = 640;
const HEIGHT = 260;
const PADDING = { top: 28, right: 16, bottom: 32, left: 64 };

function niceTicks(min, max, count = 4) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1;
  const step = niceResidual * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  for (let t = niceMin; t <= niceMax + step / 2; t += step) {
    ticks.push(Math.round(t / step) * step);
  }
  return ticks;
}

/**
 * @param {{
 *   points: Array<{ label: string, value: number|null }>,
 *   formatValue: (value: number) => string,
 *   formatTick?: (value: number) => string
 * }} props
 */
export default function TrendChart({ points, formatValue, formatTick }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const validValues = points.map((p) => p.value).filter((v) => v != null);
  if (validValues.length === 0) {
    return <p className="muted small">Ingen data at vise for dette nøgletal.</p>;
  }

  // Anker altid ved 0, så mindre udsving ikke overdrives visuelt.
  const ticks = niceTicks(Math.min(...validValues, 0), Math.max(...validValues, 0));
  const domainMin = ticks[0];
  const domainMax = ticks[ticks.length - 1];

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const slot = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;

  const xFor = (index) => (points.length === 1 ? PADDING.left + plotWidth / 2 : PADDING.left + index * slot);
  const yFor = (value) =>
    PADDING.top + plotHeight - ((value - domainMin) / (domainMax - domainMin || 1)) * plotHeight;

  // Byg linjesegmenter der brydes ved manglende år, i stedet for at forbinde
  // hen over et hul — det ville antyde data der ikke findes.
  const segments = [];
  let current = [];
  points.forEach((p, i) => {
    if (p.value == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ x: xFor(i), y: yFor(p.value) });
    }
  });
  if (current.length) segments.push(current);

  const lastValidIndex = points.reduce((acc, p, i) => (p.value != null ? i : acc), -1);
  const tickLabel = formatTick || formatValue;
  const hovered = hoverIndex != null ? points[hoverIndex] : null;

  // Nulniveauet markeres kraftigere end de øvrige gridlinjer når serien
  // krydser det — forskellen på over og under nul er den vigtigste aflæsning
  // i et regnskab og skal kunne ses uden at læse aksen.
  const baselineY = domainMin < 0 && domainMax > 0 ? yFor(0) : null;

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Udvikling over tid"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={yFor(t)} y2={yFor(t)} className="trend-grid" />
            <text x={PADDING.left - 8} y={yFor(t)} textAnchor="end" dominantBaseline="middle" className="trend-axis-label">
              {tickLabel(t)}
            </text>
          </g>
        ))}

        {baselineY != null && (
          <line
            x1={PADDING.left}
            x2={WIDTH - PADDING.right}
            y1={baselineY}
            y2={baselineY}
            className="trend-baseline"
          />
        )}

        {/* Flade under linjen — kun kontekst, ingen aflæsning. Ankres på
            nulniveauet hvis serien krydser det, ellers på bunden af feltet. */}
        {segments
          .filter((seg) => seg.length > 1)
          .map((seg, i) => {
            const anchorY = baselineY ?? HEIGHT - PADDING.bottom;
            const d = `${seg.map((pt, j) => `${j === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ")} L${
              seg[seg.length - 1].x
            },${anchorY} L${seg[0].x},${anchorY} Z`;
            return <path key={`fill-${i}`} d={d} fill="var(--chart-fill)" stroke="none" />;
          })}

        {segments.map((seg, i) => (
          <path
            key={i}
            d={seg.map((pt, j) => `${j === 0 ? "M" : "L"}${pt.x},${pt.y}`).join(" ")}
            fill="none"
            stroke="var(--chart-line)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {points.map(
          (p, i) =>
            p.value != null && (
              <circle key={i} cx={xFor(i)} cy={yFor(p.value)} r={5} fill="var(--chart-line)" stroke="var(--card)" strokeWidth={2} />
            )
        )}

        {lastValidIndex >= 0 &&
          (() => {
            // Når det seneste punkt sidder helt ude i højre kant, ville en
            // centreret label løbe ud over kanten (og blive beskåret af
            // kortets egen ramme) — så den sidste label ankres i stedet til
            // højre og vokser mod venstre, ligesom "Lines → value at the end".
            const isRightEdge = lastValidIndex === points.length - 1;
            return (
              <text
                x={xFor(lastValidIndex) + (isRightEdge ? 8 : 0)}
                y={yFor(points[lastValidIndex].value) - 14}
                textAnchor={isRightEdge ? "end" : "middle"}
                className="trend-value-label"
              >
                {formatValue(points[lastValidIndex].value)}
              </text>
            );
          })()}

        {points.map((p, i) => (
          <text key={i} x={xFor(i)} y={HEIGHT - PADDING.bottom + 22} textAnchor="middle" className="trend-axis-label">
            {p.label}
          </text>
        ))}

        {hoverIndex != null && (
          <line x1={xFor(hoverIndex)} x2={xFor(hoverIndex)} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} className="trend-crosshair" />
        )}
        {hovered?.value != null && (
          <circle cx={xFor(hoverIndex)} cy={yFor(hovered.value)} r={7} fill="var(--chart-line)" stroke="var(--card)" strokeWidth={2} />
        )}

        {/* Hit-mål bredere end selve punktet, så pointeren blot skal ramme nærmest. */}
        {points.map((_, i) => (
          <rect
            key={i}
            x={xFor(i) - slot / 2}
            y={PADDING.top}
            width={slot}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="trend-tooltip"
          style={{
            left: `${(xFor(hoverIndex) / WIDTH) * 100}%`,
            top: `${((hovered.value != null ? yFor(hovered.value) : PADDING.top) / HEIGHT) * 100}%`
          }}
        >
          <strong>{hovered.value != null ? formatValue(hovered.value) : "Ingen data"}</strong>
          <span>{hovered.label}</span>
        </div>
      )}
    </div>
  );
}
