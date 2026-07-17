# Flat standalone course fallback

## Problem

The collector currently recognizes sidebar sections only when a draggable section heading matches `Level <number> | Wk <number> | ...`. Standalone courses such as Choi Bar have a flat sidebar containing lesson links directly beneath the course title. The scan therefore produces zero sections and zero lessons, then incorrectly reports completion.

## Approved behavior

- Keep the existing grouped-section scan unchanged for Level/Week courses.
- When no grouped sections are found, collect the visible same-course lesson links from the sidebar in DOM order and place them in one generated section named `Lessons`.
- Preserve the existing lesson metadata fields and navigation behavior.
- If neither grouped nor flat lessons can be found, stop with a red `No accessible lessons found` error instead of declaring the course complete.
- Do not change or clear existing Loom records, lesson results, exports, or Tampermonkey storage keys.

## Verification

- A regression test models Choi Bar's ten flat lessons and verifies their order and generated `Lessons` section.
- A regression test verifies that a genuinely empty scan is not considered a completed course.
- The complete existing Node test suite and a userscript syntax check must pass.
