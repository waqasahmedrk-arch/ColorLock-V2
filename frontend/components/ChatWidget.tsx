"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AttachButton, DropOverlay, MessageContent, PhotoPreview, usePhotoPicker, type PickedPhoto } from "@/components/ChatPhoto";
import { ReplyBar, ReplyButton, ReplyQuote, jumpToMessage } from "@/components/ChatReply";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import type { User } from "@/lib/auth";
import { chat, clockTime, dayLabel, mergeMessages, quoteOf, startsGroup, type ChatMessage, type ChatReplyRef } from "@/lib/chat";
import { translateServer } from "@/lib/i18n";
import { installAudioUnlock, playChime } from "@/lib/sound";

const POLL_OPEN_MS = 4_000;
const POLL_CLOSED_MS = 10_000;
const CLOSE_MS = 180; // matches .chat-panel.is-closing
export const OPEN_CHAT = "colorlock:open-chat";

// A message the user sent that the server hasn't confirmed yet (negative id).
type Pending = { id: number; body: string; photo: PickedPhoto | null; replyTo: ChatReplyRef | null; failed: boolean };

const JUMP_PAGES = 10; // how many older pages a quote may load to find its original

// Floating support chat for signed-in users: a launcher in the corner with an unread badge,
// and a panel holding the user's single conversation with the admin team. Polls quickly while
// open and slowly while closed; a reply from an admin plays the message sound (if switched on).
// Opens itself on #chat (links in older "new message" notifications) or the OPEN_CHAT event.
export default function ChatWidget({ user }: { user: User }) {
  const pathname = usePathname();
  const { t, lang } = useI18n();
  const c = t.chat;
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unread, setUnread] = useState(0);
  const [bump, setBump] = useState(0);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const picker = usePhotoPicker(setError);
  const lastUnread = useRef<number | null>(null);
  const lastId = useRef(0);
  const tempId = useRef(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // keep scrolled to the bottom unless the user scrolled up
  const keepOffset = useRef<number | null>(null); // restores position after loading older

  const hidden = pathname.startsWith("/admin");

  // Make room for the launcher: Back-to-top moves up while the widget is on the page.
  useEffect(() => {
    if (hidden) return;
    document.documentElement.setAttribute("data-chat", "");
    installAudioUnlock();
    return () => document.documentElement.removeAttribute("data-chat");
  }, [hidden]);

  const arrived = useCallback((count: number) => {
    if (lastUnread.current !== null && count > lastUnread.current) {
      setBump((b) => b + 1);
      playChime("message");
    }
    lastUnread.current = count;
    setUnread(count);
  }, []);

  // Closed: a cheap unread count. Keeps going in a background tab, so a reply still chimes
  // (replies raise no notification; the sound is how the user hears about them).
  useEffect(() => {
    if (open || hidden) return;
    const check = () => { chat.unread().then((r) => arrived(r.unread)).catch(() => undefined); };
    check();
    const id = window.setInterval(check, POLL_CLOSED_MS);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", check); };
  }, [open, hidden, arrived]);

  const markRead = useCallback(() => {
    chat.markRead().then(() => { lastUnread.current = 0; setUnread(0); }).catch(() => undefined);
  }, []);

  const loadLatest = useCallback(async () => {
    setFailed(false);
    try {
      const page = await chat.thread();
      setMessages(page.messages);
      setHasMore(page.has_more);
      lastId.current = page.messages.at(-1)?.id ?? 0;
      stick.current = true;
      if (page.unread) markRead();
    } catch {
      setFailed(true);
    }
  }, [markRead]);

  // Open: load the conversation, then poll for anything newer. Also in a background tab, so a
  // reply chimes there too; it's only marked "seen" once the tab is in front again.
  useEffect(() => {
    if (!open) return;
    loadLatest();
    let unseen = false;
    const poll = async () => {
      try {
        const page = await chat.thread({ after: lastId.current });
        if (!page.messages.length) return;
        lastId.current = Math.max(lastId.current, page.messages.at(-1)!.id);
        setMessages((list) => mergeMessages(list ?? [], page.messages));
        if (page.messages.some((m) => m.sender === "admin")) {
          playChime("message");
          setBump((b) => b + 1);
          if (document.hidden) unseen = true;
          else markRead();
        }
      } catch {
        // Keep the last good state; the next poll retries.
      }
    };
    const onVisible = () => {
      if (!document.hidden && unseen) { unseen = false; markRead(); }
    };
    const id = window.setInterval(poll, POLL_OPEN_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [open, loadLatest, markRead]);

  // "Seen" ticks on the user's own messages: re-read the thread now and then while open.
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const page = await chat.thread();
        setMessages((list) => {
          if (!list) return list;
          const read = new Map(page.messages.map((m) => [m.id, m.read]));
          return list.map((m) => (read.has(m.id) && read.get(m.id) !== m.read ? { ...m, read: read.get(m.id)! } : m));
        });
      } catch {
        // Ignore; ticks update on the next round.
      }
    }, POLL_OPEN_MS * 4);
    return () => window.clearInterval(id);
  }, [open]);

  const show = useCallback(() => { setClosing(false); setOpen(true); }, []);
  const hide = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
  }, []);

  // #chat (notification links) and the OPEN_CHAT event open the panel.
  useEffect(() => {
    if (hidden) return;
    const fromHash = () => {
      if (window.location.hash === "#chat") {
        show();
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    window.addEventListener(OPEN_CHAT, show);
    return () => { window.removeEventListener("hashchange", fromHash); window.removeEventListener(OPEN_CHAT, show); };
  }, [hidden, show, pathname]);

  // Escape cancels a reply first, then closes the panel.
  const replying = replyTo !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (replying) setReplyTo(null);
      else hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide, replying]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 120);
    return () => window.clearTimeout(id);
  }, [open]);

  // Scroll: pinned to the bottom for new messages; kept in place when older ones load.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  async function loadOlder() {
    const first = messages?.[0];
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await chat.thread({ before: first.id });
      keepOffset.current = listRef.current ? listRef.current.scrollHeight - listRef.current.scrollTop : null;
      setMessages((list) => [...page.messages, ...(list ?? [])]);
      setHasMore(page.has_more);
    } catch {
      // Leave the button so the user can try again.
    } finally {
      setLoadingOlder(false);
    }
  }

  // Jumps to a quoted message, loading older pages first if it isn't on screen yet.
  async function jump(id: number) {
    if (jumpToMessage(listRef.current, id)) return;
    const first = messages?.[0];
    if (!first || !hasMore || id >= first.id) return;
    try {
      let older: ChatMessage[] = [];
      let more: boolean = hasMore;
      let before = first.id;
      for (let i = 0; i < JUMP_PAGES && more && !older.some((m) => m.id === id); i++) {
        const page = await chat.thread({ before });
        older = [...page.messages, ...older];
        more = page.has_more;
        before = page.messages[0]?.id ?? before;
        if (!page.messages.length) break;
      }
      stick.current = false;
      setMessages((list) => [...older, ...(list ?? [])]);
      setHasMore(more);
      requestAnimationFrame(() => jumpToMessage(listRef.current, id));
    } catch {
      // Stay where we are.
    }
  }

  const nameOf = (q: { sender: string; admin_name: string | null }) =>
    q.sender === "user" ? c.you : (q.admin_name ?? c.team);

  function startReply(m: ChatMessage) {
    setReplyTo(quoteOf(m));
    inputRef.current?.focus();
  }

  async function deliver(item: Pending) {
    try {
      const reply = item.replyTo?.id;
      const msg = item.photo ? await chat.sendImage(item.photo.file, item.body, reply) : await chat.send(item.body, reply);
      if (item.photo) URL.revokeObjectURL(item.photo.url);
      setPending((list) => list.filter((p) => p.id !== item.id));
      setMessages((list) => mergeMessages(list ?? [], [msg]));
      lastId.current = Math.max(lastId.current, msg.id);
    } catch (e) {
      setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: true } : p)));
      setError(translateServer(t, (e as Error).message));
    }
  }

  function send() {
    const body = draft.trim();
    if (!body && !picker.photo) return;
    const item = { id: tempId.current--, body, photo: picker.take(), replyTo, failed: false };
    setPending((list) => [...list, item]);
    setDraft("");
    setReplyTo(null);
    setError(null);
    stick.current = true;
    deliver(item);
  }

  function retry(item: Pending) {
    setPending((list) => list.map((p) => (p.id === item.id ? { ...p, failed: false } : p)));
    setError(null);
    deliver(item);
  }

  if (hidden) return null;

  const list = messages ?? [];
  const lastMine = [...list].reverse().find((m) => m.sender === "user");
  const label = unread ? c.openUnread(unread) : c.open;

  return (
    <>
      {open && (
        <section className={`chat-panel${closing ? " is-closing" : ""}`} role="dialog" aria-label={c.title}
                 {...picker.dropProps}>
          {picker.dragging && <DropOverlay />}
          <header className="chat-head">
            <span className="chat-head-avatar" aria-hidden>
              <Icon name="message" />
              <i className="chat-head-live" />
            </span>
            <span className="chat-head-text">
              <strong>{c.title}</strong>
              <small>{c.subtitle}</small>
            </span>
            <button type="button" className="chat-icon-btn" data-no-loader aria-label={c.close} title={c.close} onClick={hide}>
              <Icon name="x" />
            </button>
          </header>

          <div className="chat-body" ref={listRef}
               onScroll={(e) => {
                 const el = e.currentTarget;
                 stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
               }}>
            <div className="chat-intro">
              <span className="chat-intro-dots" aria-hidden><i /><i /><i /><i /></span>
              <strong>{c.greeting(user.name.split(" ")[0])}</strong>
              <p>{c.intro}</p>
            </div>

            {messages === null && !failed && (
              <div className="chat-skeleton" aria-busy="true"><i /><i className="is-mine" /><i /></div>
            )}
            {failed && (
              <div className="chat-error">
                <span>{c.loadError}</span>
                <button type="button" className="chat-link" data-no-loader onClick={loadLatest}>{c.retryLoad}</button>
              </div>
            )}
            {hasMore && (
              <button type="button" className="chat-older" data-no-loader onClick={loadOlder} disabled={loadingOlder}>
                {loadingOlder ? <Icon name="loader" className="spin" /> : <Icon name="arrowUp" />} {c.loadOlder}
              </button>
            )}

            {list.map((m, i) => {
              const day = dayLabel(m.created_at, lang, c.today, c.yesterday);
              const newDay = i === 0 || dayLabel(list[i - 1].created_at, lang, c.today, c.yesterday) !== day;
              const mine = m.sender === "user";
              return (
                <div key={m.id} className="chat-row-wrap">
                  {newDay && <div className="chat-day"><span>{day}</span></div>}
                  {!mine && (newDay || startsGroup(list, i)) && (
                    <div className="chat-from">{m.admin_name ? `${m.admin_name} · ${c.team}` : c.team}</div>
                  )}
                  <div className={`chat-row${mine ? " is-mine" : ""}`} data-msg={m.id}>
                    <div className={`chat-bubble${m.image_url ? " has-photo" : ""}${m.reply_to ? " has-quote" : ""}`}>
                      {m.reply_to && <ReplyQuote q={m.reply_to} name={nameOf(m.reply_to)} onJump={jump} />}
                      <MessageContent m={m} from={mine ? user.name : (m.admin_name ?? c.team)} />
                      <time dateTime={m.created_at}>{clockTime(m.created_at, lang)}</time>
                    </div>
                    <ReplyButton name={nameOf(m)} onClick={() => startReply(m)} />
                  </div>
                  {mine && m.id === lastMine?.id && !pending.length && (
                    <div className="chat-receipt">
                      <Icon name={m.read ? "checkCheck" : "check"} /> {m.read ? c.seen : c.delivered}
                    </div>
                  )}
                </div>
              );
            })}

            {pending.map((p) => (
              <div key={p.id} className="chat-row-wrap">
                <div className={`chat-row is-mine${p.failed ? " is-failed" : " is-pending"}`}>
                  <div className={`chat-bubble${p.photo ? " has-photo" : ""}${p.replyTo ? " has-quote" : ""}`}>
                    {p.replyTo && <ReplyQuote q={p.replyTo} name={nameOf(p.replyTo)} onJump={jump} />}
                    {/* eslint-disable-next-line @next/next/no-img-element -- local preview while uploading */}
                    {p.photo && <span className="chat-photo is-loaded"><img src={p.photo.url} alt="" /></span>}
                    {p.body && <p>{p.body}</p>}
                  </div>
                </div>
                <div className="chat-receipt">
                  {p.failed ? (
                    <>
                      <Icon name="alertCircle" /> {c.failed} ·{" "}
                      <button type="button" className="chat-link" data-no-loader onClick={() => retry(p)}>{c.retry}</button>
                    </>
                  ) : (
                    <><Icon name="loader" className="spin" /> {c.sending}</>
                  )}
                </div>
              </div>
            ))}
          </div>

          <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
            {error && <p className="chat-compose-error" role="alert"><Icon name="alertCircle" /> {error}</p>}
            {replyTo && (
              <ReplyBar q={replyTo} name={nameOf(replyTo)} onJump={jump}
                        onCancel={() => { setReplyTo(null); inputRef.current?.focus(); }} />
            )}
            {picker.photo && <PhotoPreview photo={picker.photo} onRemove={picker.clear} />}
            <div className="chat-compose-row">
              <AttachButton onClick={picker.open} />
              {picker.input}
              <textarea ref={inputRef} rows={1} value={draft} maxLength={2000}
                        placeholder={picker.photo ? c.captionPh : c.placeholder}
                        aria-label={c.placeholder} onPaste={picker.onPaste}
                        onChange={(e) => {
                          setDraft(e.target.value);
                          e.target.style.height = "auto";
                          e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                            e.preventDefault();
                            send();
                            (e.target as HTMLTextAreaElement).style.height = "auto";
                          }
                        }} />
              <button type="submit" className="chat-send" data-no-loader disabled={!draft.trim() && !picker.photo} aria-label={c.send} title={c.send}>
                <Icon name="send" />
              </button>
            </div>
            <small className="chat-hint">{c.hint}</small>
          </form>
        </section>
      )}

      <button type="button" className={`chat-launcher${open && !closing ? " is-open" : ""}${unread ? " has-unread" : ""}`}
              data-no-loader aria-label={open ? c.close : label} title={open ? c.close : label}
              aria-expanded={open && !closing} onClick={() => (open ? hide() : show())}>
        <span className="chat-launcher-icon is-msg" aria-hidden><Icon name="message" /></span>
        <span className="chat-launcher-icon is-x" aria-hidden><Icon name="x" /></span>
        {unread > 0 && !open && (
          <span key={bump} className="chat-launcher-badge" aria-hidden>{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
    </>
  );
}
