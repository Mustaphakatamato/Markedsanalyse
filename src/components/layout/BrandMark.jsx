// Monogram i stedet for et logo vi ikke har: fire datapunkter og en linje —
// samme figur som grafen på virksomhedsopslaget. Ligger i sin egen fil, fordi
// både skinnen og topbjælken tegner den, og to kopier ville drive fra
// hinanden.
export default function BrandMark() {
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
