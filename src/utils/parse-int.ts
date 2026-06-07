/**
 * Parse a string into an integer with range validation.
 * Throws a user-facing error if the value is not a valid integer
 * or falls outside the given bounds.
 */
export function parseIntOrThrow(
  value: string,
  name: string,
  min?: number,
  max?: number,
): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) {
    throw new Error(`--${name} must be an integer, got '${value}'`);
  }
  if (min !== undefined && n < min) {
    throw new Error(`--${name} must be at least ${min}, got ${n}`);
  }
  if (max !== undefined && n > max) {
    throw new Error(`--${name} must be at most ${max}, got ${n}`);
  }
  return n;
}
