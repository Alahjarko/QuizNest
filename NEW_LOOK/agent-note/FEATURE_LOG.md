# QuizNest Feature Log

## 2026-06-19 - Academic Problem Solver UI

Model: Codex (GPT-5)

- Added semantic design tokens for paper surfaces, restrained green and review orange, borders, spacing, shadows, and responsive content widths.
- Reworked the question set library into searchable problem-set archive cards with one primary action and secondary actions in an overflow menu.
- Reworked the mistake journal into summary-first diagnostic cards with expandable answers, explanations, review actions, and exact set filtering.
- Reworked the tutor into a context-first problem solver workspace with removable context chips, a compact inspector, quick follow-up prompts, and a fixed composer.
- Reworked the home page into a daily study desk with a personal cover, current practice, review priorities, recent sets, and recent notes.
- Reworked statistics into learning insights. Practice, streaks, weak sections, question-type accuracy, active notes, and tutor focus now lead the page; token usage is retained in a collapsed section.
- Reorganized settings into model, appearance, long-term memory, and data-management groups without changing persistence behavior.
- Made local DMG packaging generate the disk image in the system temporary directory before copying it into the cloud-synced workspace, preventing intermittent `hdiutil` resource-busy failures.
- Preserved light/dark themes, local profile customization, heatmap modes and tooltips, notebook data, AI configuration, memory management, and backup flows.

Verification:

- All JavaScript files pass `node --check`.
- `npm run sync-dist` passes.
- `git diff --check` reports no whitespace errors in `NEW_LOOK/src`.
- `QuizNest_0.1.5_aarch64.dmg` builds successfully and passes `hdiutil verify`.
