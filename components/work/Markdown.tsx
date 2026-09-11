import type { ReactNode } from "react";

/**
 * ClickUp task descriptions, which arrive as markdown.
 *
 * Built from React nodes, never from an HTML string, so nothing in a
 * description can become markup on this page -- a description is written by
 * whoever had edit rights on the task, and they are not all us. Links are only
 * rendered for http, https and mailto; anything else stays text.
 *
 * Deliberately small: headings, lists, checkboxes, quotes, code, bold, italic,
 * inline code and links. That covers what people actually type into ClickUp;
 * the rare table renders as its source rather than wrongly.
 */

const SAFE = /^(https?:|mailto:)/i;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  /* Order matters: links before bare URLs, code before emphasis. */
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(https?:\/\/[^\s<>)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) {
      out.push(SAFE.test(m[3])
        ? <a key={k} href={m[3]} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">{m[2]}</a>
        : m[0]);
    } else if (m[4]) {
      out.push(<code key={k} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{m[5]}</code>);
    } else if (m[6]) {
      out.push(<strong key={k}>{m[7]}</strong>);
    } else if (m[8]) {
      out.push(<em key={k}>{m[9]}</em>);
    } else if (m[10]) {
      out.push(<em key={k}>{m[11]}</em>);
    } else if (m[12]) {
      out.push(<a key={k} href={m[12]} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all">{m[12]}</a>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${i}`;

    if (line.trim() === "") { i++; continue; }

    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>{body.join("\n")}</code></pre>);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const size = heading[1].length === 1 ? "text-lg" : heading[1].length === 2 ? "text-base" : "text-sm";
      blocks.push(<p key={key} className={`${size} font-semibold`}>{inline(heading[2], key)}</p>);
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={key} className="my-2" />); i++; continue; }

    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key} className="border-l-2 pl-3 text-muted-foreground">{inline(body.join(" "), key)}</blockquote>);
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        const raw = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "");
        const box = raw.match(/^\[( |x|X)\]\s+(.*)$/);
        const k = `${key}-${i}`;
        items.push(
          <li key={k} className={box ? "list-none -ml-4 flex items-baseline gap-2" : ""}>
            {box && <input type="checkbox" checked={box[1] !== " "} readOnly className="h-3 w-3 translate-y-0.5" />}
            <span>{inline(box ? box[2] : raw, k)}</span>
          </li>
        );
        i++;
      }
      blocks.push(ordered
        ? <ol key={key} className="list-decimal space-y-0.5 pl-5">{items}</ol>
        : <ul key={key} className="list-disc space-y-0.5 pl-5">{items}</ul>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,3}\s|```|>|\s*([-*+]|\d+\.)\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key}>{para.flatMap((p, n) => [...inline(p, `${key}-${n}`), n < para.length - 1 ? <br key={`${key}-br${n}`} /> : null])}</p>);
  }

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
