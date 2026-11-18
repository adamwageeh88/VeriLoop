# VeriLoop — closed-loop verification for AI-generated code (simulated prototype)

Simulated prototype of an AI coding assistant that tests each proposed change on an isolated copy of the code and shows what was **checked**, what **failed** and what is still **unresolved** before the developer decides whether to apply it.
 
Intelligent Interactive Systems (37792), Assignment 2 · Adam Wageeh Mohamed Mohamed Hassen
 
README prose word count: 579 (excluding code and commands)
 
## Project status
 
**Works (implemented)**
- Request → proposal → checks → decision flow
- Evidence panel: verdict from results, "Needs attention", claims vs evidence, "Why this verdict?"
- Apply, reject, run more tests, revise, stop, undo, and a history of applied changes
- Resolving open items; answers kept as editable rules
- Settings, including accessibility options and keyboard shortcuts
- Evidence and baseline views, participant sessions, study log, NASA-TLX
**Simulated (scripted in `js/scenarios.js`)**
- The assistant (LLM), the test area and all test results
- Six tasks and a practice task; requests and revisions are scripted
**Unfinished (planned)**
- A real model with schema-checked claims and a real sandbox running `pytest`
- Free-text requests
## Technology stack
 
- HTML, CSS and JavaScript, with no framework or build step
- `js/scenarios.js`: scripted assistant output and results; `js/app.js`: interaction logic
- Browser storage: settings and the study log
- No AI model or API key at run time. Undecided: the model and sandbox for a real version
## Running or inspecting the work
 
Easiest: open the folder and double-click `index.html`.
 
Or serve it locally (needs Python 3):
 
```bash
git clone https://github.com/adamwageeh88/VeriLoop.git
cd VeriLoop
py -m http.server 8000        # Windows
python3 -m http.server 8000   # macOS / Linux
```
 
Then open http://localhost:8000.
 
- **Try first:** open "Add discount codes", send the request, then follow "Needs attention".
- **Compare:** Menu → View → Baseline, then run the same task.
- **Study session:** Menu → Study log → Start session. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> reopens the log. Or open `?pid=P01&view=baseline`.
- **Shortcuts:** press <kbd>?</kbd>.
## Development record
 
Commits: [commit history](https://github.com/adamwageeh88/VeriLoop/commits/main)

Note: the prototype was built locally and uploaded to GitHub once it was finished, so the commit history does not show the stages below. This table is the record of how the work developed; later fixes are committed separately.
 
| Stage | Date | Change | Why | Checked |
|---|---|---|---|---|
| 1 | 15 Nov 2026 | First prototype: evidence groups, claims vs evidence, both views, study log | Show the Assignment 1 idea without a backend | All tasks, both views |
| 2 | 15 Nov 2026 | Resolve actions on unresolved items | "Unresolved" gave no next step | Every resolve path |
| 3 | 15–16 Nov 2026 | Decline, Stop, "checks could not run", rules, "Why this verdict?" | Lecture audit found missing guidelines (L07, L08, L10, G11) | New tasks, every stop point |
| 4 | 15–16 Nov 2026 | Participant sessions, clean baseline, "Add free shipping", practice task, NASA-TLX | Threats to the planned study | Full session in both views |
| 5 | 16 Nov 2026 | Fixed dialogs closing each other and late clicks | Found by automated tests | All tests at three widths |
| 6 | 16 Nov 2026 | Minimal design, dark mode, "Your code" status in the top bar | Screen felt crowded; a drawer hid code status | Both themes |
| 7 | 16 Nov 2026 | Settings page; history of applied changes | Accessibility; undo alone hid what it reverses | Every setting persists and locks in sessions |
 
## AI assistance
 
**Tool:** Claude (Anthropic), in the Claude app.
 
**What I asked it to do**
- Build the prototype from my Assignment 1 review and the Weeks 1–4 slides
- Audit it against the lectures, redesign it, and add settings and change history
- Run browser tests and draft the report, diagram and storyboards
**How I used or changed its suggestions (examples)**
- I spotted that "unresolved" gave no way forward; Claude then added the resolve actions.
- I asked for a simpler, more professional look and for dark mode; I rejected the Workspace drawer and chose the always-visible code status from the alternatives Claude offered.
- I asked for the audit before any changes, then chose which gaps to fix first.
**How I checked the result**
- Ran it locally and went through each task myself
- Reviewed the test results and screenshots
- Checked the report against my Assignment 1 review and the slides
## Additional files
 
- `docs/design-concepts.md`: features mapped to lecture concepts, and study safeguards
- No ZIP file is needed.
