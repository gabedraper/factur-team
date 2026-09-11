/* Types for access.mjs. The database client is typed loosely, as in the other
 * shared .mjs modules: Supabase's generics are not worth reproducing here. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
type Get = (path: string) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Log = (line: string) => void;

export declare function syncPeople(db: Db, get: Get): Promise<{ member_id: string | null; match: string | null; role: number | null }[]>;
export declare function backfillOrphanLists(db: Db, get: Get, log?: Log): Promise<number>;
export declare function listsDue(db: Db, limit: number): Promise<{ clickup_id: string; name: string }[]>;
export declare function syncListAccess(db: Db, get: Get, lists: { clickup_id: string; name: string }[], log?: Log): Promise<{ done: number; failed: number }>;
