export default function Swatch({ hex, large, label }: { hex: string; large?: boolean; label?: string }) {
  return (
    <span
      className={large ? "swatch lg" : "swatch"}
      style={{ background: hex }}
      role="img"
      aria-label={label ?? hex}
      title={label ?? hex}
    />
  );
}
