"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { AttachButton, DropOverlay, MessageContent, PhotoPreview, usePhotoPicker } from "@/components/ChatPhoto";
import { ReplyBar, ReplyButton, ReplyQuote, jumpToMessage } from "@/components/ChatReply";
import Icon from "@/components/Icon";
import { admin, announceInbox, type AdminThread, type Conversation } from "@/lib/admin";
import { clockTime, dayLabel, mergeMessages, quoteOf, startsGroup, type ChatMessage, type ChatReplyRef } from "@/lib/chat";
import { playChime } from "@/lib/sound";
import { Empty, ErrorState, StatusChips, useAdmin } from "../ui";

const LIST_POLL_MS = 8_000;
const THREAD_POLL_MS = 4_000;
const JUMP_PAGES = 10; // how many older pages a quote may load to find its original

// Two panes: conversations on the left, the selected thread on the right (one at a time on
// small screens). Both poll; a new message from the open user chimes and is marked read.
export default function Inbox({ initialUser }: { initialUser: string | null }) {
  const { t, a, lang, ago, message } = useAdmin();
  const c = t.chat;
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(initialUser);
  const [thread, setThread] = useState<AdminThread | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const picker = usePhotoPicker(setSendError);
  const [olderBusy, setOlderBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const lastId = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const keepOffset = useRef<number | null>(null);

  const loadList = useCallback(async () => {
    try {
      setItems((await admin.conversations(query.trim(), unreadOnly)).items);
      setListError(null);
    } catch (e) {
      setListError(message(e));
    }
  }, [query, unreadOnly, message]);

  useEffect(() => {
    const id = window.setTimeout(loadList, 200);
    const poll = window.setInterval(() => { if (!document.hidden) loadList(); }, LIST_POLL_MS);
    return () => { window.clearTimeout(id); window.clearInterval(poll); };
  }, [loadList]);

  const markRead = useCallback((userId: string) => {
    admin.markRead(userId).then(() => {
      announceInbox();
      setItems((list) => list?.map((x) => (x.user.id === userId ? { ...x, unread: 0 } : x)) ?? null);
    }).catch(() => undefined);
  }, []);

  // Open a conversation: newest page, then poll for anything after it.
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setThread(null);
    setThreadError(null);
    setSendError(null);
    stick.current = true;
    admin.thread(selected).then((th) => {
      if (!alive) return;
      setThread(th);
      lastId.current = th.messages.at(-1)?.id ?? 0;
      if (th.unread) markRead(selected);
      window.setTimeout(() => inputRef.current?.focus(), 50);
    }).catch((e) => { if (alive) setThreadError(message(e)); });
    const id = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const th = await admin.thread(selected, { after: lastId.current });
        if (!alive || !th.messages.length) return;
        lastId.current = Math.max(lastId.current, th.messages.at(-1)!.id);
        setThread((cur) => (cur ? { ...cur, user: th.user, messages: mergeMessages(cur.messages, th.messages) } : cur));
        if (th.messages.some((m) => m.sender === "user")) {
          playChime("message");
          markRead(selected);
        }
      } catch {
        // Next poll retries.
      }
    }, THREAD_POLL_MS);
    return () => { alive = false; window.clearInterval(id); };
  }, [selected, reload, markRead, message]);

  // A photo picked, or a reply started, in one conversation never carries over to the next.
  const clearPhoto = picker.clear;
  useEffect(() => { clearPhoto(); setReplyTo(null); }, [selected, clearPhoto]);

  // Keep the URL on the open conversation, so refresh and back work.
  useEffect(() => {
    window.history.replaceState(null, "", selected ? `/admin/messages?user=${selected}` : "/admin/messages");
  }, [selected]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [thread]);

  async function loadOlder() {
    const first = thread?.messages[0];
    if (!selected || !first) return;
    setOlderBusy(true);
    try {
      const th = await admin.thread(selected, { before: first.id });
      keepOffset.current = bodyRef.current ? bodyRef.current.scrollHeight - bodyRef.current.scrollTop : null;
      setThread((cur) => (cur ? { ...cur, has_more: th.has_more, messages: [...th.messages, ...cur.messages] } : cur));
    } catch {
      // Button stays; try again.
    } finally {
      setOlderBusy(false);
    }
  }

  // Jumps to a quoted message, loading older pages first if it isn't on screen yet.
  async function jump(id: number) {
    if (jumpToMessage(bodyRef.current, id)) return;
    const first = thread?.messages[0];
    if (!selected || !first || !thread?.has_more || id >= first.id) return;
    try {
      let older: ChatMessage[] = [];
      let more = true;
      let before = first.id;
      for (let i = 0; i < JUMP_PAGES && more && !older.some((m) => m.id === id); i++) {
        const th = await admin.thread(selected, { before });
        older = [...th.messages, ...older];
        more = th.has_more;
        before = th.messages[0]?.id ?? before;
        if (!th.messages.length) break;
      }
      stick.current = false;
      setThread((cur) => (cur ? { ...cur, has_more: more, messages: [...older, ...cur.messages] } : cur));
      requestAnimationFrame(() => jumpToMessage(bodyRef.current, id));
    } catch {
      // Stay where we are.
    }
  }

  function startReply(m: ChatMessage) {
    setReplyTo(quoteOf(m));
    inputRef.current?.focus();
  }

  async function send() {
    const body = draft.trim();
    const photo = picker.photo;
    if (!selected || (!body && !photo) || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const reply = replyTo?.id;
      const msg = photo ? await admin.replyImage(selected, photo.file, body, reply) : await admin.reply(selected, body, reply);
      setDraft("");
      setReplyTo(null);
      if (photo) picker.clear();
      if (inputRef.current) inputRef.current.style.height = "auto";
      stick.current = true;
      lastId.current = Math.max(lastId.current, msg.id);
      setThread((cur) => (cur ? { ...cur, messages: mergeMessages(cur.messages.map((m) => ({ ...m, read: m.sender === "user" ? true : m.read })), [msg]) } : cur));
      setItems((list) => {
        if (!list) return list;
        const row = list.find((x) => x.user.id === selected);
        if (!row) return list;
        const updated = { ...row, last_body: msg.body, last_image: Boolean(msg.image_url), last_sender: "admin" as const, last_at: msg.created_at, unread: 0, total: row.total + 1 };
        return [updated, ...list.filter((x) => x.user.id !== selected)];
      });
      announceInbox();
    } catch (e) {
      setSendError(message(e));
    } finally {
      setSending(false);
    }
  }

  const who = thread?.user ?? items?.find((x) => x.user.id === selected)?.user ?? null;
  const msgs = thread?.messages ?? [];
  const nameOf = (q: { sender: string; admin_name: string | null }) =>
    q.sender === "admin" ? (q.admin_name ?? c.team) : (who?.name ?? "");

  return (
    <>
      <div className="adm-head">
        <div>
          <p className="adm-eyebrow"><Icon name="message" /> {a.nav.messages}</p>
          <h1>{a.messagesTitle}</h1>
          <p className="lead">{a.messagesLead}</p>
        </div>
      </div>

      <div className={`adm-inbox adm-rise${selected ? " has-thread" : ""}`}>
        <aside className="adm-convs">
          <div className="adm-convs-head">
            <label className="adm-search">
              <Icon name="search" />
              <input type="search" value={query} placeholder={a.inboxSearch} aria-label={a.inboxSearch}
                     onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="adm-tabs is-small" role="tablist">
              <button type="button" role="tab" className="adm-tab" data-no-loader aria-selected={!unreadOnly} onClick={() => setUnreadOnly(false)}>{a.allConv}</button>
              <button type="button" role="tab" className="adm-tab" data-no-loader aria-selected={unreadOnly} onClick={() => setUnreadOnly(true)}>{a.unreadConv}</button>
            </div>
          </div>
          <div className="adm-convs-list">
            {listError && !items && <ErrorState text={listError} onRetry={loadList} />}
            {!items && !listError && <div className="adm-table-skeleton" aria-busy="true"><i /><i /><i /><i /></div>}
            {items && items.length === 0 && <Empty icon="message" title={a.noConversations} text={a.noConversationsText} />}
            {items?.map((cv, i) => (
              <button key={cv.user.id} type="button" data-no-loader
                      className={`adm-conv${cv.user.id === selected ? " is-active" : ""}${cv.unread ? " is-unread" : ""}`}
                      style={{ "--i": i } as React.CSSProperties} onClick={() => setSelected(cv.user.id)}>
                <span className="adm-user-avatar">
                  <Avatar name={cv.user.name} src={cv.user.avatar_url} size={40} />
                  {cv.user.online && <i className="adm-online-dot" aria-hidden />}
                </span>
                <span className="adm-conv-text">
                  <span className="adm-conv-top">
                    <strong>{cv.user.name}</strong>
                    <time dateTime={cv.last_at}>{ago(cv.last_at)}</time>
                  </span>
                  <span className="adm-conv-preview">
                    {cv.last_sender === "admin" && <em>{a.youPrefix}</em>}
                    {cv.last_image && <><Icon name="image" className="adm-conv-photo" />{!cv.last_body && c.photo}</>}
                    {cv.last_body}
                  </span>
                </span>
                {cv.unread > 0 && <span key={cv.unread} className="adm-conv-badge">{cv.unread}</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className="adm-thread" {...(selected ? picker.dropProps : {})}>
          {selected && picker.dragging && <DropOverlay />}
          {!selected && <Empty icon="message" title={a.pick} text={a.pickText} />}
          {selected && threadError && !thread && <ErrorState text={threadError} onRetry={() => setReload((n) => n + 1)} />}
          {selected && (who || thread) && (
            <>
              <header className="adm-thread-head">
                <button type="button" className="adm-btn is-icon adm-thread-back" data-no-loader aria-label={a.backToInbox}
                        onClick={() => setSelected(null)}>
                  <Icon name="arrowLeft" />
                </button>
                {who && (
                  <>
                    <span className="adm-user-avatar">
                      <Avatar name={who.name} src={who.avatar_url} size={40} />
                      {who.online && <i className="adm-online-dot" aria-hidden />}
                    </span>
                    <span className="adm-user-text">
                      <strong>{who.name}</strong>
                      <small>{who.email}</small>
                    </span>
                    <StatusChips user={who} />
                    <Link href={`/admin/users/${who.id}`} className="adm-btn is-small">
                      <Icon name="user" /> {a.viewProfile}
                    </Link>
                  </>
                )}
              </header>
              {who?.is_blocked && <p className="adm-thread-warn"><Icon name="ban" /> {a.blockedChat}</p>}

              <div className="adm-thread-body" ref={bodyRef}
                   onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
                {!thread && <div className="chat-skeleton" aria-busy="true"><i /><i className="is-mine" /><i /></div>}
                {thread?.has_more && (
                  <button type="button" className="chat-older" data-no-loader onClick={loadOlder} disabled={olderBusy}>
                    <Icon name={olderBusy ? "loader" : "arrowUp"} className={olderBusy ? "spin" : undefined} /> {c.loadOlder}
                  </button>
                )}
                {msgs.map((m, i) => {
                  const day = dayLabel(m.created_at, lang, c.today, c.yesterday);
                  const newDay = i === 0 || dayLabel(msgs[i - 1].created_at, lang, c.today, c.yesterday) !== day;
                  const mine = m.sender === "admin";
                  return (
                    <div key={m.id}>
                      {newDay && <div className="chat-day"><span>{day}</span></div>}
                      {(newDay || startsGroup(msgs, i)) && (
                        <div className={`chat-from${mine ? " is-mine" : ""}`}>{mine ? (m.admin_name ?? c.team) : who?.name}</div>
                      )}
                      <div className={`chat-row${mine ? " is-mine" : ""}`} data-msg={m.id}>
                        <div className={`chat-bubble${m.image_url ? " has-photo" : ""}${m.reply_to ? " has-quote" : ""}`}>
                          {m.reply_to && <ReplyQuote q={m.reply_to} name={nameOf(m.reply_to)} onJump={jump} />}
                          <MessageContent m={m} from={mine ? (m.admin_name ?? c.team) : (who?.name ?? "")} />
                          <time dateTime={m.created_at}>
                            {clockTime(m.created_at, lang)}
                            {mine && <> · <Icon name={m.read ? "checkCheck" : "check"} /></>}
                          </time>
                        </div>
                        <ReplyButton name={nameOf(m)} onClick={() => startReply(m)} />
                      </div>
                    </div>
                  );
                })}
              </div>

              <form className="chat-compose" onSubmit={(e) => { e.preventDefault(); send(); }}>
                {sendError && <p className="chat-compose-error" role="alert"><Icon name="alertCircle" /> {sendError}</p>}
                {replyTo && (
                  <ReplyBar q={replyTo} name={nameOf(replyTo)} onJump={jump}
                            onCancel={() => { setReplyTo(null); inputRef.current?.focus(); }} />
                )}
                {picker.photo && <PhotoPreview photo={picker.photo} onRemove={picker.clear} />}
                <div className="chat-compose-row">
                  <AttachButton onClick={picker.open} disabled={sending} />
                  {picker.input}
                  <textarea ref={inputRef} rows={1} value={draft} maxLength={2000}
                            placeholder={picker.photo ? c.captionPh : a.replyPh(who?.name ?? "")}
                            aria-label={a.replyPh(who?.name ?? "")} onPaste={picker.onPaste}
                            onChange={(e) => {
                              setDraft(e.target.value);
                              e.target.style.height = "auto";
                              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
                              if (e.key === "Escape" && replyTo) { e.preventDefault(); setReplyTo(null); }
                            }} />
                  <button type="submit" className="chat-send" data-no-loader disabled={(!draft.trim() && !picker.photo) || sending}
                          aria-label={a.send} title={a.send}>
                    <Icon name={sending ? "loader" : "send"} className={sending ? "spin" : undefined} />
                  </button>
                </div>
                <small className="chat-hint">{c.hint}</small>
              </form>
            </>
          )}
        </section>
      </div>
    </>
  );
}
