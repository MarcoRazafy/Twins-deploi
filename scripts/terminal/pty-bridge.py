#!/usr/bin/env python3
"""TwinsDeploi - pseudo-terminal of one "Console" session.

Started by the terminal service (src/server/terminal/session.ts), one process
per browser session, with the rights of the platform account. Never root.

  pty-bridge.py --cwd DIR --cols N --rows N --marker ID

  stdin  (fd 0)  bytes typed in the browser  -> terminal
  stdout (fd 1)  bytes written by the shell  -> browser
  fd 3           "COLS ROWS\\n" lines         -> window size (SIGWINCH)

The session ends when the shell exits, when stdin closes (the browser left, or
the service died) or on SIGTERM. Everything the shell started is then killed:
the processes of its session, and those that left it (setsid, nohup, tmux) but
still carry the marker MINI_RAILWAY_CONSOLE=ID in their environment.
The exit status is the one of the shell (128 + signal when it was killed).
"""

import argparse
import fcntl
import os
import pty
import pwd
import select
import signal
import struct
import sys
import termios
import time

CONTROL_FD = 3
MARKER_NAME = "MINI_RAILWAY_CONSOLE"
CHUNK = 65536
MIN_SIZE, MAX_SIZE = 2, 1000
# Grace given to each signal before the next, harsher one.
KILL_STEPS = ((signal.SIGHUP, 1.5), (signal.SIGTERM, 1.5), (signal.SIGKILL, 1.0))


class Stop(Exception):
    """Raised by the signal handlers to leave the copy loop."""


def on_signal(_signum, _frame):
    raise Stop()


def clamp(value):
    return max(MIN_SIZE, min(MAX_SIZE, value))


def set_size(fd, cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", clamp(rows), clamp(cols), 0, 0))


def write_all(fd, data):
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]


def session_members(shell_pid, marker):
    """Pids of our own processes that belong to the session or carry its marker."""
    needle = ("%s=%s" % (MARKER_NAME, marker)).encode()
    uid = os.getuid()
    me = os.getpid()
    found = []
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        pid = int(name)
        if pid == me:
            continue
        try:
            if os.stat("/proc/%d" % pid).st_uid != uid:
                continue
            with open("/proc/%d/stat" % pid, "rb") as handle:
                stat = handle.read()
            # "pid (comm) state ppid pgrp session ..." - comm may contain spaces and parentheses.
            fields = stat[stat.rindex(b")") + 2:].split()
            if int(fields[3]) == shell_pid:
                found.append(pid)
                continue
            with open("/proc/%d/environ" % pid, "rb") as handle:
                if needle in handle.read().split(b"\0"):
                    found.append(pid)
        except (OSError, ValueError, IndexError):
            continue  # gone meanwhile, or not ours to read
    return found


def kill_session(shell_pid, marker):
    for signum, grace in KILL_STEPS:
        members = session_members(shell_pid, marker)
        if not members:
            return
        for pid in members:
            try:
                os.kill(pid, signum)
            except OSError:
                pass
        deadline = time.monotonic() + grace
        while time.monotonic() < deadline:
            reap(shell_pid)
            if not session_members(shell_pid, marker):
                return
            time.sleep(0.05)


_status = None


def reap(shell_pid, block=False):
    """Collects the exit status of the shell once; returns it (None while it runs)."""
    global _status
    if _status is None:
        try:
            pid, status = os.waitpid(shell_pid, 0 if block else os.WNOHANG)
            if pid == shell_pid:
                _status = os.waitstatus_to_exitcode(status)
        except ChildProcessError:
            _status = 0
    return _status


def copy_loop(master):
    control = b""
    watched = [0, master, CONTROL_FD]
    while True:
        readable, _, _ = select.select(watched, [], [])
        if master in readable:
            try:
                data = os.read(master, CHUNK)
            except OSError:
                return  # EIO: the shell and everything holding the terminal are gone
            if not data:
                return
            write_all(1, data)
        if 0 in readable:
            data = os.read(0, CHUNK)
            if not data:
                return  # the service closed the session
            write_all(master, data)
        if CONTROL_FD in readable:
            data = os.read(CONTROL_FD, 4096)
            if not data:
                watched.remove(CONTROL_FD)
                continue
            control += data
            *lines, control = control.split(b"\n")
            for line in lines[-1:]:  # only the latest size matters
                parts = line.split()
                if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                    set_size(master, int(parts[0]), int(parts[1]))


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--cols", type=int, default=80)
    parser.add_argument("--rows", type=int, default=24)
    parser.add_argument("--marker", required=True)
    args = parser.parse_args()

    if os.geteuid() == 0:
        sys.stderr.write("pty-bridge: refusing to open a root shell\n")
        return 2
    if not args.marker.isalnum():
        sys.stderr.write("pty-bridge: invalid marker\n")
        return 2

    account = pwd.getpwuid(os.getuid())
    shell = account.pw_shell or "/bin/sh"
    env = dict(os.environ)
    env[MARKER_NAME] = args.marker

    shell_pid, master = pty.fork()
    if shell_pid == 0:
        try:
            os.closerange(CONTROL_FD, 256)
            try:
                os.chdir(args.cwd)
            except OSError:
                os.chdir(account.pw_dir)
            # argv[0] starting with "-": a login shell, so ~/.profile sets PATH.
            os.execve(shell, ["-" + os.path.basename(shell)], env)
        finally:
            os._exit(127)

    for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(signum, on_signal)
    signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    try:
        set_size(master, args.cols, args.rows)
        copy_loop(master)
    except (Stop, OSError):
        pass
    finally:
        for signum in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(signum, signal.SIG_IGN)
        try:
            os.close(master)  # hangs up the terminal: SIGHUP to its foreground job
        except OSError:
            pass
        kill_session(shell_pid, args.marker)

    status = reap(shell_pid, block=True)
    return status if status >= 0 else 128 - status


if __name__ == "__main__":
    sys.exit(main())
