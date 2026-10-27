#!/usr/bin/env node
// Stop hook: append every new prompt in this session to a JSONL log.
//
// Claude Code runs this after each turn (the Stop event). It reads the session
// transcript, finds prompts that are not in the log yet, and appends one JSON
// object per prompt. It never blocks Claude: any error is printed to stderr and
// the script exits 0.
//
// Log file: $PROMPT_LOG_FILE, or <project>/.claude/prompts.jsonl by default.
// Each line: {"timestamp", "logged_at", "session_id", "uuid", "source", "prompt", "cwd"}
//   source = "human"           typed prompt that started a turn
//            "human-mid-turn"  message sent while Claude was still working
//            "scheduled"       prompt fired by a loop / scheduled wakeup

import fs from "node:fs";
import path from "node:path";

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const SKIP_PREFIXES = ["<local-command-stdout>", "<local-command-caveat>", "[Request interrupted"];
const LOCK_WAIT_MS = 10000;
const LOCK_STALE_MS = 30000;

// Return the prompt text of a user message, or null if it isn't a prompt.
function textOf(content) {
  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const isBlock = (b) => b && typeof b === "object";
    if (content.some((b) => isBlock(b) && b.type === "tool_result")) return null; // tool output, not a prompt
    text = content.filter((b) => isBlock(b) && b.type === "text").map((b) => b.text ?? "").join("\n");
  } else {
    return null;
  }
  text = text.replace(REMINDER, "").trim();
  if (!text || SKIP_PREFIXES.some((p) => text.startsWith(p))) return null;
  return text;
}

function* promptsIn(transcriptPath) {
  for (const line of fs.readFileSync(transcriptPath, "utf8").split("\n")) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || typeof e !== "object" || e.isSidechain || !e.uuid) continue;
    if (e.type === "user" && !e.isCompactSummary) {
      const scheduled = e.turnOrigin === "scheduled";
      if (e.isMeta && !scheduled) continue; // skill bodies, caveats and other injected text
      const text = textOf(e.message?.content);
      if (text) yield [e, text, scheduled ? "scheduled" : "human"];
    } else if (e.type === "attachment") {
      const a = e.attachment || {};
      if (a.type === "queued_command" && (a.commandMode ?? "prompt") === "prompt") {
        const text = textOf(a.prompt);
        if (text) yield [e, text, "human-mid-turn"];
      }
    }
  }
}

// One writer at a time: hold <log>.lock (created exclusively) while reading and appending.
function withLock(logPath, fn) {
  const lockPath = logPath + ".lock";
  const start = Date.now();
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lockPath, "wx"));
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS) fs.unlinkSync(lockPath); // left by a crash
      } catch {}
      if (Date.now() - start > LOCK_WAIT_MS) throw new Error(`timed out waiting for ${lockPath}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function main(raw) {
  const data = JSON.parse(raw);
  const transcript = data.transcript_path;
  if (!transcript || !fs.existsSync(transcript)) return;
  const project = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const logPath = process.env.PROMPT_LOG_FILE || path.join(project, ".claude", "prompts.jsonl");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });

  withLock(logPath, () => {
    const seen = new Set();
    const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
    for (const line of existing.split("\n")) {
      try {
        seen.add(JSON.parse(line).uuid);
      } catch {}
    }
    const now = new Date().toISOString();
    let out = "";
    for (const [e, text, source] of promptsIn(transcript)) {
      if (seen.has(e.uuid)) continue;
      seen.add(e.uuid);
      out += JSON.stringify({
        timestamp: e.timestamp ?? null,
        logged_at: now,
        session_id: e.sessionId || data.session_id || null,
        uuid: e.uuid,
        source,
        prompt: text,
        cwd: e.cwd ?? null,
      }) + "\n";
    }
    if (out) {
      // Keep the log one-object-per-line even if the last write lost its newline.
      if (existing && !existing.endsWith("\n")) out = "\n" + out;
      fs.appendFileSync(logPath, out, "utf8");
    }
  });
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    main(raw);
  } catch (err) { // never block the session
    process.stderr.write(`log-prompts hook: ${err.message}\n`);
  }
  process.exit(0);
});
