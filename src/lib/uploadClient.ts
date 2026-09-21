"use client";

/**
 * Browser-side upload helpers shared by the lesson-plan and leave forms.
 *
 * Why not just `fetch(url, { body: new FormData(form) })`: iOS Safari (and
 * installed PWAs on iOS in particular) sometimes sends a multipart request
 * whose file part is EMPTY — correct headers, Content-Length ≈ 0 — when the
 * File object it holds has gone stale (picked from the Files app / iCloud,
 * app backgrounded by the picker, …). The server then fails with "Failed to
 * parse body as FormData" and the user sees a misleading "connection lost".
 *
 * So we read the file into memory here first. If that read yields 0 bytes
 * we can tell the user to pick the file again instead of blaming the
 * network, and the bytes we send are a plain ArrayBuffer/Blob, never the
 * File handle. Single-file uploads go as a raw body (no multipart parser on
 * the server to disagree with the phone at all).
 */

export class FileReadError extends Error {
  constructor() {
    super("file read failed");
    this.name = "FileReadError";
  }
}

/** Reads a File fully into memory; throws FileReadError if the browser hands back 0 bytes. */
export async function readFileBytes(file: File): Promise<ArrayBuffer> {
  let buf: ArrayBuffer | null = null;
  try {
    buf = await file.arrayBuffer();
  } catch {
    buf = null;
  }
  if (!buf || buf.byteLength === 0) {
    // Older WebKit sometimes rejects arrayBuffer() on picker files; FileReader still works.
    buf = await new Promise<ArrayBuffer | null>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result instanceof ArrayBuffer ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsArrayBuffer(file);
    });
  }
  if (!buf || buf.byteLength === 0) throw new FileReadError();
  return buf;
}

export type UploadResult<T> = { status: number; json: T | null; text: string };

/**
 * XHR POST with upload progress. Resolves on any HTTP response (the caller
 * decides what a 4xx means); rejects only on a real network failure.
 */
export function xhrPost<T = unknown>(
  url: string,
  body: ArrayBuffer | Blob | FormData,
  opts: { headers?: Record<string, string>; onProgress?: (pct: number) => void } = {}
): Promise<UploadResult<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && opts.onProgress) opts.onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      let json: T | null = null;
      try {
        json = JSON.parse(xhr.responseText) as T;
      } catch {
        json = null;
      }
      resolve({ status: xhr.status, json, text: xhr.responseText });
    };
    xhr.onerror = () => reject(new Error("network"));
    xhr.onabort = () => reject(new Error("abort"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    xhr.send(body);
  });
}

/** Header-safe (ASCII) encoding of a filename; decode with decodeURIComponent on the server. */
export function encodeFileName(name: string) {
  return encodeURIComponent(name).slice(0, 1000);
}

/**
 * Packs text fields + optional file bytes into one body:
 *   [4-byte big-endian length of JSON][JSON fields, UTF-8][file bytes…]
 * Fields ride in the body (not a header) so a long Thai reason can't hit
 * header-size limits. Send with header X-Upload-Framed: 1.
 */
export function frameUpload(fields: Record<string, string>, file: ArrayBuffer | null): Blob {
  const json = new TextEncoder().encode(JSON.stringify(fields));
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, json.byteLength);
  return new Blob(file ? [head, json, file] : [head, json], { type: "application/octet-stream" });
}
