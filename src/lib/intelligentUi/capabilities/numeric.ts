/** Shared numeric constraints for native forms and host calculations. */
export function isWithinNumericBounds(
  value: number,
  bounds: { min?: number; max?: number; step?: number },
): boolean {
  if (!Number.isFinite(value)) return false;
  if (bounds.min !== undefined && value < bounds.min) return false;
  if (bounds.max !== undefined && value > bounds.max) return false;
  if (bounds.step !== undefined) {
    if (!Number.isFinite(bounds.step) || bounds.step <= 0) return false;
    const steps = (value - (bounds.min ?? 0)) / bounds.step;
    if (!Number.isFinite(steps) || Math.abs(steps - Math.round(steps)) > 1e-8)
      return false;
  }
  return true;
}
