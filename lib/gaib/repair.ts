import type Anthropic from "@anthropic-ai/sdk";

/*
 * Put a result against every tool call that never got one.
 *
 * A turn writes the assistant's message the moment it arrives and the tool
 * results a few seconds later, once the tools have run. Anything that ends the
 * request in between -- a timeout, a closed tab, a deploy -- leaves a tool call
 * with nothing after it.
 *
 * The API requires each tool call to be answered, so from that point the
 * conversation is refused. Every message. Forever. One interrupted turn and
 * somebody's chat is dead, and the only thing they are told is that it could
 * not make sense of the conversation, which is true and useless.
 *
 * So the gap is filled on the way out of the database rather than repaired in
 * it: stored history stays a faithful record of what happened, and what the
 * model sees is something it can answer. The synthesised result says plainly
 * that the tool did not finish, because inventing a plausible answer to a
 * lookup nobody performed is how you get a confident wrong figure.
 */
export function repairDanglingToolCalls(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    out.push(message);

    if (message.role !== "assistant" || typeof message.content === "string") continue;

    const asked = message.content
      .filter((b): b is Anthropic.ToolUseBlockParam => b.type === "tool_use")
      .map((b) => b.id);
    if (!asked.length) continue;

    const next = messages[i + 1];
    const answered = new Set(
      next && next.role === "user" && typeof next.content !== "string"
        ? next.content
            .filter((b) => b.type === "tool_result")
            .map((b) => (b as Anthropic.ToolResultBlockParam).tool_use_id)
        : []
    );

    const missing = asked.filter((id) => !answered.has(id));
    if (!missing.length) continue;

    const filled: Anthropic.ToolResultBlockParam[] = missing.map((id) => ({
      type: "tool_result",
      tool_use_id: id,
      is_error: true,
      content:
        "This did not finish -- the conversation was interrupted before it ran. " +
        "Say so if it matters, and do it again rather than guessing at what it would have returned.",
    }));

    if (next && next.role === "user" && typeof next.content !== "string") {
      // Slotted into the existing reply, because two consecutive user messages
      // is its own kind of malformed.
      messages[i + 1] = { ...next, content: [...filled, ...next.content] };
    } else {
      out.push({ role: "user", content: filled });
    }
  }

  return out;
}
