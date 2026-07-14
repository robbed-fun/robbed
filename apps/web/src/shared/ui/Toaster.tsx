"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/shared/lib/utils";

/**
 * Lightweight toaster (launch feedback; ROBBED_ terminal skin).
 *
 * A dependency-free notification surface: a module-singleton store + a
 * `useSyncExternalStore` subscription, so the imperative `toast()` API can be
 * called from anywhere (event handlers, effects, non-React model code) without a
 * context wrapper — only ONE `<Toaster />` is mounted (in `app/providers`).
 *
 * Docs-first (2026-07-13):
 *   - React 19 `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`
 *     (react.dev/reference/react/useSyncExternalStore): `subscribe` returns an
 *     unsubscribe fn; `getSnapshot` returns a STABLE reference while unchanged
 *     (the store only reassigns the frozen array on a real change); a frozen
 *     `getServerSnapshot` keeps SSR/hydration identical (renders nothing).
 *   - Next 16 `use client` (nextjs.org/docs/.../directives/use-client): a client
 *     component nested under the client `Providers` island — no `document` on the
 *     server, so the portal mounts behind a `mounted` gate.
 *
 * OpenNext/CF-Workers + RSC safe: no browser API touched during render/SSR
 * (portal + timers run only after mount), no external dependency.
 *
 * Styling routes ONLY through design tokens (no raw color — web.md), matching
 * the terminal-mono aesthetic: a hairline card with a colored left accent + an
 * uppercase mono tag.
 */

export type ToastVariant = "error" | "success" | "info";

export interface Toast {
  id: string;
  variant: ToastVariant;
  message: string;
  /** ms before auto-dismiss; `0` disables auto-dismiss (manual close only). */
  duration: number;
}

export interface ToastOptions {
  /** Explicit id (dedupes: re-pushing the same id replaces in place). */
  id?: string;
  /** Auto-dismiss delay, ms. Default 5000; `0` = sticky. */
  duration?: number;
}

// ── module-singleton store (survives across mounts; drives the imperative API) ─

const DEFAULT_DURATION = 5000;
const MAX_TOASTS = 4;
const EMPTY: readonly Toast[] = Object.freeze([]);

let toasts: readonly Toast[] = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Stable reference while unchanged (useSyncExternalStore contract) — `toasts` is
// only reassigned to a NEW frozen array when the set actually changes.
function getSnapshot(): readonly Toast[] {
  return toasts;
}

// SSR + first hydration render: no toasts (must match `getSnapshot`'s initial).
function getServerSnapshot(): readonly Toast[] {
  return EMPTY;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function push(variant: ToastVariant, message: string, opts: ToastOptions = {}): string {
  const id = opts.id ?? makeId();
  const duration = opts.duration ?? DEFAULT_DURATION;
  const next: Toast = { id, variant, message, duration };
  // Dedupe by id, append, and cap the stack length.
  toasts = Object.freeze([...toasts.filter((t) => t.id !== id), next].slice(-MAX_TOASTS));
  emit();
  return id;
}

/** Remove one toast (by id) or ALL toasts (no id). */
export function dismissToast(id?: string): void {
  if (id === undefined) {
    if (toasts.length === 0) return;
    toasts = EMPTY;
    emit();
    return;
  }
  const next = toasts.filter((t) => t.id !== id);
  if (next.length === toasts.length) return; // nothing matched — keep the ref stable
  toasts = Object.freeze(next);
  emit();
}

/**
 * Imperative toast API — stable module singleton, so it is safe to call from
 * render effects/handlers and to leave OUT of `useEffect` dependency arrays.
 */
export const toast = {
  error: (message: string, opts?: ToastOptions) => push("error", message, opts),
  success: (message: string, opts?: ToastOptions) => push("success", message, opts),
  info: (message: string, opts?: ToastOptions) => push("info", message, opts),
  dismiss: dismissToast,
};

/** Hook alias returning the same stable imperative API. */
export function useToast(): typeof toast {
  return toast;
}

// ── presentation ──────────────────────────────────────────────────────────────

const VARIANT: Record<ToastVariant, { accent: string; tag: string; label: string }> = {
  error: { accent: "border-l-red", tag: "text-red", label: "ERROR" },
  success: { accent: "border-l-green", tag: "text-green", label: "OK" },
  info: { accent: "border-l-border-strong", tag: "text-muted", label: "INFO" },
};

function ToastItem({ toast: t }: { toast: Toast }) {
  useEffect(() => {
    if (t.duration <= 0) return;
    const handle = setTimeout(() => dismissToast(t.id), t.duration);
    return () => clearTimeout(handle);
  }, [t.id, t.duration]);

  const v = VARIANT[t.variant];
  return (
    <div
      role={t.variant === "error" ? "alert" : "status"}
      aria-live={t.variant === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full max-w-sm items-start gap-3 border border-l-2 border-border-soft bg-surface-2 px-3.5 py-3 text-xs shadow-lg",
        v.accent,
      )}
    >
      <span className={cn("shrink-0 pt-px text-2xs font-semibold uppercase tracking-label", v.tag)}>
        {v.label}
      </span>
      <span className="flex-1 leading-snug text-text-secondary [overflow-wrap:anywhere]">
        {t.message}
      </span>
      <button
        type="button"
        onClick={() => dismissToast(t.id)}
        aria-label="Dismiss notification"
        className="-mt-0.5 shrink-0 px-1 text-sm leading-none text-muted transition-colors hover:text-text"
      >
        ×
      </button>
    </div>
  );
}

/**
 * The single toast surface. Mount ONCE (in `app/providers`). Renders nothing on
 * the server / first hydration render, then portals into `document.body`.
 */
export function Toaster() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}
