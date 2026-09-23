/** Cinzel title plaque over the pixel panel (the nameplates' 9-slice). */
export function AtlasCartouche({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="atlas-cartouche">
      <div className="atlas-cartouche-title">{title}</div>
      <div className="atlas-cartouche-sub">{subtitle}</div>
    </div>
  );
}

const TICKS = Array.from({ length: 16 }, (_, i) => (i * 22.5 * Math.PI) / 180);

/** Compass rose, bottom-right chrome; every colour is a token. */
export function AtlasCompass() {
  return (
    <svg className="atlas-compass" viewBox="-40 -42 80 84" aria-hidden="true">
      <circle r="34" fill="var(--atlas-parch)" stroke="var(--pixel-frame-gold)" strokeWidth="1" />
      <circle r="28" fill="none" stroke="var(--color-parchment-line)" strokeWidth="1" />
      <circle r="25" fill="none" stroke="var(--color-parchment-line)" strokeWidth="0.5" />
      {TICKS.map((a, i) => {
        const r1 = i % 4 === 0 ? 22 : i % 2 === 0 ? 24 : 25;
        return (
          <line
            key={i}
            x1={Math.sin(a) * r1}
            y1={-Math.cos(a) * r1}
            x2={Math.sin(a) * 28}
            y2={-Math.cos(a) * 28}
            stroke="var(--color-parchment-line)"
            strokeWidth={i % 4 === 0 ? 1 : 0.4}
          />
        );
      })}
      <path d="M0,-24 L3.5,-8 L0,-12 L-3.5,-8 Z" fill="var(--color-accent-ink)" />
      <path d="M0,24 L3,8 L0,12 L-3,8 Z" fill="var(--color-parchment-accent)" />
      <path d="M-24,0 L-8,3 L-12,0 L-8,-3 Z" fill="var(--color-parchment-accent)" />
      <path d="M24,0 L8,3 L12,0 L8,-3 Z" fill="var(--color-parchment-accent)" />
      <path d="M-16,-16 L-6,-6 L-8,-3 Z M16,-16 L6,-6 L8,-3 Z M-16,16 L-6,6 L-3,8 Z M16,16 L6,6 L3,8 Z" fill="var(--color-parchment-deep)" />
      <circle r="3.5" fill="var(--gold-accent)" />
      <circle r="1.6" fill="var(--atlas-parch)" />
      <text y="-31" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--atlas-ink-deep)" fontFamily="var(--font-display)">
        N
      </text>
    </svg>
  );
}
