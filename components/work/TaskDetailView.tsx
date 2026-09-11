import Link from "next/link";
import {
  ChevronRight, ExternalLink, Flag, Tag, Users, Calendar, Hourglass, Timer,
  CircleDot, Eye, Building2, Paperclip, CheckSquare, Link2, ArrowUpLeft,
} from "lucide-react";
import type { TaskDetail, Person, RelatedTask, Comment, CommentSegment } from "@/lib/work-detail";
import { estimate } from "@/lib/work-tree";
import { PageHeader } from "@/components/ui/page-header";
import { Surface, surface } from "@/components/ui/surface";
import { Table, TBody, TR, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/thumbnail";
import { Markdown } from "./Markdown";

/**
 * A ClickUp task page, rebuilt read-only.
 *
 * Same three columns as the real one -- subtasks, the task, its activity -- and
 * the same property grid in the same order, so somebody who opens tasks all day
 * finds each thing where their eye already goes. Two additions only: the client
 * it belongs to, linked into this app, and the process it is part of. Those are
 * the reason the page exists here at all.
 *
 * Status, priority and tag colours are ClickUp's own, carried as data, so they
 * are applied as inline style rather than as classes; everything else uses the
 * app's tokens.
 *
 * Nothing edits. Every control that would change the task over there is a link
 * to do it over there.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DATETIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const day = (v: string | null) => (v ? DATE.format(new Date(v)) : "");
const when = (v: string | null) => (v ? DATETIME.format(new Date(v)) : "");

function Empty() {
  return <span className="text-muted-foreground">Empty</span>;
}

function Prop({ icon: Icon, label, children }: {
  icon: typeof Flag; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-8 items-center gap-3 text-body">
      <span className="flex w-32 shrink-0 items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden /> {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/* A ClickUp colour when ClickUp gave one; the muted token when it did not. */
function Swatch({ color, className, children }: {
  color: string | null; className: string; children: React.ReactNode;
}) {
  return color
    ? <span className={className} style={{ backgroundColor: color }}>{children}</span>
    : <span className={`${className} bg-muted-foreground`}>{children}</span>;
}

function People({ people }: { people: Person[] }) {
  if (people.length === 0) return <Empty />;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {people.map((p) => (
        <span key={p.name} className="inline-flex items-center gap-1.5">
          <Avatar name={p.name} size={22} />{p.name}
        </span>
      ))}
    </span>
  );
}

function TaskLink({ t }: { t: RelatedTask }) {
  const done = t.statusType === "done" || t.statusType === "closed";
  return (
    <Link href={`/work/task/${t.clickupId}`} className="flex items-baseline gap-2 text-body hover:underline">
      <CircleDot className={`h-3 w-3 shrink-0 translate-y-0.5 ${done ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
      <span className={done ? "text-muted-foreground line-through" : ""}>{t.title}</span>
    </Link>
  );
}

function Segment({ s }: { s: CommentSegment }) {
  if (s.kind === "mention") return <span className="rounded bg-primary/10 px-1 font-medium text-primary">{s.text}</span>;
  let node: React.ReactNode = s.text;
  if (s.code) node = <code className="rounded bg-muted px-1">{node}</code>;
  if (s.bold) node = <strong>{node}</strong>;
  if (s.italic) node = <em>{node}</em>;
  if (s.link && /^(https?:|mailto:)/i.test(s.link)) {
    node = <a href={s.link} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{node}</a>;
  }
  return <>{node}</>;
}

function CommentBlock({ c, nested = false }: { c: Comment; nested?: boolean }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <Avatar name={c.author.name} size={22} />
        <span className="text-body font-medium">{c.author.name}</span>
        <span className="ml-auto text-meta tabular-nums text-muted-foreground">{when(c.at)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-body">
        {c.segments.map((s, i) => <Segment key={i} s={s} />)}
      </p>
      {c.replies.map((r) => <CommentBlock key={r.id} c={r} nested />)}
      {c.replyCount > c.replies.length && (
        <p className="ml-8 mt-2 text-meta text-muted-foreground">
          {c.replyCount - c.replies.length} more {c.replyCount - c.replies.length === 1 ? "reply" : "replies"}
        </p>
      )}
    </>
  );
  return nested ? <div className="ml-8 mt-3">{body}</div> : <Surface inset pad="tight">{body}</Surface>;
}

/* Collapsible like ClickUp's own sections; a Surface like every block here. */
function Section({ title, count, children }: {
  title: string; count?: number; children: React.ReactNode;
}) {
  return (
    <Surface>
      <details open className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-section-title">
          <ChevronRight className="h-4 w-4 transition-transform duration-fast ease-out group-open:rotate-90" aria-hidden />
          {title}
          {count !== undefined && <span className="font-normal tabular-nums text-muted-foreground">{count}</span>}
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    </Surface>
  );
}

function Breadcrumb({ t }: { t: TaskDetail }) {
  const step = (label: string | null, href: string | null) =>
    label && (
      <>
        <ChevronRight className="h-3 w-3" aria-hidden />
        {href ? <Link href={href} className="hover:text-foreground">{label}</Link> : <span>{label}</span>}
      </>
    );
  return (
    <nav className="flex flex-wrap items-center gap-1 normal-case tracking-normal">
      <Link href="/work/browse" className="hover:text-foreground">Spaces</Link>
      {step(t.path.space, t.path.spaceId ? `/work/browse/${t.path.spaceId}` : null)}
      {step(t.path.folder, null)}
      {step(t.path.list, t.path.listId ? `/work/browse/${t.path.listId}` : null)}
    </nav>
  );
}

export function TaskDetailView({ t }: { t: TaskDetail }) {
  const open = t.statusType !== "done" && t.statusType !== "closed";
  const overdue = open && t.dueAt && new Date(t.dueAt) < new Date();
  const setFields = t.fields.filter((f) => f.display !== "").length;
  const relations = t.waitingOn.length + t.blocking.length + t.linked.length + t.hiddenRelations;

  return (
    <div className="max-w-[1400px] space-y-section p-section">
      <PageHeader
        eyebrow={<Breadcrumb t={t} />}
        title={t.title}
        actions={
          <>
            {t.createdAt && <span className="text-meta text-muted-foreground">Created {day(t.createdAt)}</span>}
            <Button asChild variant="outline" size="sm">
              <a href={t.url} target="_blank" rel="noreferrer">
                ClickUp <ExternalLink className="ml-1 h-3.5 w-3.5" aria-hidden />
              </a>
            </Button>
          </>
        }
      />

      <div className="grid gap-section xl:grid-cols-[15rem_minmax(0,1fr)_22rem]">
        {/* ---- subtasks ---------------------------------------------------- */}
        <aside className="order-2 space-y-2 xl:order-1">
          {t.parent && (
            <Link href={`/work/task/${t.parent.clickupId}`}
                  className="flex items-start gap-1.5 text-meta text-muted-foreground hover:text-foreground">
              <ArrowUpLeft className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="line-clamp-2">{t.parent.title}</span>
            </Link>
          )}
          <Surface pad="tight" title="Subtasks"
                   actions={<span className="text-meta tabular-nums text-muted-foreground">{t.subtasks.length}</span>}>
            {t.subtasks.length === 0
              ? <p className="text-meta text-muted-foreground">None</p>
              : (
                <div className="space-y-1">
                  {t.subtasks.map((s) => (
                    <div key={s.clickupId}>
                      <TaskLink t={s} />
                      {(s.assignees.length > 0 || s.dueAt) && (
                        <div className="ml-5 text-meta text-muted-foreground">
                          {s.assignees.join(", ")}{s.assignees.length && s.dueAt ? " · " : ""}{day(s.dueAt)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
          </Surface>
        </aside>

        {/* ---- the task ---------------------------------------------------- */}
        <main className="order-1 min-w-0 space-y-section xl:order-2">
          <Surface>
            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
              <Prop icon={CircleDot} label="Status">
                <Swatch color={t.statusColor}
                        className="inline-flex items-center rounded px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-primary-foreground">
                  {t.status}
                </Swatch>
              </Prop>
              <Prop icon={Users} label="Assignees"><People people={t.assignees} /></Prop>
              <Prop icon={Calendar} label="Dates">
                {!t.startAt && !t.dueAt ? <Empty /> : (
                  <span className="tabular-nums">
                    {day(t.startAt) || "—"} <span className="text-muted-foreground">→</span>{" "}
                    <span className={overdue ? "text-destructive" : ""}>{day(t.dueAt) || "—"}</span>
                  </span>
                )}
              </Prop>
              <Prop icon={Flag} label="Priority">
                {t.priority
                  ? <span className="inline-flex items-center gap-1.5 capitalize">
                      <Flag className="h-3.5 w-3.5" style={t.priorityColor ? { color: t.priorityColor } : undefined} aria-hidden />
                      {t.priority}
                    </span>
                  : <Empty />}
              </Prop>
              <Prop icon={Hourglass} label="Time estimate">{estimate(t.timeEstimateMs) || <Empty />}</Prop>
              <Prop icon={Timer} label="Track time">{estimate(t.timeSpentMs) || <Empty />}</Prop>
              <Prop icon={Tag} label="Tags">
                {t.tags.length === 0 ? <Empty /> : (
                  <span className="flex flex-wrap gap-1">
                    {t.tags.map((g) => (
                      <Swatch key={g.name} color={g.color}
                              className="rounded px-1.5 py-0.5 text-meta text-primary-foreground">{g.name}</Swatch>
                    ))}
                  </span>
                )}
              </Prop>
              <Prop icon={Eye} label="Watchers"><People people={t.watchers} /></Prop>
              <Prop icon={Building2} label="Client">
                {t.clientId
                  ? <Link href={`/clients/${t.clientId}`} className="text-primary hover:underline">{t.clientName}</Link>
                  : <Empty />}
              </Prop>
              <Prop icon={CheckSquare} label="Process">{t.processName ?? <Empty />}</Prop>
            </div>

            {relations > 0 && (
              <div className="mt-4 space-y-1.5">
                {t.waitingOn.length > 0 && (
                  <div className="flex gap-3">
                    <span className="flex w-32 shrink-0 items-center gap-2 text-body text-muted-foreground">
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden /> Blocked by
                    </span>
                    <div className="space-y-1">{t.waitingOn.map((r) => <TaskLink key={r.clickupId} t={r} />)}</div>
                  </div>
                )}
                {t.blocking.length > 0 && (
                  <div className="flex gap-3">
                    <span className="flex w-32 shrink-0 items-center gap-2 text-body text-destructive">
                      <span className="h-2 w-2 rounded-full bg-destructive" aria-hidden /> Blocking
                    </span>
                    <div className="space-y-1">{t.blocking.map((r) => <TaskLink key={r.clickupId} t={r} />)}</div>
                  </div>
                )}
                {t.linked.length > 0 && (
                  <div className="flex gap-3">
                    <span className="flex w-32 shrink-0 items-center gap-2 text-body text-muted-foreground">
                      <Link2 className="h-4 w-4" aria-hidden /> Linked
                    </span>
                    <div className="space-y-1">{t.linked.map((r) => <TaskLink key={r.clickupId} t={r} />)}</div>
                  </div>
                )}
                {t.hiddenRelations > 0 && (
                  <p className="pl-[8.75rem] text-meta text-muted-foreground">+{t.hiddenRelations} private</p>
                )}
              </div>
            )}
          </Surface>

          {t.description.trim() && <Surface><Markdown source={t.description} /></Surface>}

          {t.fields.length > 0 && (
            <Section title="Fields" count={setFields}>
              <Table>
                <TBody>
                  {t.fields.map((f) => (
                    <TR key={f.name}>
                      <TD className="w-56 text-muted-foreground">{f.name}</TD>
                      <TD className="break-words">{f.display || <span className="text-muted-foreground">–</span>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          )}

          {t.checklists.map((cl) => {
            const done = cl.items.filter((i) => i.resolved).length;
            return (
              <Section key={cl.name} title={cl.name} count={undefined}>
                <p className="mb-2 text-meta tabular-nums text-muted-foreground">{done}/{cl.items.length}</p>
                <ul className="space-y-1">
                  {cl.items.map((it, n) => (
                    <li key={n} className="flex items-baseline gap-2 text-body">
                      <input type="checkbox" checked={it.resolved} readOnly className="h-3.5 w-3.5 translate-y-0.5" />
                      <span className={it.resolved ? "text-muted-foreground line-through" : ""}>{it.name}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })}

          {t.attachments.length > 0 && (
            <Section title="Attachments" count={t.attachments.length}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {t.attachments.map((a, n) => (
                  <a key={n} href={a.url} target="_blank" rel="noreferrer"
                     className={`${surface({ pad: "none", inset: true, interactive: true })} overflow-hidden`}>
                    {a.thumbnail
                      /* eslint-disable-next-line @next/next/no-img-element */
                      ? <img src={a.thumbnail} alt="" className="h-24 w-full object-cover" />
                      : <div className="flex h-24 items-center justify-center text-meta uppercase text-muted-foreground">
                          <Paperclip className="mr-1 h-4 w-4" aria-hidden />{a.extension ?? "file"}
                        </div>}
                    <div className="truncate px-2 py-1.5 text-meta">{a.title}</div>
                  </a>
                ))}
              </div>
            </Section>
          )}
        </main>

        {/* ---- activity ---------------------------------------------------- */}
        <aside className="order-3">
          <Surface pad="tight" title="Activity"
                   actions={t.fetchedAt && (
                     <span className={`text-meta tabular-nums ${t.stale ? "text-destructive" : "text-muted-foreground"}`}>
                       {t.stale ? "cached " : ""}{when(t.fetchedAt)}
                     </span>
                   )}>
            <div className="space-y-3">
              {t.creator && t.createdAt && (
                <p className="text-meta text-muted-foreground">
                  <span className="text-foreground">{t.creator.name}</span> created this task · {when(t.createdAt)}
                </p>
              )}
              {t.comments.map((c) => <CommentBlock key={c.id} c={c} />)}
              {t.closedAt && <p className="text-meta text-muted-foreground">Closed · {when(t.closedAt)}</p>}
              {t.updatedAt && <p className="text-meta text-muted-foreground">Updated · {when(t.updatedAt)}</p>}
              <Button asChild variant="outline" size="sm" className="w-full justify-between">
                <a href={t.url} target="_blank" rel="noreferrer">
                  Comment <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              </Button>
            </div>
          </Surface>
        </aside>
      </div>
    </div>
  );
}
