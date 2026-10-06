// Building blocks for the documentation content (content.en.tsx / content.zh.tsx). Plain
// server-safe components: no state, so the content files stay simple JSX.

import type { ReactNode } from "react";
import Icon, { type IconName } from "@/components/Icon";

export interface DocSection {
  id: string;
  icon: IconName;
  title: string;
  body: ReactNode;
}

export interface Docs {
  kicker: string;
  title: string;
  lead: string;
  toc: string;
  onThisPage: string;
  readTime: (min: number) => string;
  sections: DocSection[];
}

// Values that come from the running system rather than being written into the text.
export interface DocFacts {
  version: string;
  threshold: number;
  crop: number;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="docs-lead">{children}</p>;
}

export function Callout({ kind = "note", title, children }: { kind?: "note" | "tip" | "warn"; title?: string; children: ReactNode }) {
  const icon: IconName = kind === "tip" ? "sparkles" : kind === "warn" ? "alert" : "info";
  return (
    <div className={`docs-callout is-${kind}`}>
      <span className="docs-callout-icon" aria-hidden><Icon name={icon} /></span>
      <div>{title && <strong>{title}</strong>}{children}</div>
    </div>
  );
}

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="docs-steps">
      {items.map((s, i) => (
        <li key={s.title} style={{ "--i": i } as React.CSSProperties}>
          <span className="docs-step-num" aria-hidden>{i + 1}</span>
          <div><strong>{s.title}</strong><div className="docs-step-body">{s.body}</div></div>
        </li>
      ))}
    </ol>
  );
}

export function Cards({ items }: { items: { icon: IconName; title: string; body: ReactNode }[] }) {
  return (
    <div className="docs-cards">
      {items.map((c, i) => (
        <div key={c.title} className="docs-card" style={{ "--i": i } as React.CSSProperties}>
          <span className="docs-card-icon" aria-hidden><Icon name={c.icon} /></span>
          <strong>{c.title}</strong>
          <p>{c.body}</p>
        </div>
      ))}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table-wrap">
      <table className="docs-table">
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Terms({ items }: { items: { term: ReactNode; def: ReactNode }[] }) {
  return (
    <dl className="docs-terms">
      {items.map((x, i) => (
        <div key={i}><dt>{x.term}</dt><dd>{x.def}</dd></div>
      ))}
    </dl>
  );
}

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="docs-faq">
      {items.map((x) => (
        <details key={x.q}>
          <summary><span>{x.q}</span><Icon name="chevronDown" /></summary>
          <div className="docs-faq-a">{x.a}</div>
        </details>
      ))}
    </div>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="docs-h3">{children}</h3>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="docs-kbd">{children}</kbd>;
}
