import { twMerge } from "tailwind-merge";

export type ClassValue = string | false | null | undefined;

/**
 * Joins class names and resolves Tailwind conflicts, last value winning.
 *
 * A plain join is not enough for components that accept a `className`
 * passthrough: `"bg-red-600" + "bg-emerald-600"` leaves both in the class
 * list and lets stylesheet order decide, so a caller cannot reliably
 * override a component's own styling.
 */
export function cn(...values: ClassValue[]) {
  return twMerge(values.filter(Boolean).join(" "));
}
