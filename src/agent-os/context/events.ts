/**
 * Pao Context Control Plane — id/trace helpers.
 *
 * Identifiers are correlation handles only, not security tokens.
 */

let counter = 0;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}
