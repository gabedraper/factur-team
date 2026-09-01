/**
 * node --experimental-strip-types lib/gaib/service-key.test.ts
 *
 * Pinned down because every one of these mangled shapes is something a real
 * paste actually does, and the failure they produce -- "not readable as JSON" --
 * says nothing about which one happened.
 */
import { readKey } from "./service-key.ts";

const good = JSON.stringify({
  type: "service_account",
  project_id: "scoreboard-505215",
  client_email: "gaib-chat@scoreboard-505215.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nkqhkiG9w0BAQ==\n-----END PRIVATE KEY-----\n",
}, null, 2);

let failed = 0;
function check(label: string, value: string | undefined, shouldRead: boolean) {
  if (value === undefined) delete process.env.GOOGLE_CHAT_APP_KEY;
  else process.env.GOOGLE_CHAT_APP_KEY = value;
  const r = readKey();
  const ok = r.ok === shouldRead;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(38)} ${r.ok ? "read it" : r.problem}`);
}

check("exactly as downloaded", good, true);
// Quotes added by hand, which is what actually happens -- the inner quotes are
// left alone. A properly JSON-encoded value is a different animal and is not
// supported: nothing produces one by accident, and guessing at it risks
// accepting something that is not a key at all.
check("quotes added round it by hand", `"${good}"`, true);
check("escapes turned into real newlines", good.replace(/\\n/g, "\n"), true);
check("base64 encoded", Buffer.from(good).toString("base64"), true);
check("with surrounding whitespace", `\n  ${good}\n `, true);
check("first character clipped off", good.slice(1), true);
check("first two characters clipped off", good.slice(2), true);
check("truncated halfway", good.slice(0, Math.floor(good.length / 2)), false);
check("some other json entirely", JSON.stringify({ hello: "world" }), false);
check("not set at all", undefined, false);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
