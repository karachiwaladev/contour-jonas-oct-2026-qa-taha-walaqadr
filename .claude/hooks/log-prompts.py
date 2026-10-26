#!/usr/bin/env python3
"""Stop hook: append every new prompt in this session to a JSONL log.

Claude Code runs this after each turn (the Stop event). It reads the session
transcript, finds prompts that are not in the log yet, and appends one JSON
object per prompt. It never blocks Claude: any error is printed to stderr and
the script exits 0.

Log file: $PROMPT_LOG_FILE, or <project>/.claude/prompts.jsonl by default.
Each line: {"timestamp", "logged_at", "session_id", "uuid", "source", "prompt", "cwd"}
  source = "human"           typed prompt that started a turn
           "human-mid-turn"  message sent while Claude was still working
           "scheduled"       prompt fired by a loop / scheduled wakeup
"""
import datetime
import fcntl
import json
import os
import re
import sys

REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
SKIP_PREFIXES = ("<local-command-stdout>", "<local-command-caveat>", "[Request interrupted")


def text_of(content):
    """Return the prompt text of a user message, or None if it isn't a prompt."""
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return None  # tool output, not a prompt
        text = "\n".join(
            b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
        )
    else:
        return None
    text = REMINDER.sub("", text).strip()
    if not text or text.startswith(SKIP_PREFIXES):
        return None
    return text


def prompts_in(transcript_path):
    with open(transcript_path, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("isSidechain") or not e.get("uuid"):
                continue
            if e.get("type") == "user" and not e.get("isCompactSummary"):
                scheduled = e.get("turnOrigin") == "scheduled"
                if e.get("isMeta") and not scheduled:
                    continue  # skill bodies, caveats and other injected text
                text = text_of(e.get("message", {}).get("content"))
                if text:
                    yield e, text, "scheduled" if scheduled else "human"
            elif e.get("type") == "attachment":
                a = e.get("attachment") or {}
                if a.get("type") == "queued_command" and a.get("commandMode", "prompt") == "prompt":
                    text = text_of(a.get("prompt"))
                    if text:
                        yield e, text, "human-mid-turn"


def main():
    data = json.load(sys.stdin)
    transcript = data.get("transcript_path")
    if not transcript or not os.path.exists(transcript):
        return
    project = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    log_path = os.environ.get("PROMPT_LOG_FILE") or os.path.join(project, ".claude", "prompts.jsonl")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)

    with open(log_path, "a+", encoding="utf-8") as log:
        fcntl.flock(log, fcntl.LOCK_EX)  # one writer at a time
        log.seek(0)
        seen = set()
        for line in log:
            try:
                seen.add(json.loads(line).get("uuid"))
            except ValueError:
                pass
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        for e, text, source in prompts_in(transcript):
            if e["uuid"] in seen:
                continue
            seen.add(e["uuid"])
            log.write(json.dumps({
                "timestamp": e.get("timestamp"),
                "logged_at": now,
                "session_id": e.get("sessionId") or data.get("session_id"),
                "uuid": e["uuid"],
                "source": source,
                "prompt": text,
                "cwd": e.get("cwd"),
            }, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # never block the session
        print(f"log-prompts hook: {exc}", file=sys.stderr)
    sys.exit(0)
