#!/usr/bin/env python3
"""PreToolUse hook (Bash): block destructive shell commands.

The factory loop may create and edit files, commit and push. It must never delete
work, rewrite history or force anything. Exit code 2 blocks the command and shows
the reason to Claude. Anything that can't be parsed is allowed through, so a bug
here never stops normal work.
"""
import json
import re
import shlex
import sys

BLOCK = [
    (r"\bgit\s+push\b.*(\s--force\b|\s-f\b|\s--force-with-lease\b|\s--delete\b|\s-d\b|\s\+\S|\s:\S)", "force-pushing or deleting remote branches"),
    (r"\bgit\s+reset\b.*--hard\b", "git reset --hard (throws away work)"),
    (r"\bgit\s+clean\b", "git clean (deletes untracked files)"),
    (r"\bgit\s+(rebase|filter-branch|filter-repo)\b", "rewriting history"),
    (r"\bgit\s+commit\b.*--amend\b", "amending commits (rewrites history)"),
    (r"\bgit\s+branch\b.*\s-(D|d|-delete)\b", "deleting branches"),
    (r"\bgit\s+stash\s+(drop|clear)\b", "dropping stashed work"),
    (r"\bgit\s+checkout\b.*\s--\s", "discarding file changes"),
    (r"\bgit\s+checkout\s+\.(\s|$)", "discarding file changes"),
    (r"\bgit\s+restore\b(?!.*--staged)", "discarding file changes"),
    (r"\bgh\s+(repo|release|issue|label|secret|variable|run|cache)\s+delete\b", "deleting GitHub data"),
    (r"\bgh\s+api\b.*(-X|--method)\s*DELETE\b", "DELETE calls to the GitHub API"),
    (r"\bfind\b.*\s-delete\b", "find -delete"),
    (r"\bxargs\b.*\brm\b", "deleting files via xargs rm"),
    (r"\b(shred|mkfs(\.\w+)?|dd)\b", "low-level disk/data destruction"),
    (r"\b(drop\s+(table|database|schema)|truncate\s+table)\b", "dropping database data"),
]
SAFE_RM_PREFIXES = ("/tmp/",)


def rm_targets_outside_tmp(command):
    """True if any `rm`/`rmdir`/`unlink` in the command touches a path outside /tmp."""
    for segment in re.split(r"&&|\|\||;|\||\n", command):
        try:
            words = shlex.split(segment)
        except ValueError:
            continue
        while words and ("=" in words[0] or words[0] in ("sudo", "command", "env")):
            words = words[1:]
        if words and words[0] in ("rm", "rmdir", "unlink"):
            targets = [w for w in words[1:] if not w.startswith("-")]
            if not targets or any(not t.startswith(SAFE_RM_PREFIXES) for t in targets):
                return True
    return False


def main():
    data = json.load(sys.stdin)
    command = (data.get("tool_input") or {}).get("command") or ""
    reasons = [why for pattern, why in BLOCK if re.search(pattern, command, re.I)]
    if rm_targets_outside_tmp(command):
        reasons.append("deleting files outside /tmp")
    if reasons:
        print(
            "Blocked by the factory's no-destructive-actions rule: " + "; ".join(reasons) + ". "
            "Find a non-destructive way (add or edit instead of delete), or leave the ticket open "
            "with a comment asking a human to do this step.",
            file=sys.stderr,
        )
        sys.exit(2)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # never block on a hook bug
        print(f"block-destructive hook: {exc}", file=sys.stderr)
    sys.exit(0)
