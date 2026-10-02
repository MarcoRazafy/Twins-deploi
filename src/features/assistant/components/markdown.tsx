import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown renderer for assistant replies: paragraphs, numbered
 * and bulleted lists (one nesting level), bold, inline code and code blocks.
 * It builds React elements only, never HTML strings, so nothing in a reply
 * can inject markup.
 */

interface ListItem {
  text: string;
  children: string[];
}

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; items: ListItem[] };

const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushAll = () => {
    flushParagraph();
    list = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.trimStart().startsWith("```")) {
      flushAll();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }

    if (line.trim() === "") {
      // A blank line ends a paragraph; a list may continue after it.
      flushParagraph();
      continue;
    }

    const ordered = ORDERED.exec(line);
    const bullet = ordered ? null : BULLET.exec(line);
    const match = ordered ?? bullet;
    if (match) {
      flushParagraph();
      const indent = match[1].length;
      const text = match[2].trim();
      if (indent >= 2 && list) {
        // Indented line under an item: a sub-point of that item.
        list.items[list.items.length - 1].children.push(text);
      } else if (list && list.ordered === (ordered !== null)) {
        list.items.push({ text, children: [] });
      } else {
        list = { kind: "list", ordered: ordered !== null, items: [{ text, children: [] }] };
        blocks.push(list);
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ kind: "paragraph", text: `**${heading[1].trim().replace(/\*\*/g, "")}**` });
      continue;
    }

    if (list && /^\s+/.test(line)) {
      // Wrapped continuation of the previous list item.
      const last = list.items[list.items.length - 1];
      if (last.children.length > 0) last.children[last.children.length - 1] += ` ${line.trim()}`;
      else last.text += ` ${line.trim()}`;
      continue;
    }
    list = null;
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;

function renderInline(text: string): ReactNode {
  return text.split(INLINE).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={index} className="rounded-md bg-background/60 px-1 py-0.5 font-mono text-[13px] break-words">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function List({ block }: { block: Extract<Block, { kind: "list" }> }) {
  const Tag = block.ordered ? "ol" : "ul";
  return (
    <Tag className={block.ordered ? "list-decimal space-y-1.5 pl-5" : "list-disc space-y-1.5 pl-5"}>
      {block.items.map((item, index) => (
        <li key={index} className="pl-0.5">
          {renderInline(item.text)}
          {item.children.length > 0 ? (
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {item.children.map((child, childIndex) => (
                <li key={childIndex}>{renderInline(child)}</li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </Tag>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2.5 break-words">
      {parseBlocks(source).map((block, index) => {
        if (block.kind === "list") return <List key={index} block={block} />;
        if (block.kind === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-lg bg-background/60 p-2.5 font-mono text-[13px] whitespace-pre"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}
