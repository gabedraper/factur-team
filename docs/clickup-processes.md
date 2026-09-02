# ClickUp, translated

What is actually in our ClickUp workspace, what the pieces mean, and where each
piece belongs in this app.

Written before the migration so that the twelve things worth rebuilding are
written down once, rather than rediscovered per screen.

## The workspace, measured

23 spaces, 257 folders, 1,012 lists, 91 people. One space is 79% of it:
"Factur Clients" holds 214 folders and 798 lists. Everything else together is
43 folders and 214 lists.

15 of the 91 people are external — client staff at musashina.com, chellis.com,
vibromatic.net, cascadecoil.com, surgicallycleanair.com, marketingdirection.com.
They are guests, and they are the reason `/portal` matters at cutover.

## The seven building blocks

Everything in ClickUp is made of these:

1. **Containers** — Space, then Folder, then List. Grouping only, no behaviour.
2. **Task** — title, description, dates, priority, assignees.
3. **Status set** — the ordered statuses attached to a List. This is the workflow.
4. **Custom fields** — typed values on tasks, defined per List.
5. **Relationships** — subtask, dependency, plain link.
6. **Comments**, threaded.
7. **Attachments** and **time entries**.

Views and automations look like building blocks but hold no data. A view is a
saved filter over the seven; an automation is a rule over the seven.

## Why the containers do not survive the move

A ClickUp container is doing three jobs at the same time: it says *what the work
is about*, *what kind of work it is*, and *where you go to find it*. In this app
those three already have separate homes, so the container has nothing left to do.

| In ClickUp | Actually means | Here |
| --- | --- | --- |
| Folder "Abm Machining Inc" | which client | `org_clients` |
| List "Client Onboarding" | which process | `work_processes` |
| Task | one piece of work | `work_items` |
| Space "Sales", "Finance" | who owns it | `org_teams`, `org_members` |
| A saved view | where you look | a screen we already have |

So 214 client folders are not 214 things to build. They are 209 client records
that already exist. And the 798 lists under them are not 798 things either —
the thirteen commonest names account for roughly 460 of them, and the six
spellings of "Service Delivery" are one process with a pod attached, not six.

## The twelve processes

Counts are how many client folders carry a list of that name today. "Should
change" is what finishing the work ought to write elsewhere in the app — none
of that happens in the read-only phase, it is what the phase after is for.

### 1. Client Onboarding — 45 folders

Everything between a signed contract and a running service. Spans three teams:
sales hands over, finance sets up billing, client services builds the thing.

- Links to: client, opportunity, service period
- Owning team: varies by step
- Should change: `client_service_periods.started_on`, client status
- Note: only 45 of ~209 clients have this list, so most onboardings were run
  somewhere else or not tracked. Worth asking why before assuming the list is
  the process.

### 2. Client Offboarding — 45 folders

The mirror of onboarding. Distinguishes a full offboard from an early
termination — "early term" exists as a tag in the Finance space, so the
distinction is already being recorded, just not structurally.

- Links to: client, service period
- Should change: `client_service_periods.ended_on`, client status to Inactive

### 3. Service Delivery — 189 lists across six names

The recurring work of actually serving a client. The six spellings are pods:
plain (78), `// LG` (41), `// OP` (22), `// OSDR` (16), `// OSD` (16),
`// OBD` (16). That is one process with an owning pod, and we already model
pods in `org_services` and `org_teams`.

- Links to: client
- Owning team: the pod in the list name
- Should change: nothing directly; it is the day job, and it feeds
  `client_performance`

### 4. Finance Requests & Client Ops — one list, Finance space

The highest-value list in the workspace, because its task titles are a foreign
key that someone is typing by hand:

    T5 Innovation - New Client Contract Signed
    Cascade Coil Drapery - Full Offboard
    Premier Manufacturing - Renewal Signed
    Van Hise - services pause (invoice continuing)

Every one is `<client> - <change to their service period>`. Once that is a real
link rather than a string, finishing the task can write the change instead of a
person re-entering it in a second system.

- Links to: client, service period
- Owning team: finance
- Should change: `client_service_periods` rows, `client_history`
- Separate from Collections, which is already built and stays as it is:
  collections chases money owed, this changes what is owed.

### 5. Quarterly Projects — 33 folders

Scoped pieces of work with a quarter attached, per client.

- Links to: client
- Should change: nothing; it reports upward to leadership

### 6. Website — 37 folders ("Website" 31, "Website Project" 6)

Build and rebuild work.

- Links to: client
- Owning team: development

### 7. Website Change Requests — 18 folders

Distinct from the above: small inbound changes, not projects. Different rhythm,
different queue, probably a different status set.

- Links to: client
- Owning team: development

### 8. Brand — 35 folders

Design and brand work per client.

- Links to: client
- Owning team: design

### 9. Targeting — 24 folders

Who we are prospecting for this client. This is the one process that clearly
belongs next to the lead data rather than the client record.

- Links to: client, opportunity
- Surfaces on: `/clients/[clientId]/leads`

### 10. LinkedIn, HeyReach & Metricool setup — 23 folders

Tooling setup per client. Finite, checklist-shaped, effectively a second
onboarding for the outbound tools.

- Links to: client

### 11. Content — 26 folders ("Blog & Linkedin Content" 21, "LinkedIn" 5)

Recurring content production.

- Links to: client

### 12. Ideas & Issues intake — 20 folders

A ClickUp form the client fills in. The only process with an external author,
which makes it the one that needs `/portal` before it can move.

- Links to: client
- Author: client contact, not a member

### Also: SEO Strategy (8) and Tactics/Projects (4)

Too small to design for. They fold into Quarterly Projects unless the sync says
otherwise.

### And: the internal spaces

Operations, Sales, Data, Leadership Team, People Ops, Client Services and the
personal workspaces are 214 lists of work with no client attached. Same table,
`client_id` null, surfaced on team queues rather than client pages. They also
hold the cross-links between tasks, which is why they migrate last and together.

## The three places work appears

Every view anyone has built in ClickUp is one of these three by hand.

**Entity panel** — the work about the record you are already looking at. A
client page tab beside billing and history. The filter is the record, so nobody
chooses it.

**My queue** — everything assigned to me across every process and client,
by due date. This replaces ClickUp Home and is where most people will live.

**Process board** — one process across every client: every onboarding in
flight, every open finance request. This is what ops and finance leads need and
what ClickUp cannot do today without a hand-built view, because the work is
scattered across 209 folders.

## What the read-only phase does

Mirror in, link up, show, and send people to ClickUp to edit. Nothing writes
back. Specifically:

- Tasks are copied into `work_items` every sync, matched to a process by list
  name and to a client by folder name, alias or `<client> - ` title prefix.
- Every row keeps its ClickUp id and URL, so every row is one click from the
  real thing.
- Nothing in the app can change a task. There is no edit control, and the sync
  is a one-way overwrite.

That is deliberate. It buys the useful half — the work is finally visible next
to the client, the invoice and the opportunity it concerns — without owning the
conflict problem that two-way sync brings.

## What it cannot bring across

No API exposes these; each is a person clicking through and rebuilding:

- Automations. This matters more than it sounds: an account called "Factur
  Automations" is writing into the workspace, and every rule it runs has to be
  found by hand before anything writes back in a later phase.
- Dashboards, saved views, whiteboards, forms.
- Permission and sharing rules.
- Complete activity history.

## Open questions the sync will answer

- How many tasks per list, and how many lists have not been touched in a year.
  A dead list is a dead process and should not get a spec.
- The real status set per process, which decides how many boards we need.
- Which custom fields are used often enough to become columns.
