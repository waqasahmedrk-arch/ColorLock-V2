"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";
import { useI18n } from "@/components/I18nProvider";
import Icon from "@/components/Icon";
import { IS_ADMIN_APP } from "@/lib/appMode";
import { AuthError, GENDERS, auth, type Gender, type User } from "@/lib/auth";
import { Field, FormError } from "../../(auth)/_components/fields";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// YYYY-MM-DD for today in the user's own time zone (the date picker's upper limit).
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
// The admin site has its own copies of the profile pages, under /admin.
const BASE = IS_ADMIN_APP ? "/admin" : "";

export default function ProfileForm({ user: initial }: { user: User }) {
  const router = useRouter();
  const { t, lang } = useI18n();
  const [user, setUser] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [gender, setGender] = useState<Gender | null>(initial.gender);
  const [dob, setDob] = useState(initial.date_of_birth ?? "");
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [job, setJob] = useState(initial.job_title ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A picked-but-unsaved photo, or "remove" when the current one should be deleted on save.
  const [photo, setPhoto] = useState<File | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const trimmed = tidy(name);
  const details = {
    gender, date_of_birth: dob || null, phone: tidy(phone) || null, job_title: tidy(job) || null,
  };
  const detailsDirty = details.gender !== user.gender || details.date_of_birth !== user.date_of_birth
    || details.phone !== user.phone || details.job_title !== user.job_title;
  const dirty = trimmed !== user.name || photo !== null || detailsDirty;
  const shownSrc = photo === "remove" ? null : preview ?? user.avatar_url;
  const since = new Date(user.created_at + "Z").toLocaleDateString(lang,
    { year: "numeric", month: "long", day: "numeric" });

  function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError(t.profile.errType);
    if (file.size > MAX_BYTES) return setError(t.profile.errSize);
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
  }

  function discard() {
    setName(user.name);
    setGender(user.gender);
    setDob(user.date_of_birth ?? "");
    setPhone(user.phone ?? "");
    setJob(user.job_title ?? "");
    setFieldErrors({});
    setPhoto(null);
    setPreview(null);
    setError(null);
    setNameError(null);
  }

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    if (!trimmed) return setNameError(t.auth.errName);
    setNameError(null);
    setFieldErrors({});
    setError(null);
    setBusy(true);
    try {
      let next = user;
      if (photo instanceof File) next = await auth.uploadAvatar(photo);
      else if (photo === "remove") next = await auth.deleteAvatar();
      if (trimmed !== user.name || detailsDirty) next = await auth.updateProfile({ name: trimmed, ...details });
      setUser(next);
      setName(next.name);
      setGender(next.gender);
      setDob(next.date_of_birth ?? "");
      setPhone(next.phone ?? "");
      setJob(next.job_title ?? "");
      setPhoto(null);
      setPreview(null);
      setToast(t.profile.saved);
      router.refresh(); // header avatar and name come from the server layout
    } catch (e) {
      const a = e as AuthError;
      if (a.status === 401) return window.location.replace(`/login?next=${BASE}/profile`);
      if (a.fields.name) setNameError(a.fields.name);
      const known = ["date_of_birth", "phone", "job_title", "gender"].filter((k) => a.fields[k]);
      if (known.length) setFieldErrors(a.fields);
      else if (!a.fields.name) setError(a.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile">
      <aside className="profile-card">
        <div className="profile-banner" aria-hidden />
        <div
          className={`profile-avatar${dragging ? " is-dragging" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]); }}
        >
          <Avatar key={shownSrc ?? "none"} name={trimmed || user.name} src={shownSrc} size={112} />
          <button type="button" className="profile-avatar-edit" data-no-loader
                  onClick={() => fileRef.current?.click()} aria-label={t.profile.changePhoto}>
            <Icon name="camera" />
          </button>
        </div>
        <Link href={`${BASE}/change-password`} className="profile-password">
          <Icon name="key" /> {t.profile.changePassword}
        </Link>
        <h2 className="profile-name">{trimmed || user.name}</h2>
        {(tidy(job) || user.job_title) && (
          <p className="profile-job"><Icon name="briefcase" /> {tidy(job) || user.job_title}</p>
        )}
        <p className="profile-email">
          <Icon name="badgeCheck" /> {user.email}
        </p>
        <p className="profile-since muted"><Icon name="calendar" /> {t.profile.memberSince(since)}</p>
      </aside>

      <form className="profile-form auth-form" onSubmit={save} noValidate>
        <section className="profile-section">
          <h3>{t.profile.photoTitle}</h3>
          <p className="muted">{t.profile.photoHint}</p>
          <div className="profile-photo-actions">
            <button type="button" className="secondary" data-no-loader onClick={() => fileRef.current?.click()}>
              <Icon name="upload" /> {t.profile.upload}
            </button>
            {shownSrc && (
              <button type="button" className="profile-remove" data-no-loader
                      onClick={() => { setPhoto(user.avatar_url ? "remove" : null); setPreview(null); }}>
                <Icon name="trash" /> {t.profile.remove}
              </button>
            )}
            <input ref={fileRef} type="file" accept={TYPES.join(",")} hidden
                   onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          {photo && (
            <p className="profile-pending">
              <Icon name="info" /> {photo === "remove" ? t.profile.pendingRemove : t.profile.pendingNew}
            </p>
          )}
        </section>

        <section className="profile-section">
          <h3>{t.profile.detailsTitle}</h3>
          <Field label={t.auth.fullName} icon="user" autoComplete="name" value={name} delay={0}
                 maxLength={100} error={nameError} onChange={(e) => setName(e.target.value)} />
          <Field label={t.auth.email} icon="mail" type="email" value={user.email} delay={1}
                 readOnly disabled />
        </section>

        <section className="profile-section">
          <h3>{t.profile.moreTitle}</h3>
          <p className="muted">{t.profile.moreHint}</p>
          <Field label={t.profile.jobTitle} icon="briefcase" autoComplete="organization-title" value={job}
                 delay={2} maxLength={100} error={fieldErrors.job_title}
                 onChange={(e) => setJob(e.target.value)} />
          <div className="profile-two">
            <Field label={t.profile.phone} icon="phone" type="tel" inputMode="tel" autoComplete="tel"
                   value={phone} delay={3} maxLength={32} error={fieldErrors.phone}
                   onChange={(e) => setPhone(e.target.value)} />
            <Field label={t.profile.dob} icon="calendar" type="date" autoComplete="bday" value={dob}
                   delay={4} min="1900-01-01" max={todayLocal()} error={fieldErrors.date_of_birth}
                   onChange={(e) => setDob(e.target.value)} />
          </div>
          <fieldset className="profile-gender auth-rise" style={{ "--d": 5 } as React.CSSProperties}>
            <legend>{t.profile.gender}</legend>
            <div className="profile-gender-options">
              {GENDERS.map((g) => (
                <label key={g} className="profile-chip">
                  <input type="radio" name="gender" value={g} checked={gender === g}
                         onChange={() => setGender(g)} />
                  <span><Icon name="check" />{t.profile.genders[g]}</span>
                </label>
              ))}
              {gender && (
                <button type="button" className="profile-chip-clear" data-no-loader onClick={() => setGender(null)}>
                  <Icon name="x" /> {t.profile.clear}
                </button>
              )}
            </div>
            {fieldErrors.gender && <p className="auth-field-error" role="alert">{fieldErrors.gender}</p>}
          </fieldset>
        </section>

        <FormError message={error} />
        <div className="profile-actions">
          <button type="button" className="secondary" data-no-loader onClick={discard}
                  disabled={!dirty || busy}>
            {t.profile.discard}
          </button>
          <button type="submit" className="profile-save" data-no-loader disabled={!dirty || busy}>
            {busy ? <Icon name="loader" className="spin" /> : <Icon name="check" />}
            {busy ? t.profile.saving : t.profile.save}
          </button>
        </div>
      </form>

      {toast && (
        <div className="profile-toast" role="status">
          <Icon name="check" /> {toast}
        </div>
      )}
    </div>
  );
}
