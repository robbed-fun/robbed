"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * CopyAddressButton — a small icon button that copies any address/hash to the
 * clipboard and flips to a brief "copied" confirmation (~1.5s). Business-agnostic
 * (works for any string), so it lives in `shared/ui`.
 *
 * a11y: a real `<button>` (keyboard-activatable by default), with an `aria-label`
 * that reflects the copied state so screen readers hear the confirmation. Never
 * throws — a clipboard-less environment (SSR / denied permission) no-ops.
 *
 * It `stopPropagation`s so a copy click inside a clickable card row (TokenCard is
 * a `role="link"`) never triggers the card's navigation.
 */
export function CopyAddressButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      e.preventDefault();
      // No clipboard API (SSR / insecure context) → do NOT flip to "copied": a
      // confirmation must only ever mean the write actually happened.
      if (!navigator.clipboard) return;
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      } catch {
        // Permission denied / write rejected — never throw from a copy
        // affordance; the address text/link beside it remains usable.
      }
    },
    [value],
  );

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Address copied" : "Copy address"}
      title={copied ? "Copied" : "Copy address"}
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center align-middle leading-none text-faint transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        copied && "text-green",
        className,
      )}
    >
      {copied ? (
        <span aria-hidden className="text-xs">
          ✓
        </span>
      ) : (
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
