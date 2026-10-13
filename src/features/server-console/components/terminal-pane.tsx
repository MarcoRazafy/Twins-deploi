"use client";

import "@xterm/xterm/css/xterm.css";

import { useEffect, useEffectEvent, useRef } from "react";

import {
  CONSOLE_WS_PATH,
  consoleCloseReason,
  type ConsoleClientMessage,
  type ConsoleCloseReason,
  type ConsoleServerMessage,
} from "@/lib/server-console";

export type TerminalEvent =
  | { type: "open" }
  | {
      type: "closed";
      reason: ConsoleCloseReason;
      /** False when the server refused the connection before any terminal existed. */
      wasOpen: boolean;
      /** Exit status of the shell, when it ended by itself. */
      exitCode: number | null;
    };

interface TerminalPaneProps {
  onEvent: (event: TerminalEvent) => void;
}

const FONT_SIZE_PX = 13;
const SCROLLBACK_LINES = 5_000;
/** Pasted text is sent in pieces well under the message limit of the server. */
const INPUT_CHUNK_BYTES = 64 * 1024;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function websocketUrl(cols: number, rows: number): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}${CONSOLE_WS_PATH}?cols=${cols}&rows=${rows}`;
}

/**
 * One terminal session: an xterm.js screen wired to the terminal service.
 * Mounting opens the session, unmounting closes it (the shell ends on the
 * server); a new session is a new mount (change the `key`).
 */
export function TerminalPane({ onEvent }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const emit = useEffectEvent(onEvent);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let cleanup = (): void => {};

    // While the terminal has the focus, every key is for the shell: the shortcuts
    // of the application (Ctrl+K, Ctrl+B…) must not fire on top of it.
    const keepKeys = (event: KeyboardEvent): void => event.stopPropagation();
    container.addEventListener("keydown", keepKeys);

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        // The cell size is measured once: wait for the monospace font.
        document.fonts.ready,
      ]);
      if (disposed) return;

      const terminal = new Terminal({
        cursorBlink: true,
        fontFamily: getComputedStyle(container).fontFamily,
        fontSize: FONT_SIZE_PX,
        scrollback: SCROLLBACK_LINES,
        macOptionIsMeta: true,
        theme: {
          background: token("--background"),
          foreground: token("--foreground"),
          cursor: token("--foreground"),
          cursorAccent: token("--background"),
          selectionBackground: token("--border-strong"),
        },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      fit.fit();

      const socket = new WebSocket(websocketUrl(terminal.cols, terminal.rows));
      socket.binaryType = "arraybuffer";
      const encoder = new TextEncoder();
      let wasOpen = false;
      let exitCode: number | null = null;

      const sendBytes = (bytes: Uint8Array): void => {
        if (socket.readyState !== WebSocket.OPEN) return;
        for (let offset = 0; offset < bytes.length; offset += INPUT_CHUNK_BYTES) {
          socket.send(bytes.subarray(offset, offset + INPUT_CHUNK_BYTES));
        }
      };
      const sendControl = (message: ConsoleClientMessage): void => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      };

      socket.addEventListener("open", () => {
        wasOpen = true;
        // The size may have changed while the connection was being established.
        sendControl({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        terminal.focus();
        emit({ type: "open" });
      });
      socket.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
        if (typeof event.data !== "string") {
          terminal.write(new Uint8Array(event.data));
          return;
        }
        try {
          const message = JSON.parse(event.data) as ConsoleServerMessage;
          if (message.type === "exit") exitCode = message.code;
        } catch {
          // Not a control message we know: ignored.
        }
      });
      socket.addEventListener("close", (event) => {
        if (disposed) return;
        terminal.options.cursorBlink = false;
        terminal.options.disableStdin = true;
        emit({ type: "closed", reason: consoleCloseReason(event.code), wasOpen, exitCode });
      });

      const onData = terminal.onData((data) => sendBytes(encoder.encode(data)));
      // Mouse reports and other raw sequences: one byte per character, not UTF-8.
      const onBinary = terminal.onBinary((data) => sendBytes(Uint8Array.from(data, (char) => char.charCodeAt(0))));
      const onResize = terminal.onResize(({ cols, rows }) => sendControl({ type: "resize", cols, rows }));

      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => fit.fit());
      });
      observer.observe(container);

      cleanup = (): void => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        onData.dispose();
        onBinary.dispose();
        onResize.dispose();
        // Leaving the page ends the session: the server kills the shell.
        socket.close();
        terminal.dispose();
      };
    })();

    return () => {
      disposed = true;
      container.removeEventListener("keydown", keepKeys);
      cleanup();
    };
  }, []);

  return <div ref={containerRef} className="size-full min-h-0 overflow-hidden font-mono" />;
}
