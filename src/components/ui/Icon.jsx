// Ikoner som inline SVG. Appen har ingen UI-afhængigheder og skal ikke have
// et ikonbibliotek for femten streger — se README ("ingen UI-afhængigheder").
// Alle tegnes i currentColor, så de arver farven fra den chip/knap de sidder i.

const PATHS = {
  search: (
    <>
      <circle cx="7.5" cy="7.5" r="4.75" />
      <path d="M11 11l3.2 3.2" />
    </>
  ),
  check: <path d="M3.2 8.6l3.3 3.3 6.3-7" />,
  shield: (
    <>
      <path d="M8 1.8l5 1.9v4c0 3.2-2.1 5.5-5 6.5-2.9-1-5-3.3-5-6.5v-4l5-1.9z" />
      <path d="M5.9 7.9l1.6 1.6 2.8-3" />
    </>
  ),
  alert: (
    <>
      <path d="M8 1.9l6.2 11.2H1.8L8 1.9z" />
      <path d="M8 6.4v3.1" />
      <path d="M8 11.5v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v3.7" />
      <path d="M8 5.1v.1" />
    </>
  ),
  scales: (
    <>
      <path d="M8 2.4v11.2" />
      <path d="M4.2 4.1h7.6" />
      <path d="M4.4 13.6h7.2" />
      <path d="M2 9.1l2.2-5 2.2 5" />
      <path d="M9.6 9.1l2.2-5 2.2 5" />
    </>
  ),
  trend: (
    <>
      <path d="M2 12.6l3.7-4.2 2.7 2.4 5.2-6" />
      <path d="M10.4 4.5h3.2v3.1" />
    </>
  ),
  doc: (
    <>
      <path d="M9 1.9H4.4a1 1 0 00-1 1v10.2a1 1 0 001 1h7.2a1 1 0 001-1V5.5L9 1.9z" />
      <path d="M8.9 2v3.4h3.5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="8" cy="3.9" rx="5" ry="2.1" />
      <path d="M3 3.9v8.2c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1V3.9" />
      <path d="M3 8c0 1.2 2.2 2.1 5 2.1s5-.9 5-2.1" />
    </>
  ),
  external: (
    <>
      <path d="M9.4 2.6h4v4" />
      <path d="M13.4 2.6L7.6 8.4" />
      <path d="M11.6 9.6v3a1 1 0 01-1 1H3.4a1 1 0 01-1-1V5.4a1 1 0 011-1h3" />
    </>
  ),
  chevron: <path d="M4.6 6.2L8 9.6l3.4-3.4" />,
  plus: (
    <>
      <path d="M8 3.4v9.2" />
      <path d="M3.4 8h9.2" />
    </>
  ),
  arrow: (
    <>
      <path d="M3 8h10" />
      <path d="M9.4 4.4L13 8l-3.6 3.6" />
    </>
  ),
  back: (
    <>
      <path d="M13 8H3" />
      <path d="M6.6 4.4L3 8l3.6 3.6" />
    </>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.6M8 13v1.6M1.4 8h1.6M13 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </>
  ),
  moon: <path d="M13.2 9.6A5.6 5.6 0 016.4 2.8a5.8 5.8 0 106.8 6.8z" />,
  inbox: (
    <>
      <path d="M2 9.4l1.9-5.5a1 1 0 01.95-.7h6.3a1 1 0 01.95.7L14 9.4v3.2a1 1 0 01-1 1H3a1 1 0 01-1-1V9.4z" />
      <path d="M2 9.4h3.2l.8 1.8h4l.8-1.8H14" />
    </>
  ),
  spark: (
    <>
      <path d="M8 1.8l1.5 4.1 4.1 1.5-4.1 1.5L8 13l-1.5-4.1L2.4 7.4l4.1-1.5L8 1.8z" />
    </>
  ),
  table: (
    <>
      <rect x="2.4" y="3" width="11.2" height="10" rx="1" />
      <path d="M2.4 6.4h11.2M6.6 6.4V13" />
    </>
  )
};

/**
 * @param {{ name: keyof typeof PATHS, size?: number, strokeWidth?: number }} props
 */
export default function Icon({ name, size = 14, strokeWidth = 1.6, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}
