#!/usr/bin/env node
// PreToolUse hook (Bash): block destructive shell commands.
//
// The factory loop may create and edit files, commit and push. It must never delete
// work, rewrite history or force anything. Exit code 2 blocks the command and shows
// the reason to Claude. Anything that can't be parsed is allowed through, so a bug
// here never stops normal work.

import path from "node:path";

const BLOCK = [
  [/\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s--delete\b|\s-d\b|\s\+\S|\s:\S)/i, "force-pushing or deleting remote branches"],
  [/\bgit\s+reset\b.*--hard\b/i, "git reset --hard (throws away work)"],
  [/\bgit\s+clean\b/i, "git clean (deletes untracked files)"],
  [/\bgit\s+(rebase|filter-branch|filter-repo)\b/i, "rewriting history"],
  [/\bgit\s+commit\b.*--amend\b/i, "amending commits (rewrites history)"],
  [/\bgit\s+branch\b.*\s-(D|d|-delete)\b/i, "deleting branches"],
  [/\bgit\s+stash\s+(drop|clear)\b/i, "dropping stashed work"],
  [/\bgit\s+checkout\b.*\s--\s/i, "discarding file changes"],
  [/\bgit\s+checkout\s+\.(\s|$)/i, "discarding file changes"],
  [/\bgit\s+restore\b(?!.*--staged)/i, "discarding file changes"],
  [/\bgh\s+(repo|release|issue|label|secret|variable|run|cache)\s+delete\b/i, "deleting GitHub data"],
  [/\bgh\s+api\b.*(-X|--method)\s*DELETE\b/i, "DELETE calls to the GitHub API"],
  [/\bfind\b.*\s-delete\b/i, "find -delete"],
  [/\bxargs\b.*\brm\b/i, "deleting files via xargs rm"],
  [/\b(shred|mkfs(\.\w+)?|dd)\b/i, "low-level disk/data destruction"],
  [/\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, "dropping database data"],
];
const SAFE_RM_PREFIXES = ["/tmp/"];

// POSIX shell word splitting (like Python's shlex.split); throws on an unclosed quote.
function shellWords(text) {
  const words = [];
  let word = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) throw new Error("No closing quotation");
      word = (word ?? "") + text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      word ??= "";
      for (i++; ; i++) {
        if (i >= text.length) throw new Error("No closing quotation");
        if (text[i] === '"') break;
        if (text[i] === "\\" && '"\\$`\n'.includes(text[i + 1] ?? "")) i++;
        word += text[i];
      }
    } else if (c === "\\") {
      if (i + 1 >= text.length) throw new Error("No escaped character");
      word = (word ?? "") + text[++i];
    } else if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
    } else {
      word = (word ?? "") + c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

// True if any `rm`/`rmdir`/`unlink` in the command touches a path outside /tmp.
function rmTargetsOutsideTmp(command) {
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    let words;
    try {
      words = shellWords(segment);
    } catch {
      continue;
    }
    while (words.length && (words[0].includes("=") || ["sudo", "command", "env"].includes(words[0]))) {
      words = words.slice(1);
    }
    if (words.length && ["rm", "rmdir", "unlink"].includes(words[0])) {
      const targets = words.slice(1).filter((w) => !w.startsWith("-"));
      // Normalize first so /tmp/x/../etc doesn't count as inside /tmp.
      const outside = (t) => !SAFE_RM_PREFIXES.some((p) => path.posix.normalize(t).startsWith(p));
      if (!targets.length || targets.some(outside)) {
        return true;
      }
    }
  }
  return false;
}

function main(raw) {
  const data = JSON.parse(raw);
  const command = String((data.tool_input || {}).command || "");
  const reasons = BLOCK.filter(([pattern]) => pattern.test(command)).map(([, why]) => why);
  if (rmTargetsOutsideTmp(command)) reasons.push("deleting files outside /tmp");
  if (reasons.length) {
    process.stderr.write(
      "Blocked by the factory's no-destructive-actions rule: " + reasons.join("; ") + ". " +
        "Find a non-destructive way (add or edit instead of delete), or leave the ticket open " +
        "with a comment asking a human to do this step.\n",
    );
    process.exit(2);
  }
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    main(raw);
  } catch (err) { // never block on a hook bug
    process.stderr.write(`block-destructive hook: ${err.message}\n`);
  }
  process.exit(0);
});
