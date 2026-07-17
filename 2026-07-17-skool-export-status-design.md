# Export status noise reduction

## Approved behavior

- Successful lessons remain present in structured copy, TXT, CSV, and JSON exports.
- Structured copy/TXT renders a successful lesson as `01. Lesson title` without `— Found`.
- CSV leaves the `status` cell empty for successful lessons.
- JSON omits the `status` property from successful hierarchy lessons and successful top-level lesson-result entries.
- `No Video` and `Error` remain explicit in structured output, and their machine-readable statuses remain present in CSV/JSON.
- URL-only copy remains unchanged because it contains no status text.
- The floating UI remains unchanged and may continue showing Found counts and live Found labels.

## Verification

- Regression tests cover structured text, CSV, JSON hierarchy, and JSON lesson-result output.
- The full Node test suite and userscript syntax check must pass.
