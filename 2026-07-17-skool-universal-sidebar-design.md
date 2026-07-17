# Universal Skool sidebar discovery

## Evidence

The supplied authenticated courses use three visible sidebar shapes:

- Level/Week courses with headings such as `Level 4 | Wk 2 | Knee Shield`.
- A completely flat course such as Choi Bar.
- Standalone courses with arbitrary collapsible headings such as `Offensive Tactics`, `Knee Cutting`, `Cross Ashi Garami`, and `Arm Bar Escapes`.

The current scanner incorrectly makes section recognition depend on the Level/Week wording. Its flat fallback then sees only links in the currently expanded section. Some Skool lesson anchors are also query-relative (`?md=<lesson-id>`), but version 3.1.1 resolves them against the origin rather than the current course URL.

## Approved architecture

1. Recognize a sidebar section structurally as a top-level Skool draggable `set-` container with a confirmed header row, rather than by matching its title text.
2. Derive the section title from the confirmed header row's title attribute or visible text. Any non-empty wording is valid.
3. Expand each confirmed collapsed section using the existing header-row click behavior and wait for same-course lesson links to appear.
4. Resolve every candidate lesson href against the full current course URL. Retain only same-origin, same-course-path URLs containing a non-empty `md` lesson identifier.
5. Preserve section and lesson DOM order. Deduplicate duplicate responsive copies by module identifier or `md` identifier.
6. Use the generated `Lessons` section only when no structural section groups exist.
7. Reject a genuine zero-lesson scan with a red error; never report it as completed.

## Safety

- Do not inspect document scripts, bootstrap data, performance resources, or hidden course-wide preload state.
- Do not press Play or navigate to Loom.
- Do not change existing storage keys or delete prior collection data.
- Only click elements confirmed to be section headers inside structural `set-` containers.

## Active-lesson video providers

The collector will detect both Loom and YouTube only inside the verified active lesson container.

- Loom URLs remain canonical `https://www.loom.com/share/<id>` URLs, preserving `sid` when present.
- YouTube embed, watch, short, live, `youtu.be`, and privacy-enhanced embed URLs normalize to `https://www.youtube.com/watch?v=<id>`.
- One shared video collection retains a `provider` field and deduplicates by `provider + id`; existing Loom-only records migrate in memory as provider `loom` without changing the storage key.
- Lesson results retain legacy `loomIds` and add `youtubeIds`, so old stored data remains readable.
- TXT, copy, CSV, JSON, hierarchy preview, activity messages, and verified counters include both providers. CSV keeps its existing Loom columns and appends generic provider/video columns.
- A lesson is marked with the existing internal no-video-compatible status only when neither Loom nor YouTube is found.
- YouTube metadata comes only from the visible iframe attributes; the collector does not call YouTube APIs, press Play, or inspect recommendations inside the cross-origin player.

## Verification

- Regression coverage for arbitrary section titles in DOM order.
- Regression coverage for query-relative `?md=` lesson URLs.
- Regression coverage preserving the flat Choi Bar fallback.
- Regression coverage for YouTube normalization, provider-aware deduplication, mixed-provider lesson results, and exports.
- Full Node test suite and JavaScript syntax check.
