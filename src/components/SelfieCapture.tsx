"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";

const TARGET_WIDTH = 480;
const JPEG_QUALITY = 0.72;

/**
 * Front-camera selfie step for check-in/out (policy: requireSelfieCheckin).
 * Opens the camera, shows a live preview with an oval guide, captures one
 * frame downscaled to ~480px JPEG (tens of KB), lets the teacher retake,
 * then hands the data URL back. The parent runs the biometric prompt in
 * the same tap that confirms the photo, so WebAuthn keeps its user gesture.
 */
export default function SelfieCapture({
  kind,
  onConfirm,
  onCancel,
}: {
  kind: "checkin" | "checkout";
  onConfirm: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const { dict } = useLanguage();
  const t = dict.checkin.selfie;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.unsupported);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        setError(t.denied);
      }
    }
    open();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [t.unsupported, t.denied]);

  function capture() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = TARGET_WIDTH / video.videoWidth;
    const w = TARGET_WIDTH;
    const h = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Un-mirror: the preview is mirrored for a natural feel, the stored
    // photo is the true orientation.
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    setShot(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }

  function confirm() {
    if (!shot) return;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    onConfirm(shot);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-base font-bold">{kind === "checkin" ? t.titleIn : t.titleOut}</h3>
        <p className="mt-1 text-xs text-muted">{t.hint}</p>

        <div className="relative mx-auto mt-4 aspect-square w-full max-w-[280px] overflow-hidden rounded-2xl bg-black">
          {shot ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shot} alt="" className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
          ) : (
            <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" style={{ transform: "scaleX(-1)" }} />
          )}
          {!shot && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[78%] w-[62%] rounded-[50%] border-2 border-white/70" />
            </div>
          )}
          {!ready && !error && !shot && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/80">{t.opening}</div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <p className="mt-3 text-[11px] text-faint">{t.privacy}</p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold">
            {dict.checkin.cancelButton}
          </button>
          {shot ? (
            <>
              <button onClick={() => setShot(null)} className="rounded-lg border border-line-strong px-3 py-2 text-xs font-semibold">
                {t.retake}
              </button>
              <button onClick={confirm} className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white">
                {t.usePhoto}
              </button>
            </>
          ) : (
            <button onClick={capture} disabled={!ready} className="rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">
              📷 {t.capture}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
