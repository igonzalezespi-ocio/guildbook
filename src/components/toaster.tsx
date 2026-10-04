"use client";

import clsx from "clsx";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { decodeFlash, FLASH_COOKIE, readFlashCookie } from "@/lib/flash";
import { type Toast, toastStore } from "@/lib/toast";

const DURATION_MS = { success: 4000, error: 6000 } as const;
const NO_TOASTS: readonly Toast[] = [];

/** Shows and clears a flash left by a server action that redirected (see `setFlash`). */
export function consumeFlash() {
  const raw = readFlashCookie(document.cookie);
  if (raw === null) return;
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; path=/; SameSite=Lax`;
  const flash = decodeFlash(raw);
  if (flash) toastStore.push(flash.kind, flash.message);
}

/** Mounted once in the root layout, so it outlives `refresh()` and client navigations. */
export function Toaster() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, () => NO_TOASTS);
  const pathname = usePathname();

  useEffect(() => {
    consumeFlash();
  }, [pathname]);

  return (
    <section
      aria-label="Notificaciones"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:inset-x-auto sm:top-18 sm:right-4 sm:bottom-auto sm:px-0"
    >
      <ol className="flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </ol>
    </section>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef<number>(DURATION_MS[toast.kind]);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => toastStore.dismiss(toast.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, toast.id]);

  const error = toast.kind === "error";
  return (
    <li
      role={error ? "alert" : "status"}
      aria-live={error ? "assertive" : "polite"}
      aria-atomic="true"
      data-testid="toast"
      data-kind={toast.kind}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        "toast-enter pointer-events-auto flex items-start gap-3 rounded-md border bg-ink-2/95 py-3 pr-2 pl-3 text-sm text-bone backdrop-blur",
        "shadow-[inset_0_1px_0_rgb(201_164_76/0.15),0_10px_30px_rgb(0_0_0/0.5)]",
        error ? "border-crimson-bright/70" : "border-gold-dim",
      )}
    >
      {error ? <ErrorIcon /> : <SuccessIcon />}
      <p className="min-w-0 flex-1 self-center leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={() => toastStore.dismiss(toast.id)}
        aria-label="Cerrar notificación"
        className="-my-1 flex size-8 shrink-0 items-center justify-center rounded text-muted hover:bg-gold/10 hover:text-gold focus-visible:outline-2 focus-visible:outline-gold-dim"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}

function SuccessIcon() {
  return (
    <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/10 text-emerald-300">
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function ErrorIcon() {
  return (
    <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full border border-crimson-bright/60 bg-crimson/30 text-red-300">
      <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
        <path d="M8 4v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="12" r="1" fill="currentColor" />
      </svg>
    </span>
  );
}
