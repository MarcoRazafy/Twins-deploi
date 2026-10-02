"use client";

import { MessageCircle } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { useAssistantChat } from "../hooks/use-assistant-chat";
import { ChatPanel, PANEL_ID } from "./chat-panel";

/**
 * Floating guide chatbot: a round button at the bottom right that opens the
 * chat panel. Sits above page content (z-40) and below dialogs (z-50); the
 * workspace canvas controls live at the bottom left, so they never collide.
 */
export function AssistantWidget() {
  const pathname = usePathname();
  const chat = useAssistantChat(pathname);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Give the focus back to the launcher once the panel has been closed.
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  return (
    <>
      <Button
        ref={launcherRef}
        type="button"
        size="icon-lg"
        aria-label="Ouvrir l’assistant"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        inert={open}
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-xl shadow-black/40"
      >
        <MessageCircle className="size-5" />
      </Button>
      <AnimatePresence>
        {open ? (
          <ChatPanel chat={chat} draft={draft} onDraftChange={setDraft} onClose={() => setOpen(false)} />
        ) : null}
      </AnimatePresence>
    </>
  );
}
