/** Shared by server pages and client components (no server-only imports here). */
export type DocStatusValue = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED";

export const DOC_STATUS_TONE: Record<DocStatusValue, string> = {
  EXPIRED: "bg-danger-soft text-danger",
  EXPIRING: "bg-warn-soft text-warn",
  VALID: "bg-ok-soft text-ok",
  NO_EXPIRY: "bg-line-soft text-subtle",
};
