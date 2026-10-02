/** Shared by server pages and client components (no server-only imports here). */
export type DocStatusValue = "NO_EXPIRY" | "VALID" | "EXPIRING" | "EXPIRED";

export const DOC_STATUS_TONE: Record<DocStatusValue, string> = {
  EXPIRED: "bg-danger-soft text-danger",
  EXPIRING: "bg-warn-soft text-warn",
  VALID: "bg-ok-soft text-ok",
  NO_EXPIRY: "bg-line-soft text-subtle",
};

/**
 * File types a teacher document's attachment may have, by extension (the
 * browser-sent MIME type is never trusted). Shared by the upload form's
 * `accept` list and the server check.
 */
export const DOC_FILE_TYPES: Record<string, string> = {
  // PDF + scans / photos
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  // Word — 97-2003, 2007+, templates, macro-enabled, RTF, OpenDocument
  doc: "application/msword",
  dot: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  // Excel / PowerPoint / plain text (also seen on scanned or exported paperwork)
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odp: "application/vnd.oasis.opendocument.presentation",
  txt: "text/plain",
};

/** `accept` attribute for the file input. */
export const DOC_FILE_ACCEPT = Object.keys(DOC_FILE_TYPES).map((e) => `.${e}`).join(",");

/** Short label for a stored file name ("PDF", "DOCX", …). */
export function fileKind(name: string | null | undefined): string {
  return (name?.split(".").pop() ?? "").toUpperCase().slice(0, 5);
}
