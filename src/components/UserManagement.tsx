"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useLanguage } from "@/components/LanguageProvider";
import { formatDate, formatTime } from "@/lib/date";
import type { EnrollmentLink } from "@/actions/enrollment";

type UserRow = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  role: string;
  department?: { id: string; name: string } | null;
  campusLocation?: { id: string; name: string } | null;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
};
type Dept = { id: string; name: string };
type Site = { id: string; name: string };
type ActionResult = { ok: boolean; message: string; tempPassword?: string };

export default function UserManagement({
  users,
  departments,
  campusLocations,
  currentUserId,
  createUser,
  resetUserPassword,
  updateUserRole,
  updateUserSite,
  deleteUser,
  clearWebauthnCredentials,
  setUserActive,
  createEnrollmentLink,
  updateUsername,
  sendPasswordSetupEmail,
  updateUserProfile,
  emailConfigured,
}: {
  users: UserRow[];
  departments: Dept[];
  campusLocations: Site[];
  currentUserId: string;
  createUser: (_prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  resetUserPassword: (userId: string) => Promise<ActionResult>;
  updateUserRole: (userId: string, role: "ADMIN" | "MEMBER") => Promise<{ ok: boolean; message: string }>;
  updateUserSite: (userId: string, campusLocationId: string | null) => Promise<{ ok: boolean; message: string }>;
  deleteUser: (userId: string) => Promise<{ ok: boolean; message: string }>;
  clearWebauthnCredentials: (userId: string) => Promise<{ ok: boolean; message: string }>;
  setUserActive: (userId: string, active: boolean) => Promise<{ ok: boolean; message: string }>;
  createEnrollmentLink: (userId: string) => Promise<{ ok: true; link: EnrollmentLink; message: string } | { ok: false; message: string }>;
  updateUsername: (userId: string, username: string) => Promise<{ ok: boolean; message: string }>;
  sendPasswordSetupEmail: (userId: string) => Promise<{ ok: boolean; message: string }>;
  updateUserProfile: (
    userId: string,
    input: { name: string; username: string; email: string; departmentId: string | null }
  ) => Promise<{ ok: boolean; message: string }>;
  /** Whether RESEND_API_KEY is set on the server — controls the "email setup link" button. */
  emailConfigured: boolean;
}) {
  const { dict, locale } = useLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [createResult, setCreateResult] = useState<ActionResult | null>(null);
  const [resetResult, setResetResult] = useState<{ userId: string } & ActionResult | null>(null);
  const [roleResult, setRoleResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [siteResult, setSiteResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [deleteResult, setDeleteResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [webauthnResult, setWebauthnResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [activeResult, setActiveResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [enrollment, setEnrollment] = useState<{ userName: string; link: EnrollmentLink } | null>(null);
  const [enrollError, setEnrollError] = useState<{ userId: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [usernameEdit, setUsernameEdit] = useState<{ userId: string; value: string } | null>(null);
  const [usernameResult, setUsernameResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  const [emailResult, setEmailResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);
  // Edit-details modal (name / username / email / department in one form).
  const [editing, setEditing] = useState<{ userId: string; name: string; username: string; email: string; departmentId: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<{ userId: string; ok: boolean; message: string } | null>(null);

  function openEdit(u: UserRow) {
    setEditError(null);
    setEditing({ userId: u.id, name: u.name, username: u.username ?? "", email: u.email, departmentId: u.department?.id ?? "" });
  }

  function onSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { userId, name, username, email, departmentId } = editing;
    setEditError(null);
    startTransition(async () => {
      const res = await updateUserProfile(userId, { name, username, email, departmentId: departmentId || null });
      if (res.ok) {
        setEditing(null);
        setEditResult({ userId, ...res });
      } else {
        setEditError(res.message);
      }
    });
  }

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setResetResult(null);
    startTransition(async () => {
      const res = await createUser(null, formData);
      setCreateResult(res);
      if (res.ok) formRef.current?.reset();
    });
  }

  function onReset(userId: string, name: string) {
    if (!confirm(dict.users.resetConfirm(name))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await resetUserPassword(userId);
      setResetResult({ userId, ...res });
    });
  }

  function onRoleChange(userId: string, name: string, role: "ADMIN" | "MEMBER") {
    if (!confirm(dict.users.roleChangeConfirm(name, role))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await updateUserRole(userId, role);
      setRoleResult({ userId, ...res });
    });
  }

  function onSiteChange(userId: string, name: string, campusLocationId: string) {
    setCreateResult(null);
    startTransition(async () => {
      const res = await updateUserSite(userId, campusLocationId || null);
      setSiteResult({ userId, ...res });
    });
  }

  function onDelete(userId: string, name: string) {
    if (!confirm(dict.users.deleteConfirm(name))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await deleteUser(userId);
      setDeleteResult({ userId, ...res });
    });
  }

  function onClearWebauthn(userId: string, name: string) {
    if (!confirm(dict.users.clearWebauthnConfirm(name))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await clearWebauthnCredentials(userId);
      setWebauthnResult({ userId, ...res });
    });
  }

  function onToggleActive(u: UserRow) {
    const next = !u.isActive;
    if (!confirm(next ? dict.users.reactivateConfirm(u.name) : dict.users.suspendConfirm(u.name))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await setUserActive(u.id, next);
      setActiveResult({ userId: u.id, ...res });
    });
  }

  function onEnrollment(u: UserRow) {
    setCreateResult(null);
    setEnrollError(null);
    startTransition(async () => {
      const res = await createEnrollmentLink(u.id);
      if (res.ok) {
        setCopied(false);
        setEnrollment({ userName: u.name, link: res.link });
      } else {
        setEnrollError({ userId: u.id, message: res.message });
      }
    });
  }

  async function copyLink() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.link.url);
      setCopied(true);
    } catch {
      // Clipboard blocked — the URL is shown as text to copy manually.
    }
  }

  function onSaveUsername() {
    if (!usernameEdit) return;
    const { userId, value } = usernameEdit;
    startTransition(async () => {
      const res = await updateUsername(userId, value);
      setUsernameResult({ userId, ...res });
      if (res.ok) setUsernameEdit(null);
    });
  }

  function onSendSetupEmail(u: UserRow) {
    if (!confirm(dict.users.sendSetupEmailConfirm(u.name, u.email))) return;
    setCreateResult(null);
    startTransition(async () => {
      const res = await sendPasswordSetupEmail(u.id);
      setEmailResult({ userId: u.id, ...res });
    });
  }

  function statusBadge(u: UserRow) {
    if (!u.isActive) return <span className="badge bg-danger-soft text-danger">{dict.users.statusSuspended}</span>;
    if (u.mustChangePassword) {
      const expired = u.tempPasswordExpiresAt ? new Date(u.tempPasswordExpiresAt) < new Date() : false;
      return expired ? (
        <span className="badge bg-danger-soft text-danger">{dict.users.tempExpired}</span>
      ) : (
        <span className="badge bg-warn-soft text-warn">{dict.users.passwordPendingReset}</span>
      );
    }
    return <span className="badge bg-ok-soft text-ok">{dict.users.passwordNormal}</span>;
  }

  function lastLogin(u: UserRow) {
    if (!u.lastLoginAt) return <span className="text-faint">{dict.users.neverLoggedIn}</span>;
    const d = new Date(u.lastLoginAt);
    return <span className="whitespace-nowrap text-xs">{formatDate(d, locale)} {formatTime(d, locale)}</span>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-bold">{dict.users.addTitle}</h2>
        <p className="mt-1 text-sm text-muted">
          {dict.users.addHint}
        </p>
        <form ref={formRef} onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <input name="name" required placeholder={dict.users.namePlaceholder} className="input" />
            <input
              name="username"
              required
              autoCapitalize="none"
              spellCheck={false}
              pattern="[A-Za-z0-9._-]{3,32}"
              title={dict.users.usernameRule}
              placeholder={dict.users.usernamePlaceholder}
              className="input"
            />
            <input name="email" type="email" required placeholder={dict.users.emailPlaceholder} className="input" />
            <select name="departmentId" className="input" defaultValue="">
              <option value="">{dict.users.departmentUnset}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select name="campusLocationId" className="input" defaultValue="">
              <option value="">{dict.users.siteUnset}</option>
              {campusLocations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select name="role" className="input" defaultValue="MEMBER">
              <option value="MEMBER">{dict.users.roleMemberOption}</option>
              <option value="ADMIN">{dict.users.roleAdminOption}</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending} className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {pending ? dict.common.creating : dict.users.createAccount}
            </button>
          </div>
        </form>

        {createResult && (
          <div className={`mt-4 rounded-lg p-4 text-sm ${createResult.ok ? "bg-ok-soft text-ok" : "bg-danger-soft text-danger"}`}>
            <p>{createResult.message}</p>
            {createResult.tempPassword && (
              <>
                <p className="mt-2 font-mono text-base font-bold tracking-wide">{createResult.tempPassword}</p>
                <p className="mt-2 text-xs opacity-80">{emailConfigured ? dict.users.createdEmailHint : dict.users.createdNoEmailHint}</p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{dict.users.allUsersTitle}</h2>
          <span className="text-xs text-faint">{dict.users.countLabel(users.length)}</span>
        </div>
        {/* Card list instead of a 9-column table: reads the same on a phone
            and a laptop, and nothing gets crushed into vertical word-wrap. */}
        <ul className="mt-3 flex flex-col gap-3">
          {users.map((u) => {
            const btn = "whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-brand-ink hover:bg-line-soft disabled:opacity-40";
            return (
              <li key={u.id} className={`rounded-xl border border-line-soft bg-page p-4 ${u.isActive ? "" : "opacity-60"}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  {/* identity */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{u.name}</span>
                      {u.id === currentUserId ? (
                        <span className="badge bg-info-soft text-info">{u.role} ({dict.common.you})</span>
                      ) : (
                        <span className={`badge ${u.role === "ADMIN" ? "bg-info-soft text-info" : "bg-line-soft text-subtle"}`}>{u.role}</span>
                      )}
                      {statusBadge(u)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="text-faint">{dict.users.colUsername}:</span>
                        {usernameEdit?.userId === u.id ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              value={usernameEdit.value}
                              onChange={(e) => setUsernameEdit({ userId: u.id, value: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") onSaveUsername();
                                if (e.key === "Escape") setUsernameEdit(null);
                              }}
                              autoFocus
                              autoCapitalize="none"
                              spellCheck={false}
                              className="input w-36 px-2 py-0.5 text-xs"
                            />
                            <button disabled={pending} onClick={onSaveUsername} className="rounded bg-brand px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                              {dict.common.save}
                            </button>
                            <button onClick={() => setUsernameEdit(null)} className="px-1 text-[11px] text-muted">
                              {dict.common.cancel}
                            </button>
                          </span>
                        ) : (
                          <button
                            onClick={() => setUsernameEdit({ userId: u.id, value: u.username ?? "" })}
                            title={dict.common.edit}
                            className="font-mono text-ink underline decoration-dotted underline-offset-2 hover:text-brand-ink"
                          >
                            {u.username ?? <span className="text-danger">{dict.users.usernameMissing}</span>}
                          </button>
                        )}
                      </span>
                      <span className="break-all">{u.email}</span>
                      <span>{u.department?.name ?? <span className="text-faint">{dict.users.departmentUnset}</span>}</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-faint">{dict.users.colLastLogin}:</span>
                        {lastLogin(u)}
                      </span>
                    </div>
                    {usernameResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${usernameResult.ok ? "text-ok" : "text-danger"}`}>{usernameResult.message}</div>
                    )}
                  </div>

                  {/* site + role controls */}
                  <div className="flex flex-wrap items-center gap-2 lg:flex-none">
                    <label className="flex items-center gap-1 text-xs text-faint">
                      {dict.users.colSite}
                      <select
                        disabled={pending}
                        value={u.campusLocation?.id ?? ""}
                        onChange={(e) => onSiteChange(u.id, u.name, e.target.value)}
                        className="max-w-[200px] rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-40"
                      >
                        <option value="">{dict.users.siteUnset}</option>
                        {campusLocations.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    {u.id !== currentUserId && (
                      <label className="flex items-center gap-1 text-xs text-faint">
                        {dict.users.colRole}
                        <select
                          disabled={pending}
                          value={u.role}
                          onChange={(e) => onRoleChange(u.id, u.name, e.target.value as "ADMIN" | "MEMBER")}
                          className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-40"
                        >
                          <option value="MEMBER">MEMBER</option>
                          <option value="ADMIN">ADMIN</option>
                        </select>
                      </label>
                    )}
                  </div>
                </div>
                {siteResult?.userId === u.id && (
                  <div className={`mt-1 text-xs ${siteResult.ok ? "text-ok" : "text-danger"}`}>{siteResult.message}</div>
                )}
                {roleResult?.userId === u.id && (
                  <div className={`mt-1 text-xs ${roleResult.ok ? "text-ok" : "text-danger"}`}>{roleResult.message}</div>
                )}

                {/* actions */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                  <button disabled={pending} onClick={() => openEdit(u)} className={btn}>
                    {dict.users.editButton}
                  </button>
                  <Link href={`/admin/users/${u.id}/history`} className={btn}>
                    {dict.users.historyButton}
                  </Link>
                  <button disabled={pending} onClick={() => onReset(u.id, u.name)} className={btn}>
                    {dict.users.resetPassword}
                  </button>
                  <button disabled={pending || !u.isActive} onClick={() => onEnrollment(u)} className={btn}>
                    {dict.users.enrollmentButton}
                  </button>
                  {emailConfigured && (
                    <button disabled={pending || !u.isActive} onClick={() => onSendSetupEmail(u)} className={btn}>
                      {dict.users.sendSetupEmailButton}
                    </button>
                  )}
                  <button disabled={pending} onClick={() => onClearWebauthn(u.id, u.name)} className={btn}>
                    {dict.users.clearWebauthnButton}
                  </button>
                  {u.id !== currentUserId && (u.role !== "ADMIN" || !u.isActive) && (
                    <button
                      disabled={pending}
                      onClick={() => onToggleActive(u)}
                      className={`whitespace-nowrap rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-line-soft disabled:opacity-40 ${u.isActive ? "border-warn text-warn" : "border-ok text-ok"}`}
                    >
                      {u.isActive ? dict.users.suspendButton : dict.users.reactivateButton}
                    </button>
                  )}
                  {u.id !== currentUserId && (
                    <button
                      disabled={pending}
                      onClick={() => onDelete(u.id, u.name)}
                      className="ml-auto whitespace-nowrap rounded-lg border border-danger px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger-soft disabled:opacity-40"
                    >
                      {dict.users.deleteAccount}
                    </button>
                  )}
                </div>
                {resetResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${resetResult.ok ? "text-ok" : "text-danger"}`}>
                    {resetResult.message}
                    {resetResult.tempPassword && (
                      <div className="mt-1 font-mono text-sm font-bold tracking-wide text-ink">{resetResult.tempPassword}</div>
                    )}
                  </div>
                )}
                {webauthnResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${webauthnResult.ok ? "text-ok" : "text-danger"}`}>{webauthnResult.message}</div>
                )}
                {deleteResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${deleteResult.ok ? "text-ok" : "text-danger"}`}>{deleteResult.message}</div>
                )}
                {activeResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${activeResult.ok ? "text-ok" : "text-danger"}`}>{activeResult.message}</div>
                )}
                {enrollError?.userId === u.id && <div className="mt-2 text-xs text-danger">{enrollError.message}</div>}
                {emailResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${emailResult.ok ? "text-ok" : "text-danger"}`}>{emailResult.message}</div>
                )}
                {editResult?.userId === u.id && (
                  <div className={`mt-2 text-xs ${editResult.ok ? "text-ok" : "text-danger"}`}>{editResult.message}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <form
            onSubmit={onSaveProfile}
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">{dict.users.editTitle}</h3>
                <p className="text-xs text-muted">{dict.users.editHint}</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} className="text-faint hover:text-subtle">✕</button>
            </div>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs text-faint">
                {dict.users.editName}
                <input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input text-sm text-ink" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-faint">
                {dict.users.editUsername}
                <input
                  required
                  autoCapitalize="none"
                  spellCheck={false}
                  pattern="[A-Za-z0-9._-]{3,32}"
                  title={dict.users.usernameRule}
                  value={editing.username}
                  onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                  className="input font-mono text-sm text-ink"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-faint">
                {dict.users.editEmail}
                <input required type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} className="input text-sm text-ink" />
              </label>
              <label className="flex flex-col gap-1 text-xs text-faint">
                {dict.users.editDepartment}
                <select value={editing.departmentId} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value })} className="input text-sm text-ink">
                  <option value="">{dict.users.departmentUnset}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            </div>
            {editError && <p className="mt-3 text-sm text-danger">{editError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-subtle">
                {dict.common.cancel}
              </button>
              <button type="submit" disabled={pending} className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
                {pending ? dict.common.saving : dict.common.save}
              </button>
            </div>
          </form>
        </div>
      )}

      {enrollment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEnrollment(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold">{dict.users.enrollmentTitle}</h3>
                <p className="text-xs text-muted">{dict.users.enrollmentFor(enrollment.userName)}</p>
              </div>
              <button onClick={() => setEnrollment(null)} className="text-faint hover:text-subtle">✕</button>
            </div>
            <div
              className="mx-auto mt-4 w-[220px] rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: enrollment.link.qrSvg }}
            />
            <p className="mt-4 text-xs text-muted">{dict.users.enrollmentHint}</p>
            <div className="mt-3 flex items-center gap-2">
              <input readOnly value={enrollment.link.url} className="input flex-1 text-[11px]" onFocus={(e) => e.currentTarget.select()} />
              <button onClick={copyLink} className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white">
                {copied ? dict.users.copied : dict.users.copyLink}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-faint">
              {dict.users.enrollmentExpires(`${formatDate(enrollment.link.expiresAt, locale)}`)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
