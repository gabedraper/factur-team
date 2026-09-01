/*
 * Reading a Google service account key out of an environment variable.
 *
 * Its own file, and deliberately importing nothing. Parsing a key is a pure
 * question about a string -- it has no business dragging a database client in
 * behind it, and while it did, it could not be tested without one.
 */

export type KeyProblem =
  | "missing"
  | "not-json"
  | "json-but-not-a-key";

/*
 * Reading the key, forgivingly.
 *
 * A service account file is JSON whose private_key value contains the two
 * characters backslash-n many times over. Paste that through a form, a shell,
 * or an environment variable and something along the way is liable to turn
 * those into real line breaks -- at which point the JSON is invalid, because a
 * string in JSON may not contain a raw newline, and the whole thing fails with
 * an error about control characters that says nothing about what happened.
 *
 * So three attempts, cheapest first: as it is, base64-decoded, and with raw
 * newlines put back into the escapes they were before. Any of them working is
 * as good as any other.
 */
/** Raw newlines inside string values, escaped back into what JSON expects. */
function repair(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"/gs, (m) => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r"));
}

export function readKey():
  | { ok: true; client_email: string; private_key: string; project_id: string }
  | { ok: false; problem: KeyProblem; detail: string } {
  const raw = process.env.GOOGLE_CHAT_APP_KEY?.trim();
  if (!raw) return { ok: false, problem: "missing", detail: "the variable is not set" };

  // Quotes wrapped round the whole thing by a helpful editor.
  const unquoted = raw.replace(/^['"]|['"]$/g, "");

  /*
   * The raw value goes first, before any tidying.
   *
   * Something JSON-encoded arrives as a quoted string with its inner quotes
   * escaped; stripping the outer pair off that leaves nonsense. Parsing it
   * whole lets the unwrap below recognise what it is, and tidying is only the
   * fallback for values that were never valid to begin with.
   */
  const attempts: string[] = [raw, unquoted];

  if (!unquoted.startsWith("{")) {
    try {
      attempts.push(Buffer.from(unquoted, "base64").toString("utf8"));
    } catch {
      /* not base64; nothing lost */
    }
  }

  attempts.push(repair(unquoted));

  let lastError = "";
  for (const candidate of attempts) {
    try {
      let parsed = JSON.parse(candidate) as unknown;

      /*
       * A value that parses to a string rather than an object was JSON-encoded
       * on the way in -- pasted with quotes round it, or passed through
       * something that stringified it once too often. The contents are the real
       * key, so unwrap once and carry on.
       */
      // Unwrapped, then repaired: the string inside a JSON-encoded value has
      // had its escapes resolved into real newlines by the first parse, so it
      // needs the same treatment as a mangled paste before it will parse again.
      if (typeof parsed === "string") parsed = JSON.parse(repair(parsed)) as unknown;

      const key = parsed as {
        client_email?: string; private_key?: string; project_id?: string;
      };
      if (!key.client_email || !key.private_key) {
        return {
          ok: false,
          problem: "json-but-not-a-key",
          detail: "it parsed, but has no client_email or private_key -- is it the right file?",
        };
      }
      return {
        ok: true,
        client_email: key.client_email,
        private_key: key.private_key,
        project_id: key.project_id ?? "(none)",
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "unreadable";
    }
  }

  return {
    ok: false,
    problem: "not-json",
    // Shape only, never content: how long it is, how it starts and ends. Enough
    // to tell a truncated paste from a mangled one without printing a key.
    detail:
      `${lastError}. It is ${unquoted.length} characters, ` +
      `starts "${unquoted.slice(0, 1)}", ends "${unquoted.slice(-1)}", ` +
      `${unquoted.includes("private_key") ? "mentions" : "does not mention"} private_key`,
  };
}
