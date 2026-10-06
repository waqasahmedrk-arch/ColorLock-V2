"use client";

// Replies in the support chat, shared by the user's widget (components/ChatWidget.tsx) and the
// admin inbox: the Reply button beside a bubble, the "Replying to …" bar above the composer,
// the quote at the top of a reply, and jumping from a quote to the original message.

import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import type { ChatReplyRef } from "@/lib/chat";

const FLASH_MS = 1600; // matches the chat-flash animation

// Text for a quote: the message text, or "Photo" for a photo sent without a caption.
function QuoteText({ q }: { q: ChatReplyRef }) {
  const { t } = useI18n();
  if (q.body) return <>{q.body}</>;
  return <><Icon name="image" className="chat-quote-photo-icon" />{t.chat.photo}</>;
}

function Thumb({ src }: { src?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element -- signed storage URL
  return src ? <img className="chat-quote-thumb" src={src} alt="" loading="lazy" /> : null;
}

// The quote at the top of a reply bubble. Clicking it jumps to the original.
export function ReplyQuote({ q, name, onJump }: { q: ChatReplyRef; name: string; onJump: (id: number) => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="chat-quote" data-no-loader data-sender={q.sender}
            onClick={() => onJump(q.id)} title={t.chat.jumpTo}>
      <span className="chat-quote-text">
        <strong>{name}</strong>
        <span><QuoteText q={q} /></span>
      </span>
      <Thumb src={q.image_url} />
    </button>
  );
}

// Shown above the composer while a reply is being written.
export function ReplyBar({ q, name, onCancel, onJump }: {
  q: ChatReplyRef; name: string; onCancel: () => void; onJump: (id: number) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="chat-replying" role="status">
      <span className="chat-replying-icon" aria-hidden><Icon name="reply" /></span>
      <button type="button" className="chat-replying-text" data-no-loader onClick={() => onJump(q.id)} title={t.chat.jumpTo}>
        <strong>{t.chat.replyingTo(name)}</strong>
        <span><QuoteText q={q} /></span>
      </button>
      <Thumb src={q.image_url} />
      <button type="button" className="chat-attached-x" data-no-loader onClick={onCancel}
              aria-label={t.chat.cancelReply} title={t.chat.cancelReply}>
        <Icon name="x" />
      </button>
    </div>
  );
}

// The small Reply button beside a bubble: shown on hover / keyboard focus, always on touch.
export function ReplyButton({ name, onClick }: { name: string; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="chat-reply-btn" data-no-loader onClick={onClick}
            aria-label={t.chat.replyTo(name)} title={t.chat.reply}>
      <Icon name="reply" />
    </button>
  );
}

// Scrolls the message with this id into view inside `container` and flashes it. Returns
// false if it isn't on screen (an older page that hasn't been loaded).
export function jumpToMessage(container: HTMLElement | null, id: number): boolean {
  const el = container?.querySelector<HTMLElement>(`[data-msg="${id}"]`);
  if (!el) return false;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  el.classList.remove("is-flash");
  void el.offsetWidth; // restart the animation if it's already flashing
  el.classList.add("is-flash");
  window.setTimeout(() => el.classList.remove("is-flash"), FLASH_MS);
  return true;
}
