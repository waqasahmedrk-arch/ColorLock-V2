"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";

type Option = { value: string; label: string; hex?: string; title?: string };
const KEYS = ["model", "target_id", "style", "qc_pass"] as const;

// Filters that apply as soon as they're picked: each choice rewrites the query string (page
// back to 1) and the server re-renders the grid. While that's in flight the grid dims.
export default function ImageFilters({ models, colours, styles }: {
  models: Option[];
  colours: Option[];
  styles: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { t } = useI18n();
  const v = t.images;
  const [pending, start] = useTransition();

  const current = (key: (typeof KEYS)[number]) => params.get(key) ?? "";
  const active = KEYS.filter((k) => current(k)).length;

  function set(key: (typeof KEYS)[number], value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    const q = next.toString();
    start(() => router.push(q ? `${pathname}?${q}` : pathname, { scroll: false }));
  }

  const qc: Option[] = [{ value: "true", label: v.passed }, { value: "false", label: v.failed }];

  return (
    <div className="img-filters" data-pending={pending ? "" : undefined}>
      <Group label={v.model} options={models} value={current("model")} all={v.all} onPick={(x) => set("model", x)} />
      <Group label={v.qc} options={qc} value={current("qc_pass")} all={v.all} onPick={(x) => set("qc_pass", x)} />
      <Group label={v.style} options={styles} value={current("style")} all={v.all} onPick={(x) => set("style", x)} />

      <div className="img-filter img-filter-colours" role="radiogroup" aria-label={v.colour}>
        <span className="img-filter-label">{v.colour}</span>
        <div className="img-swatches">
          <button type="button" role="radio" aria-checked={!current("target_id")} data-no-loader
                  className="img-swatch is-all" title={v.all} onClick={() => set("target_id", "")}>
            {v.all}
          </button>
          {colours.map((c, i) => (
            <button key={c.value} type="button" role="radio" aria-checked={current("target_id") === c.value}
                    data-no-loader className="img-swatch" title={c.label} aria-label={c.label}
                    style={{ "--c": c.hex, "--i": i } as React.CSSProperties}
                    onClick={() => set("target_id", current("target_id") === c.value ? "" : c.value)}>
              <Icon name="check" />
            </button>
          ))}
        </div>
      </div>

      <div className="img-filter-end">
        {pending && <span className="img-filter-busy"><Icon name="loader" className="spin" /></span>}
        {active > 0 && (
          <>
            <span className="img-filter-count">{v.activeFilters(active)}</span>
            <button type="button" className="img-clear" data-no-loader
                    onClick={() => start(() => router.push(pathname, { scroll: false }))}>
              <Icon name="reset" /> {v.clear}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Group({ label, options, value, all, onPick }: {
  label: string;
  options: Option[];
  value: string;
  all: string;
  onPick: (v: string) => void;
}) {
  return (
    <div className="img-filter" role="radiogroup" aria-label={label}>
      <span className="img-filter-label">{label}</span>
      <div className="img-pills">
        {[{ value: "", label: all } as Option, ...options].map((o) => (
          <button key={o.value || "all"} type="button" role="radio" aria-checked={value === o.value}
                  data-no-loader className="img-pill" title={o.title ?? o.label} onClick={() => onPick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
