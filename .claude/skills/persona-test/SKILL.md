---
name: persona-test
description: Test a web app as different users would, using shoal personas (Nora, Kai, Sadie, Cathy, Dee, Lena…) and custom ones like Rob the security tester, in a real browser, with every finding re-checked. Use for "persona test", "run Rob", "shoal", "break my site", or when factory-loop calls it after verifying a build.
---

# persona-test

Acceptance checks prove the code does what the plan says. Personas find where **people** get stuck:
each one is a pretend user with a distinct goal, knowledge limit, patience and quirk, using the app
in character. This skill runs them against a local build and turns what they hit into findings.

## Inputs (all optional)

- **target**: a local URL or a project folder to serve. Default: the folder of the ticket being built.
- **personas**: ids, comma separated. Default: the set picked under *Choosing personas*.
- **task**: what the personas try to do. Default: the ticket's request, or "use the app's main flow".
- **file**: `tickets`, `pr` or `report`. Default: `report` (in chat); `pr` when factory-loop calls it.

## Personas

- **shoal library** (profiles, verbatim:
  https://github.com/Raynan00/shoal/blob/main/packages/core/personas/personas.yaml):
  ⚡ `speedrun-sam` · 🧐 `careful-carl` · 🌱 `newbie-nora` · 🌀 `chaos-cathy` · 🕵️ `skeptic-saul` ·
  ⌨️ `keyboard-kai` · 📱 `distracted-dee` · 🦯 `screenreader-sadie` (reads the accessibility tree,
  never pixels) · 📖 `literal-lena`.
- **custom**: `personas.yaml` next to this file. Currently 🕶️ `rob`, the security tester, with the
  `focus` checks he must always run.
- **strategies** (shoal's second axis: *what* the persona does): `complete-task`, `explore`,
  `adversarial-input`, `rage-quit`, `dark-patterns`, `state-breaker`. Pair them, e.g. Cathy +
  adversarial-input.

## Choosing personas

Called from factory-loop: run Nora, Kai, Sadie and Cathy on every build, plus whoever the change
touches: Rob for anything that stores, renders or parses input; Dee for filters and saved state;
Lena for new labels or copy; Saul or Carl for anything with money, sign-up or deletion. Called
directly: run what was asked, or all of them.

## Fast mode: Jev (default when a key is set)

`scripts/persona-run.mjs` follows quicke2e (https://github.com/dmoka/quicke2e): the Jev decision
model picks each persona's next move from moves code builds from the page (~0.3 s each), all typed
text comes from per-persona palettes, and code flags findings after every move: console errors,
focus dropped to the page (keyboard personas), probe markup turned into elements (Rob), sideways
scroll, getting stuck, and low-confidence picks. Personas run in parallel.

```bash
cd .claude/skills/persona-test/scripts && npm i   # once: playwright-core
node .claude/skills/persona-test/scripts/persona-run.mjs --base http://localhost:8001 \
  --personas newbie-nora,keyboard-kai,screenreader-sadie,chaos-cathy,rob --task "<the ticket's request>"
```

- **Key:** `OPENROUTER_API_KEY` or `JEV_API_KEY`, which the script reads itself from the environment or
  the repo's `.env` (git-ignored). Never read `.env`, print the key or pass it on a command line
  yourself. With no key, say so and use `--engine mock` (offline stand-in) or the manual run below.
- **Options:** `--steps 25`, `--out persona-report.json` (full trail), `--headed`, `--channel chrome`.
  Endpoint and model can be overridden with `JEV_URL` and `JEV_MODEL`.
- **Then still do steps 4–5 below**: the script's findings are leads. Re-check each one before reporting it.

## Run (manual, or to re-check fast-mode findings)

1. **Serve locally only.** `npx -y http-server <folder> -p 8001 -c-1 & echo $! > /tmp/persona.pid`, or
   the project's dev command. Never point personas at a production or third-party site.
2. **Each persona, in character.** Read its profile and act as that user in the built-in browser
   (screenshots for sighted personas; `read_page` for Sadie; keyboard only for Kai). Narrate in first
   person, stop at the persona's `patience_steps`, and note the moment something confuses, blocks,
   misleads or breaks. Rob also runs every `focus` check, scripted with Playwright where it's faster.
3. **Measure, don't guess.** Track focus with `document.activeElement` after each keyboard action,
   read the console after each step, and wait for the page to settle before judging a screenshot.
4. **Verify pass (required).** Reproduce every finding a second, independent way (a real click, a
   fresh profile, the stored data) before keeping it. Drop artefacts, such as a screenshot taken
   before the list re-rendered, and say how many you dropped.
5. **Stop the server:** `kill $(cat /tmp/persona.pid)`.

## Report

Group findings by cause and rank them: **bugs** (broken or data loss), then **security**, then
**friction**, then **wording**. Each one gets the persona(s) that hit it, exact steps, what happened,
what was expected, and a "Done when" checklist. Also list what held up, so passing areas are visible.

- `report`: post it in chat.
- `pr`: add a **Persona test** section to the ticket's PR. A finding that breaks the ticket's own
  acceptance checks is fixed before the PR opens; everything else becomes a new ticket.
- `tickets`: one issue per cause, titled `Todo <kind>: <what's wrong>`, body ending with which
  persona found it and which build. Never file duplicates: search open issues first.

## Real shoal (optional)

To run the actual swarm (https://github.com/Raynan00/shoal), shoal needs an `ANTHROPIC_API_KEY` or a
Claude Code sign-in at `~/.claude/.credentials.json` (`--provider subscription`). Never create, read,
copy or type keys or tokens yourself. If neither exists, run the personas yourself as above and say so.

## Guardrails

- Local builds only, harmless probes only: markers that are detected, never scripts that run.
- Never use real accounts, payment details or personal data in any field.
- Persona findings are leads, not proof of how real users behave. Say so in every report.
