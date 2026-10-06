// Puts the files the admin selfie check needs (app/(auth)/admin-login/SelfieStep.tsx) under
// public/mediapipe, so they're served by this site and the camera page talks to no third party:
// the MediaPipe WASM runtime (copied from node_modules) and the face landmark model (downloaded
// once). Runs before `dev`, `dev:admin` and `build`; does nothing when the files are there.

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "mediapipe");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmOut = join(out, "wasm");
mkdirSync(wasmOut, { recursive: true });
for (const f of readdirSync(wasmSrc)) {
  if (!existsSync(join(wasmOut, f))) copyFileSync(join(wasmSrc, f), join(wasmOut, f));
}

const model = join(out, "face_landmarker.task");
if (!existsSync(model)) {
  console.log("face-assets: downloading the face landmark model…");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`face-assets: model download failed (${res.status})`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
