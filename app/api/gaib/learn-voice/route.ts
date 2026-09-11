import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchChat } from "@/lib/google/chat";

/*
 * Learn how Gabe writes, from how Gabe writes.
 *
 * Gaib is Gabe's AI clone -- his name, his face in the avatar -- and a clone
 * that talks like a support desk is not one. So this reads Gabe's own recent
 * Google Chat messages, keeps only the ones he wrote, and has the model turn
 * them into a description of his style that every conversation then carries.
 *
 * What it keeps is style and nothing else. Gabe's chats are full of clients,
 * colleagues, numbers and decisions, and none of that belongs in an
 * instruction that is read out to the whole company on every turn -- so the
 * model is told to describe how he writes, never what about, and to invent its
 * example lines rather than quote. The result is returned for a person to
 * read, and stored so it can be relearned, not edited around.
 *
 * Run by hand, with the scheduler secret:
 *   curl -X POST -H "x-gaib-secret: ..." https://team.facturmfg.com/api/gaib/learn-voice
 */

export const maxDuration = 300;

const VOICE_MODEL = "claude-opus-5";

/** Whose voice. The clone is of the CEO, so it is whoever holds that role. */
async function whoIsGabe(): Promise<string | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("org_assignments")
    .select("org_roles!inner(name),org_members!inner(email,active)")
    .eq("org_roles.name", "CEO")
    .eq("org_members.active", true)
    .limit(1)
    .maybeSingle();
  return (data as { org_members: { email: string } } | null)?.org_members?.email ?? null;
}

export async function POST(request: NextRequest) {
  const offered = request.headers.get("x-gaib-secret");
  if (!offered) return new NextResponse("Unauthorized", { status: 401 });

  const db = createServiceClient();
  const { data: secretRow } = await db
    .from("gaib_secrets").select("value").eq("name", "deliver").maybeSingle();
  const expected = (secretRow as { value: string } | null)?.value ?? process.env.GAIB_DELIVER_SECRET;
  if (!expected || offered !== expected) return new NextResponse("Unauthorized", { status: 401 });

  const email = await whoIsGabe();
  if (!email) return NextResponse.json({ ok: false, reason: "no active CEO to learn from" });

  const { messages, spaces } = await fetchChat(email, 90, 80, 250);

  /*
   * Which of the senders is Gabe.
   *
   * The API names senders by an opaque id, not an email, and does not say
   * which one is the account doing the reading. But Gabe is the one person in
   * every space listed here -- they are listed because he is in them -- so the
   * sender who turns up in the most distinct spaces is him.
   */
  const spacesBySender = new Map<string, Set<string>>();
  for (const m of messages) {
    if (!m.author) continue;
    const set = spacesBySender.get(m.author) ?? new Set<string>();
    set.add(m.spaceName);
    spacesBySender.set(m.author, set);
  }
  const self = [...spacesBySender.entries()].sort((a, b) => b[1].size - a[1].size)[0]?.[0];
  if (!self) return NextResponse.json({ ok: false, reason: "no messages found to learn from" });

  // His own, most recent first, one copy of each, not so short it says nothing.
  const seen = new Set<string>();
  const mine = messages
    .filter((m) => m.author === self)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((m) => m.text.trim())
    .filter((t) => t.length >= 2 && t.length <= 700 && !seen.has(t) && (seen.add(t), true))
    .slice(0, 600);

  if (mine.length < 40) {
    return NextResponse.json({ ok: false, reason: `only ${mine.length} messages of his found -- too few to learn a voice` });
  }

  const client = new Anthropic();
  const res = await client.messages.create({
    model: VOICE_MODEL,
    max_tokens: 5000,
    system:
      "You write voice guides. Given a sample of one person's real chat messages, you describe how " +
      "they write so that an AI can write the same way. The AI is this person's clone: it uses their " +
      "name and face, and talks to their whole team at work.\n\n" +
      "HARD RULES -- the guide is read out on every conversation, to everyone:\n" +
      "- Describe style only: rhythm, length, punctuation, capitalisation, spelling habits, vocabulary, " +
      "humour, how they give instructions, how they react to good and bad news.\n" +
      "- Never include any person's name, client, company, product, figure, date, place or decision " +
      "from the messages. Not in the description, not in the examples.\n" +
      "- Never quote a message. Every example line must be newly written in their style, about " +
      "something generic.\n" +
      "- Do not describe their opinions of people, or anything personal.",
    messages: [{
      role: "user",
      content:
        `Here are ${mine.length} messages written by one person, newest first, separated by ---.\n\n` +
        mine.join("\n---\n") +
        "\n\n" +
        "Write the voice guide in markdown, second person (\"You write...\"), under 600 words, with these sections:\n" +
        "1. **How you write** -- the mechanics, concretely.\n" +
        "2. **Words and phrases you reach for** -- recurring expressions, generalised.\n" +
        "3. **Humour** -- what kind, and when.\n" +
        "4. **Good news and bad news** -- how the reaction changes.\n" +
        "5. **Never** -- things this person clearly would not say.\n" +
        "6. **Poking fun at yourself** -- this AI is the person's clone, and the person has asked it to " +
        "rib him in front of his team. From habits visible in HOW he writes (not what about), give 5-8 " +
        "affectionate, specific running jokes the clone can make at his expense. Warm, never undermining " +
        "his authority, never about anything personal.\n" +
        "7. **Example lines** -- 12 short invented lines in this voice: a greeting, a thanks, a bug " +
        "report acknowledged, a fix announced, bad news delivered, a question clarified, and a couple of " +
        "self-roasts.",
    }],
  });

  const guide = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  if (!guide) return NextResponse.json({ ok: false, reason: "the model returned no guide" });

  await db
    .from("gaib_agents")
    .update({ voice: guide, voice_learned_at: new Date().toISOString() })
    .eq("is_default", true);

  return NextResponse.json({
    ok: true,
    learnedFrom: { messages: mine.length, spaces, sampleSpan: "last 90 days" },
    guide,
  });
}
