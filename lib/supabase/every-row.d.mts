/* Types for every-row.mjs. Loose on purpose: PostgREST's builder types are
 * deeply generic, and all this needs is something that pages and answers
 * { data, error }. */
type Rangeable = {
  range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export declare const PAGE: number;
export declare function everyRow<T>(build: () => Rangeable): Promise<T[]>;
export declare function inSlices<T>(
  ids: string[],
  run: (slice: string[]) => Promise<T[]>,
  size?: number,
): Promise<T[]>;
