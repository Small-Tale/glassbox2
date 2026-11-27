# UX evaluation, 2026-11-27 (`HS2-F9Y9T5`)

A dated evaluation of the Glassbox 2 review workbench. It judges the shipped screens against the project's stated
intent (`clients/web/docs/ui-conventions.md` and Kerf's interaction conventions) through two lenses: Don Norman
(signifiers, mapping, feedback, conceptual model, gulfs of execution and evaluation) and Rory Sutherland (perceived
value, reassurance, small changes with a large perceived effect). Nothing here is implemented; each recommendation
waits for approval (see "Decisions needed").

## Method

- **How it was seen.** The real built application in Chromium against isolated seeded repositories, driven by the
  workbench browser suite with its capture directory set, so every capture is a real state (86 captures at 1440,
  940 and 390 wide, plus dialogs). Light and dark schemes appear where the suite captures them. The wide-to-narrow-
  to-wide transition is covered by the suite's resize steps.
- **Two reviewers.** The first review was written from the captures by the implementing agent. A second, independent
  review was written by a fresh agent given only the verbatim lens and 16 captures. Findings both raised are marked
  **both**; findings one reviewer raised that the captures or the code do not support are listed under "Dropped".
- **Covered.** Choosing a source and the changed-file navigator, the text diff with inline discussion and the
  Inspector, image comparison, risk and guidance analysis controls, Share Feedback and the settings dialogs, at wide,
  medium and narrow widths. Not covered: the desktop window itself (not driven), Windows, and the AI analysis flow
  against a real provider.
- **Not measured.** Contrast ratios, target sizes and font sizes below are judged by eye from captures. R6 asks for
  measurements before anything is changed on those grounds.

## The good (keep it)

- The diff reads clearly: row colour, line numbers and the hunk header carry the structure without chrome.
- Inline thread cards sit on the line they discuss, and the Inspector shows the reply chain beside it.
- "Files Reviewed 0 of N" with a progress bar is cheap, visible reassurance (Sutherland) and the check in a file
  row confirms it.
- The Diagram Renderers dialog says what is wrong ("Needs Setup"), what to do and how to re-check; the relocation
  card ("refers to an earlier version ... now at After line 5") explains itself and offers one clear action.
- Dialogs are consistent: a title, uppercase section labels, and Cancel or Close at the foot.

## Critical issues, ranked by user impact

1. **Icon-only controls with no visible meaning (both).** The footer cluster (share, appearance, AI settings,
   renderers, storage) is five small glyphs that cannot be told apart without hovering, and the file action bar
   (reviewed, copy link, copy path, reveal, open) and the toolbar's shield and compass have the same problem. A first-
   time reviewer cannot find Share Feedback, the one action that finishes the job. (Norman: signifiers.)
   Captures: `workbench-1440`, `workbench-390`, `storage-940`.
2. **The narrow layout spends the screen on chrome (both).** At 390 wide the comparison toolbar stacks into three
   rows before the first diff line (roughly 160 to 215 px of 900), the view-mode group touches or is clipped at the
   right edge, and split view wraps code mid-token. Captures: `workbench-390`, `find-split-390`, `history-940`.
3. **The Send to Hot Sheet dialog opens already failed (both).** A red "Could Not Send Feedback" banner shows before
   anything is attempted, "Choose a Project" reads like a heading rather than a missing value, "Create Ticket" is
   disabled without saying why, and "No feedback has been recorded." offers no next step. (Norman: feedback and the
   gulf of evaluation.) Capture: `export-390`.
4. **Empty states give no instruction (mine, supported by the second review in part).** The Inspector's "No
   Discussion Selected" is a large centred title in dead space, and the empty comparison says only "No File
   Selected". Neither says how to start (select a comment, or use the comment action on a line). Captures:
   `renderers-setup-1440`, `workbench-1440`.
5. **Technical text in user-facing dialogs (both, narrowed).** The Diagram Renderers dialog tells people to set
   `GLASSBOX_MERMAID_EXECUTABLE` and to restart; the Feedback Storage and AI Settings dialogs show full filesystem
   paths as body text. For the people who need them this is useful, but it leads the dialog. Captures:
   `renderers-setup-1440`, `ai-settings-390`, `storage-940`.
6. **Possible low-contrast and small-target problems (second reviewer, unverified).** Disabled toolbar buttons, the
   small "M" file badges, 11 px field labels and links on the dark theme looked borderline. This needs
   measurement, not opinion.
7. **Unexplained order modes (mine).** "Path / Risk / Narrative" is a three-way choice with no hint of what Risk or
   Narrative do or that they run an analysis. (Norman: conceptual model.) Capture: `progress-390`.
8. **Saving is silent after the fact (second reviewer, small).** "Saves automatically" is correct but nothing
   confirms a save happened. (Sutherland: reassurance.)

## Dropped

- "Move fields show before the user asks to move": the capture was taken with the Move form open on purpose.
- "Desktop Fixture" and a `/var/folders/...` path as product copy: these are test fixtures; only the pattern of
  leading with a raw path (issue 5) is real.
- "The dark theme shows the Before image at full brightness": that is image content, not chrome.
- "Reply Author is a field for something that never changes": it is editable per reply by design (`HS2-DSFN2E`); a
  remembered default would be a separate, smaller idea and is not recommended here.

## Recommendations

Each names the Kerf components that would own it, the principle, and the effort. "Mock" is the current capture plus
the proposed state in words, because a rendered mock for an idea that is then declined is wasted work; an approved
recommendation gets a rendered mock (through the Kerf design-mock workflow) before `HS2-249DRE` implements it.

| #   | Recommendation                                                                                                                                                                                                                                                                    | Principle                    | Impact | Effort |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------ | ------ |
| R1  | Show text beside the footer icons from the medium width up (`ToolbarControlGroup` with `content="icon-text"` for Share Feedback at least; the rest keep icons with tooltips), and label the file action bar the same way when the rail is wide.                                   | Signifiers                   | High   | Low    |
| R2  | At narrow widths put the secondary comparison tools (find, outline, risk, guidance, wrap) in one overflow `PopupMenu`, keep one toolbar row, default to the inline diff below the split-view minimum, and fix the clipped view-mode group.                                        | Constraints, cognitive load  | High   | Medium |
| R3  | Send to Hot Sheet: show the error only after a failed attempt, name the missing project as a field ("Hot Sheet Project: none chosen"), say why Create Ticket is disabled, and replace "No feedback has been recorded." with "Nothing to send yet. Add a comment on a line first." | Feedback, gulf of evaluation | High   | Low    |
| R4  | Give the empty Inspector and empty comparison one instruction line each, using `EmptyState` `detail`.                                                                                                                                                                             | Conceptual model             | Medium | Low    |
| R5  | Lead the renderer, storage and AI dialogs with the human sentence; put environment variable names and full paths in a `Disclosure`, and add a Copy Path action where a path is shown.                                                                                             | Cognitive load               | Medium | Low    |
| R6  | Measure contrast and target sizes for the toolbar, badges, labels and dark-theme links against WCAG 2.2 AA and the Kerf minimums, then file only the failures. Measurement only.                                                                                                  | Evidence before change       | Medium | Low    |
| R7  | Add a one-line description to each order mode (Path: A to Z; Risk: highest risk first, runs an analysis; Narrative: in reading order, runs an analysis), as tooltips or helper text.                                                                                              | Conceptual model             | Medium | Low    |
| R8  | Show "Saved" briefly after an autosave settles, next to "Saves automatically".                                                                                                                                                                                                    | Feedback, reassurance        | Low    | Low    |

## Decisions

The maintainer answered on `HS2-F9Y9T5` on 2026-11-27. Each approved change is its own ticket, matched to a rendered
mock and an after capture before it ships.

| #   | Decision                    | Ticket       |
| --- | --------------------------- | ------------ |
| R1  | Declined                    | none         |
| R2  | Approved                    | `GB2-8T670B` |
| R3  | Approved                    | `GB2-8JB784` |
| R4  | Approved                    | `GB2-WYTJSX` |
| R5  | Approved                    | `GB2-SWK512` |
| R6  | Approved (measurement only) | `GB2-6NVCBB` |
| R7  | Approved                    | `GB2-173Q1Q` |
| R8  | Approved                    | `GB2-1VSZDE` |
