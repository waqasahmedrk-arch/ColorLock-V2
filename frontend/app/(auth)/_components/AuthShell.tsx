// Two-panel frame shared by login, sign-up and password reset: an animated colour wheel on the
// left, the form on the right. A marker travels round the hue ring; the centre swatch shows the
// hue under it ("target") beside a copy that trails slightly behind ("measured"), so the two
// halves never quite match: the ΔE gap the app measures. Purely decorative (aria-hidden).

const BRAND = ["#4169E1", "#DC143C", "#228B22", "#DAA520"];

// Tick marks round the inner dial: a short one every 5°, a long one every 30°.
const TICKS = Array.from({ length: 72 }, (_, i) => {
  const a = (i * 5 * Math.PI) / 180;
  const long = i % 6 === 0;
  const r1 = long ? 57 : 60;
  const r2 = 64;
  return {
    x1: +(Math.sin(a) * r1).toFixed(2), y1: +(-Math.cos(a) * r1).toFixed(2),
    x2: +(Math.sin(a) * r2).toFixed(2), y2: +(-Math.cos(a) * r2).toFixed(2), long,
  };
});

export default function AuthShell({
  kicker,
  title,
  subtitle,
  children,
}: {
  kicker: string;
  title: string;
  subtitle: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="auth">
      <aside className="auth-visual" aria-hidden>
        <div className="auth-wheel">
          <div className="auth-wheel-ring" />
          <svg className="auth-wheel-dial" viewBox="-100 -100 200 200">
            {TICKS.map((tk, i) => (
              <line key={i} x1={tk.x1} y1={tk.y1} x2={tk.x2} y2={tk.y2} className={tk.long ? "is-long" : undefined} />
            ))}
          </svg>
          <div className="auth-wheel-reticle">
            <i /><i /><i />
            <span className="auth-wheel-cross" />
          </div>
          <div className="auth-wheel-arm"><span className="auth-wheel-marker" /></div>
          <div className="auth-wheel-chip">
            <span className="is-target" />
            <span className="is-measured" />
          </div>
        </div>
        <div className="auth-mark">
          {BRAND.map((c) => <i key={c} style={{ background: c }} />)}
        </div>
      </aside>
      <section className="auth-panel">
        <div className="auth-card">
          <p className="kicker auth-rise" style={{ "--d": 0 } as React.CSSProperties}>{kicker}</p>
          <h1 className="auth-rise" style={{ "--d": 1 } as React.CSSProperties}>{title}</h1>
          <p className="muted auth-rise auth-sub" style={{ "--d": 2 } as React.CSSProperties}>
            {subtitle}
          </p>
          {children}
        </div>
      </section>
    </div>
  );
}
