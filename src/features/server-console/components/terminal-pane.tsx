"use client";

import "@xterm/xterm/css/xterm.css";

import { useEffect, useEffectEvent, useImperativeHandle, useRef, type Ref } from "react";

import {
  CONSOLE_WS_PATH,
  consoleCloseReason,
  type ConsoleClientMessage,
  type ConsoleCloseReason,
  type ConsoleServerMessage,
} from "@/lib/server-console";

export type TerminalEvent =
  /** Attached to terminal `sessionId`: a new one, or one that was already running (`resumed`). */
  | { type: "open"; sessionId: string; resumed: boolean }
  | {
      type: "closed";
      reason: ConsoleCloseReason;
      /** False when the server refused the connection before any terminal existed. */
      wasOpen: boolean;
      /** Exit status of the shell, when it ended by itself. */
      exitCode: number | null;
    };

export interface TerminalPaneHandle {
  /** Ends the terminal on the server (the shell and everything it started). */
  end(): void;
}

interface TerminalPaneProps {
  /** Terminal to attach back to; null lets the server pick the latest detached one. */
  sessionId: string | null;
  /** Always open a new terminal, even if a detached one is waiting. */
  fresh: boolean;
  onEvent: (event: TerminalEvent) => void;
  ref?: Ref<TerminalPaneHandle>;
}

const FONT_SIZE_PX = 13;
const SCROLLBACK_LINES = 5_000;
/** Pasted text is sent in pieces well under the message limit of the server. */
const INPUT_CHUNK_BYTES = 64 * 1024;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function websocketUrl(cols: number, rows: number, sessionId: string | null, fresh: boolean): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ cols: String(cols), rows: String(rows) });
  if (fresh) query.set("new", "1");
  else if (sessionId !== null) query.set("session", sessionId);
  return `${scheme}//${window.location.host}${CONSOLE_WS_PATH}?${query}`;
}

/**
 * One connection to a terminal: an xterm.js screen wired to the terminal
 * service. Unmounting only detaches: the shell keeps running on the server,
 * and the next mount attaches back to it (its latest output is replayed).
 * `end()` closes it for good. Props are read once, at mount: change the
 * `key` to connect again.
 */
export function TerminalPane({ sessionId, fresh, onEvent, ref }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const emit = useEffectEvent(onEvent);
  const endRef = useRef<() => void>(() => {});
  const initial = useRef({ sessionId, fresh });

  useImperativeHandle(ref, () => ({ end: () => endRef.current() }), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let ending = false;
    let cleanup = (): void => {};
    // Asked before the connection is up: sent as soon as it is.
    endRef.current = () => {
      ending = true;
    };

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

      const socket = new WebSocket(
        websocketUrl(terminal.cols, terminal.rows, initial.current.sessionId, initial.current.fresh),
      );
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

      endRef.current = () => sendControl({ type: "close" });

      socket.addEventListener("open", () => {
        wasOpen = true;
        if (ending) {
          sendControl({ type: "close" });
          return;
        }
        // The size may have changed while the connection was being established.
        sendControl({ type: "resize", cols: terminal.cols, rows: terminal.rows });
        terminal.focus();
      });
      socket.addEventListener("message", (event: MessageEvent<ArrayBuffer | string>) => {
        if (typeof event.data !== "string") {
          terminal.write(new Uint8Array(event.data));
          return;
        }
        try {
          const message = JSON.parse(event.data) as ConsoleServerMessage;
          if (message.type === "exit") exitCode = message.code;
          else if (message.type === "session") {
            emit({ type: "open", sessionId: message.id, resumed: message.resumed });
          }
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
        // Leaving the page detaches: the shell keeps running on the server.
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
