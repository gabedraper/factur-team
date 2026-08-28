import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { myPermissions } from "@/lib/org";
import { Transcript } from "@/components/gaib/transcript";

export const dynamic = "force-dynamic";

/*
 * Every conversation anybody has had with Gaib.
 *
 * Its own permission rather than org.manage, which nineteen people hold. A
 * transcript can contain what Gaib found in the asker's own mailbox when they
 * asked it to look, so who may read one is a narrower question than who may
 * administer the app.
 */

type SessionRow = {
  id: string;
  title: string | null;
  opened_by: string;
  status: string;
  created_at: string;
  last_message_at: string;
  user_id: string;
};

export default async function TranscriptsPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>;
}) {
  if (!(await myPermissions()).has("gaib.transcripts")) redirect("/gaib");

  const db = createServiceClient();
  const { data } = await db
    .from("gaib_sessions")
    .select("id,title,opened_by,status,created_at,last_message_at,user_id")
    .order("last_message_at", { ascending: false })
    .limit(300);

  const sessions = (data ?? []) as SessionRow[];

  // Names in one lookup rather than one per row.
  const { data: profileRows } = await db
    .from("profiles")
    .select("id,full_name")
    .in("id", sessions.map((s) => s.user_id));
  const names = new Map(
    ((profileRows ?? []) as { id: string; full_name: string | null }[])
      .map((p) => [p.id, p.full_name])
  );

  const selectedId = (await searchParams).s ?? sessions[0]?.id ?? null;
  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  const { data: messageRows } = selected
    ? await db
        .from("gaib_messages")
        .select("role,content,blocks,page_url,created_at")
        .eq("session_id", selected.id)
        .order("created_at", { ascending: true })
    : { data: [] };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold">Conversations</h1>
        <span className="text-sm text-muted-foreground">{sessions.length}</span>
      </div>

      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <div className="max-h-[75vh] space-y-1 overflow-y-auto pr-1">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/gaib/transcripts?s=${s.id}`}
              className={`block rounded-lg border px-3 py-2 ${
                s.id === selectedId ? "border-primary bg-accent" : "hover:bg-accent"
              }`}
            >
              <p className="truncate text-sm">{s.title ?? "Untitled"}</p>
              <p className="mt-0.5 flex items-baseline gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">{names.get(s.user_id) ?? "Unknown"}</span>
                <span className="ml-auto shrink-0">
                  {new Date(s.last_message_at).toLocaleDateString()}
                </span>
              </p>
            </Link>
          ))}
          {!sessions.length && <p className="text-sm text-muted-foreground">—</p>}
        </div>

        {selected ? (
          <Transcript
            who={names.get(selected.user_id) ?? "Unknown"}
            openedBy={selected.opened_by}
            startedAt={selected.created_at}
            messages={
              (messageRows ?? []) as {
                role: "user" | "assistant";
                content: string;
                blocks: unknown;
                page_url: string | null;
                created_at: string;
              }[]
            }
          />
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
    </div>
  );
}
