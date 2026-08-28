import { redirect } from "next/navigation";
import { myPermissions } from "@/lib/org";
import { getCodingSettings } from "@/actions/gaib-admin";
import { DANGER, AUTO_MAX_FILES, AUTO_MAX_LINES } from "@/lib/gaib/danger";
import { CodingRules } from "@/components/settings/CodingRules";

export const dynamic = "force-dynamic";

export default async function CodingAgentPage() {
  if (!(await myPermissions()).has("org.manage")) redirect("/settings");

  const settings = await getCodingSettings();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-xl font-semibold">Coding agent</h1>
      <CodingRules
        settings={settings}
        ceiling={{ files: AUTO_MAX_FILES, lines: AUTO_MAX_LINES }}
        // The built-in list is shown but not editable here. It is code, it is
        // on its own protected list, and the only way to shorten it is a commit
        // somebody reviewed -- which is the property that makes the editable
        // parts of this page safe to expose at all.
        builtIn={DANGER.map((d) => ({ pattern: d.pattern, why: d.why }))}
      />
    </div>
  );
}
