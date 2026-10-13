"use client";

import { useEffect, useRef } from "react";

import { Markdown } from "@/features/assistant";
import { cn } from "@/lib/utils";

import type { ChatItem } from "../lib/conversation-store";
import { ToolCall } from "./tool-call";

/** Within this distance of the end, new content keeps the view at the end. */
const STICK_THRESHOLD_PX = 80;

function Working() {
  return (
    <div className="flex items-center gap-1 py-1" role="status">
      <span className="sr-only">Claude Code travaille…</span>
      {[0, 1, 2].map((dot) => (
        <span
          key={dot}
          aria-hidden
          className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
          style={{ animationDelay: `${dot * 180}ms` }}
        />
      ))}
    </div>
  );
}

function Item({ item, running }: { item: ChatItem; running: boolean }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-primary-foreground">
            {item.text}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="text-sm leading-relaxed">
          <Markdown source={item.text} />
        </div>
      );
    case "tool":
      return <ToolCall item={item} running={running} />;
    case "notice":
      return (
        <p
          role={item.tone === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm break-words",
            item.tone === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-border bg-secondary text-muted-foreground",
          )}
        >
          {item.text}
        </p>
      );
  }
}

interface MessageListProps {
  items: readonly ChatItem[];
  /** Claude Code is working on this conversation. */
  running: boolean;
}

export function MessageList({ items, running }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Follow the answer while it is written, unless the reader scrolled back up.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [items, running]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < STICK_THRESHOLD_PX;
  }

  const last = items[items.length - 1];
  // Dots while nothing visible is moving: before the first piece, and between two steps.
  const waiting = running && (last === undefined || last.kind === "user" || (last.kind === "tool" && last.output !== null));

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      aria-label="Conversation avec Claude Code"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-6">
        {items.map((item, index) => (
          <Item key={index} item={item} running={running} />
        ))}
        {waiting ? <Working /> : null}
      </div>
    </div>
  );
}
