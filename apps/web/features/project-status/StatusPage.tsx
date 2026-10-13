import { PROJECT_STATUS as P, type Status } from "./project-status";

const TONE: Record<Status, string> = {
  LOCKED: "#5eead4",
  APPROVED: "#86efac",
  "IN REVIEW": "#fcd34d",
  PENDING: "#a1a1aa",
  BLOCKED: "#f87171",
};

const label = { fontSize: 11, letterSpacing: "0.14em", color: "#8b8b95" } as const;

function Bar({ value, color = "#e4e4e7", h = 4 }: { value: number; color?: string; h?: number }) {
  return (
    <div style={{ height: h, background: "#26262c", borderRadius: h }} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: h }} />
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className} style={{ marginTop: 40 }}>
      <h2 style={{ ...label, marginBottom: 12, fontWeight: 500 }}>{title}</h2>
      {children}
    </section>
  );
}

export function StatusPage() {
  return (
    <main style={{ minHeight: "100dvh", background: "#0b0b0e", color: "#ededf0", fontFamily: "var(--font-sans), system-ui, sans-serif", padding: "40px 20px 64px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <p style={{ ...label, margin: 0 }}>D2KIRO · PROJECT COCKPIT</p>

        <div style={{ marginTop: 28, display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <span style={{ ...label, fontSize: 13 }}>{P.project}</span>
          <span style={{ fontSize: 72, fontWeight: 600, lineHeight: 1 }}>{P.overall}%</span>
        </div>
        <div style={{ ...label, marginTop: 8 }}>{P.overallLabel}</div>
        <div style={{ marginTop: 12 }}><Bar value={P.overall} color="#5eead4" h={8} /></div>

        <div style={{ marginTop: 28, display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div>
            <div style={label}>CURRENT GATE</div>
            <div style={{ marginTop: 6, fontSize: 18 }}>{P.currentGate}</div>
          </div>
          <div>
            <div style={label}>NEXT</div>
            <div style={{ marginTop: 6, fontSize: 15, color: "#c4c4cc" }}>{P.next.join(" → ")}</div>
          </div>
        </div>

        {/* Mobile: the open-items answer comes before the ten cards (CSS order, no duplicated markup). */}
        <style>{`.ck-flow{display:flex;flex-direction:column}@media(max-width:640px){.ck-open{order:-1}}`}</style>
        <div className="ck-flow">
        <Section title="STATUS">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
            {P.cards.map((c) => (
              <div key={c.name} style={{ border: "1px solid #26262c", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontWeight: 500 }}>{c.name}</span>
                  <span style={{ fontSize: 11, letterSpacing: "0.1em", color: TONE[c.status] }}>{c.status}</span>
                </div>
                <div style={{ margin: "10px 0 8px", display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ flex: 1 }}><Bar value={c.progress} color={TONE[c.status]} /></div>
                  <span style={{ fontSize: 12, color: "#c4c4cc", fontVariantNumeric: "tabular-nums" }}>{c.progress}%</span>
                </div>
                <div style={{ fontSize: 13, color: "#8b8b95" }}>{c.note}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="OPEN BEFORE PRODUCTION" className="ck-open">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: "#d4d4da" }}>
            {P.openBeforeProduction.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </Section>

        <Section title="TIME REMAINING">
          <div style={{ display: "flex", gap: 40, flexWrap: "wrap" }}>
            {P.time.map((t) => (
              <div key={t.label}>
                <div style={label}>{t.label}</div>
                <div style={{ fontSize: 22, marginTop: 4 }}>{t.value}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#8b8b95", marginTop: 10 }}>{P.timeDisclaimer}</p>
        </Section>

        <Section title="RECENT MILESTONES">
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {P.milestones.map((m) => (
              <li key={m.title} style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>{m.title}</span>
                {m.detail && <span style={{ color: "#8b8b95", fontFamily: "var(--font-mono), monospace", fontSize: 13 }}>{m.detail}</span>}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="WHAT CHANGED SINCE LAST REVIEW">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9, color: "#d4d4da" }}>
            {P.changedSinceLastReview.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </Section>
        </div>
      </div>
    </main>
  );
}
