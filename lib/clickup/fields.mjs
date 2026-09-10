/*
 * Turning ClickUp custom field values into words.
 *
 * The API answers with identifiers, not labels. "Responsible Party" comes back
 * as ["c82e0087-fccc-4598-a17b-b930711521f3"] and "Client Onboarding Phase" as
 * the number 0. What a person needs to read is "Team Lead" and
 * "Phase 1: Sell & Sign".
 *
 * The definitions ride along on every task payload in type_config, so this
 * resolves them at write time and stores the words beside the raw value. The
 * alternative -- keeping a field dictionary and joining at render time -- means
 * every page that shows a task has to know how sixteen field types encode
 * themselves, and pages that forget quietly show a uuid.
 *
 * Shared by scripts/sync-clickup.mjs and app/api/work/sync.
 */

/* A drop_down value is the chosen option's orderindex, though some payloads
 * carry the option id instead. Both are tried before giving up. */
function optionLabel(config, value) {
  const options = config?.options ?? [];
  const byId = options.find((o) => o.id === value);
  if (byId) return byId.name ?? byId.label ?? null;
  const byOrder = options.find((o) => o.orderindex === Number(value));
  return byOrder ? byOrder.name ?? byOrder.label ?? null : null;
}

function labelNames(config, value) {
  const options = config?.options ?? [];
  const ids = Array.isArray(value) ? value : [value];
  return ids
    .map((id) => {
      const hit = options.find((o) => o.id === id || o.id === id?.id);
      return hit ? hit.label ?? hit.name ?? null : null;
    })
    .filter(Boolean)
    .join(", ");
}

const DATE = (v) =>
  Number.isFinite(Number(v))
    ? new Date(Number(v)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "";

/** A human-readable rendering of one field's value, or "" when unset. */
export function displayValue(field) {
  const { type, value, type_config: config } = field ?? {};
  if (value === null || value === undefined || value === "") return "";

  switch (type) {
    case "drop_down":
      return optionLabel(config, value) ?? String(value);
    case "labels":
      return labelNames(config, value);
    case "checkbox":
      return value === true || value === "true" ? "Yes" : "No";
    case "date":
      return DATE(value);
    case "users":
      return (Array.isArray(value) ? value : [value])
        .map((u) => u?.username ?? u?.email ?? "")
        .filter(Boolean)
        .join(", ");
    case "currency": {
      const n = Number(value);
      return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : String(value);
    }
    case "number":
      return String(value);
    case "list_relationship":
    case "task_relationship":
      return (Array.isArray(value) ? value : [value])
        .map((t) => t?.name ?? "")
        .filter(Boolean)
        .join(", ");
    case "location":
      return value?.formatted_address ?? "";
    case "emoji": /* a rating, stored as a count */
      return String(value);
    default:
      /* short_text, text, url, email, phone, and anything ClickUp adds later. */
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

/**
 * The custom fields of one task, ordered as ClickUp returns them, with the
 * empty ones dropped -- a row carries sixteen definitions and typically three
 * values, and storing the other thirteen as nulls on 30,000 tasks buys nothing.
 */
export function packFields(task) {
  const out = [];
  for (const f of task?.custom_fields ?? []) {
    const display = displayValue(f);
    if (display === "") continue;
    out.push({
      id: f.id,
      name: f.name ?? "",
      type: f.type ?? "",
      value: f.value ?? null,
      display,
    });
  }
  return out.length ? out : null;
}

/**
 * Dependency edges for one task.
 *
 * ClickUp expresses both directions on the same record: depends_on is what this
 * task waits for, task_id is what waits for it. Stored from this task's point
 * of view so a row reads the way the task page does.
 */
export function packDependencies(task) {
  const edges = [];
  for (const d of task?.dependencies ?? []) {
    if (d.depends_on && d.task_id === task.id) {
      edges.push({ depends_on_clickup_id: String(d.depends_on), relation: "waiting_on" });
    } else if (d.task_id && d.depends_on === task.id) {
      edges.push({ depends_on_clickup_id: String(d.task_id), relation: "blocking" });
    }
  }
  return edges;
}
