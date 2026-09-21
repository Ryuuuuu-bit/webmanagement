import type { NextRequest } from "next/server";

/**
 * Server half of src/lib/uploadClient.ts. Upload Route Handlers accept two
 * body shapes:
 *
 *   raw        — Content-Type anything but multipart, the file bytes as the
 *                body, name/type in X-File-Name (URI-encoded) / X-File-Type.
 *                With X-Upload-Framed: 1 the body starts with a
 *                length-prefixed JSON of text fields (frameUpload() on the
 *                client). This is what current clients send: nothing to parse.
 *   multipart  — the classic form post. Still accepted so a phone running a
 *                cached older build of the app (PWA) keeps working.
 *
 * An empty body with multipart headers is the iOS Safari stale-File bug
 * (see uploadClient.ts) and gets its own error so the UI can say "pick the
 * file again" instead of "connection lost".
 */

export type UploadBody =
  | { ok: true; mode: "raw"; file: File | null; fields: Record<string, string> }
  | { ok: true; mode: "form"; file: File | null; fields: Record<string, string> }
  | { ok: false; error: "tooLarge" | "empty" | "parse" };

const FRAMED_HEADER = "x-upload-framed";

export async function readUploadBody(req: NextRequest, opts: { maxBytes: number; fileField: string; log: string }): Promise<UploadBody> {
  const contentType = req.headers.get("content-type") ?? "";
  const declared = Number(req.headers.get("content-length") ?? -1);
  if (declared > opts.maxBytes) return { ok: false, error: "tooLarge" };

  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    if (declared === 0) {
      console.error(`[${opts.log}] empty multipart body (content-length 0) ua=${req.headers.get("user-agent") ?? "?"}`);
      return { ok: false, error: "empty" };
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      console.error(`[${opts.log}] bad multipart: ${String(err)} content-type=${contentType} content-length=${declared} ua=${req.headers.get("user-agent") ?? "?"}`);
      return { ok: false, error: declared <= 0 ? "empty" : "parse" };
    }
    const fields: Record<string, string> = {};
    form.forEach((v, k) => {
      if (typeof v === "string") fields[k] = v;
    });
    const f = form.get(opts.fileField);
    return { ok: true, mode: "form", file: f instanceof File && f.size > 0 ? f : null, fields };
  }

  // Raw mode.
  let buf: ArrayBuffer;
  try {
    buf = await req.arrayBuffer();
  } catch (err) {
    console.error(`[${opts.log}] body read failed: ${String(err)}`);
    return { ok: false, error: "parse" };
  }
  if (buf.byteLength > opts.maxBytes) return { ok: false, error: "tooLarge" };
  const fields: Record<string, string> = {};
  if (req.headers.get(FRAMED_HEADER) === "1") {
    // [u32 length][JSON][file bytes] — see frameUpload() in uploadClient.ts.
    if (buf.byteLength < 4) return { ok: false, error: "parse" };
    const jsonLen = new DataView(buf).getUint32(0);
    if (4 + jsonLen > buf.byteLength) return { ok: false, error: "parse" };
    try {
      const parsed = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, jsonLen))) as unknown;
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) fields[k] = typeof v === "string" ? v : String(v ?? "");
      }
    } catch {
      return { ok: false, error: "parse" };
    }
    buf = buf.slice(4 + jsonLen);
  }
  const rawName = req.headers.get("x-file-name");
  let file: File | null = null;
  if (rawName !== null) {
    if (buf.byteLength === 0) return { ok: false, error: "empty" };
    let name = "file";
    try {
      name = decodeURIComponent(rawName).slice(0, 200) || "file";
    } catch {
      name = rawName.slice(0, 200) || "file";
    }
    const type = (req.headers.get("x-file-type") ?? "").slice(0, 100);
    file = new File([buf], name, { type });
  }
  return { ok: true, mode: "raw", file, fields };
}
