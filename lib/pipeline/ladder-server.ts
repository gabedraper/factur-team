import { createClient } from "@/lib/supabase/server";
import { BOTH_STAGE_FIELDS, type StageFields } from "@/lib/pipeline/targets";
import { ladderOf, type Ladder } from "@/lib/pipeline/ladder";

/*
 * Which ladder the signed-in person reads, from their roles.
 *
 * Through the session client on purpose: my_stage_fields() answers from
 * auth.uid(), so it cannot be widened by passing somebody else's id, and it
 * falls back to both for anyone with no role -- a busy screen beats a blank one.
 */
export async function myStageFields(): Promise<StageFields> {
  const db = await createClient();
  const { data } = await db.rpc("my_stage_fields");
  return (((data ?? []) as StageFields[])[0] ?? BOTH_STAGE_FIELDS);
}

export async function myLadder(): Promise<Ladder> {
  return ladderOf(await myStageFields());
}
