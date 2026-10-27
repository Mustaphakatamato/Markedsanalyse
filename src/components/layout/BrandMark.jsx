// Devoteams ordmærke — en tekstgengivelse af "devoteam·", hvor prikken er
// Red Poppy. Ligger i sin egen fil, fordi både skinnen og topbjælken tegner
// den. Erstat med <img src={logo}> når det officielle SVG ligger i src/assets.
export default function BrandMark() {
  return (
    <span className="dt-logo" aria-label="Devoteam">
      devoteam
      <span className="dt-logo__dot" aria-hidden="true" />
    </span>
  );
}
