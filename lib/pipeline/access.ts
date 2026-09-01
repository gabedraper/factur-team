import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";

/**
 * What the viewer may do in the pipeline.
 *
 * Unlike talent, there's no pipeline.view/manage permission to check --
 * editing a client's pipeline is earned by having a role on that client at
 * all, which my_client_ids() already answers and every opportunities/
 * opp_activities policy already enforces. "manage" here only distinguishes
 * org.manage holders, who see every client's pipeline, for UI purposes (an
 * all-clients toggle) -- same "the policies are the real guard, this decides
 * what to draw" split as lib/talent/access.ts.
 */
export type PipelineAccess = { view: boolean; manageAll: boolean };

export async function pipelineAccess(): Promise<PipelineAccess> {
  const perms = await myPermissions();
  const manageAll = perms.has("org.manage");
  return { view: true, manageAll };
}

/** For pages. */
export async function requirePipeline(level: keyof PipelineAccess = "view"): Promise<PipelineAccess> {
  const access = await pipelineAccess();
  if (!access[level]) redirect("/");
  return access;
}

/** For server actions, where a redirect would be swallowed. */
export async function assertPipeline(level: keyof PipelineAccess = "view") {
  const access = await pipelineAccess();
  if (!access[level]) throw new Error(`Forbidden: pipeline ${level} required`);
  return access;
}
