/*
 * The embedded ticket, whichever shape it arrives in.
 *
 * PostgREST returns a to-one relation as an object, and the generated types
 * insist it is an array. Reaching for [0] therefore compiles cleanly, finds
 * nothing at runtime, and the row is skipped in silence -- which is exactly what
 * happened: every update ever queued was dropped on the way out, in both the
 * panel and Chat, and nothing anywhere said so.
 *
 * Reading both shapes costs one line. Trusting either one costs the feature.
 */
export function embedded<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}
