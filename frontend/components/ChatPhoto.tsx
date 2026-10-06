"use client";

// Photos in the support chat, shared by the user's widget (components/ChatWidget.tsx) and the
// admin inbox: picking one (button, paste or drag-and-drop), the preview above the composer,
// the photo inside a message bubble, and the full-size viewer.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { PHOTO_MAX_BYTES, PHOTO_TYPES, type ChatMessage } from "@/lib/chat";

export interface PickedPhoto {
  file: File;
  url: string; // object URL for the preview; whoever ends up holding it revokes it
}

// The photo waiting to be sent. `take()` hands it over (e.g. to a pending message) without
// revoking its preview URL; `clear()` drops and revokes it.
export function usePhotoPicker(onError: (msg: string | null) => void) {
  const { t } = useI18n();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0); // dragenter/leave fire for every child; count them

  const pick = useCallback((file: File | undefined | null) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) return onError(t.chat.errType);
    if (file.size > PHOTO_MAX_BYTES) return onError(t.chat.errSize);
    onError(null);
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { file, url: URL.createObjectURL(file) };
    });
  }, [onError, t]);

  const clear = useCallback(() => {
    setPhoto((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
  }, []);

  const take = useCallback(() => {
    const p = photo;
    setPhoto(null);
    return p;
  }, [photo]);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setDragging(true); },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      pick(e.dataTransfer.files[0]);
    },
  };

  // A pasted screenshot or copied image becomes the attachment; pasted text pastes as usual.
  const onPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); pick(file); }
  };

  const input = (
    <input ref={inputRef} type="file" accept={PHOTO_TYPES.join(",")} hidden
           onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
  );
  const open = () => inputRef.current?.click();

  return { photo, pick, clear, take, dragging, dropProps, onPaste, input, open };
}

export function AttachButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <button type="button" className="chat-attach" data-no-loader onClick={onClick} disabled={disabled}
            aria-label={t.chat.attach} title={t.chat.attach}>
      <Icon name="image" />
    </button>
  );
}

export function PhotoPreview({ photo, onRemove }: { photo: PickedPhoto; onRemove: () => void }) {
  const { t } = useI18n();
  return (
    <div className="chat-attached">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
      <img src={photo.url} alt="" />
      <span className="chat-attached-name">{photo.file.name || t.chat.photo}</span>
      <button type="button" className="chat-attached-x" data-no-loader onClick={onRemove}
              aria-label={t.chat.removePhoto} title={t.chat.removePhoto}>
        <Icon name="x" />
      </button>
    </div>
  );
}

export function DropOverlay() {
  const { t } = useI18n();
  return (
    <div className="chat-drop" aria-hidden>
      <Icon name="upload" /> {t.chat.dropHere}
    </div>
  );
}

// The photo inside a bubble. Sized from the stored dimensions so nothing jumps while it loads;
// clicking opens the full-size viewer.
export function MessagePhoto({ src, width, height, alt }: {
  src: string; width?: number | null; height?: number | null; alt: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const ratio = width && height ? `${width} / ${height}` : undefined;
  return (
    <>
      <button type="button" className={`chat-photo${loaded ? " is-loaded" : ""}`} data-no-loader
              style={{ aspectRatio: ratio }} onClick={() => setOpen(true)} aria-label={alt}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
        <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} />
      </button>
      {open && <PhotoViewer src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function PhotoViewer({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    // Capture phase, so Escape closes the photo and not the chat panel behind it.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="chat-viewer" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <div className="chat-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noopener noreferrer" className="chat-viewer-btn"
           title={t.chat.openOriginal} aria-label={t.chat.openOriginal}>
          <Icon name="download" />
        </a>
        <button type="button" className="chat-viewer-btn" data-no-loader onClick={onClose}
                title={t.chat.closePhoto} aria-label={t.chat.closePhoto} autoFocus>
          <Icon name="x" />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  );
}

// Bubble contents for a stored message: the photo (if any), then the text (if any).
export function MessageContent({ m, from }: { m: ChatMessage; from: string }) {
  const { t } = useI18n();
  return (
    <>
      {m.image_url && (
        <MessagePhoto src={m.image_url} width={m.image_width} height={m.image_height}
                      alt={t.chat.photoAlt(from)} />
      )}
      {m.body && <p>{m.body}</p>}
    </>
  );
}
