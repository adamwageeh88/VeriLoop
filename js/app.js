/*
 * VeriLoop prototype — interaction logic.
 *
 * The assistant and sandbox are SIMULATED from js/scenarios.js. What is real
 * is the interaction: the order in which evidence appears, what the person
 * can inspect, and which decisions they can make, stop and undo.
 *
 * Initiative rule (after Horvitz, 1999; Lecture 03):
 *   - Running checks on an isolated copy is cheap and reversible -> the
 *     system ACTS (checks start automatically). The person can stop them.
 *   - Automatic self-revision after a failed test is bounded by a user
 *     setting -> the system acts only within the limit the person set,
 *     and the person can stop it.
 *   - Applying to the working codebase is costly -> the system ASKS and
 *     never applies on its own.
 *   - When the assistant cannot verify what was asked (e.g. speed), it
 *     DECLINES to claim it and asks before continuing (Lecture 07).
 */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * (state.settings.speed === "fast" ? 0.35 : 1)));
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const clock = () => new Date().toTimeString().slice(0, 5);

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  const state = {
    condition: "evidence",            // "evidence" | "baseline"
    settings: null,                   // filled from SETTING_DEFAULTS and the browser's saved choices
    study: null,                      // participant session {pid, view, started} — hides researcher controls
    scenario: null,
    versionId: null,
    phase: "home",                    // home | idle | generating | clarify | verifying | report | nocheck | decided
    history: [],
    autoRevisions: 0,
    autoPending: false,               // waiting to start an automatic retry (can be stopped)
    pendingVerify: null,              // {kind, auto} for re-running stopped checks
    decisionStart: null,
    inspected: 0,                     // evidence inspections since the last decision (study measure)
    sandboxFiles: new Set(),
    integrated: [],
    log: [],
    runToken: 0,
    res: {},                          // per-proposal resolutions: "version:itemId" -> {...}
    rules: {},                        // remembered rules the person set: key -> {text, label, setIn, at, q}
    reviseOverride: null,
    openItems: new Set(), openFor: null, openSeeded: false
  };


  const baseline = () => state.condition === "baseline";

  /* ------------------------------------------------------------------ */
  /* Settings: appearance and accessibility are the person's own; behaviour */
  /* settings change what the system does and are fixed during a study session */
  /* ------------------------------------------------------------------ */
  const SETTING_DEFAULTS = {
    theme: "dark", textSize: "m", contrast: "normal", palette: "standard", density: "comfortable", motion: "system",
    wrapCode: false, expandAll: false,
    autoCheck: true, selfRevise: 1, confirmRisky: true,
    shortcuts: true, speed: "normal"
  };
  const BEHAVIOUR = ["autoCheck", "selfRevise", "confirmRisky", "expandAll"];
  const SETTINGS_KEY = "veriloop-settings-v1";
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); } catch (e) { saved = {}; }
    return Object.assign({}, SETTING_DEFAULTS, saved);
  }
  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) { /* storage unavailable */ }
  }
  const systemDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const systemReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function applySettings() {
    const s = state.settings, root = document.documentElement;
    const theme = s.theme === "system" ? (systemDark && !systemDark.matches ? "light" : "dark") : s.theme;
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-text", s.textSize);
    root.setAttribute("data-contrast", s.contrast);
    root.setAttribute("data-palette", s.palette);
    root.setAttribute("data-density", s.density);
    root.setAttribute("data-wrap", s.wrapCode ? "on" : "off");
    const reduce = s.motion === "reduce" || (s.motion === "system" && systemReduce && systemReduce.matches);
    root.setAttribute("data-motion", reduce ? "reduce" : "full");
  }
  if (systemDark && systemDark.addEventListener) systemDark.addEventListener("change", () => state.settings.theme === "system" && applySettings());
  if (systemReduce && systemReduce.addEventListener) systemReduce.addEventListener("change", () => state.settings.motion === "system" && applySettings());
  state.settings = loadSettings();
  applySettings();

  // Screen-reader announcements for results that arrive without the person's focus moving
  function announce(text) {
    const el = $("#sr-status");
    el.textContent = "";
    setTimeout(() => (el.textContent = text), 50);
  }

  // Tasks shown to the person: in a participant session, the session's own order (practice first); otherwise every non-practice task
  function taskList() {
    if (state.study) return state.study.order.map((id) => SCENARIOS.find((s) => s.id === id));
    return SCENARIOS.filter((s) => !s.practice);
  }
  const isDone = (id) => !!(state.study && state.study.done.includes(id));
  function nextTask() { return state.study ? state.study.order.find((id) => !state.study.done.includes(id)) : null; }
  // Unlocked = the next unfinished task (sessions run in a fixed order); outside sessions everything is open
  const isLocked = (id) => !!(state.study && id !== nextTask());

  // Seeded shuffle so each participant ID always gets the same task order (mulberry32)
  function seededOrder(ids, seedText) {
    let h = 1779033703 ^ seedText.length;
    for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    const rand = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const out = ids.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  function version(id = state.versionId) {
    const v = state.scenario.versions[id];
    if (v && v.sameAs) {
      const base = state.scenario.versions[v.sameAs];
      return Object.assign({}, base, v, { assistant: base.assistant, diff: base.diff });
    }
    return v;
  }
  const filesOf = (v) => v.diff.map((f) => f.file);
  const claimText = (v, cid) => (v.assistant.claims.find((x) => x.id === cid) || { text: cid }).text;

  /* ------------------------------------------------------------------ */
  /* Evidence after the person's resolutions and remembered rules        */
  /* ------------------------------------------------------------------ */
  const resKey = (id) => state.versionId + ":" + id;

  // If the person has already set a rule that answers this item's question, use it (Lecture 10: the correction survives)
  function ruleAnswer(e) {
    for (const opt of e.resolve || []) {
      if (opt.kind !== "answer") continue;
      for (const o of opt.options) {
        if (o.rule && state.rules[o.rule.key] && state.rules[o.rule.key].text === o.rule.text) return { o, key: o.rule.key };
      }
    }
    return null;
  }

  function effective(v) {
    const ver = v.verification;
    const out = { checked: ver.verified.slice(), failed: (ver.failed || []).slice(), unresolved: [], inconclusive: [], accepted: [], changed: false };
    const route = (list, bucket) => list.forEach((e) => {
      const r = state.res[resKey(e.id)];
      const ra = r ? null : ruleAnswer(e);
      if (!r && !ra) { out[bucket].push(e); return; }
      out.changed = true;
      if (r && r.status === "accepted") { out.accepted.push(Object.assign({}, e, { note: r.note, fromId: e.id, accepted: true })); return; }
      const src = r || { status: ra.o.result, evidence: ra.o.evidence, reviseTo: ra.o.reviseTo, hint: ra.o.hint };
      out[src.status === "checked" ? "checked" : "failed"].push(Object.assign(
        { id: e.id + "-res", fromId: e.id, resolved: true, reviseTo: src.reviseTo, hint: src.hint, fromRule: ra ? ra.key : null }, src.evidence));
    });
    route(ver.unresolved || [], "unresolved");
    route(ver.inconclusive || [], "inconclusive");
    return out;
  }

  function assess(v, ev) {
    if (!ev.changed) return v.verification.assessment;
    if (ev.failed.length) return { level: "blocked", text: `${plural(ev.failed.length, "check")} failed. Ask for a revision or reject this proposal.` };
    const serious = ev.unresolved.filter((u) => u.severity !== "low");
    if (serious.length) return { level: "caution", text: `${plural(serious.length, "risk")} still need${serious.length === 1 ? "s" : ""} your judgement.` };
    if (ev.unresolved.length || ev.inconclusive.length) return { level: "review", text: "Only minor open items remain." };
    if (ev.accepted.length) return { level: "review", text: `Nothing is left open. You accepted ${plural(ev.accepted.length, "risk")} yourself.` };
    return { level: "low", text: "Everything open has been resolved. The evidence now covers the change." };
  }

  /* ------------------------------------------------------------------ */
  /* Progress steps (the baseline has no checking step)                  */
  /* ------------------------------------------------------------------ */
  function setPhase(p) {
    state.phase = p;
    // Once a decision is made, evidence actions can no longer change it
    if (p === "decided") $$("#evidence .item-actions, #evidence .start-here button").forEach((el) => el.remove());
    const current = { home: 1, idle: 1, generating: 2, clarify: 2, verifying: 3, report: 4, nocheck: 4, decided: 5 }[p];
    $$("#steps li").forEach((li) => {
      const n = Number(li.dataset.step);
      li.classList.toggle("hidden", baseline() && n === 3);
      li.querySelector(".n").textContent = baseline() && n === 4 ? "3" : String(n);
      li.classList.toggle("done", n < current);
      li.classList.toggle("current", n === current || (baseline() && current === 3 && n === 4));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar                                                             */
  /* ------------------------------------------------------------------ */
  function renderScenarioList() {
    $("#scenario-list").innerHTML = taskList().map((s, i) => {
      const done = isDone(s.id);
      const cls = [state.scenario && state.scenario.id === s.id ? "active" : "", done ? "done" : ""].join(" ");
      const label = state.study ? `${i + 1}. ${esc(s.title)}${done ? " <span class=\"tick\">✓</span>" : ""}` : esc(s.title);
      return `<li><button data-scenario="${s.id}" class="${cls}" ${done || isLocked(s.id) ? "disabled" : ""}>${label}</button></li>`;
    }).join("");
  }

  function renderFiles() {
    const integratedFiles = new Set();
    state.integrated.filter((c) => !c.undone).forEach((c) => c.files.forEach((f) => integratedFiles.add(f)));
    if (!$("#file-tree")) return;   // the file list was removed; the diff names the changed files
    $("#file-tree").innerHTML = REPO.files.map((f) => {
      let mark = "";
      if (integratedFiles.has(f.path)) mark = `<span class="mark integrated" title="Changed in your code">M</span>`;
      else if (!baseline() && state.sandboxFiles.has(f.path)) mark = `<span class="mark sandbox" title="Changed in the test copy only">S</span>`;
      return `<li class="${mark ? "touched" : ""}"><span>${esc(f.path)}</span>${mark}</li>`;
    }).join("");
  }

  function renderWorkspace() {
    const active = state.integrated.filter((c) => !c.undone);
    const st = $("#workspace-status");
    st.textContent = active.length ? `Your code: ${plural(active.length, "change")} applied` : "Your code: unchanged";
    $("#btn-code").classList.toggle("changed", active.length > 0);
    $("#cp-empty").classList.toggle("hidden", state.integrated.length > 0);
    $("#checkpoints").innerHTML = (active.length > 1 ? `<li class="cp-all"><button class="link-btn" data-view-all>View all changes to your code</button></li>` : "") +
      state.integrated.map((c) => {
        const st = diffStats(c.diff);
        return `<li class="${c.undone ? "undone" : ""}">
          <span class="cp-main"><span class="cp-title">${esc(c.title)}</span>
            <span class="cp-meta">${c.undone ? `Undone at ${esc(c.undoneAt)}` : `Applied at ${esc(c.at)}`}, <b class="plus">+${st.add}</b> <b class="minus">−${st.del}</b></span></span>
          <span class="cp-acts"><button data-view-cp="${c.id}">View changes</button>${c.undone ? "" : `<button data-undo="${c.id}">Undo</button>`}</span></li>`;
      }).join("");
    renderFiles();
  }

  function diffStats(diff) {
    let add = 0, del = 0;
    diff.forEach((f) => f.hunks.forEach((h) => h.lines.forEach((l) => { if (l[0] === "+") add++; if (l[0] === "-") del++; })));
    return { add, del };
  }

  // Read-only rendering of a change, used for what was applied to the person's code
  function diffBlock(diff) {
    return diff.map((f) => `<div class="diff-file-name">${esc(f.file)}</div>` + f.hunks.map((h) => `<div class="hunk">${esc(h.header)}</div>` +
      h.lines.map(([sign, o, n, code]) => `<div class="dl ${sign === "+" ? "add" : sign === "-" ? "del" : ""}"><span class="gut"></span><span class="no">${o ?? ""}</span><span class="no">${n ?? ""}</span><span class="sign">${sign === " " ? "" : sign}</span><span class="code">${esc(code)}</span></div>`).join("")).join("")).join("");
  }

  function evidenceSummary(e, how) {
    const howText = how.includes("despite") ? "Applied despite open problems." : how.includes("no checks") ? "" : "";
    return `<div class="cp-evidence verdict ${e.level}">
      <p class="eyebrow-line">Evidence when it was applied</p>
      <h3><span class="dot" aria-hidden="true"></span>${esc(e.title)}</h3>
      <p class="verdict-text">${esc(e.text)} ${howText}</p>
      ${e.counts ? `<p class="evkey"><span><b>${e.counts.checked}</b> checked</span><span><b>${e.counts.failed}</b> failed</span><span><b>${e.counts.unresolved}</b> unresolved</span></p>` : ""}
      ${e.open && e.open.length ? `<ul class="cp-list">${e.open.map((o) => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      ${e.accepted && e.accepted.length ? `<p class="cp-sub">Risks you accepted:</p><ul class="cp-list">${e.accepted.map((a) => `<li>${esc(a.title)}${a.note ? ` (your note: ${esc(a.note)})` : ""}</li>`).join("")}</ul>` : ""}
    </div>`;
  }

  function changeSection(c, full) {
    const st = diffStats(c.diff);
    return `<section class="cp-view${c.undone ? " is-undone" : ""}" data-cp="${c.id}">
      <div class="cp-head">
        <div><p class="eyebrow-line">${esc(c.task)}</p><h3 class="cp-h">${esc(c.label)}</h3>
          <p class="cp-meta">${c.undone ? `Applied at ${esc(c.at)} and undone at ${esc(c.undoneAt)}. Your code no longer includes this change` : `Applied at ${esc(c.at)}`}. ${plural(c.files.length, "file")}, <b class="plus">+${st.add}</b> <b class="minus">−${st.del}</b>.</p></div>
        ${c.undone ? "" : `<button class="btn" data-undo="${c.id}">Undo this change</button>`}
      </div>
      ${full ? `<p class="cp-summary">${esc(c.summary)}</p>${evidenceSummary(c.evidence, c.how)}` : ""}
      <div class="diff static">${diffBlock(c.diff)}</div>
    </section>`;
  }

  function openChange(cpId) {
    const c = state.integrated.find((x) => x.id === cpId);
    if (!c) return;
    closeMenu();
    state.inspected++;
    openModal(`<h2 id="modal-title" data-wide>What changed in your code</h2>
      ${changeSection(c, true)}
      <div class="modal-actions"><button class="btn primary" data-modal="cancel">Close</button></div>`);
  }

  function openAllChanges() {
    closeMenu();
    const active = state.integrated.filter((c) => !c.undone);
    const files = [...new Set(active.flatMap((c) => c.files))];
    openModal(`<h2 id="modal-title" data-wide>All changes to your code</h2>
      <p>${plural(active.length, "change")} applied, touching ${plural(files.length, "file")}: <span class="mono">${files.map(esc).join(", ")}</span>. Oldest first.</p>
      ${active.map((c) => changeSection(c, false)).join("")}
      <div class="modal-actions"><button class="btn primary" data-modal="cancel">Close</button></div>`);
  }

  // Lecture 10: what the system holds is inspectable, editable and forgettable, in the person's words
  function renderRules() {
    const keys = Object.keys(state.rules);
    $("#rules-panel").classList.toggle("hidden", baseline() || !keys.length);
    $("#rules").innerHTML = keys.length
      ? keys.map((k) => {
          const r = state.rules[k];
          return `<li><span class="rule-text">${esc(r.text)}</span><span class="rule-meta">Set ${esc(r.at)} in ${esc(r.setIn)}. Sent to the assistant with every request.</span>
            <span class="rule-acts"><button data-rule-edit="${k}">Change</button><button data-rule-forget="${k}">Forget</button></span></li>`;
        }).join("")
      : `<li class="rules-empty">None yet. When you answer a question about how your code should behave, it is kept here and reused.</li>`;
  }

  /* ------------------------------------------------------------------ */
  /* Start screen                                                        */
  /* ------------------------------------------------------------------ */
  function renderHome() {
    state.runToken++;
    state.scenario = null;
    setPhase("home");
    setCrumb("");
    $(".centre").classList.add("home");
    $("#diff").classList.add("hidden");
    $("#composer").classList.add("hidden");
    const intro = baseline()
      ? `<h1>Review AI code changes</h1><p class="lede">Ask the assistant for a change, read what it proposes, and decide whether to apply it.</p>`
      : `<h1>Review AI code changes with evidence</h1><p class="lede">Each change the assistant proposes is tested on a copy of your project first. You see what passed, what failed and what has not been checked, then decide.</p>`;
    const tasks = taskList();
    $("#thread").innerHTML = `
      <div class="start">${intro}
        <div class="task-list-head"><h2>${state.study ? "Your tasks" : "Tasks"}</h2>${state.study ? `<span class="muted">${state.study.done.length} of ${state.study.order.length} done</span>` : ""}</div>
        <ul class="task-rows">${tasks.map((s, i) => {
          const done = isDone(s.id), locked = isLocked(s.id);
          return `<li><button class="task-row${done ? " done" : ""}" data-scenario="${s.id}" ${done || locked ? "disabled" : ""}>
            <span class="num">${i + 1}</span>
            <span class="txt"><span class="t">${esc(s.title)}</span><span class="d">${esc(s.blurb)}</span></span>
            <span class="go">${done ? "Done" : locked ? "Locked" : "Open"}</span>
          </button></li>`;
        }).join("")}</ul>
      </div>`;
    panelPlaceholder();
    renderScenarioList();
  }

  function setCrumb(text) { $("#crumb").textContent = text; $("#btn-tasks").classList.toggle("hidden", !text); }

  function panelPlaceholder() {
    const text = baseline() ? "The assistant's report appears here once it proposes a change." : "Results of testing a proposed change appear here.";
    $("#evidence").innerHTML = `<div class="ev-scroll"><div class="placeholder"><p>${text}</p></div>${baseline() ? "" : `<div class="groups">${capabilityHtml(false)}</div>`}</div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Thread                                                              */
  /* ------------------------------------------------------------------ */
  function addMsg(role, html) {
    const who = { user: "You", assistant: "Assistant (simulated)", system: "VeriLoop" }[role];
    const av = { user: "Y", assistant: "AI", system: "✓" }[role];
    const el = document.createElement("div");
    el.className = `msg ${role}`;
    el.innerHTML = `<div class="avatar">${av}</div><div><div class="who">${role === "system" && baseline() ? "System" : who}</div><div class="body">${html}</div></div>`;
    $("#thread").appendChild(el);
    $("#thread").scrollTop = $("#thread").scrollHeight;
    return el;
  }
  function assistantHtml(v) {
    return `<div>${esc(v.assistant.summary)}</div>
      <div class="claims-h">The assistant says:</div>
      <ul class="claims">${v.assistant.claims.map((c) => `<li>${esc(c.text)}</li>`).join("")}</ul>`;
  }
  // Context the assistant receives is shown when it is used (Lecture 10)
  function noteRulesSent() {
    const keys = Object.keys(state.rules);
    if (!keys.length || baseline()) return;
    addMsg("system", `Sent with your request: ${plural(keys.length, "rule")} you set — ${keys.map((k) => `“${esc(state.rules[k].text)}”`).join(", ")}.`);
  }

  /* ------------------------------------------------------------------ */
  /* Diff                                                                */
  /* ------------------------------------------------------------------ */
  function tagStatus(v) {
    const map = {};
    const rank = { ok: 1, warn: 2, bad: 3 };
    const put = (tag, s) => { if (tag && (!map[tag] || rank[s] > rank[map[tag]])) map[tag] = s; };
    if (v.verification.error || state.phase === "nocheck") return map;
    const ev = effective(v);
    ev.checked.forEach((e) => put(e.highlight, "ok"));
    ev.unresolved.forEach((e) => put(e.highlight, "warn"));
    ev.failed.forEach((e) => put(e.highlight, "bad"));
    return map;
  }

  function renderDiff(v, where) {
    const box = $("#diff");
    box.classList.remove("hidden");
    const showMarks = !baseline() && state.phase !== "verifying" && state.phase !== "nocheck";
    const marks = showMarks ? tagStatus(v) : {};
    let whereHtml;
    if (where === "integrated") whereHtml = `<span class="where integrated">Applied to your code</span>`;
    else if (baseline()) whereHtml = `<span class="where neutral">Not applied</span>`;   // no hint of a test copy in the baseline
    else whereHtml = `<span class="where sandbox">Test copy only</span>`;
    const legend = showMarks && Object.keys(marks).length
      ? `<span class="legend"><span><i style="background:var(--checked)"></i>Checked</span><span><i style="background:var(--unresolved)"></i>Unresolved</span><span><i style="background:var(--failed)"></i>Failed</span></span>`
      : "";
    const adds = v.diff.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter((l) => l[0] === "+").length, 0), 0);
    const dels = v.diff.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.filter((l) => l[0] === "-").length, 0), 0);
    let html = `<div class="diff-head"><span class="title">${esc(v.label)}</span><span class="stat">${plural(v.diff.length, "file")} <b class="plus">+${adds}</b> <b class="minus">−${dels}</b></span>${legend}${whereHtml}</div>`;
    v.diff.forEach((f) => {
      html += `<div class="diff-file-name">${esc(f.file)}</div>`;
      f.hunks.forEach((h) => {
        html += `<div class="hunk">${esc(h.header)}</div>`;
        h.lines.forEach(([sign, o, n, code, tag]) => {
          const cls = sign === "+" ? "add" : sign === "-" ? "del" : "";
          const m = tag && marks[tag] ? `mark-${marks[tag]}` : "";
          html += `<div class="dl ${cls} ${m}" ${tag ? `data-tag="${tag}"` : ""}><span class="gut"></span><span class="no">${o ?? ""}</span><span class="no">${n ?? ""}</span><span class="sign">${sign === " " ? "" : sign}</span><span class="code">${esc(code)}</span></div>`;
        });
      });
    });
    box.innerHTML = html;
  }

  function flashTag(tag) {
    if (!tag) return;
    const lines = $$(`#diff .dl[data-tag="${tag}"]`);
    if (!lines.length) return;
    lines[0].scrollIntoView({ block: "center", behavior: "smooth" });
    lines.forEach((l) => l.classList.add("flash"));
    setTimeout(() => lines.forEach((l) => l.classList.remove("flash")), 1800);
  }

  /* ------------------------------------------------------------------ */
  /* Evidence panel                                                      */
  /* ------------------------------------------------------------------ */
  const STAGES = {
    standard: [
      ["Copy the project to a test area", 450],
      ["Apply the proposed change", 350],
      ["Run your existing tests", 1100],
      ["Write and run tests for the new behaviour", 900],
      ["Find other code that uses what changed", 500],
      ["Re-run any failures on the original code", 500]
    ],
    targeted: [
      ["Copy the project to a test area", 400],
      ["Apply the proposed change", 300],
      ["Run your existing tests", 900],
      ["Run tests for the new behaviour", 600],
      ["Compare old and new behaviour on 40 inputs", 1200],
      ["Find other code that uses what changed", 400]
    ],
    install: [
      ["Copy the project to a test area", 400],
      ["Apply the proposed change", 300],
      ["Install the new library version", 1600],
      ["Run your existing tests", 900],
      ["Write and run tests for the new behaviour", 700],
      ["Find other code that uses what changed", 400]
    ]
  };

  function evidenceShell(inner, decide = "") {
    $("#evidence").innerHTML = `<div class="ev-scroll">${inner}</div>${decide}`;
  }

  // Returns "done", "error" or "cancelled"
  async function runStages(kind, token, errorAt) {
    const stages = STAGES[kind];
    const v = version();
    evidenceShell(`
      <div class="verdict checking"><p class="eyebrow-line">${esc(v.label)}</p><h2><span class="spin" aria-hidden="true"></span>Checking the change</h2>
      <p class="verdict-text">Started automatically on a copy of your code. Your code is not touched.</p></div>
      <ol class="stages">${stages.map(([l]) => `<li><span class="dot"></span><span>${esc(l)}</span><span class="t"></span></li>`).join("")}</ol>
      <div class="stop-row"><button class="btn" data-act="stop">Stop checking</button></div>`);
    const items = $$(".stages li");
    const t0 = performance.now();
    for (let i = 0; i < stages.length; i++) {
      if (token !== state.runToken) return "cancelled";
      items[i].classList.add("active");
      await wait(stages[i][1]);
      if (token !== state.runToken) return "cancelled";
      items[i].querySelector(".t").textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";
      if (errorAt === i) { items[i].classList.replace("active", "error"); return "error"; }
      items[i].classList.replace("active", "done");
    }
    return "done";
  }

  function runRow(label, pair, note) {
    if (!pair) return `<div class="run notrun"><span>${label}</span><span class="note">${note || "Not run"}</span><span></span></div>`;
    const [p, t, flaky = 0] = pair;
    if (t === 0) return `<div class="run notrun"><span>${label}</span><span class="note">None needed</span><span></span></div>`;
    const failing = t - p - flaky;
    const flakySeg = flaky ? `<i class="flaky" style="width:${(flaky / t) * 100}%"></i>` : "";
    return `<div class="run"><span>${label}</span><span class="bar"><i class="${failing > 0 ? "part" : ""}" style="width:${(p / t) * 100}%"></i>${flakySeg}</span><span class="v">${p}/${t}</span></div>
      ${flaky ? `<div class="note" style="padding-left:138px">${plural(flaky, "unreliable test")} not counted</div>` : ""}`;
  }

  const GLYPH = { ok: "✓", bad: "✕", warn: "!", flaky: "~" };
  const LEVEL = { low: "Low risk", review: "Ready for your review", caution: "Needs your judgement", blocked: "Not ready to apply" };

  function itemActions(e, kind, v) {
    if (state.phase === "decided") return "";
    const btns = [];
    if (e.accepted) {
      btns.push(`<button class="act" data-reopen="${e.fromId}">Reopen</button>`);
    } else if (e.resolved) {
      if (kind === "bad" && e.reviseTo) btns.push(`<button class="act" data-act="revise">Ask for a revision</button>`);
      if (e.fromRule) btns.push(`<button class="act" data-rule-edit="${e.fromRule}">Change rule</button>`);
      else btns.push(`<button class="act" data-reopen="${e.fromId}">Undo my answer</button>`);
    } else if (kind === "warn" || kind === "flaky") {
      (e.resolve || []).forEach((o, i) => {
        if (o.kind === "more" && !v.moreTests) return;
        btns.push(`<button class="act" data-resolve="${e.id}" data-opt="${i}">${esc(o.label)}</button>`);
      });
      btns.push(`<button class="act" data-acceptrisk="${e.id}">Accept the risk</button>`);
    } else if (kind === "bad" && v.reviseTo) {
      btns.push(`<button class="act" data-act="revise">Ask for a revision</button>`);
    }
    return btns.length ? `<div class="item-actions">${btns.join("")}</div>` : "";
  }

  function tagText(e) {
    if (e.fromRule) return "Your rule";
    if (e.resolved) return "Resolved by you";
    if (e.accepted) return "Accepted";
    if (e.severity) return { high: "High", medium: "Medium", low: "Low" }[e.severity];
    return "";
  }

  // One row per piece of evidence: title first, everything else on demand (progressive disclosure, L05)
  function itemHtml(e, kind, v, open) {
    const note = e.accepted && e.note ? `<p class="item-note">Your note: ${esc(e.note)}</p>` : "";
    const ruleNote = e.fromRule ? `<p class="item-note">Answered by your rule: “${esc(state.rules[e.fromRule].text)}”</p>` : "";
    const tag = tagText(e);
    return `<div class="item ${kind}${open ? " open" : ""}" data-item="${e.id}">
      <button class="item-head" data-toggle="${e.id}" data-tag="${e.highlight || ""}" aria-expanded="${open}">
        <span class="glyph ${kind}" aria-hidden="true">${GLYPH[kind]}</span>
        <span class="item-title">${esc(e.title)}</span>
        ${tag ? `<span class="item-tag ${e.severity && !e.resolved && !e.accepted ? "sev-" + e.severity : ""}" ${e.severity ? `title="${{ high: "Likely to break something that works today", medium: "Could matter; needs your judgement", low: "Unlikely to matter, but not checked" }[e.severity]}"` : ""}>${tag}</span>` : ""}
      </button>
      <div class="item-body">
        <p class="item-detail">${esc(e.detail)}</p>
        ${e.why && !e.accepted ? `<p class="item-why">${esc(e.why)}</p>` : ""}${note}${ruleNote}
        <details class="source"><summary>Source: ${esc(e.source.kind)}</summary><span class="mono">${esc(e.source.ref)}</span><pre>${esc(e.source.log)}</pre></details>
        ${itemActions(e, kind, v)}
      </div>
    </div>`;
  }

  function rulesInline() {
    const keys = Object.keys(state.rules);
    if (!keys.length || baseline()) return "";
    return `<section class="rules-inline"><h3>Your rules <span class="n">${keys.length}</span></h3>
      <p class="hint">Sent to the assistant with every request and used to answer its questions.</p>
      <ul class="rules">${keys.map((k) => `<li><span class="rule-text">${esc(state.rules[k].text)}</span>
        <span class="rule-acts"><button data-rule-edit="${k}">Change</button><button data-rule-forget="${k}">Forget</button></span></li>`).join("")}</ul></section>`;
  }

  function group(title, count, body, open) {
    return `<details class="group" ${open ? "open" : ""}><summary><span>${title}</span>${count != null ? `<span class="n">${count}</span>` : ""}</summary><div class="group-body">${body}</div></details>`;
  }

  function timelineHtml() {
    if (state.history.length < 2) return "";
    const colour = { low: "var(--checked)", review: "var(--ink-2)", caution: "var(--unresolved)", blocked: "var(--failed)", none: "var(--ink-3)" };
    return group("History", state.history.length, `<ol class="timeline">${state.history.map((h, i) => `
      <li class="${i === state.history.length - 1 ? "current" : ""}"><span class="pip" style="background:${colour[h.level]}"></span>
      <span>${esc(h.label)}: ${h.note || `${h.failed} failed, ${h.unresolved} unresolved`}${h.auto ? " (automatic retry)" : ""}</span></li>`).join("")}</ol>`, false);
  }

  function capabilityHtml(open) {
    return group("What the checks can and cannot tell you", null, `<div class="cap-cols"><div><h4>Checks</h4><ul>${CAPABILITY.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
      <div><h4>Does not check</h4><ul>${CAPABILITY.doesNot.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div></div>`, open);
  }

  // G11: make clear why the system gave this verdict
  function whyVerdict(ev) {
    const lines = [];
    if (ev.failed.length) lines.push(`${plural(ev.failed.length, "check")} failed.`);
    const sev = { high: 0, medium: 0, low: 0 };
    ev.unresolved.forEach((u) => sev[u.severity || "low"]++);
    if (ev.unresolved.length) lines.push(`${plural(ev.unresolved.length, "item")} unresolved (${["high", "medium", "low"].filter((k) => sev[k]).map((k) => `${sev[k]} ${k}`).join(", ")}).`);
    if (ev.inconclusive.length) lines.push(`${plural(ev.inconclusive.length, "result")} inconclusive and not counted.`);
    if (ev.accepted.length) lines.push(`You accepted ${plural(ev.accepted.length, "risk")}.`);
    if (!lines.length) lines.push("Nothing failed and nothing is unresolved.");
    return `<details class="why"><summary>Why this verdict?</summary>
      <p>${lines.join(" ")}</p>
      <p>The verdict comes from the results, not from the assistant's claims. Any failed check: <em>Not ready to apply</em>. Any high or medium unresolved item: <em>Needs your judgement</em>. Only low or inconclusive items: <em>Ready for your review</em>. Nothing open: <em>Low risk</em>.</p>
      <p>Low risk is not proof. It only covers what the checks test.</p></details>`;
  }

  function verdictHead(level, title, text, v, extra = "") {
    return `<div class="verdict ${level}">
      <p class="eyebrow-line">${esc(v.label)}, tested on a copy of your code.</p>
      <h2><span class="dot" aria-hidden="true"></span>${esc(title)}</h2>
      <p class="verdict-text">${esc(text)}</p>${extra}</div>`;
  }

  function renderReport() {
    const v = version();
    const ver = v.verification;
    const ev = effective(v);
    const { failed, unresolved, inconclusive, checked, accepted } = ev;
    const assessment = assess(v, ev);
    const scroll = $(".ev-scroll") ? $(".ev-scroll").scrollTop : 0;

    // A rule the person set can make the code wrong; offer the revision that follows the rule
    const ruleFail = failed.find((f) => f.reviseTo);
    if (ruleFail) state.reviseOverride = { to: ruleFail.reviseTo, hint: ruleFail.hint, from: ruleFail.fromId, derived: true };
    else if (state.reviseOverride && state.reviseOverride.derived) state.reviseOverride = null;

    // Which rows are open: the first item needing attention starts open; the person's choices are kept across re-renders
    if (state.openFor !== state.versionId) { state.openFor = state.versionId; state.openItems = new Set(); state.openSeeded = false; }
    const attention = failed.map((e) => [e, "bad"]).concat(unresolved.map((e) => [e, "warn"]), inconclusive.map((e) => [e, "flaky"]));
    if (!state.openSeeded && attention.length) {
      (state.settings.expandAll ? attention : attention.slice(0, 1)).forEach(([e]) => state.openItems.add(e.id));
      state.openSeeded = true;
    }

    const seg = (n, c) => (n ? `<i class="${c}" style="flex:${n}"></i>` : "");
    const bar = `<div class="evbar" role="img" aria-label="${checked.length} checked, ${failed.length} failed, ${unresolved.length} unresolved">${seg(checked.length, "c")}${seg(failed.length, "f")}${seg(unresolved.length, "u")}${seg(inconclusive.length, "x")}${seg(accepted.length, "a")}</div>
      <p class="evkey"><span><b>${checked.length}</b> checked</span><span><b>${failed.length}</b> failed</span><span><b>${unresolved.length}</b> unresolved</span>${inconclusive.length ? `<span><b>${inconclusive.length}</b> inconclusive</span>` : ""}${accepted.length ? `<span><b>${accepted.length}</b> accepted</span>` : ""}</p>
      ${whyVerdict(ev)}`;

    const inner = `
      ${verdictHead(assessment.level, LEVEL[assessment.level], assessment.text, v, bar)}

      <section class="attention">
        <h3>Needs attention <span class="n">${attention.length}</span></h3>
        ${attention.length
          ? `<p class="hint">Open an item to see its source and how to resolve it.</p>${attention.map(([e, k]) => itemHtml(e, k, v, state.openItems.has(e.id))).join("")}`
          : `<p class="empty">Nothing needs attention within what these checks cover.</p>`}
      </section>

      ${rulesInline()}

      <div class="groups">
        ${group("Checked", checked.length, checked.map((e) => itemHtml(e, "ok", v, state.openItems.has(e.id))).join("") || `<p class="empty">Nothing was checked.</p>`, false)}
        ${accepted.length ? group("Accepted by you", accepted.length, accepted.map((e) => itemHtml(e, "flaky", v, state.openItems.has(e.id))).join(""), false) : ""}
        ${group("Assistant's claims", ver.claimCheck.length, ver.claimCheck.map((c) => `<div class="claim-row"><span>${esc(claimText(v, c.claim))}<small>${esc(c.note)}</small></span>
            <span class="badge ${c.status}">${{ supported: "Supported", partial: "Partly true", contradicted: "Contradicted", unchecked: "Not checked" }[c.status]}</span></div>`).join(""), false)}
        ${group("Test runs", null, `<div class="runs">
            ${runRow("Existing tests", ver.runs.existing)}
            ${runRow("New tests", ver.runs.generated)}
            ${runRow("Old vs new", ver.runs.differential, v.moreTests ? "Not run yet" : "Not run")}
            <div class="run"><span>Changed lines run</span><span class="bar"><i style="width:${ver.changedLineCoverage}%"></i></span><span class="v">${ver.changedLineCoverage}%</span></div>
            <p class="note">Running a line is not the same as checking what it does.</p></div>`, false)}
        ${timelineHtml()}
        ${capabilityHtml(false)}
      </div>`;

    evidenceShell(inner, decisionBar(v));
    if ($(".ev-scroll")) $(".ev-scroll").scrollTop = scroll;
    renderDiff(v, "sandbox");
  }

  // Shown when checks failed to run or were stopped: absence of evidence is not evidence of safety
  function renderNoEvidence(kind) {
    const v = version();
    const err = kind === "error" ? v.verification.error : null;
    setPhase("nocheck");
    evidenceShell(`
      ${verdictHead("none", err ? "Checks could not run" : "Checks stopped", err ? err.detail : "You stopped the checks before they finished.", v,
        `<p class="verdict-text strong">There are no results. That does not mean the change is safe; it has not been checked.</p>`)}
      ${err ? `<div class="groups">${group("What went wrong", null, `<pre class="code-view">${esc(err.log)}</pre><p class="note">This is a problem with the test area, not necessarily with the change.</p>`, true)}</div>` : ""}
      <div class="groups">${timelineHtml()}</div>`,
      `<div class="decide"><div class="decide-more">
        <button class="choice quiet" data-act="retry-checks">Run checks again</button>
        ${v.reviseTo ? `<button class="choice quiet" data-act="revise">Ask for a revision</button>` : ""}
      </div><div class="decide-row">
        <button class="choice" data-act="reject">Reject</button>
        <button class="choice" data-act="accept">Apply without checks</button>
      </div>${reviseBox()}<p class="foot">Nothing reaches your code until you choose.</p></div>`);
    renderDiff(v, "sandbox");
    startDecisionClock();
  }

  function renderBaseline() {
    const v = version();
    evidenceShell(`
      <div class="verdict plain"><p class="eyebrow-line">${esc(v.label)}</p><h2>Assistant's report</h2></div>
      <ul class="baseline-claims">${v.assistant.claims.map((c) => `<li><span class="tick">✓</span>${esc(c.text)}</li>`).join("")}</ul>`, decisionBar(v));
  }

  function reviseBox() {
    return `<div id="revise-box" class="revise-box hidden">
        <label for="revise-text">What should the assistant change?</label>
        <textarea id="revise-text" rows="3"></textarea>
        <div class="row"><button class="btn" data-act="revise-cancel">Cancel</button><button class="btn primary" data-act="revise-send">Send to assistant</button></div>
      </div>`;
  }

  // All decisions share one visual weight, so no option is presented as the default (anchoring, L06)
  function decisionBar(v) {
    const canMore = !baseline() && !!v.moreTests;
    const canRevise = !!(v.reviseTo || state.reviseOverride);
    return `<div class="decide">
      ${canRevise || canMore ? `<div class="decide-more">
        ${canRevise ? `<button class="choice quiet" data-act="revise">Ask for a revision</button>` : ""}
        ${canMore ? `<button class="choice quiet" data-act="more">Run more tests</button>` : ""}
      </div>` : ""}
      <div class="decide-row">
        <button class="choice" data-act="reject">Reject</button>
        <button class="choice" data-act="accept">Apply to my code</button>
      </div>
      ${reviseBox()}
      <p class="foot">Nothing reaches your code until you choose. Applied changes can be undone.</p>
    </div>`;
  }

  function showOutcome(msg) {
    const d = $(".decide");
    let btn = `<button class="btn" data-again>Try again</button>`;
    if (state.study) btn = `<button class="btn primary" data-next>${nextTask() ? "Next task" : "Finish"}</button>`;
    const html = `<div class="outcome"><span>${esc(msg)}</span>${btn}</div>`;
    if (d) d.innerHTML = html;
    else $("#evidence").insertAdjacentHTML("beforeend", `<div class="decide">${html}</div>`);
  }

  /* ------------------------------------------------------------------ */
  /* Flow                                                                */
  /* ------------------------------------------------------------------ */
  function selectScenario(id) {
    if (isDone(id) || isLocked(id)) return;
    state.runToken++;
    state.scenario = SCENARIOS.find((s) => s.id === id);
    state.versionId = null;
    state.history = [];
    state.autoRevisions = 0;
    state.autoPending = false;
    state.pendingVerify = null;
    state.sandboxFiles = new Set();
    state.res = {};
    state.reviseOverride = null;
    state.inspected = 0;
    setPhase("idle");
    setCrumb(state.scenario.title);
    $(".centre").classList.remove("home");
    $("#thread").innerHTML = "";
    addMsg("system", "Your request is ready below. Send it when you are ready.");
    $("#diff").classList.add("hidden");
    $("#composer").classList.remove("hidden");
    $("#prompt").value = state.scenario.prompt;
    $("#send").disabled = false;
    panelPlaceholder();
    renderScenarioList();
    renderFiles();
    closeDrawer();
    $("#send").focus();
  }

  async function send() {
    if (!state.scenario || state.phase !== "idle") return;
    $("#send").disabled = true;
    $("#composer").classList.add("hidden");
    addMsg("user", esc($("#prompt").value));
    noteRulesSent();
    await propose(state.scenario.start, false);
  }

  async function propose(vid, auto) {
    const token = ++state.runToken;
    setPhase("generating");
    const typing = addMsg("assistant", `<span class="typing" aria-label="Assistant is writing"><span></span><span></span><span></span></span><button class="btn small" data-act="stop">Stop</button>`);
    typing.classList.add("is-typing");
    await wait(1100);
    if (token !== state.runToken) return;
    typing.remove();
    const prev = state.versionId;
    state.versionId = vid;
    const v = version();

    // The assistant states what it cannot do and returns control (Lecture 07 decline turn)
    if (v.decline) {
      setPhase("clarify");
      addMsg("assistant", `<div>${esc(v.decline.message)}</div>
        <div class="decline-opts">${v.decline.options.map((o, i) => `<button class="btn${i === 0 ? " primary" : ""}" data-decline="${i}">${esc(o.label)}</button>`).join("")}</div>`);
      $("#evidence").innerHTML = `<div class="ev-scroll"><div class="placeholder"><p>The assistant is asking you a question before it changes anything.</p></div>${baseline() ? "" : `<div class="groups">${capabilityHtml(false)}</div>`}</div>`;
      return;
    }

    state.reviseOverride = null;
    addMsg("assistant", assistantHtml(v));
    filesOf(v).forEach((f) => state.sandboxFiles.add(f));
    renderFiles();

    if (baseline()) {
      setPhase("report");
      renderDiff(v, "sandbox");
      renderBaseline();
      startDecisionClock();
      pointToResults();
      announce("The assistant's proposal is ready.");
      return;
    }
    if (!state.settings.autoCheck && !auto) { renderAwaitChecks(); return; }
    await verify(v.verification.stages, token, auto);
  }

  // Automatic checks are off: the system waits to be asked (Horvitz: act / ask / wait)
  function renderAwaitChecks() {
    const v = version();
    setPhase("nocheck");
    evidenceShell(verdictHead("none", "Not checked yet", "Automatic checks are off, so nothing has been tested.", v,
      `<p class="verdict-text strong">Run the checks to see what passes, what fails and what is left unchecked.</p>`),
      `<div class="decide"><div class="decide-more">
        ${v.reviseTo ? `<button class="choice quiet" data-act="revise">Ask for a revision</button>` : ""}
      </div><div class="decide-row">
        <button class="choice" data-act="start-checks">Run checks</button>
        <button class="choice" data-act="reject">Reject</button>
        <button class="choice" data-act="accept">Apply without checks</button>
      </div>${reviseBox()}<p class="foot">You can turn automatic checks back on in Settings.</p></div>`);
    renderDiff(v, "sandbox");
    startDecisionClock();
    announce("Proposal ready. Automatic checks are off; nothing has been tested.");
  }

  function onDecline(i) {
    const opt = version().decline.options[i];
    $$(".decline-opts button").forEach((b) => (b.disabled = true));
    logEvent(`decline answer: ${opt.label}`, { decisionMs: null }, true);
    addMsg("user", esc(opt.label));
    if (opt.go) { propose(opt.go, false); return; }
    setPhase("decided");
    state.runToken++;
    logEvent("cancel request");
    addMsg("system", "Request cancelled. Nothing was changed.");
    $("#evidence").innerHTML = `<div class="ev-scroll"></div>`;
    showOutcome("Cancelled. Your code was not changed.");
    afterDecision();
  }

  async function verify(kind, token, auto) {
    setPhase("verifying");
    state.pendingVerify = { kind, auto };
    renderDiff(version(), "sandbox");
    const v0 = version();
    const result = await runStages(kind, token, v0.verification.error ? v0.verification.error.atStage : undefined);
    if (result === "cancelled") return;
    const v = version();
    const ver = v.verification;
    if (result === "error") {
      state.history.push({ label: v.label, level: "none", note: "checks could not run" });
      addMsg("system", "The checks could not run, so there are no results for this proposal.");
      announce("The checks could not run. There are no results for this proposal.");
      renderNoEvidence("error");
      return;
    }
    state.history.push({ label: v.label, level: ver.assessment.level, failed: (ver.failed || []).length, unresolved: (ver.unresolved || []).length, auto: !!auto });

    // Closed loop: bounded automatic self-revision when an existing test fails
    if ((ver.failed || []).length && v.autoRevise && state.autoRevisions < state.settings.selfRevise) {
      state.autoRevisions++;
      setPhase("report");
      renderReport();
      const d = $(".decide");
      if (d) d.innerHTML = `<div class="outcome"><span>A test failed, so the assistant will try again automatically (attempt ${state.autoRevisions} of ${state.settings.selfRevise}). You can change this limit in Settings.</span><button class="btn" data-act="stop">Stop the retry</button></div>`;
      addMsg("system", `${plural(ver.failed.length, "check")} failed on the copy. The failure is being sent back to the assistant for automatic retry ${state.autoRevisions} of ${state.settings.selfRevise}.`);
      logEvent("auto-revise", { decisionMs: null }, true);
      state.autoPending = true;
      await wait(2200);
      if (token !== state.runToken) return;
      state.autoPending = false;
      await propose(v.autoRevise, true);
      return;
    }

    setPhase("report");
    renderReport();
    startDecisionClock();
    pointToResults();
    const ev = effective(v), a = assess(v, ev);
    announce(`Checks finished: ${LEVEL[a.level]}. ${ev.failed.length} failed, ${ev.unresolved.length} unresolved, ${ev.checked.length} checked.`);
  }

  function startDecisionClock() { state.decisionStart = performance.now(); }

  // On narrow screens the results sit below the conversation: point to them (L04: a cue must reach attention)
  function pointToResults() {
    if (window.innerWidth > 900) return;
    const m = addMsg("system", `${baseline() ? "The assistant's report is" : "The results are"} ready below. <button class="btn small" data-jump-results>Show</button>`);
    m.classList.add("jump-note");
  }

  // A task is finished when the person applies, rejects or cancels it
  function afterDecision() {
    if (!state.study) return;
    const id = state.scenario.id;
    if (!state.study.done.includes(id)) state.study.done.push(id);
    renderScenarioList();
    saveLog();
    if (state.study.tlx && !state.scenario.practice) openWorkload(id);
  }

  /* ------------------------------------------------------------------ */
  /* Stop (L07: the person can take the turn back; G9 efficient correction) */
  /* ------------------------------------------------------------------ */
  function onStop() {
    state.runToken++;
    $$(".msg.is-typing").forEach((m) => m.remove());
    if (state.autoPending) {
      state.autoPending = false;
      logEvent("stop automatic retry", { decisionMs: null }, true);
      addMsg("system", "Automatic retry stopped. The failed attempt is shown so you can decide what to do.");
      setPhase("report");
      renderReport();
      startDecisionClock();
      return;
    }
    if (state.phase === "verifying") {
      logEvent("stop checks", { decisionMs: null }, true);
      addMsg("system", "Checks stopped. Nothing was applied.");
      state.history.push({ label: version().label, level: "none", note: "checks stopped" });
      renderNoEvidence("stopped");
      return;
    }
    if (state.phase === "generating") {
      logEvent("stop assistant", { decisionMs: null }, true);
      if (state.versionId && !version().decline) {
        addMsg("system", "Stopped. The assistant's new attempt was discarded; the previous proposal is shown again.");
        setPhase("report");
        if (baseline()) renderBaseline(); else renderReport();
        startDecisionClock();
      } else {
        addMsg("system", "Stopped before the assistant proposed anything. Nothing was changed.");
        state.versionId = null;
        setPhase("idle");
        $("#composer").classList.remove("hidden");
        $("#send").disabled = false;
        panelPlaceholder();
      }
    }
  }

  async function onRetryChecks() {
    const v = version();
    logEvent("run checks again", { decisionMs: null }, true);
    if (v.retryTo && v.verification.error) state.versionId = v.retryTo;
    addMsg("system", "Running the checks again.");
    const token = ++state.runToken;
    await verify(version().verification.stages, token, false);
  }

  /* ------------------------------------------------------------------ */
  /* Decisions                                                           */
  /* ------------------------------------------------------------------ */
  function onAccept() {
    const v = version();
    if (state.phase === "nocheck") {
      openModal(`
        <h2 id="modal-title">Apply a change that has not been checked?</h2>
        <p>No tests have run on this proposal. VeriLoop cannot tell you anything about whether it works.</p>
        <p>You can undo it afterwards from “Your code” at the top.</p>
        <div class="modal-actions"><button class="btn" data-modal="cancel">Go back</button><button class="btn danger" data-modal="confirm">Apply without checks</button></div>`,
        (r) => { if (r === "confirm") integrate("apply (no checks)"); });
      return;
    }
    const ev = baseline() ? null : effective(v);
    const failed = ev ? ev.failed : [];
    const risky = ev ? ev.unresolved.filter((u) => u.severity !== "low") : [];
    const acceptedRisky = ev ? ev.accepted.filter((u) => u.severity !== "low") : [];
    if (state.settings.confirmRisky && (failed.length || risky.length)) {
      openModal(`
        <h2 id="modal-title">Apply this change with open problems?</h2>
        <p>The checks still show:</p>
        <ul>${failed.map((f) => `<li><strong>Failed:</strong> ${esc(f.title)}</li>`).join("")}
            ${risky.map((r) => `<li><strong>Unresolved (${r.severity}):</strong> ${esc(r.title)}</li>`).join("")}
            ${acceptedRisky.map((r) => `<li><strong>Accepted by you (${r.severity}):</strong> ${esc(r.title)}</li>`).join("")}</ul>
        <p>You can undo it afterwards from “Your code” at the top.</p>
        <div class="modal-actions"><button class="btn" data-modal="cancel">Go back</button><button class="btn danger" data-modal="confirm">Apply anyway</button></div>`,
        (r) => { if (r === "confirm") integrate("apply (despite open problems)"); });
      return;
    }
    integrate("apply", acceptedRisky);
  }

  function integrate(action, acceptedRisky = []) {
    const v = version();
    // A checkpoint keeps the exact change and the evidence it was applied on (provenance, L11)
    let evidence;
    if (baseline()) evidence = { level: "none", title: "No checks in this view", text: "Applied on the assistant's report alone." };
    else if (state.phase === "nocheck") evidence = { level: "none", title: "Applied without checks", text: "No tests had run on this proposal." };
    else { const ev = effective(v), a = assess(v, ev); evidence = { level: a.level, title: LEVEL[a.level], text: a.text, counts: { checked: ev.checked.length, failed: ev.failed.length, unresolved: ev.unresolved.length }, accepted: ev.accepted.map((x) => ({ title: x.title, note: x.note })), open: ev.failed.map((x) => "Failed: " + x.title).concat(ev.unresolved.map((x) => `Unresolved (${x.severity}): ${x.title}`)) }; }
    const cp = { id: "cp" + (state.integrated.length + 1), scenarioId: state.scenario.id, versionId: state.versionId, files: filesOf(v), title: `${state.scenario.title}, ${v.label.toLowerCase()}`, undone: false,
      label: v.label, task: state.scenario.title, summary: v.assistant.summary, diff: v.diff, at: clock(), how: action, evidence };
    state.integrated.push(cp);
    logEvent(action);
    setPhase("decided");
    state.runToken++;
    addMsg("system", `Applied ${esc(v.label.toLowerCase())} to your code: ${cp.files.map((f) => `<span class="mono">${esc(f)}</span>`).join(", ")}. A checkpoint was saved.${acceptedRisky.length ? ` It includes ${plural(acceptedRisky.length, "risk")} you accepted.` : ""} <button class="link-btn" data-view-cp="${cp.id}">View changes</button>`);
    renderDiff(v, "integrated");
    showOutcome("Applied to your code. You can undo it from “Your code” at the top.");
    renderWorkspace();
    afterDecision();
    toast(`Applied ${plural(cp.files.length, "file")}.`, "Undo", () => undo(cp.id));
    announce(`Applied to your code. ${plural(cp.files.length, "file")} changed. Undo is available under Your code.`);
  }

  function undo(cpId) {
    const cp = state.integrated.find((c) => c.id === cpId);
    if (!cp || cp.undone) return;
    cp.undone = true;
    cp.undoneAt = clock();
    pushLog({ scenario: cp.scenarioId, version: cp.versionId, action: "undo" });
    renderWorkspace();
    if (state.scenario && state.scenario.id === cp.scenarioId) addMsg("system", `Undone. Your code is back to how it was before ${esc(cp.title)}.`);
    toast("Undone. Your code is back to its checkpoint.");
  }

  function onReject() {
    logEvent("reject");
    setPhase("decided");
    state.runToken++;
    addMsg("system", `Rejected ${esc(version().label.toLowerCase())}. Your code was not changed.`);
    showOutcome("Rejected. Your code was not changed.");
    announce("Rejected. Your code was not changed.");
    afterDecision();
  }

  async function onMoreTests() {
    if (state.phase !== "report") return;
    const v = version();
    if (!v.moreTests) return;
    state.inspected++;
    logEvent("run more tests", { decisionMs: null }, true);
    addMsg("system", "Running more tests: checking the code that uses this change, and comparing old and new behaviour.");
    state.versionId = v.moreTests;
    const token = ++state.runToken;
    await verify(version().verification.stages, token, false);
  }

  function onReviseOpen(hint) {
    const v = version();
    $("#revise-box").classList.remove("hidden");
    const ta = $("#revise-text");
    ta.value = hint || (state.reviseOverride && state.reviseOverride.hint) || v.reviseHint || defaultHint(v);
    $(".decide").scrollIntoView({ block: "nearest", behavior: "smooth" });
    ta.focus();
  }
  function defaultHint(v) {
    if (baseline() || !v.verification || v.verification.error) return "";
    const f = (v.verification.failed || [])[0] || (v.verification.unresolved || [])[0];
    return f ? `Please fix this: ${f.title}.` : "";
  }
  async function onReviseSend() {
    const v = version();
    const text = $("#revise-text").value.trim();
    if (!text) { $("#revise-text").focus(); $("#revise-text").placeholder = "Write what the assistant should change."; return; }
    const to = state.reviseOverride ? state.reviseOverride.to : v.reviseTo;
    if (v.reviseMatch && !state.reviseOverride && !v.reviseMatch.some((k) => text.toLowerCase().includes(k))) {
      // L07 repair: say what was found and hand the turn back, rather than "fixing" something it was not told about
      logEvent(`ask for a revision (not understood): ${text.slice(0, 80)}`, { decisionMs: null }, true);
      addMsg("user", esc(text));
      const typing = addMsg("assistant", `<span class="typing"><span></span><span></span><span></span></span>`);
      await wait(900);
      typing.remove();
      addMsg("assistant", esc(v.reviseMiss));
      $("#revise-text").value = "";
      $("#revise-box").classList.add("hidden");
      return;
    }
    logEvent(`ask for a revision: ${text.slice(0, 80)}`);
    addMsg("user", esc(text));
    noteRulesSent();
    state.reviseOverride = null;
    await propose(to, false);
  }

  /* ------------------------------------------------------------------ */
  /* Resolving open items                                                */
  /* ------------------------------------------------------------------ */
  function openItem(id) {
    const ver = version().verification;
    return (ver.unresolved || []).concat(ver.inconclusive || []).find((e) => e.id === id);
  }

  function applyResolution(item, r, logLabel) {
    state.res[resKey(item.id)] = r;
    if (r.status === "failed" && r.reviseTo) state.reviseOverride = { to: r.reviseTo, hint: r.hint, from: item.id };
    logEvent(logLabel, { decisionMs: null }, true);
    renderReport();
    const word = { checked: "Moved to Checked", failed: "Moved to Failed", accepted: "Marked as accepted by you" }[r.status];
    toast(`${word}: ${item.title}`);
  }

  function setRule(o, item, q) {
    state.rules[o.rule.key] = { text: o.rule.text, setIn: state.scenario.title, at: clock(), q };
    renderRules();
  }

  function answerModal(item, opt, current, onSave) {
    openModal(`
      <h2 id="modal-title">${esc(opt.question)}</h2>
      <p>${esc(item.detail)}</p>
      ${opt.show ? `<pre class="code-view">${esc(opt.show)}</pre>` : ""}
      <fieldset class="choices">${opt.options.map((o, k) => `
        <label><input type="radio" name="ans" value="${k}" ${current === k ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</fieldset>
      <p class="hint-line">${opt.options.some((o) => o.rule) ? "Your answer is kept as a rule under <em>Rules you've set</em>, reused for later proposals, and can be changed or forgotten." : "Your answer becomes part of the evidence. You can undo it later."}</p>
      <div class="modal-actions"><button class="btn" data-modal="cancel">Cancel</button><button class="btn primary" data-modal="save">Save answer</button></div>`,
      (r) => {
        if (r !== "save") return;
        const sel = $('input[name="ans"]:checked');
        if (!sel) { $(".hint-line").innerHTML = "<strong style=\"color:var(--failed)\">Choose one of the answers first.</strong>"; return false; }
        onSave(opt.options[Number(sel.value)]);
      });
  }

  async function onResolve(id, i) {
    if (state.phase !== "report") return;
    const item = openItem(id);
    if (!item) return;
    const opt = item.resolve[i];
    state.inspected++;
    if (opt.kind === "more") return onMoreTests();
    if (opt.kind === "revise") {
      state.reviseOverride = { to: version().reviseTo, hint: opt.hint, from: id };
      return onReviseOpen(opt.hint);
    }
    if (opt.kind === "test") {
      const acts = $(`.item[data-item="${id}"] .item-actions`);
      if (acts) acts.innerHTML = `<span class="running"><span class="dot"></span>${esc(opt.running || "Running…")}</span>`;
      const token = state.runToken;
      await wait(1600);
      if (token !== state.runToken) return;
      return applyResolution(item, { status: opt.result, evidence: opt.evidence }, `resolve ${id}: ${opt.label}`);
    }
    if (opt.kind === "answer") {
      answerModal(item, opt, -1, (o) => {
        if (o.rule) {
          setRule(o, item, { scenarioId: state.scenario.id, versionId: state.versionId, itemId: id, ri: i });
          logEvent(`answer ${id}: ${o.label} (kept as rule)`, { decisionMs: null }, true);
          renderReport();
          toast(`Rule saved: ${o.rule.text}`);
          return;
        }
        applyResolution(item, { status: o.result, evidence: o.evidence, note: o.note, reviseTo: o.reviseTo, hint: o.hint }, `answer ${id}: ${o.label}`);
      });
    }
  }

  function findRuleQuestion(key) {
    const q = state.rules[key].q;
    const sc = SCENARIOS.find((s) => s.id === q.scenarioId);
    const ver = sc.versions[q.versionId].verification;
    const item = (ver.unresolved || []).concat(ver.inconclusive || []).find((e) => e.id === q.itemId);
    return { item, opt: item.resolve[q.ri] };
  }

  function onRuleEdit(key) {
    const { item, opt } = findRuleQuestion(key);
    const current = opt.options.findIndex((o) => o.rule && o.rule.text === state.rules[key].text);
    answerModal(item, opt, current, (o) => {
      const q = state.rules[key].q;
      if (!o.rule) delete state.rules[key];
      else state.rules[key] = { text: o.rule.text, setIn: state.rules[key].setIn, at: clock(), q };
      pushLog({ scenario: q.scenarioId, version: q.versionId, action: `change rule ${key}: ${o.rule ? o.rule.text : "removed"}` });
      renderRules();
      if (state.phase === "report") renderReport();
      toast(o.rule ? `Rule changed: ${o.rule.text}` : "Rule removed.");
    });
  }

  function onRuleForget(key) {
    const r = state.rules[key];
    openModal(`<h2 id="modal-title">Forget this rule?</h2>
      <p>“${esc(r.text)}”</p>
      <p>VeriLoop will stop sending it to the assistant, and any answers based on it will be reopened.</p>
      <div class="modal-actions"><button class="btn" data-modal="cancel">Keep it</button><button class="btn danger" data-modal="confirm">Forget rule</button></div>`,
      (res) => {
        if (res !== "confirm") return;
        delete state.rules[key];
        pushLog({ scenario: r.q.scenarioId, version: r.q.versionId, action: `forget rule ${key}` });
        renderRules();
        if (state.phase === "report") renderReport();
        toast("Rule forgotten. Answers based on it are open again.");
      });
  }

  function onAcceptRisk(id) {
    if (state.phase !== "report") return;
    const item = openItem(id);
    if (!item) return;
    state.inspected++;
    openModal(`
      <h2 id="modal-title">Accept this risk?</h2>
      <p><strong>${esc(item.title)}</strong></p>
      <p>${esc(item.detail)}</p>
      <label class="field">Why is it acceptable? <span class="muted">(optional, kept on record)</span>
        <textarea id="risk-note" rows="2" placeholder="For example: only affects an input we never send"></textarea></label>
      <div class="modal-actions"><button class="btn" data-modal="cancel">Cancel</button><button class="btn primary" data-modal="save">Accept the risk</button></div>`,
      (r) => {
        if (r !== "save") return;
        applyResolution(item, { status: "accepted", note: $("#risk-note").value.trim() }, `accept risk ${id}`);
      });
  }

  function onReopen(id) {
    if (state.phase !== "report") return;
    delete state.res[resKey(id)];
    if (state.reviseOverride && state.reviseOverride.from === id) state.reviseOverride = null;
    logEvent(`reopen ${id}`, { decisionMs: null }, true);
    renderReport();
  }

  /* ------------------------------------------------------------------ */
  /* Study log and participant sessions                                  */
  /* ------------------------------------------------------------------ */
  function pushLog(entry) {
    state.log.push(Object.assign({ t: new Date().toISOString(), pid: state.study ? state.study.pid : "", condition: state.condition, decisionMs: null, inspected: null, appropriateness: "", note: "" }, entry));
    updateLogCount();
    saveLog();
  }

  // Autosave so a refresh or crash does not lose a participant's data. Browser storage can be unavailable (e.g. sandboxed previews).
  const SAVE_KEY = "veriloop-study-log-v1";
  function saveLog() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ log: state.log, study: state.study, savedAt: new Date().toISOString() })); } catch (e) { /* storage unavailable */ }
  }
  function loadSaved() {
    try { const raw = localStorage.getItem(SAVE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  // One row per participant and task: what they finally did, after any undo
  function summarise() {
    const rows = {};
    state.log.forEach((e) => {
      if (!e.scenario) return;
      const sc = SCENARIOS.find((s) => s.id === e.scenario);
      if (sc && sc.practice) return;
      const k = (e.pid || "-") + "|" + e.scenario;
      const r = rows[k] || (rows[k] = { pid: e.pid || "", condition: e.condition, task: e.scenario, final: "", version: "", appropriate: "", decisionMs: null, inspected: null, revisions: 0, stops: 0, workload: null });
      if (e.action.startsWith("apply") || e.action === "reject" || e.action === "cancel request") {
        Object.assign(r, { final: e.action, version: e.version, appropriate: e.appropriateness, decisionMs: e.decisionMs, inspected: e.inspected });
      }
      if (e.action === "undo" && r.final.startsWith("apply")) { r.final = "applied then undone"; r.appropriate = ""; }
      if (e.action.startsWith("ask for a revision")) r.revisions++;
      if (e.action.startsWith("stop")) r.stops++;
      if (e.workload) r.workload = e.workload;
    });
    return Object.values(rows);
  }

  function logEvent(action, extra = {}, keepClock = false) {
    const truth = state.scenario.truth[state.versionId] || {};
    const key = action.startsWith("apply") ? "accept" : action === "reject" ? "reject" : action === "cancel request" ? "cancel" : null;
    const ms = "decisionMs" in extra ? extra.decisionMs : (state.decisionStart ? Math.round(performance.now() - state.decisionStart) : null);
    pushLog({ scenario: state.scenario.id, version: state.versionId || "", action, decisionMs: ms, inspected: key ? state.inspected : null, appropriateness: key ? truth[key] || "" : "", note: key ? truth.note || "" : "" });
    if (!keepClock) { state.decisionStart = null; state.inspected = 0; }
  }
  function updateLogCount() { $("#log-count").textContent = state.log.length; }

  function openLog() {
    const rows = state.log.map((e) => `<tr><td>${e.t.slice(11, 19)}</td><td>${esc(e.pid || "–")}</td><td>${e.condition === "evidence" ? "Evidence" : "Baseline"}</td><td>${esc(e.scenario)}</td><td>${esc(e.version)}</td><td>${esc(e.action)}</td>
      <td>${e.decisionMs != null ? (e.decisionMs / 1000).toFixed(1) + " s" : "–"}</td><td>${e.inspected != null ? e.inspected : "–"}</td><td class="ap-${e.appropriateness}">${esc(e.appropriateness || "–")}</td></tr>`).join("");
    const session = state.study
      ? `<div class="session on"><strong>Participant session running:</strong> ${esc(state.study.pid)}, ${state.study.view === "evidence" ? "Evidence" : "Baseline"} view, started ${esc(state.study.startedAt)}.
          <button class="btn" data-modal="end-session">End session</button></div>`
      : `<div class="session"><strong>Start a participant session</strong>
          <p>Hides the view switch and this log, fixes the view, and tags every row with the participant ID. Reopen this log with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.</p>
          <div class="session-row"><label>Participant ID <input id="pid" value="P${String(new Set(state.log.map((e) => e.pid).filter(Boolean)).size + 1).padStart(2, "0")}"></label>
          <label>View <select id="pview"><option value="evidence">Evidence</option><option value="baseline">Baseline</option></select></label>
          <button class="btn primary" data-modal="start-session">Start session</button></div>
          <div class="session-opts">
            <label><input type="checkbox" id="opt-practice" checked> Begin with a practice task (not analysed)</label>
            <label><input type="checkbox" id="opt-shuffle" checked> Shuffle task order (fixed per participant ID)</label>
            <label><input type="checkbox" id="opt-tlx" checked> Ask about workload after each task (NASA-TLX)</label>
          </div></div>`;
    openModal(`
      <h2 id="modal-title" data-wide>Study log</h2>
      ${session}
      ${summaryTable()}
      <p>Each row is one action. <em>Time to decide</em> runs from seeing the result to applying or rejecting; <em>Looked at</em> counts the evidence opened, tests run, questions answered and risks reviewed before that decision; <em>Appropriate?</em> compares the decision with the task's known answer.</p>
      <div class="log-wrap"><table class="log-table"><tr><th>Time</th><th>Participant</th><th>View</th><th>Task</th><th>Version</th><th>Action</th><th>Time to decide</th><th>Looked at</th><th>Appropriate?</th></tr>${rows || `<tr><td colspan="9" class="muted">No actions yet.</td></tr>`}</table></div>
      <div class="modal-actions"><button class="btn danger" data-modal="clear">Clear log</button><button class="btn" data-modal="export">Export JSON</button><button class="btn primary" data-modal="cancel">Close</button></div>`,
      (r) => {
        if (r === "export") exportLog();
        if (r === "clear") { state.log = []; updateLogCount(); saveLog(); }
        if (r === "start-session") startSession($("#pid").value.trim() || "P??", $("#pview").value, { practice: $("#opt-practice").checked, shuffle: $("#opt-shuffle").checked, tlx: $("#opt-tlx").checked });
        if (r === "end-session") endSession();
      });
  }

  function summaryTable() {
    const rows = summarise();
    if (!rows.length) return "";
    return `<h3 class="sum-h">Final decision per task</h3><div class="log-wrap"><table class="log-table"><tr><th>Participant</th><th>View</th><th>Task</th><th>Final</th><th>Version</th><th>Appropriate?</th><th>Time to decide</th><th>Looked at</th><th>Revisions</th><th>Workload</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.pid || "–")}</td><td>${r.condition === "evidence" ? "Evidence" : "Baseline"}</td><td>${esc(r.task)}</td><td>${esc(r.final || "unfinished")}</td><td>${esc(r.version)}</td><td class="ap-${r.appropriate}">${esc(r.appropriate || "–")}</td>
        <td>${r.decisionMs != null ? (r.decisionMs / 1000).toFixed(1) + " s" : "–"}</td><td>${r.inspected != null ? r.inspected : "–"}</td><td>${r.revisions}</td><td>${r.workload ? r.workload.mean : "–"}</td></tr>`).join("")}</table></div>
      <h3 class="sum-h">Every action</h3>`;
  }

  function startSession(pid, view, opts = { practice: true, shuffle: true, tlx: true }) {
    const main = SCENARIOS.filter((s) => !s.practice).map((s) => s.id);
    const order = (opts.practice ? ["practice"] : []).concat(opts.shuffle ? seededOrder(main, pid) : main);
    state.study = { pid, view, startedAt: clock(), order, done: [], tlx: opts.tlx };
    state.rules = {};
    state.integrated = [];
    // Same behaviour for everyone; appearance and accessibility choices are the participant's own
    BEHAVIOUR.forEach((k) => (state.settings[k] = SETTING_DEFAULTS[k]));
    state.settings.speed = "normal";
    document.body.classList.add("study");
    setCondition(view, true);
    pushLog({ scenario: "", version: "", action: `session start (${view}; order ${order.join(", ")})` });
    renderWorkspace();
    renderRules();
    renderHome();
    // Same briefing for both views except one sentence, so instructions do not differ between conditions
    openModal(`<h2 id="modal-title">Before you start</h2>
      <p>You will work through ${plural(order.length, "task")}${opts.practice ? ", starting with a practice task" : ""}. In each one you ask an AI assistant for a change to a small shop's code, read what it proposes, and decide what to do with it.</p>
      <p>${view === "evidence" ? "The panel on the right shows the results of checks run on a copy of the code." : "The panel on the right shows the assistant's own report."} Your code only changes if you choose <strong>Apply to my code</strong>.</p>
      <p>Take as long as you need. There are no trick questions, and the assistant is not always right.</p>
      <div class="modal-actions"><button class="btn primary" data-modal="cancel">Start</button></div>`);
  }
  function endSession() {
    pushLog({ scenario: "", version: "", action: `session end (${state.study.done.length} of ${state.study.order.length} tasks done)` });
    state.study = null;
    document.body.classList.remove("study");
    toast("Participant session ended. Researcher controls are back.");
  }

  function exportLog() {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), settings: state.settings, summary: summarise(), events: state.log }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "veriloop-study-log.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Raw NASA-TLX (Hart & Staveland, 1988): six 0–100 scales, averaged
  const TLX = [
    ["mental", "Mental demand", "How mentally demanding was the task?", "Very low", "Very high"],
    ["physical", "Physical demand", "How physically demanding was the task?", "Very low", "Very high"],
    ["temporal", "Temporal demand", "How hurried or rushed was the pace of the task?", "Very low", "Very high"],
    ["performance", "Performance", "How successful were you in doing what you were asked?", "Perfect", "Failure"],
    ["effort", "Effort", "How hard did you have to work to reach your level of performance?", "Very low", "Very high"],
    ["frustration", "Frustration", "How insecure, discouraged, irritated or stressed were you?", "Very low", "Very high"]
  ];
  function openWorkload(taskId) {
    const touched = new Set();
    openModal(`<h2 id="modal-title">How was that task?</h2>
      <p>Move every slider to show how you felt about the task you just finished.</p>
      <div class="tlx">${TLX.map(([k, name, q, lo, hi]) => `
        <div class="tlx-row"><label for="tlx-${k}"><strong>${name}</strong> <span>${q}</span></label>
          <input type="range" id="tlx-${k}" min="0" max="100" step="5" value="50" data-tlx="${k}">
          <div class="tlx-ends"><span>${lo}</span><span>${hi}</span></div></div>`).join("")}</div>
      <p class="hint-line"></p>
      <div class="modal-actions"><button class="btn primary" data-modal="save">Continue</button></div>`,
      (r) => {
        if (r !== "save") return false;   // must be answered; Escape and clicking outside do nothing
        if (touched.size < TLX.length) { $(".hint-line").innerHTML = `<strong style="color:var(--failed)">Please move all six sliders (${touched.size} of 6 done).</strong>`; return false; }
        const scores = {}; TLX.forEach(([k]) => (scores[k] = Number($(`#tlx-${k}`).value)));
        const mean = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / TLX.length);
        pushLog({ scenario: taskId, version: "", action: "workload (NASA-TLX)", workload: Object.assign({ mean }, scores) });
      });
    $$("#modal [data-tlx]").forEach((el) => el.addEventListener("input", () => { touched.add(el.dataset.tlx); el.classList.add("touched"); }));
  }

  function renderStudyEnd() {
    state.scenario = null;
    setPhase("home");
    $(".centre").classList.add("home");
    $("#diff").classList.add("hidden");
    $("#composer").classList.add("hidden");
    $("#thread").innerHTML = `<div class="start"><h1>All tasks done</h1><p class="lede">Thank you. Please let the researcher know you have finished.</p></div>`;
    $("#evidence").innerHTML = `<div class="ev-scroll"></div>`;
    renderScenarioList();
    pushLog({ scenario: "", version: "", action: "all tasks done" });
  }

  /* ------------------------------------------------------------------ */
  /* Settings (global controls, Amershi G17) and capability              */
  /* ------------------------------------------------------------------ */
  const SETTINGS_UI = [
    { id: "appearance", title: "Appearance", items: [
      { key: "theme", label: "Theme", type: "seg", opts: [["dark", "Dark"], ["light", "Light"], ["system", "Match system"]] },
      { key: "textSize", label: "Text size", desc: "Scales all text, including code.", type: "seg", opts: [["s", "Small"], ["m", "Default"], ["l", "Large"], ["xl", "Largest"]] },
      { key: "density", label: "Spacing", type: "seg", opts: [["comfortable", "Comfortable"], ["compact", "Compact"]] }
    ] },
    { id: "accessibility", title: "Accessibility", items: [
      { key: "contrast", label: "High contrast", desc: "Makes secondary text and dividing lines stronger.", type: "switch", on: "high", off: "normal" },
      { key: "palette", label: "Colour-blind-safe colours", desc: "Blue, orange and yellow for checked, failed and unresolved. Icons always show the status too.", type: "switch", on: "cb", off: "standard" },
      { key: "motion", label: "Motion", desc: "Spinners, typing dots and sliding panels.", type: "seg", opts: [["system", "Match system"], ["reduce", "Reduce"], ["full", "Full"]] }
    ] },
    { id: "reading", title: "Reading", items: [
      { key: "wrapCode", label: "Wrap long code lines", desc: "Instead of scrolling sideways.", type: "switch" },
      { key: "expandAll", label: "Open every item that needs attention", desc: "Instead of only the first one.", type: "switch" }
    ] },
    { id: "checks", title: "Assistant and checks", evidenceOnly: true, items: [
      { key: "autoCheck", label: "Run checks automatically", desc: "When off, VeriLoop waits until you ask before testing a proposal.", type: "switch" },
      { key: "selfRevise", label: "Automatic retries", desc: "How many times the assistant may fix its own failed tests before handing back to you.", type: "seg", opts: [["0", "None"], ["1", "1"], ["2", "2"]] },
      { key: "confirmRisky", label: "Confirm risky changes", desc: "Ask again before applying a change with failed checks or medium or high risks.", type: "switch" }
    ] },
    { id: "keyboard", title: "Keyboard", items: [
      { key: "shortcuts", label: "Keyboard shortcuts", desc: "Press ? at any time to see them.", type: "switch" }
    ] },
    { id: "demo", title: "Demo", researcher: true, items: [
      { key: "speed", label: "Simulation speed", desc: "Changes how fast the simulation runs, not its results.", type: "seg", opts: [["normal", "Normal"], ["fast", "Fast"]] }
    ] }
  ];

  function settingControl(it) {
    const s = state.settings;
    const locked = state.study && BEHAVIOUR.includes(it.key);
    let ctl;
    if (it.type === "seg") {
      ctl = `<div class="seg-group" role="radiogroup" aria-label="${esc(it.label)}">${it.opts.map(([v, l]) => `<button role="radio" aria-checked="${String(s[it.key]) === v}" data-set="${it.key}" data-val="${v}" ${locked ? "disabled" : ""}>${l}</button>`).join("")}</div>`;
    } else {
      const isOn = it.on ? s[it.key] === it.on : !!s[it.key];
      ctl = `<button class="switch" role="switch" aria-checked="${isOn}" aria-label="${esc(it.label)}" data-set="${it.key}" data-val="${isOn ? (it.off || "false") : (it.on || "true")}" ${locked ? "disabled" : ""}></button>`;
    }
    return `<div class="setting"><span><span class="lbl">${esc(it.label)}</span>${it.desc ? `<span class="desc">${esc(it.desc)}</span>` : ""}${locked ? `<span class="locked">Fixed for this study session.</span>` : ""}</span>${ctl}</div>`;
  }

  function settingsBody() {
    const sections = SETTINGS_UI.filter((sec) => !(sec.evidenceOnly && baseline()) && !(sec.researcher && state.study));
    return `<h2 id="modal-title" data-medium>Settings</h2>
      <div class="settings">
        <nav class="settings-nav" aria-label="Settings sections">${sections.map((sec, i) => `<button data-setting-nav="${sec.id}" aria-current="${i === 0}">${sec.title}</button>`).join("")}</nav>
        <div>${sections.map((sec) => `<section class="settings-section" id="set-${sec.id}"><h3>${sec.title}</h3>${sec.items.map(settingControl).join("")}</section>`).join("")}</div>
      </div>
      <div class="settings-foot"><button class="link-btn" data-modal="reset">Reset to defaults</button><button class="btn primary" data-modal="cancel">Done</button></div>`;
  }

  // Changes apply at once, are remembered in this browser and are logged for the study
  function changeSetting(key, raw) {
    if (state.study && BEHAVIOUR.includes(key)) return;
    const def = SETTING_DEFAULTS[key];
    const val = typeof def === "boolean" ? raw === "true" : typeof def === "number" ? Number(raw) : raw;
    state.settings[key] = val;
    applySettings();
    saveSettings();
    pushLog({ scenario: state.scenario ? state.scenario.id : "", version: state.versionId || "", action: `setting ${key}: ${val}` });
    const scroll = $(".modal-box").scrollTop;
    const nav = $(".settings-nav [aria-current=true]");
    const navId = nav ? nav.dataset.settingNav : null;
    $("#modal-body").innerHTML = settingsBody();
    $(".modal-box").scrollTop = scroll;
    if (navId) $$(".settings-nav button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.settingNav === navId)));
    const again = $(`#modal-body [data-set="${key}"][aria-checked="true"], #modal-body .switch[data-set="${key}"]`);
    if (again) again.focus();
    if (state.phase === "report" && ["expandAll"].includes(key)) { state.openSeeded = false; state.openFor = null; renderReport(); }
  }

  function openSettings() {
    openModal(settingsBody(), (r) => {
      if (r !== "reset") return;
      Object.keys(SETTING_DEFAULTS).forEach((k) => { if (!(state.study && BEHAVIOUR.includes(k))) state.settings[k] = SETTING_DEFAULTS[k]; });
      applySettings();
      saveSettings();
      pushLog({ scenario: state.scenario ? state.scenario.id : "", version: state.versionId || "", action: "settings reset to defaults" });
      $("#modal-body").innerHTML = settingsBody();
      return false;   // keep the page open
    });
  }

  function openShortcuts() {
    openModal(`<h2 id="modal-title">Keyboard shortcuts</h2>
      <table class="keys">
        <tr><td><kbd>?</kbd></td><td>Show this list</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Next / previous evidence item</td></tr>
        <tr><td><kbd>Enter</kbd> or <kbd>Space</kbd></td><td>Open or close the focused item</td></tr>
        <tr><td><kbd>c</kbd></td><td>Jump to the checks</td></tr>
        <tr><td><kbd>t</kbd></td><td>Switch task</td></tr>
        <tr><td><kbd>,</kbd></td><td>Open settings</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close a dialog or menu</td></tr>
      </table>
      <p class="note" style="margin-top:10px">There are no single-key shortcuts for Apply or Reject, so a stray key press cannot change your code.</p>
      <div class="modal-actions"><button class="btn primary" data-modal="cancel">Close</button></div>`);
  }

  function openCapability() {
    state.inspected++;
    openModal(`<h2 id="modal-title">How checks work</h2>
      <p>Each proposed change is applied to a copy of the project and tested there before you decide what to do with it.</p>
      ${capabilityHtml(true)}
      <p>In this prototype every result is scripted. The README lists which parts are simulated.</p>
      <div class="modal-actions"><button class="btn primary" data-modal="cancel">Close</button></div>`);
  }

  /* ------------------------------------------------------------------ */
  /* Modal, toast, drawer                                                */
  /* ------------------------------------------------------------------ */
  let modalCb = null;
  let lastFocus = null;
  let modalGen = 0;   // bumps on every open, so a dialog opened from another dialog's callback is not closed with it
  function openModal(html, cb) {
    modalGen++;
    if ($("#modal").classList.contains("hidden")) lastFocus = document.activeElement;
    $("#modal-body").innerHTML = html;
    $(".modal-box").classList.toggle("wide", !!$("#modal-body [data-wide]"));
    $(".modal-box").classList.toggle("medium", !!$("#modal-body [data-medium]"));
    $("#modal").classList.remove("hidden");
    modalCb = cb || null;
    const f = $("#modal-body input, #modal-body select, #modal-body button");
    if (f) f.focus();
  }
  function closeModal(result) {
    // Callback runs before clearing so it can read form values; returning false keeps the dialog open
    const gen = modalGen;
    if (modalCb && modalCb(result) === false) return;
    if (modalGen !== gen) return;   // the callback opened a new dialog; leave it open
    modalCb = null;
    $("#modal").classList.add("hidden");
    $("#modal-body").innerHTML = "";
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }

  let toastTimer;
  function toast(msg, actionLabel, action) {
    const t = $("#toast");
    t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ""}`;
    t.classList.remove("hidden");
    if (actionLabel) t.querySelector("button").onclick = () => { action(); t.classList.add("hidden"); };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
  }

  // Three small pop-overs share one behaviour: one open at a time, closed by clicking elsewhere or Escape
  const POPS = { "btn-menu": "menu", "btn-code": "code-pop", "btn-tasks": "task-menu" };
  function toggleMenu(btnId) {
    const pop = $("#" + POPS[btnId]);
    const open = pop.classList.contains("hidden");
    closeMenu();
    if (open) { pop.classList.remove("hidden"); $("#" + btnId).setAttribute("aria-expanded", "true"); }
  }
  function closeMenu() {
    Object.entries(POPS).forEach(([b, m]) => { $("#" + m).classList.add("hidden"); $("#" + b).setAttribute("aria-expanded", "false"); });
  }
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) closeMenu(); }, true);

  function closeDrawer() { closeMenu(); }


  function setCondition(c, silent) {
    closeMenu();
    state.condition = c;
    document.body.classList.toggle("baseline", c === "baseline");
    $$(".seg").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.condition === c)));
    renderRules();
    if (state.scenario) selectScenario(state.scenario.id); else renderHome();
    if (!silent) toast(c === "evidence" ? "Evidence view: shows test results." : "Baseline view: shows only the assistant's report.");
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t) { if (e.target.id === "scrim") closeDrawer(); return; }
    if (t.dataset.scenario) return selectScenario(t.dataset.scenario);
    if (t.dataset.condition) return setCondition(t.dataset.condition);
    if (t.dataset.set) return changeSetting(t.dataset.set, t.dataset.val);
    if (t.dataset.settingNav) { const sec = $("#set-" + t.dataset.settingNav); if (sec) sec.scrollIntoView({ block: "start", behavior: "smooth" }); $$(".settings-nav button").forEach((b) => b.setAttribute("aria-current", String(b === t))); return; }
    if (t.dataset.viewCp) return openChange(t.dataset.viewCp);
    if (t.hasAttribute("data-view-all")) return openAllChanges();
    if (t.dataset.undo) {
      const inView = !!t.closest("#modal");
      const all = inView && /All changes/.test($("#modal-title").textContent);
      undo(t.dataset.undo);
      if (inView) { if (all && state.integrated.some((c) => !c.undone)) openAllChanges(); else openChange(t.dataset.undo); }
      return;
    }
    if (t.dataset.modal) return closeModal(t.dataset.modal);
    if (t.hasAttribute("data-again")) return selectScenario(state.scenario.id);
    if (t.hasAttribute("data-home")) { closeDrawer(); return renderHome(); }
    if (t.hasAttribute("data-next")) { const n = nextTask(); return n ? selectScenario(n) : renderStudyEnd(); }
    if (t.hasAttribute("data-jump-results")) return $("#evidence").scrollIntoView({ behavior: "smooth" });
    if (t.dataset.decline) return onDecline(Number(t.dataset.decline));
    if (t.dataset.resolve) return onResolve(t.dataset.resolve, Number(t.dataset.opt));
    if (t.dataset.acceptrisk) return onAcceptRisk(t.dataset.acceptrisk);
    if (t.dataset.reopen) return onReopen(t.dataset.reopen);
    if (t.dataset.ruleEdit) return onRuleEdit(t.dataset.ruleEdit);
    if (t.dataset.ruleForget) return onRuleForget(t.dataset.ruleForget);
    if (t.dataset.jump) {
      state.inspected++;
      const btn = $(`.item[data-item="${t.dataset.jump}"] > button`);
      if (btn) { btn.scrollIntoView({ block: "start", behavior: "smooth" }); if (btn.getAttribute("aria-expanded") === "false") btn.click(); else flashTag(btn.dataset.tag); }
      return;
    }
    if (t.dataset.toggle) {
      const item = t.closest(".item");
      const open = !item.classList.contains("open");
      item.classList.toggle("open", open);
      t.setAttribute("aria-expanded", String(open));
      if (open) { state.openItems.add(t.dataset.toggle); state.inspected++; flashTag(t.dataset.tag); }
      else state.openItems.delete(t.dataset.toggle);
      return;
    }
    switch (t.dataset.act) {
      case "accept": return onAccept();
      case "reject": return onReject();
      case "more": return onMoreTests();
      case "revise": return onReviseOpen();
      case "revise-cancel": return $("#revise-box").classList.add("hidden");
      case "revise-send": return onReviseSend();
      case "stop": return onStop();
      case "retry-checks": return onRetryChecks();
      case "start-checks": { logEvent("run checks (manual)", { decisionMs: null }, true); const tk = ++state.runToken; return verify(version().verification.stages, tk, false); }
    }
    if (t.closest("#menu") || t.closest("#task-menu")) closeMenu();
    switch (t.id) {
      case "send": return send();
      case "btn-settings": return openSettings();
      case "btn-log": return openLog();
      case "btn-capability": return openCapability();
      case "btn-menu": case "btn-code": case "btn-tasks": return toggleMenu(t.id);
      case "btn-home": closeDrawer(); return renderHome();
    }
  });
  $("#prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); if ($("#modal").classList.contains("hidden")) openLog(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const modalOpen = !$("#modal").classList.contains("hidden");
    if (state.settings.shortcuts && !typing && !modalOpen && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const heads = $$("#evidence .item-head").filter((h) => h.offsetParent);
      const i = heads.indexOf(document.activeElement);
      if (e.key === "?") { e.preventDefault(); return openShortcuts(); }
      if (e.key === "j" && heads.length) { e.preventDefault(); return heads[Math.min(i + 1, heads.length - 1)].focus(); }
      if (e.key === "k" && heads.length) { e.preventDefault(); return heads[Math.max(i - 1, 0)].focus(); }
      if (e.key === "c") { e.preventDefault(); return (heads[0] || $("#evidence")).focus(); }
      if (e.key === "t" && !$("#btn-tasks").classList.contains("hidden")) { e.preventDefault(); toggleMenu("btn-tasks"); const f = $("#task-menu button:not(:disabled)"); if (f) f.focus(); return; }
      if (e.key === ",") { e.preventDefault(); return openSettings(); }
    }
    if (e.key !== "Escape") return;
    if (!$("#modal").classList.contains("hidden")) closeModal("cancel");
    else { closeDrawer(); closeMenu(); }
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal("cancel"); });

  /* init — a researcher can also start a session from the URL: ?pid=P03&view=baseline */
  renderWorkspace();
  renderRules();
  const params = new URLSearchParams(location.search);
  if (params.get("pid")) startSession(params.get("pid"), params.get("view") === "baseline" ? "baseline" : "evidence");
  else renderHome();
  const saved = loadSaved();
  if (saved && saved.log && saved.log.length && !params.get("pid")) {
    openModal(`<h2 id="modal-title">Restore the saved study log?</h2>
      <p>A study log with ${plural(saved.log.length, "row")} was saved in this browser on ${esc(saved.savedAt.slice(0, 16).replace("T", " "))}${saved.study ? `, during ${esc(saved.study.pid)}'s session` : ""}.</p>
      <p>Restoring brings back the rows (export them before clearing). It does not restore an unfinished task.</p>
      <div class="modal-actions"><button class="btn danger" data-modal="discard">Discard it</button><button class="btn primary" data-modal="restore">Restore rows</button></div>`,
      (r) => {
        if (r === "restore") { state.log = saved.log; updateLogCount(); toast(`Restored ${plural(saved.log.length, "row")}. Open Study log to export them.`); }
        if (r === "discard") { state.log = []; saveLog(); }
        if (r === "cancel") return false;
      });
  }
})();
