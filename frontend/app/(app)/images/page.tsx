import Link from "next/link";
import { Suspense } from "react";
import Disclosures from "@/components/Disclosures";
import Icon from "@/components/Icon";
import { api, fmt, MODELS, modelLabel } from "@/lib/api";
import { dataText } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import ImageFilters from "./ImageFilters";
import "./images.css";

type Params = { model?: string; target_id?: string; style?: string; qc_pass?: string; page?: string };
const PAGE_SIZE = 48;

function qs(params: Params, overrides: Partial<Params>): string {
  const merged = { ...params, ...overrides };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
  return `/images?${sp.toString()}`;
}

// Page numbers to show: first, last, the current one with a neighbour each side, "gap" between.
function pageItems(page: number, pages: number): (number | "gap")[] {
  const keep = new Set([1, pages, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => keep.add(p));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((p) => keep.add(p));
  const sorted = [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(p - sorted[i - 1] === 2 ? p - 1 : "gap");
    out.push(p);
  });
  return out;
}

export default async function ImagesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const filters = { model: params.model, target_id: params.target_id, style: params.style, qc_pass: params.qc_pass };
  const [targets, styles, data, passed, { t }] = await Promise.all([
    api.targets(),
    api.promptStyles(),
    api.images({ ...filters, page: String(page), page_size: String(PAGE_SIZE) }),
    // How many of the filtered images pass QC (only the total is used).
    params.qc_pass === "false" ? Promise.resolve(null)
      : api.images({ ...filters, qc_pass: "true", page: "1", page_size: "1" }),
    getT(),
  ]);
  const v = t.images;
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const target = new Map(targets.map((tg) => [tg.id, { name: dataText(t.data.targets, tg.id, tg.name), hex: tg.hex }]));
  const passCount = passed?.total ?? 0;
  const pct = data.total ? Math.round((passCount / data.total) * 100) : 0;
  const listKey = [params.model, params.target_id, params.style, params.qc_pass, page].join("|");

  return (
    <div className="img-page">
      <header className="img-hero">
        <span className="img-kicker"><Icon name="image" /> {v.kicker}</span>
        <h1>{v.title}</h1>
        <p className="lead">{v.lead}</p>
        <div className="img-stats">
          <span className="img-stat"><Icon name="image" /> {v.count(data.total)}</span>
          <span className="img-stat is-ok"><Icon name="check" /> {v.passShare(passCount, pct)}</span>
          {pages > 1 && <span className="img-stat"><Icon name="file" /> {v.pageOf(page, pages)}</span>}
        </div>
      </header>

      <Suspense fallback={<div className="img-filters is-placeholder" aria-hidden />}>
        <ImageFilters
          models={MODELS.map((m) => ({ value: m.key, label: m.label }))}
          colours={targets.map((tg) => ({ value: tg.id, label: `${target.get(tg.id)?.name} ${tg.hex}`, hex: tg.hex }))}
          styles={styles.map((s) => ({ value: s.id, label: s.code, title: `${s.code} · ${dataText(t.data.styles, s.id, s.description)}` }))}
        />
      </Suspense>

      {data.items.length === 0 ? (
        <div className="img-empty">
          <span className="img-empty-icon"><Icon name="search" /></span>
          <p>{v.none}</p>
          <Link href="/images" className="img-clear"><Icon name="reset" /> {v.clear}</Link>
        </div>
      ) : (
        <ul className="img-grid" key={listKey}>
          {data.items.map((img, i) => {
            const tg = target.get(img.target_id);
            const name = `${modelLabel(img.model)} · ${tg?.name ?? img.target_id} · ${img.style.slice(0, 1)} #${img.slot}`;
            return (
              <li key={img.image_id} style={{ "--i": Math.min(i, 24) } as React.CSSProperties}>
                <Link href={`/images/${img.image_id}`} className="img-card" aria-label={v.open(name)}>
                  <div className="img-frame">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.image_url} alt={name} loading="lazy" decoding="async" />
                    <span className={`img-model is-${img.model}`}>{img.model === "flux" ? "FLUX" : "SDXL"}</span>
                    <span className="img-slot">{img.style.slice(0, 1)} · #{img.slot}</span>
                  </div>
                  <div className="img-meta">
                    <span className="img-pair" title={`${v.target} ${tg?.hex} · ${v.measured} ${img.sample_hex}`}>
                      <i style={{ background: tg?.hex }} />
                      <i style={{ background: img.sample_hex }} />
                    </span>
                    <span className="img-de"><b>{fmt(img.delta_e00, 1)}</b> ΔE00</span>
                    <span className={`img-qc ${img.qc_pass ? "ok" : "bad"}`} title={img.qc_pass ? v.qcPass : v.qcFail}>
                      <Icon name={img.qc_pass ? "check" : "x"} />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="img-pager" aria-label={v.pages}>
          {page > 1
            ? <Link href={qs(params, { page: String(page - 1) })} className="img-page-btn is-step" scroll><Icon name="chevronLeft" /><span>{v.previous}</span></Link>
            : <span className="img-page-btn is-step is-disabled" aria-disabled><Icon name="chevronLeft" /><span>{v.previous}</span></span>}
          <ol>
            {pageItems(page, pages).map((p, i) => p === "gap"
              ? <li key={`g${i}`} className="img-page-gap" aria-hidden>…</li>
              : (
                <li key={p}>
                  {p === page
                    ? <span className="img-page-btn is-current" aria-current="page">{p}</span>
                    : <Link href={qs(params, { page: String(p) })} className="img-page-btn">{p}</Link>}
                </li>
              ))}
          </ol>
          {page < pages
            ? <Link href={qs(params, { page: String(page + 1) })} className="img-page-btn is-step"><span>{v.next}</span><Icon name="chevronRight" /></Link>
            : <span className="img-page-btn is-step is-disabled" aria-disabled><span>{v.next}</span><Icon name="chevronRight" /></span>}
        </nav>
      )}

      <Disclosures />
    </div>
  );
}
