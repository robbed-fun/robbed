import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn class-merge helper (canonical). Vendored — code we own (§12.24). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
