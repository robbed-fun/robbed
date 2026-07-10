"use client";

import { useId } from "react";

import { Chip } from "./Chip";
import { MonoLabel } from "./MonoText";
import { cn } from "@/shared/lib/utils";

/**
 * Terminal amount field (ROBBED_ Phase F) — the mockup's YOU PAY block:
 * micro-label · bordered box with a 17px value input + unit suffix ·
 * quick-select chips (0.1 / 0.5 / 1 / MAX) underneath. Controlled + generic:
 * quote math, MAX resolution, and validation belong to the calling feature
 * (`decimal` inputMode, string value — no float coercion here).
 */
export interface QuickOption {
  label: string;
  onSelect: () => void;
  active?: boolean;
}

export function AmountInput({
  label,
  value,
  onValueChange,
  unit,
  quick,
  readOnly = false,
  disabled = false,
  placeholder = "0.0",
  inputClassName,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  label?: React.ReactNode;
  value: string;
  onValueChange?: (value: string) => void;
  /** Unit suffix inside the box (ETH / ticker). */
  unit?: React.ReactNode;
  /** Quick-amount chips row (0.1 / 0.5 / 1 / MAX). */
  quick?: QuickOption[];
  readOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)} {...props}>
      {label ? (
        <MonoLabel size="2xs">
          <label htmlFor={id}>{label}</label>
        </MonoLabel>
      ) : null}
      <div
        className={cn(
          "flex items-center gap-2 border border-border bg-transparent px-3 py-2.5 transition-colors focus-within:border-green",
          disabled && "opacity-50",
        )}
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onValueChange?.(e.target.value)}
          readOnly={readOnly || !onValueChange}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xl text-text tabular-nums placeholder:text-faint focus:outline-none",
            inputClassName,
          )}
        />
        {unit ? <span className="shrink-0 text-xs text-faint">{unit}</span> : null}
      </div>
      {quick && quick.length > 0 ? (
        <div className="flex items-center gap-1.5">
          {quick.map((q) => (
            <Chip
              key={q.label}
              variant="outline"
              active={q.active}
              disabled={disabled}
              onClick={q.onSelect}
            >
              {q.label}
            </Chip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
