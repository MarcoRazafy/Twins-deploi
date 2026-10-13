import { Fragment, type ReactNode } from "react";

/**
 * Small, safe Markdown renderer for assistant replies: paragraphs, headings,
 * numbered and bulleted lists (one nesting level), tables, rules, bold, inline
 * code, links and code blocks. It builds React elements only, never HTML
 * strings, so nothing in a reply can inject markup.
 */

interface ListItem {
  text: string;
  children: string[];
}

type Align = "left" | "center" | "right";

type Block =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "table"; header: string[]; align: Align[]; rows: string[][] };

const ORDERED = /^(\s*)\d+[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
/** The line under a table header: `|---|:--:|`. */
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Cells of a table row; a pipe inside inline code or after a backslash is text. */
function splitRow(line: string): string[] {
  const row = line.trim();
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < row.length; index += 1) {
    const char = row[index];
    if (char === "\\" && row[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (char === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else {
      if (char === "`") inCode = !inCode;
      cell += char;
    }
  }
  cells.push(cell.trim());
  if (row.startsWith("|")) cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function alignOf(rule: string): Align {
  if (rule.startsWith(":") && rule.endsWith(":")) return "center";
  return rule.endsWith(":") ? "right" : "left";
}

export function parseBlocks(source: string): Block[] {
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

    if (line.includes("|") && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[index + 1]).map(alignOf);
      if (header.length === align.length) {
        flushAll();
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index].trim() !== "" && lines[index].includes("|")) {
          rows.push(splitRow(lines[index]));
          index += 1;
        }
        index -= 1;
        blocks.push({ kind: "table", header, align, rows });
        continue;
      }
    }

    if (RULE.test(line)) {
      flushAll();
      blocks.push({ kind: "rule" });
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
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim().replace(/\s+#+$/, "") });
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

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"'`*)\]]+)/g;
const LINK = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">
      {children}
    </a>
  );
}

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
    const link = LINK.exec(part);
    if (link) {
      return (
        <ExternalLink key={index} href={link[2]}>
          {link[1]}
        </ExternalLink>
      );
    }
    if (/^https?:\/\//.test(part)) {
      // The full stop that ends the sentence is not part of the address.
      const href = part.replace(TRAILING_PUNCTUATION, "");
      return (
        <Fragment key={index}>
          <ExternalLink href={href}>{href}</ExternalLink>
          {part.slice(href.length)}
        </Fragment>
      );
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

const ALIGN_CLASS: Record<Align, string> = { left: "text-left", center: "text-center", right: "text-right" };

function Table({ block }: { block: Extract<Block, { kind: "table" }> }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-background/60">
            {block.header.map((cell, index) => (
              <th key={index} scope="col" className={`px-2.5 py-1.5 font-medium ${ALIGN_CLASS[block.align[index]]}`}>
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t">
              {block.header.map((_, index) => (
                <td key={index} className={`px-2.5 py-1.5 align-top ${ALIGN_CLASS[block.align[index]]}`}>
                  {renderInline(row[index] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2.5 break-words">
      {parseBlocks(source).map((block, index) => {
        if (block.kind === "list") return <List key={index} block={block} />;
        if (block.kind === "table") return <Table key={index} block={block} />;
        if (block.kind === "rule") return <hr key={index} />;
        if (block.kind === "heading") {
          return (
            <p
              key={index}
              role="heading"
              aria-level={block.level}
              className={block.level <= 2 ? "pt-1 text-base font-semibold" : "font-semibold"}
            >
              {renderInline(block.text)}
            </p>
          );
        }
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
