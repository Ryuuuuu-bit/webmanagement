"use client";

import { useRef, useState, useTransition } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatDate, formatTime } from "@/lib/date";
import type { EnrollmentLink } from "@/actions/enrollment";

type UserRow = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  role: string;
  department?: { name: string } | null;
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
    return <span className="text-faint">{dict.users.passwordNormal}</span>;
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
        <h2 className="text-base font-bold">{dict.users.allUsersTitle}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-faint">
                <th className="pb-2">{dict.users.colName}</th>
                <th className="pb-2">{dict.users.colUsername}</th>
                <th className="pb-2">{dict.users.colEmail}</th>
                <th className="pb-2">{dict.users.colDepartment}</th>
                <th className="pb-2">{dict.users.colSite}</th>
                <th className="pb-2">{dict.users.colRole}</th>
                <th className="pb-2">{dict.users.colStatus}</th>
                <th className="pb-2">{dict.users.colLastLogin}</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-t border-line-soft align-top ${u.isActive ? "" : "opacity-60"}`}>
                  <td className="py-2 font-medium">{u.name}</td>
                  <td className="py-2">
                    {usernameEdit?.userId === u.id ? (
                      <div className="flex items-center gap-1">
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
                          className="input w-36 px-2 py-1 text-xs"
                        />
                        <button disabled={pending} onClick={onSaveUsername} className="rounded bg-brand px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">
                          {dict.common.save}
                        </button>
                        <button onClick={() => setUsernameEdit(null)} className="px-1 text-[11px] text-muted">
                          {dict.common.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setUsernameEdit({ userId: u.id, value: u.username ?? "" })}
                        title={dict.common.edit}
                        className="font-mono text-xs text-ink underline decoration-dotted underline-offset-2 hover:text-brand-ink"
                      >
                        {u.username ?? <span className="text-danger">{dict.users.usernameMissing}</span>}
                      </button>
                    )}
                    {usernameResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${usernameResult.ok ? "text-ok" : "text-danger"}`}>{usernameResult.message}</div>
                    )}
                  </td>
                  <td className="py-2 text-muted">{u.email}</td>
                  <td className="py-2">{u.department?.name ?? "—"}</td>
                  <td className="py-2">
                    <select
                      disabled={pending}
                      value={u.campusLocation?.id ?? ""}
                      onChange={(e) => onSiteChange(u.id, u.name, e.target.value)}
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-40"
                    >
                      <option value="">{dict.users.siteUnset}</option>
                      {campusLocations.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                    {siteResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${siteResult.ok ? "text-ok" : "text-danger"}`}>{siteResult.message}</div>
                    )}
                  </td>
                  <td className="py-2">
                    {u.id === currentUserId ? (
                      <span className="badge bg-info-soft text-info">{u.role} ({dict.common.you})</span>
                    ) : (
                      <select
                        disabled={pending}
                        value={u.role}
                        onChange={(e) => onRoleChange(u.id, u.name, e.target.value as "ADMIN" | "MEMBER")}
                        className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink disabled:opacity-40"
                      >
                        <option value="MEMBER">MEMBER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    )}
                    {roleResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${roleResult.ok ? "text-ok" : "text-danger"}`}>{roleResult.message}</div>
                    )}
                  </td>
                  <td className="py-2">{statusBadge(u)}</td>
                  <td className="py-2">{lastLogin(u)}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        disabled={pending}
                        onClick={() => onReset(u.id, u.name)}
                        className="text-xs font-semibold text-brand-ink underline disabled:opacity-40"
                      >
                        {dict.users.resetPassword}
                      </button>
                      <button
                        disabled={pending || !u.isActive}
                        onClick={() => onEnrollment(u)}
                        className="text-xs font-semibold text-brand-ink underline disabled:opacity-40"
                      >
                        {dict.users.enrollmentButton}
                      </button>
                      {emailConfigured && (
                        <button
                          disabled={pending || !u.isActive}
                          onClick={() => onSendSetupEmail(u)}
                          className="text-xs font-semibold text-brand-ink underline disabled:opacity-40"
                        >
                          {dict.users.sendSetupEmailButton}
                        </button>
                      )}
                      <button
                        disabled={pending}
                        onClick={() => onClearWebauthn(u.id, u.name)}
                        className="text-xs font-semibold text-brand-ink underline disabled:opacity-40"
                      >
                        {dict.users.clearWebauthnButton}
                      </button>
                      {u.id !== currentUserId && (u.role !== "ADMIN" || !u.isActive) && (
                        <button
                          disabled={pending}
                          onClick={() => onToggleActive(u)}
                          className={`text-xs font-semibold underline disabled:opacity-40 ${u.isActive ? "text-warn" : "text-ok"}`}
                        >
                          {u.isActive ? dict.users.suspendButton : dict.users.reactivateButton}
                        </button>
                      )}
                      {u.role !== "ADMIN" && u.id !== currentUserId && (
                        <button
                          disabled={pending}
                          onClick={() => onDelete(u.id, u.name)}
                          className="text-xs font-semibold text-danger underline disabled:opacity-40"
                        >
                          {dict.users.deleteAccount}
                        </button>
                      )}
                    </div>
                    {resetResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${resetResult.ok ? "text-ok" : "text-danger"}`}>
                        {resetResult.message}
                        {resetResult.tempPassword && (
                          <div className="mt-1 font-mono text-sm font-bold tracking-wide text-ink">{resetResult.tempPassword}</div>
                        )}
                      </div>
                    )}
                    {webauthnResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${webauthnResult.ok ? "text-ok" : "text-danger"}`}>{webauthnResult.message}</div>
                    )}
                    {deleteResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${deleteResult.ok ? "text-ok" : "text-danger"}`}>{deleteResult.message}</div>
                    )}
                    {activeResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${activeResult.ok ? "text-ok" : "text-danger"}`}>{activeResult.message}</div>
                    )}
                    {enrollError?.userId === u.id && <div className="mt-1 text-xs text-danger">{enrollError.message}</div>}
                    {emailResult?.userId === u.id && (
                      <div className={`mt-1 text-xs ${emailResult.ok ? "text-ok" : "text-danger"}`}>{emailResult.message}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
