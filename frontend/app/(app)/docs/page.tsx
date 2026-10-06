import type { Metadata } from "next";
import Icon from "@/components/Icon";
import { api } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import docsEn from "./content.en";
import docsZh from "./content.zh";
import DocsScrollSpy from "./DocsScrollSpy";
import "./docs.css";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).t.meta.docs };
}

const SWATCHES = ["#4169E1", "#DC143C", "#228B22", "#DAA520", "#008080", "#8A2BE2"];
const READ_MINUTES = 8;

// User manual and project documentation. The text lives in content.<locale>.tsx; live values
// (package version, QC threshold, crop) come from the API so the manual can't go stale.
export default async function DocsPage() {
  const [provenance, { locale }] = await Promise.all([api.provenance(), getT()]);
  const facts = {
    version: provenance.package_version,
    threshold: provenance.qc.flat_p95_de_max,
    crop: provenance.qc.crop_fraction,
  };
  const d = (locale === "zh" ? docsZh : docsEn)(facts);

  return (
    <div className="docs">
      <header className="docs-hero">
        <div className="docs-hero-art" aria-hidden>
          {SWATCHES.map((c, i) => <i key={c} style={{ "--c": c, "--i": i } as React.CSSProperties} />)}
        </div>
        <span className="docs-kicker"><Icon name="book" /> {d.kicker}</span>
        <h1>{d.title}</h1>
        <p className="docs-hero-lead">{d.lead}</p>
        <p className="docs-hero-meta">
          <span><Icon name="clock" /> {d.readTime(READ_MINUTES)}</span>
          <span><Icon name="flask" /> colourlock {facts.version}</span>
        </p>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc">
          <nav aria-label={d.toc}>
            <p className="docs-toc-title">{d.onThisPage}</p>
            <ol>
              {d.sections.map((s, i) => (
                <li key={s.id} style={{ "--i": i } as React.CSSProperties}>
                  <a href={`#${s.id}`} data-toc={s.id}>
                    <Icon name={s.icon} /> <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="docs-body">
          {d.sections.map((s, i) => (
            <section key={s.id} id={s.id} className="docs-section" aria-labelledby={`${s.id}-title`}>
              <h2 id={`${s.id}-title`}>
                <span className="docs-section-icon" aria-hidden><Icon name={s.icon} /></span>
                <span className="docs-section-num" aria-hidden>{String(i + 1).padStart(2, "0")}</span>
                {s.title}
                <a href={`#${s.id}`} className="docs-anchor" aria-label={`#${s.title}`}>#</a>
              </h2>
              {s.body}
            </section>
          ))}
        </article>
      </div>

      <DocsScrollSpy ids={d.sections.map((s) => s.id)} />
    </div>
  );
}
