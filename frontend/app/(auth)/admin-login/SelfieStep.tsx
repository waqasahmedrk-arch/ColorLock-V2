"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { adminAuth } from "@/lib/admin";
import type { RequestError } from "@/lib/chat";
import { translateServer } from "@/lib/i18n";
import { FormError, SubmitButton } from "../_components/fields";

// The admin's first sign-in ends with a selfie (backend routers/admin_auth.py). Before the photo
// is taken, a face check runs here in the browser: one face, close enough and centred, then a
// blink and a head turn, which a printed photo or a still image on a screen can't do. The model
// and WASM runtime are served from this site (scripts/face-assets.mjs); nothing leaves the
// browser except the final photo.

const ASSETS = "/mediapipe";
const HOLD_MS = 600; // facing the camera, eyes open, this long before the photo is taken
const LOST_MS = 1200; // face out of view this long restarts the check

type Phase = "intro" | "starting" | "live" | "preview" | "error";
type CameraError = "denied" | "noCamera" | "busy" | "insecure" | "failed";
type Step = "blink" | "turn" | "back";
type Hint = "noFace" | "manyFaces" | "closer" | "center" | Step | "hold";

export default function SelfieStep({ email, token, expiresIn, remember, onDone, onBack }: {
  email: string;
  token: string;
  expiresIn: number;
  remember: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const c = t.adminLogin;
  const [phase, setPhase] = useState<Phase>("intro");
  const [camError, setCamError] = useState<CameraError | null>(null);
  const [hint, setHint] = useState<Hint>("noFace");
  const [passed, setPassed] = useState({ blink: false, turn: false });
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const landmarker = useRef<FaceLandmarker | null>(null);
  const frame = useRef(0);

  function stopCamera() {
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((tr) => tr.stop());
    stream.current = null;
  }

  useEffect(() => () => {
    stopCamera();
    landmarker.current?.close();
    landmarker.current = null;
  }, []);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  async function start() {
    setCamError(null);
    setError(null);
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError(window.isSecureContext ? "noCamera" : "insecure");
      setPhase("error");
      return;
    }
    try {
      const [media] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        }),
        loadLandmarker(),
      ]);
      stream.current = media;
      const v = video.current!;
      v.srcObject = media;
      await v.play();
      setPassed({ blink: false, turn: false });
      setHint("noFace");
      setPhase("live");
      watch();
    } catch (e) {
      stopCamera();
      setCamError(cameraError(e));
      setPhase("error");
    }
  }

  async function loadLandmarker() {
    if (landmarker.current) return;
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(`${ASSETS}/wasm`);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: `${ASSETS}/face_landmarker.task`, delegate },
      runningMode: "VIDEO" as const, numFaces: 2, outputFaceBlendshapes: true,
    });
    try {
      landmarker.current = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
    } catch {
      landmarker.current = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
    }
  }

  // The check, frame by frame. Kept in refs so only hint changes re-render.
  function watch() {
    let step: Step = "blink";
    let eyesClosed = false;
    let lastSeen = performance.now();
    let holdFrom = 0;
    let lastTime = -1;
    let shown: Hint | null = null;
    const show = (h: Hint) => { if (h !== shown) { shown = h; setHint(h); } };
    const restart = () => {
      step = "blink";
      eyesClosed = false;
      holdFrom = 0;
      setPassed({ blink: false, turn: false });
    };

    const tick = () => {
      frame.current = requestAnimationFrame(tick);
      const v = video.current;
      const lm = landmarker.current;
      if (!v || !lm || v.readyState < 2 || v.currentTime === lastTime) return;
      lastTime = v.currentTime;
      const now = performance.now();
      const face = readFace(lm.detectForVideo(v, now));

      if (face.count !== 1) {
        if (face.count > 1) { restart(); show("manyFaces"); return; }
        if (now - lastSeen > LOST_MS && step !== "blink") restart();
        holdFrom = 0;
        show("noFace");
        return;
      }
      lastSeen = now;
      if (face.width < 0.22) { holdFrom = 0; show("closer"); return; }
      if (step !== "turn" && (Math.abs(face.cx - 0.5) > 0.17 || Math.abs(face.cy - 0.5) > 0.2)) {
        holdFrom = 0;
        show("center");
        return;
      }

      if (step === "blink") {
        if (face.blink > 0.55) eyesClosed = true;
        else if (eyesClosed && face.blink < 0.3) {
          step = "turn";
          setPassed((p) => ({ ...p, blink: true }));
        }
        show(step);
      } else if (step === "turn") {
        if (face.yaw < 0.3 || face.yaw > 0.7) {
          step = "back";
          setPassed((p) => ({ ...p, turn: true }));
        }
        show(step);
      } else {
        const facing = face.yaw > 0.4 && face.yaw < 0.6 && face.blink < 0.3;
        if (!facing) { holdFrom = 0; show("back"); return; }
        holdFrom ||= now;
        show("hold");
        if (now - holdFrom >= HOLD_MS) {
          cancelAnimationFrame(frame.current);
          capture(v);
        }
      }
    };
    frame.current = requestAnimationFrame(tick);
  }

  function capture(v: HTMLVideoElement) {
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      stopCamera();
      if (!blob) { setCamError("failed"); setPhase("error"); return; }
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setPhase("preview");
    }, "image/jpeg", 0.92);
  }

  function retake() {
    setPhoto(null);
    start();
  }

  async function submit() {
    if (!photo || busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminAuth.selfie(email, token, remember, photo.blob);
      setDone(true);
      window.setTimeout(onDone, 700);
    } catch (e) {
      const err = e as RequestError;
      setError(translateServer(t, err.message));
      // An expired or used token can't be retried; everything else can be retaken.
      if (err.status === 400 || err.status === 403) setExpired(true);
    } finally {
      setBusy(false);
    }
  }

  const hints: Record<Hint, string> = {
    noFace: c.selfieNoFace, manyFaces: c.selfieManyFaces, closer: c.selfieCloser,
    center: c.selfieCenter, blink: c.selfieBlink, turn: c.selfieTurn, back: c.selfieBack,
    hold: c.selfieHold,
  };
  const camErrors: Record<CameraError, string> = {
    denied: c.selfieDenied, noCamera: c.selfieNoCamera, busy: c.selfieBusy,
    insecure: c.selfieInsecure, failed: c.selfieFailed,
  };
  const live = phase === "starting" || phase === "live";
  const good = hint === "blink" || hint === "turn" || hint === "back" || hint === "hold";

  return (
    <div className="auth-form auth-step">
      <div className="auth-mail-badge"><Icon name="camera" /></div>
      <p className="auth-step-lead"><strong>{c.selfieTitle}</strong><br />{c.selfieLead}</p>

      <div className={`selfie-frame${live ? " is-live" : ""}${good ? " is-good" : ""}`} hidden={!live && phase !== "preview"}>
        <video ref={video} className="selfie-video" autoPlay playsInline muted hidden={phase === "preview"} />
        {phase === "preview" && photo && <img className="selfie-video" src={photo.url} alt={c.selfiePreview} />}
        {live && (
          <svg className="selfie-guide" viewBox="0 0 100 75" preserveAspectRatio="none" aria-hidden>
            <defs>
              <mask id="selfie-mask">
                <rect width="100" height="75" fill="#fff" />
                <ellipse cx="50" cy="37.5" rx="19" ry="30" fill="#000" />
              </mask>
            </defs>
            <rect width="100" height="75" mask="url(#selfie-mask)" className="selfie-shade" />
            <ellipse cx="50" cy="37.5" rx="19" ry="30" className="selfie-oval" />
          </svg>
        )}
        {phase === "starting" && <p className="selfie-hint"><Icon name="loader" /> {c.selfieStarting}</p>}
        {phase === "live" && <p className="selfie-hint" aria-live="polite">{hints[hint]}</p>}
      </div>

      {phase === "live" && (
        <ul className="selfie-checks" aria-label={c.selfieChallenge}>
          <li className={passed.blink ? "is-done" : undefined}>
            <Icon name={passed.blink ? "check" : "eye"} /> {c.selfieDoneBlink}
          </li>
          <li className={passed.turn ? "is-done" : undefined}>
            <Icon name={passed.turn ? "check" : "user"} /> {c.selfieDoneTurn}
          </li>
        </ul>
      )}

      {phase === "error" && camError && (
        <div className="auth-error" role="alert"><Icon name="alertCircle" /> {camErrors[camError]}</div>
      )}
      <FormError message={error} />

      {(phase === "intro" || phase === "error") && (
        <>
          <button type="button" className="auth-submit" data-no-loader onClick={start}>
            <span className="auth-submit-label">{phase === "intro" ? c.selfieAllow : c.selfieRetry}</span>
            <Icon name="camera" />
          </button>
          {phase === "intro" && <p className="auth-step-lead selfie-small">{c.selfieAllowHint}</p>}
        </>
      )}

      {phase === "preview" && !expired && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="selfie-actions">
          <SubmitButton busy={busy} done={done}>{done ? t.auth.login.done : c.selfieUse}</SubmitButton>
          <button type="button" className="auth-link" data-no-loader disabled={busy || done} onClick={retake}>
            <Icon name="reset" /> {c.selfieRetake}
          </button>
        </form>
      )}

      {!done && <p className="auth-step-lead selfie-small">{c.selfieExpires(Math.round(expiresIn / 60))}</p>}
      <button type="button" className="auth-link auth-back" data-no-loader onClick={() => { stopCamera(); onBack(); }}>
        <Icon name="arrowLeft" /> {c.back}
      </button>
    </div>
  );
}

// One face's position, size, head turn and eye closure, in the video frame's 0..1 coordinates.
function readFace(r: FaceLandmarkerResult) {
  const count = r.faceLandmarks.length;
  if (count !== 1) return { count, width: 0, cx: 0, cy: 0, yaw: 0.5, blink: 0 };
  const pts = r.faceLandmarks[0];
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  // Nose tip (1) between the cheek edges (234, 454): about 0.5 facing the camera.
  const [nose, left, right] = [pts[1], pts[234], pts[454]];
  const yaw = (nose.x - left.x) / ((right.x - left.x) || 1e-6);
  const shapes = r.faceBlendshapes[0]?.categories ?? [];
  const score = (name: string) => shapes.find((s) => s.categoryName === name)?.score ?? 0;
  const blink = Math.min(score("eyeBlinkLeft"), score("eyeBlinkRight"));
  return { count, width: maxX - minX, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, yaw, blink };
}

function cameraError(e: unknown): CameraError {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "noCamera";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}
