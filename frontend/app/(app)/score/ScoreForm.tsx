"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import CountUp from "@/components/CountUp";
import { fmt, PUBLIC_API_BASE, type Problem, type ScoreResult, type Target } from "@/lib/api";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { history } from "@/lib/history";
import { dataText, translateServer, type Dict } from "@/lib/i18n";
import { NOTIFICATIONS_CHANGED } from "@/lib/notifications";
import ScoreExplain from "./ScoreExplain";

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const ACCEPT = ["image/png", "image/jpeg"];
const CUSTOM = "__custom__";
const NAME_MAX = 100; // matches the API
const CHECK_MS = 350; // debounce for the name-availability check

type NameState = "idle" | "checking" | "free" | "taken";

// The name as the API stores it: whitespace collapsed and trimmed.
const tidy = (s: string) => s.split(/\s+/).filter(Boolean).join(" ");
// "Royal blue test.png" -> "Royal blue test": a starting suggestion from the file name.
const fromFile = (f: File) => tidy(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")).slice(0, NAME_MAX);

function fileSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ScoreForm({ targets, cropFraction }: { targets: Target[]; cropFraction: number }) {
  const { t } = useI18n();
  const v = t.score;
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [customHex, setCustomHex] = useState("#4169E1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [name, setName] = useState("");
  const [nameState, setNameState] = useState<NameState>("idle");
  // True while the name is still the one suggested from the file, so a new file replaces it.
  const suggested = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const custom = targetId === CUSTOM;
  const hexValid = !custom || HEX_RE.test(customHex);
  const targetHex = custom ? (hexValid ? customHex : null) : targets.find((tg) => tg.id === targetId)?.hex ?? null;
  // The study measures the central crop; inset is the share trimmed from each side.
  const inset = `${((1 - cropFraction) / 2) * 100}%`;

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const clean = tidy(name);
  const nameTooLong = clean.length > NAME_MAX;

  // Ask the API whether the name is free, a moment after typing stops.
  useEffect(() => {
    if (!clean || nameTooLong) { setNameState("idle"); return; }
    setNameState("checking");
    let live = true;
    const id = window.setTimeout(() => {
      history.nameAvailable(clean)
        .then((r) => { if (live) setNameState(r.available ? "free" : "taken"); })
        // Unknown (offline, signed out): let the server decide on submit.
        .catch(() => { if (live) setNameState("idle"); });
    }, CHECK_MS);
    return () => { live = false; window.clearTimeout(id); };
  }, [clean, nameTooLong]);

  function onFile(f: File | null) {
    setResult(null);
    setError(null);
    // Cleared so picking the same file again still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
    if (f && !ACCEPT.includes(f.type)) {
      setError(v.badType);
      return;
    }
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
    if (f && (suggested.current || !tidy(name))) {
      setName(fromFile(f));
      suggested.current = true;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !hexValid || !clean || nameTooLong || nameState === "taken") return;
    setBusy(true);
    setError(null);
    setResult(null);
    const body = new FormData();
    body.append("image", file);
    if (custom) body.append("target_hex", customHex);
    else body.append("target_id", targetId);
    body.append("name", clean);
    body.append("explain", "true");
    try {
      // credentials: the session cookie tells the API whose history to save this in.
      const res = await fetch(`${PUBLIC_API_BASE}/score`, { method: "POST", body, credentials: "include" });
      const json = await res.json();
      if (!res.ok) {
        const p = json as Problem;
        if (res.status === 409) {
          // Taken after all (e.g. saved from another tab): show it on the name field.
          setNameState("taken");
        } else {
          setError(p.detail ? `${translateServer(t, p.title)}: ${translateServer(t, p.detail)}` : translateServer(t, p.title));
        }
      } else {
        setResult(json as ScoreResult);
        // This name is now used; start the next score with a fresh one.
        setNameState("taken");
        // A new personal best or milestone may have created a notification.
        window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
        // On one-column layouts the result sits below the form.
        if (window.matchMedia("(max-width: 800px)").matches) {
          requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }
      }
    } catch {
      setError(v.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="score-layout">
      <form className="card score-form" onSubmit={onSubmit}>
        <section className="score-step">
          <h2><span className="score-step-num">1</span>{v.image}</h2>
          {preview && file ? (
            <div className={`score-preview${busy ? " is-busy" : ""}`}>
              <div className="score-preview-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt={v.selected} />
                <span className="score-crop" style={{ inset }} aria-hidden>
                  <span className="score-crop-label">{v.measuredArea}</span>
                  <span className="score-scan" />
                </span>
              </div>
              <div className="score-file">
                <Icon name="image" />
                <span className="score-file-name" title={file.name}>{file.name}</span>
                <span className="muted">{fileSize(file.size)}</span>
                <button type="button" className="score-ghost" data-no-loader onClick={() => inputRef.current?.click()} disabled={busy}>
                  <Icon name="reset" />{v.replace}
                </button>
                <button type="button" className="score-ghost score-icon-btn" data-no-loader aria-label={v.remove} title={v.remove}
                        onClick={() => onFile(null)} disabled={busy}>
                  <Icon name="x" />
                </button>
              </div>
            </div>
          ) : (
            <label
              htmlFor="score-file"
              className={`score-drop${dragging ? " is-dragging" : ""}`}
              onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }}
              onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0] ?? null); }}
            >
              <span className="score-drop-icon"><Icon name="upload" /></span>
              <strong>{dragging ? v.dropActive : v.dropTitle}</strong>
              <span className="muted">{v.dropOr}</span>
              <span className="score-drop-hint">{v.dropHint}</span>
            </label>
          )}
          <input ref={inputRef} id="score-file" className="score-file-input" type="file" accept={ACCEPT.join(",")} aria-label={v.image}
                 onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
        </section>

        <fieldset className="score-step">
          <legend><h2><span className="score-step-num">2</span>{v.targetColour}</h2></legend>
          <div className="score-targets">
            {targets.map((tg, i) => {
              const name = dataText(t.data.targets, tg.id, tg.name);
              return (
                <label key={tg.id} className="score-target" style={{ "--i": i, "--c": tg.hex } as React.CSSProperties} title={`${name} ${tg.hex}`}>
                  <input type="radio" name="target" value={tg.id} checked={targetId === tg.id} onChange={() => setTargetId(tg.id)} />
                  <span className="score-target-chip" aria-hidden><Icon name="check" /></span>
                  <span className="score-target-name">{name}</span>
                  <span className="score-target-hex">{tg.hex}</span>
                </label>
              );
            })}
            <label className="score-target is-custom" style={{ "--i": targets.length, "--c": hexValid ? customHex : "transparent" } as React.CSSProperties}>
              <input type="radio" name="target" value={CUSTOM} checked={custom} onChange={() => setTargetId(CUSTOM)} />
              <span className="score-target-chip" aria-hidden><Icon name="check" /></span>
              <span className="score-target-name">{v.custom}</span>
              <span className="score-target-hex">{custom ? customHex : "#RRGGBB"}</span>
            </label>
          </div>
          {custom && (
            <div className="score-custom">
              <label className="field">
                {v.hex}
                <span className="score-custom-row">
                  <input type="color" value={hexValid ? customHex : "#000000"} aria-label={v.hex}
                         onChange={(e) => setCustomHex(e.target.value.toUpperCase())} />
                  <input type="text" value={customHex} onChange={(e) => setCustomHex(e.target.value.trim())}
                         aria-invalid={!hexValid} spellCheck={false} maxLength={7} />
                </span>
              </label>
              {!hexValid && <span className="score-hex-error"><Icon name="alertCircle" />{v.hexError}</span>}
            </div>
          )}
        </fieldset>

        <section className="score-step">
          <h2><span className="score-step-num">3</span><label htmlFor="score-name">{v.nameLabel}</label></h2>
          <div className={`score-name${nameState === "taken" || nameTooLong ? " is-invalid" : ""}`}>
            <Icon name="file" />
            <input id="score-name" type="text" value={name} maxLength={NAME_MAX + 20} autoComplete="off"
                   placeholder={v.namePlaceholder} aria-describedby="score-name-status" required
                   aria-invalid={nameState === "taken" || nameTooLong}
                   onChange={(e) => { setName(e.target.value); suggested.current = false; }} />
            <span className="score-name-count" aria-hidden>{clean.length}/{NAME_MAX}</span>
          </div>
          <p id="score-name-status" className={`score-name-status is-${nameTooLong ? "taken" : nameState}`} aria-live="polite">
            {nameTooLong ? <><Icon name="alertCircle" />{v.nameTooLong(NAME_MAX)}</>
              : nameState === "taken" ? <><Icon name="alertCircle" />{v.nameTaken}</>
              : nameState === "checking" ? <><Icon name="loader" className="spin" />{v.nameChecking}</>
              : nameState === "free" ? <><Icon name="check" />{v.nameFree}</>
              : !clean && file ? <><Icon name="info" />{v.nameRequired}</>
              : <span className="muted">{v.nameHint}</span>}
          </p>
        </section>

        <button type="submit" className="score-submit"
                disabled={!file || !hexValid || busy || !clean || nameTooLong || nameState === "taken" || nameState === "checking"}
                style={targetHex ? ({ "--c": targetHex } as React.CSSProperties) : undefined}>
          {busy ? <><Icon name="loader" className="spin" />{v.measuring}</> : <><Icon name="pipette" />{v.submit}</>}
        </button>
      </form>

      <div className="score-output" aria-live="polite" ref={resultRef}>
        {error && <div className="error score-error"><Icon name="alertCircle" className="lead" />{error}</div>}
        {busy && <ScoreSkeleton t={t} />}
        {!busy && !result && !error && (
          <div className="card score-empty">
            <div className="score-empty-art" aria-hidden>
              <i style={{ background: "#4169E1" }} /><i style={{ background: "#DC143C" }} />
              <i style={{ background: "#228B22" }} /><i style={{ background: "#DAA520" }} />
            </div>
            <h3>{v.emptyTitle}</h3>
            <ol>
              {v.emptySteps.map((s, i) => <li key={s} style={{ "--i": i } as React.CSSProperties}>{s}</li>)}
            </ol>
          </div>
        )}
        {!busy && result && <ScoreView key={result.score_id} r={result} t={t} preview={preview} />}
      </div>
    </div>
  );
}

function ScoreSkeleton({ t }: { t: Dict }) {
  return (
    <div className="card score-skeleton" aria-busy>
      <p className="muted"><Icon name="loader" className="spin lead" />{t.score.loadingTitle}</p>
      <div className="sk sk-swatch" />
      <div className="sk sk-line" style={{ width: "40%" }} />
      <div className="sk sk-line lg" style={{ width: "28%" }} />
      <div className="score-metrics">
        <div className="sk sk-tile" /><div className="sk sk-tile" /><div className="sk sk-tile" />
      </div>
    </div>
  );
}

// General perceptibility bands for ΔE; a reading aid only, not a study threshold.
function verdictOf(de: number): keyof Dict["score"]["verdicts"] {
  if (de <= 1) return "imperceptible";
  if (de <= 2) return "close";
  if (de <= 10) return "glance";
  if (de <= 49) return "different";
  return "opposite";
}

const pct = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;

function ScoreView({ r, t, preview }: { r: ScoreResult; t: Dict; preview: string | null }) {
  const v = t.score;
  const targetName = dataText(t.data.targets, r.target.id, r.target.name);
  const verdict = verdictOf(r.delta_e00);
  const chromaMax = Math.max(r.chroma.sample, r.chroma.reference, 1) * 1.1;
  const sign = r.chroma.delta >= 0 ? "+" : "";
  return (
    <div className="score-result">
      <div className="card score-main">
        {r.name && <h3 className="score-result-name"><Icon name="file" />{r.name}</h3>}
        <p className="score-saved">
          <Icon name="check" /> {t.history.savedToHistory}{" "}
          <Link href="/history">{t.history.viewHistory} <Icon name="arrowRight" /></Link>
        </p>

        <div className="score-compare" role="img" aria-label={`${v.target} ${r.target.hex} · ${v.measured} ${r.sample_hex}`}>
          <div className="score-half target" style={{ background: r.target.hex }}>
            <span>{v.targetShort}</span>
          </div>
          <div className="score-half sample" style={{ background: r.sample_hex }}>
            <span>{v.sampleShort}</span>
          </div>
        </div>
        <div className="score-compare-caption">
          <span>{targetName} · <span className="mono">{r.target.hex}</span></span>
          <span><span className="mono">{r.sample_hex}</span> · {v.measured}</span>
        </div>

        <div className="score-delta">
          <div>
            <div className="kicker">{v.deltaE}</div>
            <div className="score-delta-value"><CountUp value={r.delta_e00} digits={2} duration={900} /></div>
          </div>
          <div className="score-verdict" data-verdict={verdict}>
            <span className="score-verdict-dot" />{v.verdicts[verdict]}
          </div>
        </div>
        <div className="score-meter" aria-hidden>
          <span className="score-meter-fill" style={{ "--w": pct(r.delta_e00 / 20) } as React.CSSProperties} />
          <span className="score-meter-ticks"><i>0</i><i>1</i><i>2</i><i>10</i><i>20+</i></span>
        </div>
        <p className="score-verdict-note muted">{v.verdictNote}</p>
      </div>

      {r.warnings.map((w, i) => (
        <div key={w} className="callout score-anim" style={{ "--d": `${0.15 + i * 0.05}s` } as React.CSSProperties}>
          <Icon name="alert" className="lead" />{v.warnings[w] ?? w}
        </div>
      ))}

      <div className="score-metrics">
        <div className="card score-tile score-anim" style={{ "--d": "0.2s" } as React.CSSProperties}>
          <div className="score-tile-head">
            <span className="kicker">{v.flatnessQc}</span>
            <span className={`badge ${r.qc.pass ? "ok" : "bad"}`}><Icon name={r.qc.pass ? "check" : "x"} />{r.qc.pass ? v.pass : v.fail}</span>
          </div>
          <div className="score-tile-value">{fmt(r.flat_p95_de, 3)}</div>
          <div className={`score-bar${r.qc.pass ? " ok" : " bad"}`}>
            <span style={{ "--w": pct(r.flat_p95_de / (r.qc.threshold * 2)) } as React.CSSProperties} />
            <i className="score-bar-mark" title={`${v.threshold} ${r.qc.threshold}`} />
          </div>
          <div className="score-tile-sub muted">{v.flatnessValue(fmt(r.flat_p95_de, 3), r.qc.threshold)}</div>
        </div>

        <div className="card score-tile score-anim" style={{ "--d": "0.28s" } as React.CSSProperties}>
          <div className="score-tile-head">
            <span className="kicker">{v.chroma}</span>
            <span className={`badge ${r.chroma.delta < 0 ? "warn" : "ok"}`}>Δ {sign}{fmt(r.chroma.delta, 1)}</span>
          </div>
          <div className="score-chroma">
            <span>{v.sampleShort}</span>
            <div className="score-bar"><span style={{ "--w": pct(r.chroma.sample / chromaMax), background: r.sample_hex } as React.CSSProperties} /></div>
            <b>{fmt(r.chroma.sample, 1)}</b>
            <span>{v.targetShort}</span>
            <div className="score-bar"><span style={{ "--w": pct(r.chroma.reference / chromaMax), background: r.target.hex } as React.CSSProperties} /></div>
            <b>{fmt(r.chroma.reference, 1)}</b>
          </div>
          <div className="score-tile-sub muted">{r.chroma.delta < 0 ? v.lessSaturated : v.asSaturated}</div>
        </div>

        <div className="card score-tile score-anim" style={{ "--d": "0.36s" } as React.CSSProperties}>
          <div className="score-tile-head"><span className="kicker">{t.image.keptPct}</span></div>
          <div className="score-tile-value">{fmt(r.kept_pct, 2)}<small>%</small></div>
          <div className="score-bar"><span style={{ "--w": pct(r.kept_pct / 100) } as React.CSSProperties} /></div>
        </div>
      </div>

      {!r.qc.pass && (
        <div className="callout score-anim" style={{ "--d": "0.4s" } as React.CSSProperties}>
          <Icon name="info" className="lead" />{v.notFlat}
        </div>
      )}

      {r.explain && preview && <ScoreExplain r={r} ex={r.explain} preview={preview} t={t} />}

      <details className="card score-details score-anim" style={{ "--d": "0.44s" } as React.CSSProperties}>
        <summary><Icon name="chevronDown" />{v.details}</summary>
        <dl className="kv">
          <dt>{t.image.sampleLab}</dt><dd className="mono">{r.sample_lab.map((x) => x.toFixed(2)).join(", ")}</dd>
          <dt>{t.image.targetLab}</dt><dd className="mono">{r.target.lab.map((x) => x.toFixed(2)).join(", ")}</dd>
          <dt>{v.package}</dt><dd>colourlock {r.package_version}</dd>
          <dt>{v.scoreId}</dt><dd className="score-id"><span className="mono">{r.score_id}</span><CopyButton value={r.score_id} /></dd>
        </dl>
      </details>
    </div>
  );
}
