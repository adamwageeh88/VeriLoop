# VeriLoop — closed-loop verification for AI-generated code (simulated prototype)

Intelligent Interactive Systems (37792) · Assignment 2 · Adam Wageeh Mohamed Mohamed Hassen

README prose word count: _update before submission_

VeriLoop is a web prototype of a coding assistant that tests each proposed change on an isolated copy of the code and shows the developer what was **checked**, what **failed** and what is still **unresolved** before they decide whether to apply it to their code.

## Project status

| Part | Status |
|---|---|
| Interface and decisions: Apply to my code, Reject, Run more tests, Ask for a revision | Implemented |
| Resolving open items: run a test, answer a question, ask for a fix, accept the risk; reopen or undo | Implemented |
| Rules you've set: answers kept as rules, reused for later proposals, changeable and forgettable | Implemented |
| Stop controls: stop the assistant, stop the checks, stop an automatic retry | Implemented |
| “Why this verdict?” explanation, undo checkpoints, “What changed in your code” views with the evidence each change was applied on | Implemented |
| Settings: appearance (theme, text size, spacing), accessibility (high contrast, colour-blind-safe colours, reduced motion), reading (wrap code, open all items), assistant and checks (automatic or on-request checks, retry limit, risk confirmation), keyboard shortcuts | Implemented |
| Accessibility: skip link, screen-reader announcements, keyboard operation throughout, visible focus, status shown by icon as well as colour | Implemented |
| Evidence and Baseline views; Baseline shows no sign of checks | Implemented |
| Study log (participant ID, time to decide, evidence looked at, appropriateness), final decision per task, JSON export, autosave with restore after a reload | Implemented |
| Participant sessions: practice task, task order shuffled per participant ID, tasks unlocked in order, same briefing for both views, fixed starting settings, end screen | Implemented |
| Workload questionnaire (raw NASA-TLX, six 0–100 scales) after each task in a session | Implemented |
| Code assistant (LLM), test area, test runner, generated and differential tests, call-graph analysis, failure of the test area | **Simulated**: scripted in `js/scenarios.js` |
| Free-text requests; more than the scripted revisions per proposal | **Simulated**: requests are fixed and each revision is scripted. In “Add free shipping” the fix only follows feedback that names the problem (keyword match); otherwise the assistant asks what is wrong |
| Real model call with structured (JSON schema) output for claims; real sandboxed `pytest` run | Planned |

Six scripted tasks:

| Task | What it shows |
|---|---|
| Add discount codes | Tests pass but a shared rounding function changes; more tests reveal the regression |
| Fix pagination bug | Automatic retry after a failed test; an unreliable test; a question about page=0 |
| Add free shipping | Every check passes but there is still a bug at exactly £50: tests reliance on the checks themselves |
| Speed up product search | The assistant declines to claim a speed-up it cannot check and asks before going ahead |
| Upgrade the payment library | The test area fails, so there is no evidence; the checks can be re-run |
| Document an invoice helper | A low-risk change, to compare against |
| Practice: rename a variable | Shown first in participant sessions only; not analysed |

## Technology stack

- Plain HTML, CSS and JavaScript; no build step, no dependencies, no API keys.
- AI behaviour is scripted data, not a model call.

## Running or inspecting the work

No installation is needed. **Easiest:** open the `veriloop` folder and double-click `index.html`; it runs in any modern browser (Chrome, Edge, Firefox, Safari).

To serve it locally instead (needs Python 3):

```bash
# Windows (PowerShell)
py -m http.server 8000

# macOS / Linux
python3 -m http.server 8000
```

Then open http://localhost:8000. On Windows, if `py` and `python` are both “not found”, Python is not installed; use the double-click method or install Python from python.org with “Add python.exe to PATH” ticked.

Suggested walkthrough: open **Add discount codes** → *Send request* → under *Unresolved*, click **Test the code that uses it** → **Ask for a revision** → answer **How should discounts round?** → **Apply to my code** → **Undo** in *Your code*. Then switch to **Baseline view** and run the same task to compare. Open **Study log** to see what was recorded.

### Keyboard shortcuts

Press <kbd>?</kbd> for the list: <kbd>j</kbd>/<kbd>k</kbd> move between evidence items, <kbd>c</kbd> jumps to the checks, <kbd>t</kbd> switches task, <kbd>,</kbd> opens settings. There are deliberately no single-key shortcuts for Apply or Reject.

### Running a participant session

Open **Study log** → enter a participant ID and view → choose the options (practice task, shuffled order, workload questionnaire; all on by default) → **Start session**. The participant sees a short briefing that is the same in both views apart from one sentence. The session hides the view switch, the log and the demo-speed setting, resets settings, fixes the view, unlocks tasks one at a time and tags every row with the ID. The task order is shuffled but always the same for the same ID, so it can be reproduced. Press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> to reopen the log and end the session. A session can also be started from the URL: `http://localhost:8000/?pid=P03&view=baseline`.

The log is saved in the browser after every action. If the page is reloaded, VeriLoop offers to restore it. **Export JSON** gives a `summary` (one row per participant and task: final decision after any undo, appropriateness, time to decide, evidence looked at, revisions, workload) and every `event`. Saving may not work in sandboxed previews; run it locally for real sessions.

## Repository structure

```
index.html            page layout
css/styles.css        styling
js/scenarios.js       scripted assistant output and verification results
js/app.js             interaction logic, initiative rule, log
docs/design-concepts.md  design choices mapped to module concepts
```

## Development record

| Date | Change | Why | What I checked |
|---|---|---|---|
| 2026-11-15 | First simulated prototype: three scenarios, evidence panel, A/B views, log | Show the interaction proposed in A1 without building the backend | Ran all three tasks in both views in Chrome; no console errors |
| 2026-11-15 | Redesign: light theme, progress steps, start screen with task cards, plain-language verdict with evidence bar and “Start here” pointer, collapsible sections, responsive layout; removed task tags that hinted at the answer | Make the next step and the key evidence obvious; tags would bias study participants | Checked at 1500, 1100 and 420 px wide; full walkthrough with no errors |
| 2026-11-15 | Every unresolved item now has ways to resolve it: run a test, answer a requirement question, ask for a fix, or accept the risk with a reason; the verdict updates as items are resolved; added proposals that follow the rule the user sets | In testing, “unresolved” gave no next step, so the only way forward was to apply anyway | Ran every resolution path in both tasks; resolution actions appear in the study log |
| 2026-11-15 | Audit against Weeks 1–4, then: participant sessions that hide researcher controls; Baseline view stripped of any sign of checks; three new tasks (checks miss a bug, assistant declines, test area fails); answers kept as editable, forgettable rules; Stop for the assistant, checks and automatic retries; “Why this verdict?”; study log now records participant, evidence looked at and settings changes | Participants could see the answers; the Baseline leaked the evidence condition; nothing tested over-reliance on the checks; several guidelines (L07 decline and turn-taking, L08 failure, L10 memory, G11) were missing | All six tasks in both views, every stop point, rule reuse and forgetting, participant session start and end; no console errors |

| 2026-11-16 | Study safeguards: practice task; per-participant shuffled task order, unlocked one at a time; identical briefing; NASA-TLX after each task; autosave and restore; one summary row per task (accounts for undo); the free-shipping revision only fixes the bug if the feedback names it; pre-filled revision text now describes the problem, not the fix | Learning effects, order effects, missing workload measure, data loss on reload, and the prototype giving away answers through scripted revisions and hints | Full participant session in both views; questionnaire cannot be skipped; reload restores the log; summary rows checked against the actions |
| 2026-11-16 | UI fixes from a bug sweep at 1500, 1100 and 400 px: nested dialogs closed each other (session briefing, workload after “Apply anyway”); evidence actions stayed clickable after a decision; no way back to the task list on smaller screens (logo and “All tasks” now go home); study log columns cut off (wider dialog); compact decision buttons on short screens; toast moved to the top on phones; “results are ready below” pointer on phones | Found by automated checks (overflow, unlabelled buttons, toast overlap, console errors) and by reviewing screenshots | All test scripts pass at three widths with no console errors |

| 2026-11-16 | Minimal redesign: two columns instead of three; workspace (your code, rules, tasks, files) moved into a drawer; view switch, settings, study log and “How checks work” moved into one menu; progress shown as one line of text; checks panel reduced to a verdict and one “Needs attention” list, with the first item open and everything else folded; actions shown only inside an opened item; near-monochrome palette with colour only for evidence status; Reject and Apply as an equal pair, with further steps as quieter links | Feedback that too much was on screen at once; less extraneous load (L05) without removing any evidence | All test scripts pass at three widths; fixed a layout clash in the “Checking the change” heading found while reviewing screenshots |

| 2026-11-16 | Dark mode as the default, with a Light option under Menu (remembered in the browser); every colour now comes from one set of theme variables | Requested; a light theme is kept for printed screenshots in the report | Both themes checked on every screen; all test scripts pass |

| 2026-11-16 | Replaced the Workspace drawer: task switching is a dropdown on the task name; “Your code” status (with Undo and your rules) is always visible in the top bar; rules also appear in the checks panel with Change and Forget beside them; file list removed (the diff names changed files) | The drawer hid whether real code had changed (visibility of system state, L06) and grouped unrelated things; L10 says to show what is remembered where it is used | All test scripts pass at three widths; phone header no longer overflows |

| 2026-11-16 | Settings page: theme (dark, light, match system), text size (4 steps), spacing, high contrast, colour-blind-safe status colours, motion, code wrapping, open all items, run checks automatically or on request, retry limit, risk confirmation, keyboard shortcuts; applied instantly, remembered in the browser, logged; behaviour settings fixed during study sessions. Accessibility: skip link, screen-reader announcements when checks finish or a decision is made, all type sizes in rem | Requested: fully accessible and customisable. Behaviour settings are locked in sessions so participants are compared under the same conditions | Every setting applies, persists after reload, resets, and locks in a session; shortcuts and announcements tested; all test scripts pass |

| 2026-11-16 | “What changed in your code”: each applied change can be viewed (from “Your code” or the confirmation message), showing the task and proposal, when it was applied, the code differences file by file, and the evidence at the moment it was applied (verdict, open problems, risks accepted with notes); “View all changes” shows every applied change together; undo works from inside the view | Requested: see what changed, not only undo. Keeping the evidence with the change is provenance (L11) and supports evaluating past decisions (gulf of evaluation, L06) | Applied, viewed, undone from the view and re-viewed in a test script; all suites pass |

_Add rows and commit links as the project develops._

## AI assistance

_Describe honestly before submission._ Draft: Claude (Anthropic) was used to generate the first version of the prototype code and the design-concept notes from my A1 literature review and the Week 1–4 lecture slides. I checked … and changed …

## Additional files

None. No ZIP is needed.
