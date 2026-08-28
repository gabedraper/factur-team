import { Badge } from "@/components/ui/badge";
import { Search, Wrench } from "lucide-react";

/*
 * One conversation, read back.
 *
 * Shows what was said, and what Gaib went and did in between -- the tool calls
 * are the part worth having, because they are the record of what was looked up
 * on somebody's behalf and there is nowhere else that is written down.
 *
 * What it does not show is what came back. A single email read in full can be
 * thousands of words, and a page that pastes the contents of somebody's inbox
 * under the heading "conversations" has quietly become a different feature from
 * the one anybody agreed to. The call says an email was read and which search
 * found it; reading the email itself is still a thing you do in your own
 * mailbox.
 */

type Message = {
  role: "user" | "assistant";
  content: string;
  blocks: unknown;
  page_url: string | null;
  created_at: string;
};

type Block = {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
};

/** The one field of a tool call worth putting on screen. */
function summarise(name: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (input[k] ? String(input[k]) : "");
  switch (name) {
    case "query_data": return pick("purpose") || pick("sql");
    case "describe_data": return pick("tables") || "everything available";
    case "search_tickets": return pick("query");
    case "raise_ticket": return pick("title");
    case "search_my_email": return pick("query");
    case "read_my_email": return `message ${pick("id")}`;
    case "search_my_chat": return pick("contains");
    case "search_my_drive": return pick("file_id") ? `file ${pick("file_id")}` : pick("text");
    default: return "";
  }
}

const READS_PRIVATE = new Set([
  "search_my_email", "read_my_email", "search_my_chat", "search_my_drive",
]);

export function Transcript({
  who, openedBy, startedAt, messages,
}: {
  who: string;
  openedBy: string;
  startedAt: string;
  messages: Message[];
}) {
  const pages = [...new Set(messages.map((m) => m.page_url).filter(Boolean))] as string[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        <span className="text-sm font-medium">{who}</span>
        <Badge variant="outline">
          {openedBy === "gaib" ? "Gaib started it" : "They started it"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(startedAt).toLocaleString()}
        </span>
      </div>

      {pages.length > 0 && (
        <p className="truncate text-xs text-muted-foreground">{pages.join(" · ")}</p>
      )}

      <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
        {messages.map((m, i) => {
          const blocks = (m.blocks as Block[] | null) ?? [];
          const calls = blocks.filter((b) => b?.type === "tool_use");

          return (
            <div key={i} className="space-y-2">
              {m.content.trim() && (
                <div
                  className={
                    m.role === "user"
                      ? "ml-auto w-fit max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                      : "w-fit max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  {m.content}
                </div>
              )}

              {calls.map((c, j) => {
                const name = c.name ?? "";
                const detail = summarise(name, c.input ?? {});
                const sensitive = READS_PRIVATE.has(name);
                return (
                  <div
                    key={j}
                    className="flex items-start gap-2 rounded-md border border-dashed px-3 py-1.5 text-xs"
                  >
                    {sensitive ? (
                      <Search className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{name}</span>
                      {detail && (
                        <span className="ml-1.5 break-words text-muted-foreground">{detail}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
        {!messages.length && <p className="text-sm text-muted-foreground">Nothing said yet</p>}
      </div>
    </div>
  );
}
