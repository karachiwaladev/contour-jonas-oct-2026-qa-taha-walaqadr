# CLAUDE.md: Software Factory

We are building a **software factory**. Work arrives as GitHub issues ("Ticket #N") in this
repo, an agent loop picks each one up, does the work, and reports back on the issue.
Humans build and improve the loop; the loop builds the features.

## How to read this repo (progressive disclosure)

This file is the **base index** and the only file an agent must read first. Keep it short.

- Read this file, then open only the project folder your task touches.
- Each project folder has its own `README.md` (what and why) and, when needed, its own
  `CLAUDE.md` (how to work there). Load those only when you work in that folder.
- Put detail in the deepest file that needs it, never here.

## Rules for this file

- Keep it **under 100 lines at all times**. If an edit would push it over, move the detail
  into a project folder and link to it from here.
- The index below is the source of truth for which projects exist. Update it in the same
  commit that adds, renames or removes a project folder.
- One line per project in the index.

## Repository layout

```
CLAUDE.md                  <- you are here (base index)
README.md                  <- workshop info
.claude/settings.json      <- hooks config (Stop hook logs every prompt)
.claude/hooks/             <- hook scripts
.claude/prompts.jsonl      <- prompt log written by the Stop hook (JSONL)
.claude/skills/            <- factory skills (the ticket loop lives here)
projects/<project-name>/   <- one folder per project
  README.md                <- what the project is, status, owner
  CLAUDE.md                <- optional: project-specific agent instructions
```

## How the factory handles a ticket

1. Pick up each open issue.
2. React 👀 so people can see it has been picked up.
3. Do the work: answer a question in a comment, or make the change and push to `main`.
4. Comment with what was done (link the commit), then close the issue.
5. If a ticket is unclear or needs a human decision, leave it open with a comment saying
   what is needed.

## Adding a project

1. Create `projects/<project-name>/` (lowercase, hyphenated).
2. Add `projects/<project-name>/README.md` with a one-paragraph summary.
3. Add a row to the index below in the same commit.

## Index

| Project | Folder | Status | Summary |
| --- | --- | --- | --- |
| _(none yet)_ | - | - | Add the first project with the steps above. |

## Ground rules

- Training repo only: no real company code, no real keys or secrets.
- Push to `main`; only what is on GitHub counts.
