#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell, Read, Grep, Glob): block the commands that
// .claude/settings.json also lists under permissions.deny, so a rule that a
// deny pattern misses (other flag order, quoting, a different tool) still stops.
//
//   - rm -rf (any flag order or spelling) and PowerShell Remove-Item -Recurse -Force
//   - git push --force / -f / --force-with-lease / +refspec
//   - piping a download into a shell: curl|sh, wget|bash, irm|iex, sh <(curl ...)
//   - reading .env files (.env, .env.local, ...), via the shell or the file tools
//
// Exit code 2 blocks the call and shows the reason to Claude. Written in Node
// rather than Python because Node is always there when Claude Code is.
// Input that can't be parsed is let through, so a bug here never stops normal work.

const DOWNLOADERS = String.raw`(curl|wget|fetch|iwr|irm|invoke-webrequest|invoke-restmethod)`;
const SHELLS = String.raw`(sh|bash|zsh|dash|ksh|fish|python3?|node|perl|ruby|pwsh|powershell|iex|invoke-expression)`;

const BASH_RULES = [
  [new RegExp(String.raw`\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*(\s--force(-with-lease)?\b|\s-[a-z]*f[a-z]*\b|\s\+\S)`, "i"),
    "git push --force (rewrites remote history)"],
  [new RegExp(String.raw`\b${DOWNLOADERS}\b[^\n;]*\|\s*(sudo\s+)?(-?\S*/)?${SHELLS}\b`, "i"),
    "piping a download into a shell (curl | sh)"],
  [new RegExp(String.raw`\b${SHELLS}\b[^\n;]*(<\(|\$\(|\x60)\s*${DOWNLOADERS}\b`, "i"),
    "running a downloaded script (sh <(curl ...))"],
  [/\bremove-item\b(?=.*\s-r(ecurse)?\b)(?=.*\s-fo(rce)?\b)/i, "Remove-Item -Recurse -Force"],
];

// A .env file: .env or .env.<suffix>, but not .envrc or process.env.X.
const ENV_FILE = /(^|[\s'"=:/\\<(])\.env(\.[\w.-]+)?(?=$|[\s'";|&)<>])/i;
const ENV_BASENAME = /(^|[/\\])\.env(\.[\w.-]+)?$/i;

function isRmRf(command) {
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    let i = words.findIndex((w) => /^(\\|.*\/)?rm$/.test(w.replace(/^["']|["']$/g, "")));
    if (i < 0) continue;
    let recursive = false, force = false;
    for (const w of words.slice(i + 1)) {
      if (w === "--") break;
      if (w === "--recursive") recursive = true;
      else if (w === "--force") force = true;
      else if (/^-[a-zA-Z]+$/.test(w)) {
        if (/[rR]/.test(w)) recursive = true;
        if (/f/.test(w)) force = true;
      }
    }
    if (recursive && force) return true;
  }
  return false;
}

function reasonsFor(tool, input) {
  const reasons = [];
  if (tool === "Bash" || tool === "PowerShell") {
    const command = String(input.command || "");
    if (isRmRf(command)) reasons.push("rm -rf (recursive forced delete)");
    for (const [pattern, why] of BASH_RULES) if (pattern.test(command)) reasons.push(why);
    if (ENV_FILE.test(command)) reasons.push("reading a .env file (secrets)");
  } else {
    // Read / Grep / Glob: refuse to open or search .env files directly.
    const targets = [input.file_path, input.path, input.pattern, input.glob].filter(Boolean).map(String);
    if (targets.some((t) => ENV_BASENAME.test(t) || /(^|[/\\])\.env\*?$/.test(t))) {
      reasons.push("reading a .env file (secrets)");
    }
  }
  return reasons;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let reasons = [];
  try {
    const data = JSON.parse(raw || "{}");
    reasons = reasonsFor(data.tool_name || "", data.tool_input || {});
  } catch (err) {
    process.stderr.write(`block-unsafe hook: ${err.message}\n`);
    process.exit(0);
  }
  if (reasons.length) {
    process.stderr.write(
      `Blocked by the factory's safety rules: ${reasons.join("; ")}. ` +
        "Find a safe way (edit instead of delete, a normal push, a pinned package instead of a piped " +
        "script, an env var name instead of the secret), or leave the ticket open and ask a human.\n",
    );
    process.exit(2);
  }
  process.exit(0);
});
