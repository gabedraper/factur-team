/*
 * Turning a ClickUp name into one of our records.
 *
 * Shared, deliberately: scripts/sync-clickup.mjs does the full walk and
 * app/api/work/sync does the incremental one, and a matcher that exists twice
 * is a matcher that disagrees with itself by the second month. Plain .mjs so
 * both a Node script and a route handler can import it without a build step.
 *
 * Every rule here was measured against the live workspace before it was kept.
 * See docs/clickup-processes.md.
 */

// Deliberately blunt: lowercase, drop punctuation, drop the company suffix.
// Anything cleverer than this starts matching "Precision Bevel" to "Precision
// Tool" and a wrong client link is worse than no client link, because nobody
// checks a row that looks right.

const SUFFIXES = /\b(inc|llc|l l c|ltd|limited|corp|corporation|co|company|group|holdings|usa|us|gmbh|plc|pty|lp|llp)\b/g;

export function norm(name) {
  return (name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    /*
     * Apostrophes are deleted, not spaced. "Hartmann's Inc" spaced becomes
     * "hartmann s", which matches nothing; deleted it becomes "hartmanns",
     * which is exactly what both org_clients and client_aliases hold.
     */
    .replace(/['\u2019`]/g, "")
    .replace(/[.,"()\[\]/\\-]/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * ClickUp folders carry a trailing qualifier the client name never has:
 * "Turner Machine Tool // Website" is the Turner Machine folder, not a client
 * called Turner Machine Tool Website.
 */
export function folderName(name) {
  return (name || "").split("//")[0].trim();
}

/*
 * One matcher, built once, used by the sync and by check-clickup-match.
 *
 * The alias table is not a list of alternative full names -- it holds
 * *prefixes*, written for the Salesforce and QuickBooks matchers: "budde sheet"
 * stands for "Budde Sheet Metal Works". An exact lookup against it can never
 * hit, which is why the first version of this matched 197 folders and zero
 * aliases. So aliases match by prefix, longest first, and only when the alias
 * is substantial enough to be worth trusting -- a three letter prefix would
 * cheerfully attach half the book to one client.
 */
export function buildMatcher({ clients, aliases }) {
  /*
   * A name shared by more than one client is not a match, it is a coin toss.
   *
   * The roster holds twenty rows all called exactly "Certapro Painters", and
   * the first version handed every CertaPro task -- Rock Hill, Nashua,
   * Plymouth, Indianapolis, Grand Rapids -- to whichever of the twenty came
   * back first. Filing work against the wrong client is worse than leaving it
   * unfiled, because nobody rechecks a row that looks right. Ambiguous names
   * are dropped from the matcher entirely and their tasks stay unmatched, which
   * is the honest answer until the duplicates are cleaned up.
   */
  const seen = new Map();
  for (const c of clients ?? []) {
    const k = norm(c.name);
    if (!k) continue;
    if (seen.has(k)) seen.get(k).push(c.id);
    else seen.set(k, [c.id]);
  }

  const byName = new Map();
  let ambiguous = 0;
  for (const [k, ids] of seen) {
    if (ids.length === 1) byName.set(k, ids[0]);
    else ambiguous++;
  }

  let orphanAliases = 0;
  const prefixes = [];
  for (const a of aliases ?? []) {
    const id = byName.get(norm(a.client_name));
    const k = norm(a.alias);
    if (!k) continue;
    if (!id) {
      /* The alias names a company that is not in org_clients -- usually a
       * prospect or a client from before the roster. Counted, not guessed at. */
      orphanAliases++;
      continue;
    }
    if (k.length >= 8 || k.includes(" ")) prefixes.push([k, id]);
  }
  prefixes.sort((a, b) => b[0].length - a[0].length);

  /*
   * Names safe to hunt for anywhere inside a task title.
   *
   * The Finance list does not follow one convention. "Client Moved to MTM - 30
   * Day Contract Notice -- O-Ring Sales" puts the client last; "Un-Pause
   * Invoices for Atlantic Combustion" puts it in the middle; "Amherst Tool 1
   * Month Concession" puts it first with no separator. Matching only the prefix
   * before " - " found 326 of 638 tasks in that space.
   *
   * Scanning the whole title is worth it, but only for names long enough that a
   * hit is not a coincidence. The roster contains "Key", "IDS", "Gpa" and
   * "Mooney" -- and Mooney is also a colleague's surname, so "Meghan Mooney -
   * March Comp" would file itself under a client. Nine characters is the floor,
   * matched on whole words only.
   *
   * "Factur" is excluded outright: it is in the roster as a client, and half
   * the internal finance work mentions it.
   */
  const scan = [];
  const SELF = /^factur\b/;
  for (const [k, id] of byName) {
    if (k.length >= 9 && !SELF.test(k)) scan.push([k, id]);
  }
  for (const [k, id] of prefixes) {
    if (k.length >= 9 && !SELF.test(k)) scan.push([k, id]);
  }
  scan.sort((a, b) => b[0].length - a[0].length);

  /* Longest name wins, so "Turner Machine Tool" beats "Turner Machine". */
  function scanTitle(title) {
    const t = " " + norm(title) + " ";
    for (const [name, id] of scan) {
      if (t.includes(" " + name + " ")) return [id, "title_scan"];
    }
    return [null, null];
  }

  function lookup(raw) {
    const k = norm(raw);
    if (!k) return [null, null];
    if (byName.has(k)) return [byName.get(k), "name"];
    for (const [alias, id] of prefixes) {
      if (k === alias || k.startsWith(alias + " ")) return [id, "alias"];
    }
    return [null, null];
  }

  return {
    stats: { clients: byName.size, aliases: prefixes.length, orphanAliases, scannable: scan.length, ambiguous },

    /** Folder first, then the "<Client> - <Event>" title convention. */
    clientFor(folder, title) {
      if (folder) {
        const [id, how] = lookup(folderName(folder));
        if (id) return [id, how === "name" ? "folder" : "alias"];
      }
      const dash = (title || "").split(/\s+-\s+/)[0];
      if (dash && dash !== title) {
        const [id] = lookup(dash);
        if (id) return [id, "title"];
      }
      /* Last, because it is the loosest rule and should never pre-empt one of
       * the exact ones above. */
      return scanTitle(title);
    },
  };
}

