#!/usr/bin/env node
// Fast persona runs for the persona-test skill.
//
// Pattern from quicke2e (https://github.com/dmoka/quicke2e): a small decision model, Jev, picks
// each move from a list of legal moves that code builds from the page; it never writes text.
// Typed values come from each persona's palette below; code decides what counts as a finding.
// One Jev decision is ~0.3 s, so a whole persona session takes seconds, not minutes.
//
//   node persona-run.mjs --base http://localhost:8001 --personas newbie-nora,keyboard-kai,rob \
//     --task "Add a task, find it with search and mark it done" [--steps 25] [--engine jev|mock]
//
// Key: OPENROUTER_API_KEY or JEV_API_KEY, from the environment or the repo's .env. It is only ever
// sent as the Authorization header to the Jev endpoint, and never printed or written to disk.
// Optional: JEV_URL (default OpenRouter's decisions endpoint), JEV_MODEL (default typesafe/jev-1.13).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split(/\s+--/).filter(Boolean)
  .map((a) => a.replace(/^--/, "")).map((a) => { const i = a.indexOf(" "); return i < 0 ? [a, true] : [a.slice(0, i), a.slice(i + 1).trim()]; }));
const BASE = args.base || "http://localhost:8001";
const TASK = args.task || "Use the app's main flow as you naturally would.";
const ENGINE = args.engine || "jev";
const MAX_STEPS = Number(args.steps) || 25;
const OUT = args.out || "persona-report.json";

// ---- key, without ever printing it --------------------------------------------------------------
function loadDotEnv() {
  let dir = process.cwd();
  while (dir && !fs.existsSync(path.join(dir, ".git"))) { const up = path.dirname(dir); if (up === dir) return; dir = up; }
  const file = path.join(dir, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?(OPENROUTER_API_KEY|JEV_API_KEY|JEV_URL|JEV_MODEL)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadDotEnv();
const KEY = process.env.JEV_API_KEY || process.env.OPENROUTER_API_KEY;
const JEV_URL = process.env.JEV_URL || "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = process.env.JEV_MODEL || "typesafe/jev-1.13";
if (ENGINE === "jev" && !KEY) {
  console.error("No Jev key: set OPENROUTER_API_KEY or JEV_API_KEY in your environment or the repo's .env, or use --engine mock.");
  process.exit(2);
}

// ---- personas -----------------------------------------------------------------------------------
// Short summaries of shoal's personas (full profiles: shoal/packages/core/personas/personas.yaml).
// Jev reads ~1,024 tokens per decision, so profiles stay short.
const SHOAL = {
  "speedrun-sam": ["mouse", "Impatient and tech-savvy. Skims, clicks the most prominent button at once, gives up if something doesn't respond."],
  "careful-carl": ["mouse", "Methodical and risk-averse. Reads every label, double-checks fields, won't click anything ambiguous."],
  "newbie-nora": ["mouse", "Rarely uses computers, doesn't know web conventions, looks for literal words that match the goal."],
  "chaos-cathy": ["mouse", "Clicks in unexpected orders, double-submits, uses unusual values, revisits steps; not malicious."],
  "skeptic-saul": ["mouse", "Assumes the site is tricking them; hunts for hidden costs and pre-checked options before committing."],
  "keyboard-kai": ["keyboard", "Uses only the keyboard: Tab, Shift+Tab, Enter, Space, Escape and arrow keys. Never the mouse."],
  "distracted-dee": ["mouse", "Multitasking and half paying attention; forgets the step, repeats things, needs clear state."],
  "screenreader-sadie": ["a11y", "Blind; uses a screen reader and keyboard. Knows only roles and names that are announced."],
  "literal-lena": ["mouse", "Takes every label literally; a button must do exactly what its words say."],
};
// Custom personas from ../personas.yaml (id, name, modality, profile). Tiny parser for that file's shape.
function customPersonas() {
  const file = new URL("../personas.yaml", import.meta.url);
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const block of fs.readFileSync(file, "utf8").split(/\n\s*-\s+id:\s*/).slice(1)) {
    const id = block.split("\n")[0].trim();
    const profile = (block.match(/profile:\s*>\s*\n([\s\S]*?)\n\s{4}\w+:/) || [])[1]?.replace(/\s+/g, " ").trim() || "";
    const modality = (block.match(/modality:\s*(\w+)/) || [])[1];
    out[id] = [modality === "a11y" ? "a11y" : modality === "keyboard" ? "keyboard" : "mouse", profile];
  }
  return out;
}
const PERSONAS = { ...SHOAL, ...customPersonas() };
// Text each persona types. Jev chooses WHERE to type; code chooses WHAT.
const PALETTES = {
  default: ["Call the doctor tomorrow", "Buy milk", "work, home"],
  "chaos-cathy": ["   ", "🔥 émoji ünïcode", "x".repeat(300), "a,,b, ,c", "Buy milk"],
  rob: ['<b data-probe>probe</b>', '"><i data-probe>x</i>', "'><span data-probe></span>", "Buy milk"],
};

// ---- engine ---------------------------------------------------------------------------------------
const RULES = "Choose the one move this person would make next on this page, in character. " +
  "Pick DONE only when the task is visibly complete. Pick GIVEUP if this person would give up now.";
async function jev(state, criteria, goal) {
  const body = { model: JEV_MODEL, state, questions: { action: { type: "choice", criteria, instructions: { goal, rules: RULES } } } };
  for (let k = 0; ; k++) {
    const res = await fetch(JEV_URL, { method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(body) })
      .catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
    if (res.ok) {
      const r = await res.json();
      return { choice: r.answers.action.choice, confidence: r.answers.action.confidence ?? 1, cost: r.usage?.cost || 0 };
    }
    if (k < 3 && (res.status === 0 || res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 400 * 2 ** k)); continue; }
    // Never echo the request (it carries the key in its headers); the body text is the server's.
    throw Object.assign(new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`), { engine: true });
  }
}
// Offline stand-in: prefers moves it hasn't made yet, fills before clicking, finishes after a while.
function mock(state, criteria, goal, tried) {
  // Keyboard stand-in: focus the first field, add two items, then Tab along and tick each checkbox it meets.
  const opening = ["KEY:Tab", "TYPE", "KEY:Enter", "TYPE", "KEY:Enter"];
  if (criteria["KEY:Tab"]) return { choice: state.step >= MAX_STEPS - 1 ? "DONE"
    : opening[state.step - 1] || (/\[checkbox\]/.test(state.focused) && state.history.at(-1) !== "KEY:Space" ? "KEY:Space" : "KEY:Tab"),
    confidence: 0.9, cost: 0 };
  const keys = Object.keys(criteria).filter((k) => k !== "DONE" && k !== "GIVEUP");
  const fresh = keys.filter((k) => !tried.has(k));
  const pick = state.step >= MAX_STEPS - 2 ? "DONE" : (fresh.find((k) => k.startsWith("FILL")) || fresh[0] || keys[state.step % keys.length] || "DONE");
  return { choice: pick, confidence: fresh.length ? 0.9 : 0.4, cost: 0 };
}

// ---- page -> state and legal moves ----------------------------------------------------------------
const SNAP = () => {
  const visible = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[hidden]"); };
  const name = (el) => (el.getAttribute("aria-label") || el.labels?.[0]?.textContent || el.placeholder ||
    el.textContent || el.title || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const els = [...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]")]
    .filter((e) => visible(e) && !e.disabled).slice(0, 40);
  document.querySelectorAll("[data-pid]").forEach((e) => e.removeAttribute("data-pid"));
  const a = document.activeElement;
  return {
    elements: els.map((e, i) => {
      e.setAttribute("data-pid", i);
      const type = e.tagName === "INPUT" ? e.type : e.tagName.toLowerCase();
      return { i, r: type, l: name(e), ...(e.type === "checkbox" ? { v: e.checked ? "checked" : "unchecked" } : {}),
        ...(e.tagName === "SELECT" ? { o: [...e.options].slice(0, 6).map((o) => o.text), v: e.selectedOptions[0]?.text } : {}),
        ...(e === a ? { f: 1 } : {}) };
    }),
    focused: a === document.body ? "nothing (page)" : `${a.tagName.toLowerCase()}${a.type ? `[${a.type}]` : ""} ${name(a)}`.trim(),
    text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
    probes: document.querySelectorAll("[data-probe]").length,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    hash: document.body.innerHTML.length + ":" + document.body.innerText.length,
    bodyFocused: a === document.body || a === null,
  };
};
function moves(snap, modality) {
  const c = { DONE: "I have finished the task", GIVEUP: "I am stuck or fed up and would leave now" };
  if (modality !== "mouse") {
    for (const k of ["Tab", "Shift+Tab", "Enter", "Space", "Escape", "ArrowDown", "ArrowUp"]) c[`KEY:${k}`] = `press ${k}`;
    c.TYPE = "type text into the focused field";
    return c;
  }
  for (const e of snap.elements) {
    if (/^(text|search|email|textarea|date)$/.test(e.r)) c[`FILL:${e.i}`] = `type into ${e.r} "${e.l}"`;
    else if (e.r === "select") (e.o || []).forEach((o, j) => { c[`SELECT:${e.i}:${j}`] = `choose "${o}" in "${e.l}"`; });
    else c[`CLICK:${e.i}`] = `click ${e.r} "${e.l}"${e.v ? ` (${e.v})` : ""}`;
  }
  return c;
}

// ---- one persona session --------------------------------------------------------------------------
async function runPersona(browser, id) {
  const [modality, profile] = PERSONAS[id] || ["mouse", id];
  const palette = PALETTES[id] || PALETTES.default;
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE);
  const goal = `${profile} Task: ${TASK}`.slice(0, 600);
  const findings = [], trail = [], tried = new Set();
  let typed = 0, cost = 0, outcome = "PATIENCE", repeat = 0, lastMove = "", lastHash = "";
  const t0 = Date.now();
  const find = (kind, step, text) => { if (!findings.some((f) => f.kind === kind && f.text === text)) findings.push({ kind, step, text }); };

  for (let step = 1; step <= MAX_STEPS; step++) {
    const snap = await page.evaluate(SNAP);
    const criteria = moves(snap, modality);
    const state = { step, url: new URL(page.url()).pathname, focused: snap.focused, history: trail.slice(-5).map((t) => t.move),
      ...(modality === "mouse" ? { elements: snap.elements, text: snap.text } : { focused_detail: snap.focused }) };
    if (modality === "a11y") state.announced = (await page.accessibility.snapshot({ interestingOnly: true }))?.children
      ?.slice(0, 40).map((n) => `${n.role} ${n.name || "(no name)"}`) || [];
    const ts = Date.now();
    let d;
    try { d = ENGINE === "mock" ? mock(state, criteria, goal, tried) : await jev(state, criteria, goal); }
    catch (e) { outcome = "ENGINE_ERROR"; find("engine", step, e.message); break; }
    cost += d.cost;
    const move = String(d.choice);
    tried.add(move);
    trail.push({ step, move, what: criteria[move] || move, confidence: Number(d.confidence.toFixed?.(2) ?? d.confidence), ms: Date.now() - ts });
    if (d.confidence < 0.3) find("hesitation", step, `unsure what to do next (confidence ${d.confidence.toFixed(2)}) at: ${snap.focused}`);
    if (move === "DONE") { outcome = "DONE"; break; }
    if (move === "GIVEUP") { outcome = "GIVEUP"; find("friction", step, `gave up after: ${trail.slice(-3, -1).map((t) => t.what).join(" → ")}`); break; }

    const wasFocused = !snap.bodyFocused;
    try {
      const [kind, a, b] = move.split(":");
      const el = () => page.locator(`[data-pid="${a}"]`);
      if (kind === "CLICK") await el().click({ timeout: 2000 });
      else if (kind === "FILL") {
        // Date fields take a real date (tomorrow), never palette text: browsers reject anything else.
        const isDate = (await el().getAttribute("type")) === "date";
        const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
        await el().fill(isDate ? tomorrow : palette[typed++ % palette.length], { timeout: 2000 });
        if (!isDate) await el().press("Enter");
      }
      else if (kind === "SELECT") await el().selectOption({ index: Number(b) }, { timeout: 2000 });
      else if (kind === "KEY") await page.keyboard.press(a);
      else if (move === "TYPE") await page.keyboard.type(palette[typed++ % palette.length]);
      else { find("engine", step, `unknown move ${move}`); continue; }
    } catch (e) { find("friction", step, `${criteria[move]} failed: ${e.message.split("\n")[0]}`); }
    await page.waitForTimeout(250);

    const after = await page.evaluate(SNAP);
    if (errors.length) find("bug", step, `console error after "${criteria[move]}": ${errors.splice(0).join(" | ").slice(0, 200)}`);
    // Report what THIS move caused, not a state that was already there.
    if (after.probes > snap.probes) find("security", step, `typed markup became ${after.probes - snap.probes} page element(s) after "${criteria[move]}"`);
    if (after.overflow && !snap.overflow) find("friction", step, `page scrolls sideways after "${criteria[move]}"`);
    if (modality !== "mouse" && wasFocused && after.bodyFocused && !/Escape|Tab/.test(move))
      find("bug", step, `keyboard focus dropped to the page after "${criteria[move]}" (was on ${snap.focused})`);
    // Progress includes focus: Tab changes where you are without changing the page.
    const where = `${after.hash}|${after.focused}`;
    repeat = move === lastMove && where === lastHash ? repeat + 1 : 0;
    lastMove = move; lastHash = where;
    if (repeat >= 3) { outcome = "STUCK"; find("friction", step, `stuck repeating "${criteria[move]}" with nothing changing`); break; }
  }
  await context.close();
  return { persona: id, modality, outcome, steps: trail.length, seconds: (Date.now() - t0) / 1000, cost, findings, trail };
}

// ---- run all personas in parallel ----------------------------------------------------------------
const ids = String(args.personas || "newbie-nora,keyboard-kai,screenreader-sadie,chaos-cathy").split(",").map((s) => s.trim());
const unknown = ids.filter((id) => !PERSONAS[id]);
if (unknown.length) { console.error(`Unknown persona(s): ${unknown.join(", ")}. Known: ${Object.keys(PERSONAS).join(", ")}`); process.exit(2); }
const channel = args.channel || (process.platform === "win32" ? "msedge" : "chrome");
const browser = await chromium.launch({ channel, headless: !args.headed }).catch(() => chromium.launch({ headless: !args.headed }));
const t0 = Date.now();
const results = await Promise.all(ids.map((id) => runPersona(browser, id)));
await browser.close();

const report = { engine: ENGINE === "jev" ? `${JEV_MODEL} @ ${new URL(JEV_URL).host}` : "mock", base: BASE, task: TASK,
  seconds: (Date.now() - t0) / 1000, cost: results.reduce((s, r) => s + r.cost, 0), results };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
const RANK = { security: 0, bug: 1, friction: 2, hesitation: 3, engine: 4 };
console.log(`persona-run · ${report.engine} · ${ids.length} personas in ${report.seconds.toFixed(1)} s · $${report.cost.toFixed(5)}`);
for (const r of results) {
  console.log(`\n${r.persona} (${r.modality}): ${r.outcome} in ${r.steps} steps, ${r.seconds.toFixed(1)} s`);
  for (const f of [...r.findings].sort((a, b) => RANK[a.kind] - RANK[b.kind])) console.log(`  [${f.kind}] step ${f.step}: ${f.text}`);
  if (!r.findings.length) console.log("  no findings");
}
console.log(`\nFull trail: ${OUT}. Findings are leads: re-check each one before reporting it.`);
