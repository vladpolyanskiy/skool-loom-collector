// ==UserScript==
// @name         Skool Loom Collector + Status UI
// @namespace    local.skool.loom.collector
// @version      3.2.0
// @description  Automatically visits Skool courses and lessons, collecting active-lesson Loom and YouTube URLs without playback or downloads.
// @author       Local
// @homepageURL  https://github.com/vladpolyanskiy/skool-loom-collector
// @supportURL   https://github.com/vladpolyanskiy/skool-loom-collector/issues
// @downloadURL  https://raw.githubusercontent.com/vladpolyanskiy/skool-loom-collector/main/skool-loom-collector.user.js
// @updateURL    https://raw.githubusercontent.com/vladpolyanskiy/skool-loom-collector/main/skool-loom-collector.user.js
// @match        https://www.skool.com/*
// @match        https://skool.com/*
// @match        https://www.loom.com/embed/*
// @match        https://loom.com/embed/*
// @match        https://www.loom.com/share/*
// @match        https://loom.com/share/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// ==/UserScript==

(function () {
    'use strict';

    const ITEMS_KEY = 'skoolLoomCollector.items.v1';
    const METADATA_KEY = 'skoolLoomCollector.metadata.v2';
    const SETTINGS_KEY = 'skoolLoomCollector.settings.v2';
    const STATE_KEY = 'skoolLoomCollector.state.v3';
    const RESULTS_KEY = 'skoolLoomCollector.lessonResults.v3';
    const UI_ID = 'skool-loom-collector-root';
    const STYLE_ID = 'skool-loom-collector-style-v3';
    const ROUTE_EVENT = 'skool-loom-collector-route-v3';

    const LOOM_ID_PATTERN = '[0-9a-fA-F]{32}';
    const LOOM_PATH_PATTERN = new RegExp(
        `\\/(?:share|embed)\\/(${LOOM_ID_PATTERN})(?:$|[/?#])`,
        'i'
    );
    const COURSE_CARD_SELECTOR =
        'div[role="button"][aria-roledescription="sortable"][tabindex="0"]';
    const SECTION_GROUP_SELECTOR =
        '[data-rbd-draggable-id^="set-"]';
    const LESSON_LINK_SELECTOR =
        'a[href*="/classroom/"]';
    const MODULE_IDENTIFIER_SELECTOR =
        '[data-rbd-draggable-id^="setModule-"]';
    const ACTIVE_PHASES = new Set([
        'scanning-catalog',
        'entering-course',
        'scanning-course',
        'running',
        'navigating-lesson',
        'waiting-for-lesson',
        'collecting',
        'between-lessons',
        'returning-to-catalog'
    ]);

    const DEFAULT_SETTINGS = Object.freeze({
        lessonTimeoutMs: 10000,
        routeTimeoutMs: 12000,
        minDelayMs: 800,
        maxDelayMs: 1500,
        maxNavigationFailures: 3,
        maxLogEntries: 300
    });

    function cleanText(value) {
        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function finiteOrNull(value) {
        const number = Number(value);

        return Number.isFinite(number) && number > 0
            ? number
            : null;
    }

    function uniqueStrings(values) {
        return [
            ...new Set(
                (Array.isArray(values) ? values : [])
                    .map((value) => cleanText(value))
                    .filter(Boolean)
            )
        ].sort();
    }

    function uniqueQualities(values) {
        return [
            ...new Set(
                (Array.isArray(values) ? values : [])
                    .map(Number)
                    .filter((value) => {
                        return (
                            Number.isFinite(value) &&
                            value >= 144 &&
                            value <= 4320
                        );
                    })
            )
        ].sort((left, right) => right - left);
    }

    function normalizeMetadata(raw, id = '') {
        const source = raw && typeof raw === 'object'
            ? raw
            : {};
        const width = finiteOrNull(source.width);
        const height = finiteOrNull(source.height);
        const qualities = uniqueQualities([
            ...(Array.isArray(source.qualities)
                ? source.qualities
                : []),
            height
        ]);

        return {
            id: cleanText(source.id || id).toLowerCase(),
            title: cleanText(source.title).slice(0, 240),
            formats: uniqueStrings(source.formats),
            qualities,
            width,
            height: Math.max(height || 0, qualities[0] || 0) || null,
            duration: finiteOrNull(source.duration),
            detectedAt: source.detectedAt || null
        };
    }

    function mergeMetadata(existing, incoming, id = '') {
        const left = normalizeMetadata(existing, id);
        const right = normalizeMetadata(incoming, id);
        const qualities = uniqueQualities([
            ...left.qualities,
            ...right.qualities,
            left.height,
            right.height
        ]);

        return {
            id: cleanText(right.id || left.id || id).toLowerCase(),
            title: cleanText(right.title || left.title).slice(0, 240),
            formats: uniqueStrings([
                ...left.formats,
                ...right.formats
            ]),
            qualities,
            width: Math.max(left.width || 0, right.width || 0) || null,
            height: Math.max(
                left.height || 0,
                right.height || 0,
                qualities[0] || 0
            ) || null,
            duration: Math.max(
                left.duration || 0,
                right.duration || 0
            ) || null,
            detectedAt:
                right.detectedAt ||
                left.detectedAt ||
                null
        };
    }

    function normalizeLoomUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') {
            return null;
        }

        try {
            const url = new URL(rawUrl.replace(/&amp;/gi, '&'));
            const hostname = url.hostname
                .toLowerCase()
                .replace(/^www\./, '');

            if (hostname !== 'loom.com') {
                return null;
            }

            const match = url.pathname.match(LOOM_PATH_PATTERN);

            if (!match) {
                return null;
            }

            const id = match[1].toLowerCase();
            const sid = cleanText(url.searchParams.get('sid'));
            const suffix = sid
                ? `?sid=${encodeURIComponent(sid)}`
                : '';

            return {
                id,
                sid,
                shareUrl: `https://www.loom.com/share/${id}${suffix}`,
                embedUrl: `https://www.loom.com/embed/${id}${suffix}`
            };
        } catch {
            return null;
        }
    }

    function normalizeYouTubeUrl(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') {
            return null;
        }

        let url;

        try {
            url = new URL(rawUrl, 'https://www.youtube.com');
        } catch {
            return null;
        }

        const host = url.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, '');
        let id = '';

        if (host === 'youtu.be') {
            id = url.pathname.split('/').filter(Boolean)[0] || '';
        } else if (
            host === 'youtube.com' ||
            host === 'youtube-nocookie.com'
        ) {
            const parts = url.pathname.split('/').filter(Boolean);

            if (url.pathname === '/watch') {
                id = url.searchParams.get('v') || '';
            } else if (['embed', 'shorts', 'live'].includes(parts[0])) {
                id = parts[1] || '';
            }
        }

        if (!/^[A-Za-z0-9_-]{11}$/.test(id)) {
            return null;
        }

        return {
            provider: 'youtube',
            id,
            url: `https://www.youtube.com/watch?v=${id}`,
            embedUrl: `https://www.youtube.com/embed/${id}`
        };
    }

    function normalizeVideoUrl(rawUrl) {
        const loom = normalizeLoomUrl(rawUrl);

        if (loom) {
            return {
                provider: 'loom',
                id: loom.id,
                url: loom.shareUrl,
                embedUrl: loom.embedUrl,
                sid: loom.sid,
                shareUrl: loom.shareUrl
            };
        }

        return normalizeYouTubeUrl(rawUrl);
    }

    function normalizeVideoProvider(provider) {
        return cleanText(provider).toLowerCase() === 'youtube'
            ? 'youtube'
            : 'loom';
    }

    function normalizeProviderVideoId(provider, id) {
        const cleaned = cleanText(id);

        return normalizeVideoProvider(provider) === 'loom'
            ? cleaned.toLowerCase()
            : cleaned;
    }

    function videoRecordKey(provider, id) {
        const normalizedProvider = normalizeVideoProvider(provider);
        const normalizedId = normalizeProviderVideoId(
            normalizedProvider,
            id
        );

        return `${normalizedProvider}:${normalizedId}`;
    }

    function resultVideoReferences(result) {
        const references = [];

        (Array.isArray(result?.loomIds) ? result.loomIds : [])
            .forEach((id) => {
                const normalizedId = normalizeProviderVideoId('loom', id);

                if (normalizedId) {
                    references.push({ provider: 'loom', id: normalizedId });
                }
            });
        (Array.isArray(result?.youtubeIds) ? result.youtubeIds : [])
            .forEach((id) => {
                const normalizedId = normalizeProviderVideoId('youtube', id);

                if (normalizedId) {
                    references.push({ provider: 'youtube', id: normalizedId });
                }
            });

        return [...new Map(references.map((reference) => [
            videoRecordKey(reference.provider, reference.id),
            reference
        ])).values()];
    }

    function normalizeLessonPage(raw) {
        const source = raw && typeof raw === 'object'
            ? raw
            : {};
        const sectionIndex = Number(source.sectionIndex);
        const lessonIndex = Number(source.lessonIndex);
        const globalLessonIndex = Number(source.globalLessonIndex);
        const courseIndex = Number(source.courseIndex);

        return {
            courseTitle: cleanText(source.courseTitle || source.course),
            courseIndex: Number.isFinite(courseIndex) ? courseIndex : 0,
            sectionTitle: cleanText(
                source.sectionTitle ||
                source.section ||
                source.groupTitle
            ),
            sectionIndex: Number.isFinite(sectionIndex) ? sectionIndex : 0,
            lessonTitle: cleanText(
                source.lessonTitle ||
                source.title ||
                source.lesson
            ),
            lessonIndex: Number.isFinite(lessonIndex) ? lessonIndex : 0,
            globalLessonIndex: Number.isFinite(globalLessonIndex)
                ? globalLessonIndex
                : Number.isFinite(lessonIndex)
                    ? lessonIndex
                    : 0,
            skoolUrl: cleanText(source.skoolUrl || source.url),
            elementSelectorOrIdentifier: cleanText(
                source.elementSelectorOrIdentifier ||
                source.identifier
            ) || null
        };
    }

    function lessonKey(rawLesson) {
        const lesson = normalizeLessonPage(rawLesson);
        let routeId = '';

        try {
            routeId = new URL(lesson.skoolUrl).searchParams.get('md') || '';
        } catch {
            routeId = '';
        }

        return [
            lesson.courseTitle.toLowerCase(),
            routeId || lesson.elementSelectorOrIdentifier || '',
            lesson.sectionIndex,
            lesson.lessonIndex,
            lesson.lessonTitle.toLowerCase()
        ].join('::');
    }

    function lessonRelationshipKey(rawLesson) {
        const lesson = normalizeLessonPage(rawLesson);

        return [
            lessonKey(lesson),
            lesson.skoolUrl
        ].join('::');
    }

    function normalizeItems(raw, fallbackDate = new Date().toISOString()) {
        if (!Array.isArray(raw)) {
            return [];
        }

        const records = new Map();

        for (const candidate of raw) {
            if (!candidate || typeof candidate !== 'object') {
                continue;
            }

            const provider = normalizeVideoProvider(candidate.provider);
            const fallbackUrl = provider === 'youtube'
                ? `https://www.youtube.com/watch?v=${candidate.id || ''}`
                : `https://www.loom.com/share/${candidate.id || ''}`;
            const normalizedUrl = normalizeVideoUrl(
                candidate.url ||
                candidate.embedUrl ||
                fallbackUrl
            );

            if (!normalizedUrl) {
                continue;
            }

            const id = normalizeProviderVideoId(
                normalizedUrl.provider,
                normalizedUrl.id
            );
            const key = videoRecordKey(normalizedUrl.provider, id);
            const pages = Array.isArray(candidate.lessonPages)
                ? candidate.lessonPages.map(normalizeLessonPage)
                : [];
            const current = records.get(key);
            const incoming = {
                provider: normalizedUrl.provider,
                id,
                url: normalizedUrl.url,
                embedUrl: normalizedUrl.embedUrl,
                firstSeenAt: candidate.firstSeenAt || fallbackDate,
                lastSeenAt:
                    candidate.lastSeenAt ||
                    candidate.firstSeenAt ||
                    fallbackDate,
                metadata: normalizeMetadata(candidate.metadata, id),
                lessonPages: pages
            };

            if (!current) {
                incoming.lessonPages = [
                    ...new Map(
                        incoming.lessonPages.map((page) => [
                            lessonRelationshipKey(page),
                            page
                        ])
                    ).values()
                ];
                records.set(key, incoming);
                continue;
            }

            const relationships = new Map(
                current.lessonPages.map((page) => [
                    lessonRelationshipKey(page),
                    page
                ])
            );

            for (const page of incoming.lessonPages) {
                relationships.set(lessonRelationshipKey(page), page);
            }

            if (current.provider === 'loom') {
                current.url = current.url.includes('?sid=')
                    ? current.url
                    : incoming.url;
                current.embedUrl = current.embedUrl.includes('?sid=')
                    ? current.embedUrl
                    : incoming.embedUrl;
            } else {
                current.url = incoming.url;
                current.embedUrl = incoming.embedUrl;
            }
            current.firstSeenAt = [
                current.firstSeenAt,
                incoming.firstSeenAt
            ].filter(Boolean).sort()[0] || fallbackDate;
            current.lastSeenAt = [
                current.lastSeenAt,
                incoming.lastSeenAt
            ].filter(Boolean).sort().at(-1) || fallbackDate;
            current.metadata = mergeMetadata(
                current.metadata,
                incoming.metadata,
                id
            );
            current.lessonPages = [...relationships.values()];
        }

        return [...records.values()];
    }

    function mergeVideoRecord(
        rawItems,
        rawDetection,
        rawLesson,
        now = new Date().toISOString()
    ) {
        const items = normalizeItems(rawItems, now);
        const normalizedUrl = normalizeVideoUrl(
            rawDetection?.shareUrl ||
            rawDetection?.url ||
            rawDetection?.embedUrl ||
            ''
        );

        if (!normalizedUrl) {
            return {
                items,
                record: null,
                isNewVideo: false,
                isNewRelationship: false
            };
        }

        const lesson = normalizeLessonPage(rawLesson);
        const relationship = lessonRelationshipKey(lesson);
        const provider = normalizedUrl.provider;
        const id = normalizeProviderVideoId(provider, normalizedUrl.id);
        const key = videoRecordKey(provider, id);
        let record = items.find((item) => {
            return videoRecordKey(item.provider, item.id) === key;
        });
        const isNewVideo = !record;

        if (!record) {
            record = {
                provider,
                id,
                url: normalizedUrl.url,
                embedUrl: normalizedUrl.embedUrl,
                firstSeenAt: now,
                lastSeenAt: now,
                metadata: normalizeMetadata(
                    rawDetection?.metadata,
                    id
                ),
                lessonPages: []
            };
            items.push(record);
        }

        const isNewRelationship = !record.lessonPages.some((page) => {
            return lessonRelationshipKey(page) === relationship;
        });

        if (isNewRelationship) {
            record.lessonPages.push(lesson);
        }

        if (
            provider !== 'loom' ||
            !record.url.includes('?sid=') ||
            normalizedUrl.sid
        ) {
            record.url = normalizedUrl.url;
            record.embedUrl = normalizedUrl.embedUrl;
        }

        record.lastSeenAt = now;
        record.metadata = mergeMetadata(
            record.metadata,
            rawDetection?.metadata,
            id
        );

        return {
            items,
            record,
            isNewVideo,
            isNewRelationship
        };
    }

    function sectionsWithFlatFallback(sections, flatLessons) {
        if (Array.isArray(sections) && sections.length) {
            return sections;
        }

        return Array.isArray(flatLessons) && flatLessons.length
            ? [{ title: 'Lessons', lessons: flatLessons }]
            : [];
    }

    function isInvalidEmptyCourseScan(queue, retryOnly) {
        return !retryOnly && (!Array.isArray(queue) || queue.length === 0);
    }

    function isSameCourseLessonHref(href, currentHref) {
        try {
            const current = new URL(currentHref);
            const candidate = new URL(href, current.href);

            return (
                candidate.origin === current.origin &&
                candidate.pathname.replace(/\/$/, '') ===
                    current.pathname.replace(/\/$/, '') &&
                Boolean(candidate.searchParams.get('md'))
            );
        } catch {
            return false;
        }
    }

    function sectionDescriptorFromGroup(group) {
        const headerRow = group?.firstElementChild?.firstElementChild;

        if (!headerRow?.querySelector?.('svg')) {
            return null;
        }

        const titledText = [...headerRow.querySelectorAll('[title]')]
            .map((element) => cleanText(element.getAttribute('title')))
            .find(Boolean);
        const title = titledText || cleanText(headerRow.textContent);

        return title
            ? { group, headerRow, title }
            : null;
    }

    function buildQueueFromSectionData(
        courseTitle,
        courseIndex,
        sections,
        origin = 'https://www.skool.com'
    ) {
        const queue = [];
        let globalLessonIndex = 0;

        (Array.isArray(sections) ? sections : []).forEach(
            (section, sectionIndex) => {
                const sectionTitle = cleanText(section?.title);
                const lessons = Array.isArray(section?.lessons)
                    ? section.lessons
                    : [];

                lessons.forEach((rawLesson, lessonIndex) => {
                    let skoolUrl = null;

                    try {
                        skoolUrl = rawLesson?.href
                            ? new URL(rawLesson.href, origin).href
                            : null;
                    } catch {
                        skoolUrl = null;
                    }

                    queue.push({
                        courseTitle: cleanText(courseTitle),
                        courseIndex: Number.isFinite(Number(courseIndex))
                            ? Number(courseIndex)
                            : 0,
                        sectionTitle,
                        sectionIndex,
                        lessonTitle: cleanText(rawLesson?.title),
                        lessonIndex,
                        globalLessonIndex,
                        skoolUrl,
                        elementSelectorOrIdentifier:
                            cleanText(rawLesson?.identifier) || null
                    });

                    globalLessonIndex += 1;
                });
            }
        );

        return queue;
    }

    function compareLessons(leftRaw, rightRaw) {
        const left = normalizeLessonPage(leftRaw);
        const right = normalizeLessonPage(rightRaw);

        return (
            left.courseIndex - right.courseIndex ||
            left.sectionIndex - right.sectionIndex ||
            left.lessonIndex - right.lessonIndex ||
            left.globalLessonIndex - right.globalLessonIndex ||
            left.lessonTitle.localeCompare(right.lessonTitle)
        );
    }

    function escapeCsv(value) {
        const text = value === null || value === undefined
            ? ''
            : String(value);

        return /[",\r\n]/.test(text)
            ? `"${text.replace(/"/g, '""')}"`
            : text;
    }

    function formatQuality(metadata) {
        const qualities = uniqueQualities([
            ...(Array.isArray(metadata?.qualities)
                ? metadata.qualities
                : []),
            metadata?.height
        ]);

        return qualities[0]
            ? `${qualities[0]}p`
            : '';
    }

    function buildVerifiedCollection(rawResults, rawItems) {
        const results = rawResults && typeof rawResults === 'object'
            ? Object.values(rawResults)
                .filter((result) => result?.lesson)
                .sort((left, right) => {
                    return compareLessons(left.lesson, right.lesson);
                })
            : [];
        const allItems = normalizeItems(rawItems);
        const requestedKeys = new Set();

        results.forEach((result) => {
            if (result.status !== 'found') {
                return;
            }

            resultVideoReferences(result).forEach((reference) => {
                requestedKeys.add(videoRecordKey(
                    reference.provider,
                    reference.id
                ));
            });
        });

        const items = allItems.filter((item) => {
            return requestedKeys.has(videoRecordKey(item.provider, item.id));
        });
        const verifiedIds = items.map((item) => {
            return item.provider === 'loom'
                ? item.id
                : videoRecordKey(item.provider, item.id);
        });
        const availableKeys = new Set(items.map((item) => {
            return videoRecordKey(item.provider, item.id);
        }));
        const lessonCount = results.filter((result) => {
            return result.status === 'found' &&
                resultVideoReferences(result).some((reference) => {
                    return availableKeys.has(videoRecordKey(
                        reference.provider,
                        reference.id
                    ));
                });
        }).length;

        return {
            results,
            items,
            verifiedIds,
            lessonCount,
            legacyCount: Math.max(0, allItems.length - items.length)
        };
    }

    function buildStructuredText(rawResults, rawItems) {
        const view = buildVerifiedCollection(rawResults, rawItems);
        const itemMap = new Map(view.items.map((item) => [
            videoRecordKey(item.provider, item.id),
            item
        ]));
        const lines = [];
        let currentCourse = '';
        let currentSection = '';

        view.results.forEach((result) => {
            const lesson = normalizeLessonPage(result.lesson);

            if (lesson.courseTitle !== currentCourse) {
                if (lines.length) {
                    lines.push('');
                }

                currentCourse = lesson.courseTitle || 'Untitled course';
                currentSection = '';
                lines.push(currentCourse, '');
            }

            if (lesson.sectionTitle !== currentSection) {
                if (currentSection && lines[lines.length - 1] !== '') {
                    lines.push('');
                }

                currentSection = lesson.sectionTitle || 'Untitled section';
                lines.push(currentSection);
            }

            const status = result.status === 'found'
                ? 'Found'
                : result.status === 'no-loom'
                    ? 'No Video'
                    : 'Error';
            const lessonNumber = String(lesson.lessonIndex + 1).padStart(2, '0');
            lines.push(`  ${lessonNumber}. ${lesson.lessonTitle} — ${status}`);

            if (result.status === 'found') {
                resultVideoReferences(result)
                    .map((reference) => itemMap.get(videoRecordKey(
                        reference.provider,
                        reference.id
                    )))
                    .filter(Boolean)
                    .forEach((item) => {
                        lines.push(`      ${item.url}`);
                    });
            }
        });

        return lines.join('\n').trim();
    }

    function buildCsv(rawResults, rawItems) {
        const view = buildVerifiedCollection(rawResults, rawItems);
        const results = view.results;
        const items = view.items;
        const itemMap = new Map(items.map((item) => [
            videoRecordKey(item.provider, item.id),
            item
        ]));
        const headers = [
            'course_title',
            'section_index',
            'section_title',
            'lesson_index',
            'global_lesson_index',
            'lesson_title',
            'skool_url',
            'status',
            'loom_id',
            'loom_url',
            'loom_title',
            'quality',
            'formats',
            'duration_seconds',
            'first_seen_at',
            'last_seen_at',
            'video_provider',
            'video_id',
            'video_url',
            'video_title'
        ];
        const rows = [];

        results
            .filter((result) => result?.lesson)
            .sort((left, right) => {
                return compareLessons(left.lesson, right.lesson);
            })
            .forEach((result) => {
                const lesson = normalizeLessonPage(result.lesson);
                const references = resultVideoReferences(result);
                const rowsForLesson = references.length
                    ? references
                    : [{ provider: '', id: '' }];

                rowsForLesson.forEach((reference) => {
                    const item = reference.id
                        ? itemMap.get(videoRecordKey(
                            reference.provider,
                            reference.id
                        ))
                        : null;
                    const metadata = item?.metadata || {};
                    const isLoom = reference.provider === 'loom';

                    rows.push([
                        lesson.courseTitle,
                        lesson.sectionIndex,
                        lesson.sectionTitle,
                        lesson.lessonIndex,
                        lesson.globalLessonIndex,
                        lesson.lessonTitle,
                        lesson.skoolUrl,
                        result.status || '',
                        isLoom ? reference.id : '',
                        isLoom
                            ? (item?.url || (reference.id
                                ? `https://www.loom.com/share/${reference.id}`
                                : ''))
                            : '',
                        isLoom ? (metadata.title || '') : '',
                        item ? formatQuality(metadata) : '',
                        item && Array.isArray(metadata.formats)
                            ? metadata.formats.join('|')
                            : '',
                        item?.metadata?.duration || '',
                        item?.firstSeenAt || result.firstSeenAt || '',
                        item?.lastSeenAt || result.lastSeenAt || '',
                        reference.provider,
                        reference.id,
                        item?.url || '',
                        metadata.title || ''
                    ]);
                });
            });

        return [headers, ...rows]
            .map((row) => row.map(escapeCsv).join(','))
            .join('\r\n');
    }

    function buildJsonExport({
        state,
        results: rawResults,
        items: rawItems,
        settings,
        exportedAt = new Date().toISOString()
    }) {
        const view = buildVerifiedCollection(rawResults, rawItems);
        const items = view.items;
        const itemMap = new Map(items.map((item) => [
            videoRecordKey(item.provider, item.id),
            item
        ]));
        const results = view.results;
        const courses = [];
        const courseMap = new Map();

        for (const result of results) {
            const lesson = normalizeLessonPage(result.lesson);
            const courseMapKey = [
                lesson.courseIndex,
                lesson.courseTitle
            ].join('::');
            let course = courseMap.get(courseMapKey);

            if (!course) {
                course = {
                    title: lesson.courseTitle,
                    courseIndex: lesson.courseIndex,
                    sections: []
                };
                courseMap.set(courseMapKey, course);
                courses.push(course);
            }

            let section = course.sections.find((candidate) => {
                return candidate.sectionIndex === lesson.sectionIndex;
            });

            if (!section) {
                section = {
                    title: lesson.sectionTitle,
                    sectionIndex: lesson.sectionIndex,
                    lessons: []
                };
                course.sections.push(section);
            }

            section.lessons.push({
                ...lesson,
                status: result.status || '',
                outcome: result.outcome || '',
                error: result.error || null,
                firstSeenAt: result.firstSeenAt || null,
                lastSeenAt: result.lastSeenAt || null,
                videos: resultVideoReferences(result)
                    .map((reference) => itemMap.get(videoRecordKey(
                        reference.provider,
                        reference.id
                    )))
                    .filter(Boolean)
            });
        }

        courses.sort((left, right) => {
            return left.courseIndex - right.courseIndex;
        });
        courses.forEach((course) => {
            course.sections.sort((left, right) => {
                return left.sectionIndex - right.sectionIndex;
            });
            course.sections.forEach((section) => {
                section.lessons.sort(compareLessons);
            });
        });

        return {
            schemaVersion: 4,
            exportedAt,
            courses,
            videos: items,
            lessonResults: rawResults || {},
            runState: state || defaultState(),
            settings: {
                ...DEFAULT_SETTINGS,
                ...(settings && typeof settings === 'object'
                    ? settings
                    : {})
            }
        };
    }

    function defaultState() {
        return {
            version: 3,
            mode: null,
            status: 'idle',
            interruptedStatus: null,
            tone: 'gray',
            message: 'Ready',
            catalogUrl: '',
            courseQueue: [],
            courseQueueIndex: 0,
            queue: [],
            queueReady: false,
            queueIndex: 0,
            currentTarget: null,
            routeGeneration: 0,
            navigationFailures: 0,
            completedLessonIds: [],
            failedLessonIds: [],
            noLoomLessonIds: [],
            activityLog: [],
            retryOnly: false,
            startedAt: null,
            completedAt: null,
            lastUpdatedAt: null
        };
    }

    function buildResetSnapshot(rawSettings) {
        return {
            items: [],
            results: {},
            metadata: {},
            settings: {
                ...DEFAULT_SETTINGS,
                ...(rawSettings && typeof rawSettings === 'object'
                    ? rawSettings
                    : {})
            },
            state: defaultState()
        };
    }

    function isResetConfirmationActive(deadline, now = Date.now()) {
        const deadlineNumber = Number(deadline);
        const nowNumber = Number(now);

        return Number.isFinite(deadlineNumber) &&
            deadlineNumber > 0 &&
            Number.isFinite(nowNumber) &&
            deadlineNumber > nowNumber;
    }

    function restoreState(raw) {
        const source = raw && typeof raw === 'object'
            ? raw
            : {};
        const restored = {
            ...defaultState(),
            ...source,
            courseQueue: Array.isArray(source.courseQueue)
                ? source.courseQueue
                : [],
            queue: Array.isArray(source.queue)
                ? source.queue.map(normalizeLessonPage)
                : [],
            completedLessonIds: Array.isArray(source.completedLessonIds)
                ? [...new Set(source.completedLessonIds)]
                : [],
            failedLessonIds: Array.isArray(source.failedLessonIds)
                ? [...new Set(source.failedLessonIds)]
                : [],
            noLoomLessonIds: Array.isArray(source.noLoomLessonIds)
                ? [...new Set(source.noLoomLessonIds)]
                : [],
            activityLog: Array.isArray(source.activityLog)
                ? source.activityLog
                : []
        };

        if (ACTIVE_PHASES.has(restored.status)) {
            restored.interruptedStatus = restored.status;
            restored.status = 'awaiting-resume';
            restored.tone = 'purple';
            restored.message = 'Automatic run was interrupted. Click Resume.';
        }

        return restored;
    }

    function canCommitLessonDetection(state, generation, targetLessonId) {
        return Boolean(
            state &&
            state.status === 'collecting' &&
            Number(state.routeGeneration) === Number(generation) &&
            state.currentTarget &&
            Number(state.currentTarget.generation) === Number(generation) &&
            state.currentTarget.lessonId === targetLessonId
        );
    }

    function getCourseCardClickTarget(card) {
        if (!card || typeof card.querySelector !== 'function') {
            return card || null;
        }

        return card.querySelector('img[alt]') ||
            card.querySelector('[title]') ||
            card.firstElementChild ||
            card;
    }

    const TEST_API = {
        normalizeLoomUrl,
        normalizeYouTubeUrl,
        normalizeVideoUrl,
        normalizeMetadata,
        mergeMetadata,
        normalizeLessonPage,
        normalizeItems,
        mergeVideoRecord,
        lessonKey,
        sectionsWithFlatFallback,
        isInvalidEmptyCourseScan,
        isSameCourseLessonHref,
        sectionDescriptorFromGroup,
        buildQueueFromSectionData,
        compareLessons,
        escapeCsv,
        buildCsv,
        buildJsonExport,
        buildVerifiedCollection,
        buildStructuredText,
        buildResetSnapshot,
        isResetConfirmationActive,
        defaultState,
        restoreState,
        canCommitLessonDetection,
        getCourseCardClickTarget
    };

    if (typeof module === 'object' && module.exports) {
        module.exports = TEST_API;
        return;
    }

    const hostname = location.hostname
        .toLowerCase()
        .replace(/^www\./, '');
    const isLoomPage = hostname === 'loom.com';
    const isSkoolPage = hostname === 'skool.com';

    if (isLoomPage) {
        runLoomMetadataBridge();
        return;
    }

    if (!isSkoolPage || window.top !== window.self) {
        return;
    }

    runSkoolCollector();

    function runLoomMetadataBridge() {
        if (window.__SKOOL_LOOM_METADATA_BRIDGE_V3__) {
            return;
        }

        window.__SKOOL_LOOM_METADATA_BRIDGE_V3__ = true;

        const normalized = normalizeLoomUrl(location.href);

        if (!normalized) {
            return;
        }

        let lastSignature = '';
        let publishTimer = null;

        function classifyResource(rawUrl, result) {
            if (!rawUrl || typeof rawUrl !== 'string') {
                return;
            }

            const url = rawUrl.replace(/&amp;/gi, '&');
            const lower = url.toLowerCase();

            if (lower.includes('.m3u8')) {
                result.formats.add('HLS');
            }

            if (lower.includes('.mpd')) {
                result.formats.add('DASH');
            }

            if (/\.mp4(?:$|[?#])/i.test(url)) {
                result.formats.add('MP4');
            }

            if (/\.webm(?:$|[?#])/i.test(url)) {
                result.formats.add('WebM');
            }

            const qualityPattern =
                /(?:^|[^0-9])(2160|1440|1080|900|720|540|480|360|240)p?(?:[^0-9]|$)/gi;
            let match;

            while ((match = qualityPattern.exec(url)) !== null) {
                result.qualities.add(Number(match[1]));
            }
        }

        function collectMetadata() {
            const result = {
                id: normalized.id,
                title: '',
                formats: new Set(),
                qualities: new Set(),
                width: null,
                height: null,
                duration: null,
                detectedAt: new Date().toISOString()
            };
            const titleCandidates = [
                document.querySelector('meta[property="og:title"]')?.content,
                document.querySelector('meta[name="twitter:title"]')?.content,
                document.querySelector('h1')?.textContent,
                document.title
            ];

            for (const value of titleCandidates) {
                const title = cleanText(value)
                    .replace(/\s*[|\-–—]\s*Loom\s*$/i, '')
                    .slice(0, 240);

                if (title && !/^loom$/i.test(title)) {
                    result.title = title;
                    break;
                }
            }

            document.querySelectorAll('video').forEach((video) => {
                const width = finiteOrNull(video.videoWidth);
                const height = finiteOrNull(video.videoHeight);
                const duration = finiteOrNull(video.duration);

                result.width = Math.max(result.width || 0, width || 0) || null;
                result.height = Math.max(result.height || 0, height || 0) || null;
                result.duration = Math.max(
                    result.duration || 0,
                    duration || 0
                ) || null;

                if (height) {
                    result.qualities.add(height);
                }

                classifyResource(video.currentSrc, result);
                classifyResource(video.src, result);
                video.querySelectorAll('source').forEach((source) => {
                    classifyResource(source.src, result);
                });
            });

            try {
                performance.getEntriesByType('resource').forEach((entry) => {
                    classifyResource(entry.name, result);
                });
            } catch {
                // Video and source element metadata remain available.
            }

            return normalizeMetadata({
                ...result,
                formats: [...result.formats],
                qualities: [...result.qualities]
            }, normalized.id);
        }

        function publish() {
            clearTimeout(publishTimer);
            publishTimer = null;

            const metadata = collectMetadata();
            const signature = JSON.stringify(metadata);

            if (signature === lastSignature) {
                return;
            }

            lastSignature = signature;

            const store = normalizeMetadataStore(
                GM_getValue(METADATA_KEY, {})
            );
            store[normalized.id] = mergeMetadata(
                store[normalized.id],
                metadata,
                normalized.id
            );
            GM_setValue(METADATA_KEY, store);

            try {
                window.parent.postMessage({
                    type: 'SKOOL_LOOM_COLLECTOR_METADATA_V3',
                    metadata: store[normalized.id]
                }, '*');
            } catch {
                // GM storage remains the cross-origin fallback.
            }
        }

        function schedulePublish(delay = 100) {
            clearTimeout(publishTimer);
            publishTimer = setTimeout(publish, delay);
        }

        function start() {
            [0, 250, 700, 1500, 3000].forEach((delay) => {
                setTimeout(() => schedulePublish(0), delay);
            });

            const observer = new MutationObserver(() => {
                schedulePublish(120);
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src', 'data-src', 'content']
            });
            setInterval(() => schedulePublish(0), 3000);
        }

        if (document.documentElement) {
            start();
        } else {
            document.addEventListener('DOMContentLoaded', start, {
                once: true
            });
        }
    }

    function normalizeMetadataStore(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return {};
        }

        const store = {};

        Object.entries(raw).forEach(([id, metadata]) => {
            const normalizedId = cleanText(id).toLowerCase();

            if (new RegExp(`^${LOOM_ID_PATTERN}$`).test(normalizedId)) {
                store[normalizedId] = normalizeMetadata(
                    metadata,
                    normalizedId
                );
            }
        });

        return store;
    }

    function runSkoolCollector() {
        if (window.__SKOOL_LOOM_COLLECTOR_V3__) {
            return;
        }

        window.__SKOOL_LOOM_COLLECTOR_V3__ = true;

        let items = normalizeItems(GM_getValue(ITEMS_KEY, []));
        let results = normalizeResults(GM_getValue(RESULTS_KEY, {}));
        let settings = normalizeSettings(GM_getValue(SETTINGS_KEY, {}));
        let state = restoreState(GM_getValue(STATE_KEY, {}));
        let ui = null;
        let rootObserver = null;
        let renderTimer = null;
        let driveScheduled = false;
        let runnerBusy = false;
        let resetConfirmationTimer = null;
        let resetConfirmationDeadline = 0;
        const pendingWaits = new Map();

        GM_setValue(ITEMS_KEY, items);
        GM_setValue(RESULTS_KEY, results);
        GM_setValue(SETTINGS_KEY, settings);
        saveState();

        function normalizeSettings(raw) {
            const source = raw && typeof raw === 'object'
                ? raw
                : {};
            const merged = {
                ...DEFAULT_SETTINGS,
                ...source
            };

            merged.lessonTimeoutMs = clampNumber(
                merged.lessonTimeoutMs,
                2000,
                60000,
                DEFAULT_SETTINGS.lessonTimeoutMs
            );
            merged.routeTimeoutMs = clampNumber(
                merged.routeTimeoutMs,
                3000,
                60000,
                DEFAULT_SETTINGS.routeTimeoutMs
            );
            merged.minDelayMs = clampNumber(
                merged.minDelayMs,
                500,
                10000,
                DEFAULT_SETTINGS.minDelayMs
            );
            merged.maxDelayMs = clampNumber(
                merged.maxDelayMs,
                merged.minDelayMs,
                15000,
                DEFAULT_SETTINGS.maxDelayMs
            );
            merged.maxNavigationFailures = clampNumber(
                merged.maxNavigationFailures,
                1,
                10,
                DEFAULT_SETTINGS.maxNavigationFailures
            );
            merged.maxLogEntries = clampNumber(
                merged.maxLogEntries,
                50,
                1000,
                DEFAULT_SETTINGS.maxLogEntries
            );

            return merged;
        }

        function clampNumber(value, minimum, maximum, fallback) {
            const number = Number(value);

            if (!Number.isFinite(number)) {
                return fallback;
            }

            return Math.min(maximum, Math.max(minimum, Math.round(number)));
        }

        function normalizeResults(raw) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
                return {};
            }

            const normalized = {};

            Object.entries(raw).forEach(([key, result]) => {
                if (!result || typeof result !== 'object' || !result.lesson) {
                    return;
                }

                const lesson = normalizeLessonPage(result.lesson);
                normalized[key || lessonKey(lesson)] = {
                    lesson,
                    status: cleanText(result.status) || 'unknown',
                    outcome: cleanText(result.outcome),
                    loomIds: Array.isArray(result.loomIds)
                        ? [...new Set(result.loomIds.map((id) => {
                            return cleanText(id).toLowerCase();
                        }).filter(Boolean))]
                        : [],
                    youtubeIds: Array.isArray(result.youtubeIds)
                        ? [...new Set(result.youtubeIds.map((id) => {
                            return cleanText(id);
                        }).filter(Boolean))]
                        : [],
                    error: result.error ? cleanText(result.error) : null,
                    firstSeenAt: result.firstSeenAt || null,
                    lastSeenAt: result.lastSeenAt || null
                };
            });

            return normalized;
        }

        function saveState(skipRender = false) {
            state.lastUpdatedAt = new Date().toISOString();
            GM_setValue(STATE_KEY, state);

            if (!skipRender) {
                scheduleRender();
            }
        }

        function saveItems() {
            items = normalizeItems(items);
            GM_setValue(ITEMS_KEY, items);
            scheduleRender();
        }

        function saveResults() {
            GM_setValue(RESULTS_KEY, results);
            scheduleRender();
        }

        function addLog(message, level = 'info') {
            const entry = {
                at: new Date().toISOString(),
                level,
                message: cleanText(message).slice(0, 500)
            };

            state.activityLog.push(entry);
            state.activityLog = state.activityLog.slice(
                -settings.maxLogEntries
            );
            saveState();
        }

        function setPhase(status, message, tone = 'amber') {
            state.status = status;
            state.message = cleanText(message);
            state.tone = tone;
            saveState();
        }

        function cancelPendingWaits() {
            for (const [timer, resolve] of pendingWaits.entries()) {
                clearTimeout(timer);
                resolve(false);
            }

            pendingWaits.clear();
        }

        function waitMs(milliseconds, generation = null) {
            return new Promise((resolve) => {
                const timer = setTimeout(() => {
                    pendingWaits.delete(timer);
                    resolve(
                        generation === null ||
                        generation === state.routeGeneration
                    );
                }, Math.max(0, milliseconds));

                pendingWaits.set(timer, resolve);
            });
        }

        async function waitFor(predicate, timeoutMs, generation = null) {
            const deadline = Date.now() + timeoutMs;

            while (Date.now() <= deadline) {
                if (
                    generation !== null &&
                    generation !== state.routeGeneration
                ) {
                    return false;
                }

                try {
                    if (predicate()) {
                        return true;
                    }
                } catch {
                    // The DOM may be between SPA renders; retry.
                }

                const continued = await waitMs(200, generation);

                if (!continued) {
                    return false;
                }
            }

            return false;
        }

        function getCatalogUrl() {
            const parts = location.pathname.split('/').filter(Boolean);
            const classroomIndex = parts.indexOf('classroom');

            if (classroomIndex === -1) {
                return '';
            }

            const catalogPath = `/${parts
                .slice(0, classroomIndex + 1)
                .join('/')}`;

            return `${location.origin}${catalogPath}`;
        }

        function isCatalogPage() {
            try {
                const current = new URL(location.href);
                const catalog = new URL(getCatalogUrl());

                return current.pathname.replace(/\/$/, '') ===
                    catalog.pathname.replace(/\/$/, '');
            } catch {
                return false;
            }
        }

        function isCoursePage() {
            const parts = location.pathname.split('/').filter(Boolean);
            const classroomIndex = parts.indexOf('classroom');

            return (
                classroomIndex >= 0 &&
                parts.length > classroomIndex + 1
            );
        }

        function isAuthenticated() {
            if (document.querySelector('input[type="password"]')) {
                return false;
            }

            const links = [...document.querySelectorAll('a[href]')];
            const hasClassroom = links.some((link) => {
                return /\/classroom(?:\/|$)/.test(
                    link.getAttribute('href') || ''
                );
            });
            const hasCommunity = links.some((link) => {
                return /^community$/i.test(cleanText(link.textContent));
            });

            return hasClassroom && hasCommunity;
        }

        function ensureSafeSkoolPage() {
            const currentHost = location.hostname
                .toLowerCase()
                .replace(/^www\./, '');

            if (currentHost !== 'skool.com') {
                failRun('Unexpected external page opened. Collection stopped.');
                return false;
            }

            if (!isAuthenticated()) {
                failRun('Skool login is not active. Sign in, then Resume.');
                return false;
            }

            return true;
        }

        function elementIsVisible(element) {
            if (!element || !element.isConnected) {
                return false;
            }

            if (element.closest('[hidden], [aria-hidden="true"]')) {
                return false;
            }

            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                Number(style.opacity || 1) !== 0 &&
                rect.width > 0 &&
                rect.height > 0
            );
        }

        function scanCatalogCourses() {
            return [...document.querySelectorAll(COURSE_CARD_SELECTOR)]
                .filter(elementIsVisible)
                .map((card, courseIndex) => {
                    const imageAlt = cleanText(
                        card.querySelector('img[alt]')?.getAttribute('alt')
                    );
                    const titleCandidates = [
                        imageAlt,
                        ...[...card.querySelectorAll('div, span')]
                            .map((element) => cleanText(element.textContent))
                            .filter((text) => text && text.length <= 140)
                    ];
                    const courseTitle = titleCandidates.find((candidate) => {
                        return candidate && (
                            !imageAlt ||
                            candidate === imageAlt
                        );
                    }) || titleCandidates[0] || `Course ${courseIndex + 1}`;

                    return {
                        courseTitle,
                        courseIndex,
                        cardIdentifier: {
                            imageAlt: imageAlt || null,
                            title: courseTitle,
                            index: courseIndex
                        }
                    };
                });
        }

        function findCourseCard(course) {
            const cards = [...document.querySelectorAll(COURSE_CARD_SELECTOR)];

            return cards.find((card) => {
                const imageAlt = cleanText(
                    card.querySelector('img[alt]')?.getAttribute('alt')
                );

                return (
                    imageAlt === course.cardIdentifier?.imageAlt ||
                    imageAlt === course.courseTitle ||
                    [...card.querySelectorAll('div, span')].some((element) => {
                        return cleanText(element.textContent) ===
                            course.courseTitle;
                    })
                );
            }) || cards[course.courseIndex] || null;
        }

        function getSectionGroups() {
            return [...document.querySelectorAll(SECTION_GROUP_SELECTOR)]
                .map(sectionDescriptorFromGroup)
                .filter(Boolean);
        }

        function getSidebarRoot() {
            const groups = getSectionGroups().map((entry) => entry.group);

            if (!groups.length) {
                return null;
            }

            let root = groups[0].parentElement;

            while (
                root?.parentElement &&
                !groups.every((group) => root.contains(group))
            ) {
                root = root.parentElement;
            }

            return root;
        }

        function getCurrentCourseTitle() {
            const sidebar = getSidebarRoot();

            if (sidebar) {
                const groups = getSectionGroups().map((entry) => entry.group);
                const candidate = [...sidebar.querySelectorAll('[title]')]
                    .find((element) => {
                        const title = cleanText(element.getAttribute('title'));

                        return (
                            title &&
                            !element.closest(LESSON_LINK_SELECTOR) &&
                            !groups.some((group) => group.contains(element))
                        );
                    });

                if (candidate) {
                    return cleanText(candidate.getAttribute('title'));
                }
            }

            const title = cleanText(document.title)
                .replace(/\s*·\s*[^·]+$/, '');
            const separatorIndex = title.indexOf(' - ');

            return separatorIndex >= 0
                ? cleanText(title.slice(separatorIndex + 3))
                : title;
        }

        async function expandCollapsedSections() {
            const entries = getSectionGroups();

            for (const { group, headerRow, title } of entries) {
                const hasLessonLinks = () => {
                    return [...group.querySelectorAll(LESSON_LINK_SELECTOR)]
                        .some((link) => {
                            return isSameCourseLessonHref(
                                link.getAttribute('href'),
                                location.href
                            );
                        });
                };

                if (hasLessonLinks()) {
                    continue;
                }

                headerRow.click();
                const expanded = await waitFor(hasLessonLinks, 1200);

                if (!expanded) {
                    addLog(`Section did not expand: ${title}`, 'error');
                }
            }
        }

        function sectionDataFromDom() {
            const sections = getSectionGroups().map(({ group, title }) => {
                const lessons = [...group.querySelectorAll(LESSON_LINK_SELECTOR)]
                    .filter((link) => {
                        return isSameCourseLessonHref(
                            link.getAttribute('href'),
                            location.href
                        );
                    })
                    .map((link) => ({
                        title: cleanText(
                            link.querySelector('[title]')?.getAttribute('title') ||
                            link.textContent
                        ),
                        href: link.getAttribute('href'),
                        identifier:
                            link.closest(MODULE_IDENTIFIER_SELECTOR)
                                ?.getAttribute('data-rbd-draggable-id') ||
                            null
                    }));

                return {
                    title,
                    lessons
                };
            });

            if (sections.length) {
                return sections;
            }

            const seen = new Set();
            const flatLessons = [...document.querySelectorAll(LESSON_LINK_SELECTOR)]
                .filter((link) => {
                    return isSameCourseLessonHref(
                        link.getAttribute('href'),
                        location.href
                    );
                })
                .map((link) => {
                    const href = link.getAttribute('href');
                    const identifier = link.closest(MODULE_IDENTIFIER_SELECTOR)
                        ?.getAttribute('data-rbd-draggable-id') || null;
                    const lessonId = new URL(href, location.href)
                        .searchParams.get('md');
                    const dedupeKey = identifier || lessonId || href;

                    if (seen.has(dedupeKey)) {
                        return null;
                    }

                    seen.add(dedupeKey);

                    return {
                        title: cleanText(
                            link.querySelector('[title]')?.getAttribute('title') ||
                            link.textContent
                        ),
                        href,
                        identifier
                    };
                })
                .filter((lesson) => lesson?.title);

            return sectionsWithFlatFallback(sections, flatLessons);
        }

        function sameLessonUrl(leftRaw, rightRaw) {
            try {
                const left = new URL(leftRaw, location.origin);
                const right = new URL(rightRaw, location.origin);

                return (
                    left.origin === right.origin &&
                    left.pathname.replace(/\/$/, '') ===
                        right.pathname.replace(/\/$/, '') &&
                    left.searchParams.get('md') ===
                        right.searchParams.get('md')
                );
            } catch {
                return false;
            }
        }

        function findLessonLink(lesson) {
            const sidebar = getSidebarRoot() || document;
            const links = [...sidebar.querySelectorAll(LESSON_LINK_SELECTOR)];

            if (lesson.elementSelectorOrIdentifier) {
                const byIdentifier = links.find((link) => {
                    return link.closest(MODULE_IDENTIFIER_SELECTOR)
                        ?.getAttribute('data-rbd-draggable-id') ===
                        lesson.elementSelectorOrIdentifier;
                });

                if (byIdentifier) {
                    return byIdentifier;
                }
            }

            return links.find((link) => {
                return sameLessonUrl(link.href, lesson.skoolUrl);
            }) || null;
        }

        function findVisibleMainLessonTitle(lesson) {
            const sidebar = getSidebarRoot();
            const selector = 'h1, h2, h3, h4, h5, h6, div, span, p';

            return [...document.querySelectorAll(selector)]
                .filter((element) => {
                    return (
                        cleanText(element.textContent) === lesson.lessonTitle &&
                        elementIsVisible(element) &&
                        !sidebar?.contains(element) &&
                        !element.closest(`#${UI_ID}`) &&
                        ![...element.children].some((child) => {
                            return cleanText(child.textContent) ===
                                lesson.lessonTitle;
                        })
                    );
                })
                .sort((left, right) => {
                    return left.children.length - right.children.length;
                })[0] || null;
        }

        function verifyIntendedLesson(lesson) {
            if (!sameLessonUrl(location.href, lesson.skoolUrl)) {
                return false;
            }

            const matchingLink = findLessonLink(lesson);

            if (!matchingLink || !sameLessonUrl(matchingLink.href, location.href)) {
                return false;
            }

            return Boolean(findVisibleMainLessonTitle(lesson));
        }

        function getActiveLessonContainer(lesson) {
            if (!verifyIntendedLesson(lesson)) {
                return null;
            }

            const sidebar = getSidebarRoot();
            const title = findVisibleMainLessonTitle(lesson);

            if (!title) {
                return null;
            }

            let container = title;

            while (
                container.parentElement &&
                !container.parentElement.contains(sidebar)
            ) {
                container = container.parentElement;
            }

            if (
                container === document.body ||
                container.contains(sidebar)
            ) {
                container = title.closest('main') || title.parentElement;
            }

            return container && elementIsVisible(container)
                ? container
                : null;
        }

        function collectActivePaneVideos(lesson) {
            const container = getActiveLessonContainer(lesson);

            if (!container) {
                return [];
            }

            const detections = new Map();
            const nodes = [
                ...container.querySelectorAll([
                    'iframe[src]',
                    'iframe[data-src]',
                    '[data-src]',
                    '[data-url]',
                    '[data-video-url]'
                ].join(','))
            ];

            nodes.forEach((node) => {
                if (!elementIsVisible(node)) {
                    return;
                }

                ['src', 'data-src', 'data-url', 'data-video-url']
                    .forEach((attribute) => {
                        const rawUrl = node.getAttribute(attribute);
                        const normalized = normalizeVideoUrl(rawUrl || '');

                        if (normalized) {
                            const key = videoRecordKey(
                                normalized.provider,
                                normalized.id
                            );
                            const metadata = normalized.provider === 'youtube'
                                ? {
                                    title: cleanText(
                                        node.getAttribute('title') ||
                                        node.getAttribute('aria-label')
                                    ),
                                    formats: ['YouTube']
                                }
                                : {};
                            detections.set(key, {
                                ...normalized,
                                metadata
                            });
                        }
                    });
            });

            return [...detections.values()];
        }

        function activePaneLoomIds(lesson) {
            return new Set(
                collectActivePaneVideos(lesson)
                    .filter((detection) => detection.provider === 'loom')
                    .map((detection) => detection.id)
            );
        }

        function randomInterLessonDelay() {
            return Math.round(
                settings.minDelayMs +
                Math.random() * (
                    settings.maxDelayMs - settings.minDelayMs
                )
            );
        }

        function scheduleDrive(delay = 0) {
            if (driveScheduled) {
                return;
            }

            driveScheduled = true;
            setTimeout(async () => {
                driveScheduled = false;
                await drive();
            }, delay);
        }

        async function drive() {
            if (runnerBusy || !ACTIVE_PHASES.has(state.status)) {
                return;
            }

            runnerBusy = true;

            try {
                if (!ensureSafeSkoolPage()) {
                    return;
                }

                if (state.mode === 'all') {
                    await driveAllCourses();
                } else if (state.mode === 'current') {
                    await driveCurrentCourse();
                }
            } catch (error) {
                failRun(error?.message || 'Unexpected collector error.');
            } finally {
                runnerBusy = false;

                if (ACTIVE_PHASES.has(state.status)) {
                    scheduleDrive(50);
                }
            }
        }

        async function driveAllCourses() {
            if (isCatalogPage()) {
                if (!state.courseQueue.length) {
                    setPhase(
                        'scanning-catalog',
                        'Scanning classroom courses…',
                        'amber'
                    );
                    state.catalogUrl = getCatalogUrl();
                    state.courseQueue = scanCatalogCourses();
                    state.courseQueueIndex = 0;

                    if (!state.courseQueue.length) {
                        throw new Error('No visible course cards were found.');
                    }

                    addLog(
                        `Detected ${state.courseQueue.length} courses in catalog order.`
                    );
                    setPhase('running', 'Course catalog ready.', 'amber');
                    return;
                }

                if (state.courseQueueIndex >= state.courseQueue.length) {
                    completeRun('All courses completed.');
                    return;
                }

                await enterCurrentCourse();
                return;
            }

            if (!isCoursePage()) {
                throw new Error('Unexpected Skool route. Collection stopped.');
            }

            if (!state.courseQueue.length) {
                await navigateToCatalog();
                return;
            }

            if (!state.queueReady) {
                await scanCurrentCourseQueue();
                return;
            }

            if (state.queueIndex < state.queue.length) {
                await processCurrentLesson();
                return;
            }

            state.courseQueueIndex += 1;
            state.queue = [];
            state.queueReady = false;
            state.queueIndex = 0;
            state.currentTarget = null;
            saveState();
            await navigateToCatalog();
        }

        async function driveCurrentCourse() {
            if (!isCoursePage()) {
                throw new Error(
                    'Open a course lesson before using current-course mode.'
                );
            }

            if (!state.queueReady) {
                await scanCurrentCourseQueue();
                return;
            }

            if (state.queueIndex < state.queue.length) {
                await processCurrentLesson();
                return;
            }

            completeRun('Current course completed.');
        }

        async function enterCurrentCourse() {
            const course = state.courseQueue[state.courseQueueIndex];
            const card = findCourseCard(course);

            if (!card) {
                recordCourseFailure(
                    course,
                    'Course card could not be reidentified.'
                );
                state.courseQueueIndex += 1;
                saveState();
                return;
            }

            const generation = ++state.routeGeneration;
            cancelPendingWaits();
            setPhase(
                'entering-course',
                `Opening ${course.courseTitle}…`,
                'amber'
            );
            addLog(`Opening course ${course.courseIndex + 1}: ${course.courseTitle}`);
            getCourseCardClickTarget(card).click();

            const opened = await waitFor(() => {
                return (
                    isCoursePage() &&
                    getCurrentCourseTitle() === course.courseTitle
                );
            }, settings.routeTimeoutMs, generation);

            if (!opened) {
                state.navigationFailures += 1;
                recordCourseFailure(course, 'Course navigation timed out.');

                if (
                    state.navigationFailures >=
                    settings.maxNavigationFailures
                ) {
                    throw new Error(
                        'Repeated course navigation failures. Collection stopped.'
                    );
                }

                state.courseQueueIndex += 1;
                saveState();
                return;
            }

            state.navigationFailures = 0;
            state.queue = [];
            state.queueReady = false;
            state.queueIndex = 0;
            setPhase('scanning-course', 'Scanning course sidebar…', 'amber');
        }

        async function scanCurrentCourseQueue() {
            setPhase('scanning-course', 'Expanding and scanning sections…', 'amber');
            await expandCollapsedSections();

            const courseTitle = getCurrentCourseTitle();
            const course = state.mode === 'all'
                ? state.courseQueue[state.courseQueueIndex]
                : null;
            const courseIndex = course?.courseIndex ?? findKnownCourseIndex(
                courseTitle
            );
            const sections = sectionDataFromDom();
            let queue = buildQueueFromSectionData(
                courseTitle,
                courseIndex,
                sections,
                location.href
            );

            if (state.retryOnly) {
                queue = queue.filter((lesson) => {
                    const existing = results[lessonKey(lesson)];

                    return existing && (
                        existing.status === 'error' ||
                        existing.status === 'no-loom'
                    );
                });
            }

            state.queue = queue;
            state.queueIndex = 0;
            state.currentTarget = null;

            addLog(
                `Detected ${sections.length} sections and ${queue.length} lessons in ${courseTitle}.`
            );

            if (isInvalidEmptyCourseScan(queue, state.retryOnly)) {
                state.queueReady = false;
                failRun(`No accessible lessons found in ${courseTitle}.`);
                return;
            }

            state.queueReady = true;

            if (!queue.length && state.retryOnly) {
                addLog(`No failed lessons remain in ${courseTitle}.`);
            }

            setPhase('running', 'Lesson queue ready.', 'amber');
        }

        function findKnownCourseIndex(courseTitle) {
            const known = state.courseQueue.find((course) => {
                return course.courseTitle === courseTitle;
            });

            if (known) {
                return known.courseIndex;
            }

            const prior = Object.values(results).find((result) => {
                return result.lesson?.courseTitle === courseTitle;
            });

            return prior?.lesson?.courseIndex || 0;
        }

        async function processCurrentLesson() {
            const lesson = state.queue[state.queueIndex];

            if (!lesson) {
                state.queueIndex = state.queue.length;
                saveState();
                return;
            }

            cancelPendingWaits();
            const generation = ++state.routeGeneration;
            const id = lessonKey(lesson);
            state.currentTarget = {
                lessonId: id,
                generation,
                lesson
            };
            setPhase(
                'navigating-lesson',
                `Opening ${lesson.lessonTitle}…`,
                'amber'
            );

            let verified = verifyIntendedLesson(lesson);

            for (let attempt = 1; !verified && attempt <= 2; attempt += 1) {
                const link = findLessonLink(lesson);

                if (link) {
                    link.click();
                } else if (isSafeLessonUrl(lesson.skoolUrl)) {
                    const anchor = document.createElement('a');
                    anchor.href = lesson.skoolUrl;
                    anchor.style.display = 'none';
                    document.body.appendChild(anchor);
                    anchor.click();
                    anchor.remove();
                } else {
                    break;
                }

                verified = await waitFor(() => {
                    return verifyIntendedLesson(lesson);
                }, settings.routeTimeoutMs, generation);

                if (!verified && attempt < 2) {
                    await waitMs(800, generation);
                }
            }

            if (!verified) {
                if (generation !== state.routeGeneration) {
                    return;
                }

                state.navigationFailures += 1;
                recordLessonResult(lesson, {
                    status: 'error',
                    outcome: 'error',
                    loomIds: [],
                    error: 'Lesson navigation or active-state verification failed.'
                });
                addLog(
                    `Navigation failed: ${lesson.lessonTitle}`,
                    'error'
                );

                if (
                    state.navigationFailures >=
                    settings.maxNavigationFailures
                ) {
                    throw new Error(
                        'Repeated lesson navigation failures. Collection stopped.'
                    );
                }

                advanceLesson('red');
                const continued = await waitMs(
                    randomInterLessonDelay(),
                    generation
                );

                if (continued && ACTIVE_PHASES.has(state.status)) {
                    setPhase('running', 'Moving to the next lesson…', 'amber');
                }
                return;
            }

            state.navigationFailures = 0;
            setPhase(
                'waiting-for-lesson',
                `Waiting for ${lesson.lessonTitle} content…`,
                'amber'
            );

            await waitFor(() => {
                return Boolean(getActiveLessonContainer(lesson));
            }, 3000, generation);

            if (
                generation !== state.routeGeneration ||
                !verifyIntendedLesson(lesson)
            ) {
                return;
            }

            setPhase(
                'collecting',
                `Looking for video in ${lesson.lessonTitle}…`,
                'amber'
            );

            const detections = await waitForStableVideos(lesson, generation);

            if (!canCommitLessonDetection(state, generation, id)) {
                return;
            }

            if (!detections.length) {
                recordLessonResult(lesson, {
                    status: 'no-loom',
                    outcome: 'no-video',
                    loomIds: [],
                    youtubeIds: [],
                    error: null
                });
                addLog(`No Video: ${lesson.lessonTitle}`, 'no-loom');
                state.tone = 'gray';
            } else {
                const metadataStore = normalizeMetadataStore(
                    GM_getValue(METADATA_KEY, {})
                );
                const loomIds = [];
                const youtubeIds = [];
                let addedAnything = false;

                detections.forEach((detection) => {
                    const detectionMetadata = detection.provider === 'loom'
                        ? metadataStore[detection.id] || detection.metadata || {}
                        : detection.metadata || {};
                    const merged = mergeVideoRecord(items, {
                        ...detection,
                        metadata: detectionMetadata
                    }, lesson);
                    items = merged.items;

                    if (detection.provider === 'youtube') {
                        youtubeIds.push(detection.id);
                    } else {
                        loomIds.push(detection.id);
                    }

                    addedAnything = addedAnything ||
                        merged.isNewVideo ||
                        merged.isNewRelationship;
                });

                saveItems();
                recordLessonResult(lesson, {
                    status: 'found',
                    outcome: addedAnything ? 'new' : 'already',
                    loomIds,
                    youtubeIds,
                    error: null
                });

                if (addedAnything) {
                    addLog(
                        `Saved ${detections.length} video URL${detections.length === 1 ? '' : 's'}: ${lesson.lessonTitle}`,
                        'new'
                    );
                    state.tone = 'green';
                } else {
                    addLog(
                        `Already collected: ${lesson.lessonTitle}`,
                        'already'
                    );
                    state.tone = 'blue';
                }
            }

            advanceLesson(state.tone);

            const continued = await waitMs(
                randomInterLessonDelay(),
                generation
            );

            if (continued && ACTIVE_PHASES.has(state.status)) {
                setPhase('running', 'Moving to the next lesson…', 'amber');
            }
        }

        function isSafeLessonUrl(rawUrl) {
            try {
                const url = new URL(rawUrl, location.origin);
                const host = url.hostname
                    .toLowerCase()
                    .replace(/^www\./, '');

                return (
                    host === 'skool.com' &&
                    url.origin === location.origin &&
                    /\/classroom\//.test(url.pathname) &&
                    Boolean(url.searchParams.get('md'))
                );
            } catch {
                return false;
            }
        }

        async function waitForStableVideos(lesson, generation) {
            const deadline = Date.now() + settings.lessonTimeoutMs;

            while (Date.now() <= deadline) {
                if (
                    generation !== state.routeGeneration ||
                    !verifyIntendedLesson(lesson)
                ) {
                    return [];
                }

                const first = collectActivePaneVideos(lesson);

                if (first.length) {
                    const continued = await waitMs(300, generation);

                    if (!continued || !verifyIntendedLesson(lesson)) {
                        return [];
                    }

                    const second = collectActivePaneVideos(lesson);
                    const firstIds = first.map((item) => {
                        return videoRecordKey(item.provider, item.id);
                    }).sort().join(',');
                    const secondIds = second.map((item) => {
                        return videoRecordKey(item.provider, item.id);
                    }).sort().join(',');

                    if (firstIds && firstIds === secondIds) {
                        return second;
                    }
                }

                const continued = await waitMs(300, generation);

                if (!continued) {
                    return [];
                }
            }

            return [];
        }

        function recordLessonResult(lesson, patch) {
            const id = lessonKey(lesson);
            const now = new Date().toISOString();
            const existing = results[id];
            results[id] = {
                lesson: normalizeLessonPage(lesson),
                status: patch.status,
                outcome: patch.outcome || '',
                loomIds: Array.isArray(patch.loomIds)
                    ? [...new Set(patch.loomIds)]
                    : [],
                youtubeIds: Array.isArray(patch.youtubeIds)
                    ? [...new Set(patch.youtubeIds)]
                    : [],
                error: patch.error || null,
                firstSeenAt: existing?.firstSeenAt || now,
                lastSeenAt: now
            };

            state.completedLessonIds = [
                ...new Set([...state.completedLessonIds, id])
            ];
            state.failedLessonIds = state.failedLessonIds
                .filter((candidate) => candidate !== id);
            state.noLoomLessonIds = state.noLoomLessonIds
                .filter((candidate) => candidate !== id);

            if (patch.status === 'error') {
                state.failedLessonIds.push(id);
            }

            if (patch.status === 'no-loom') {
                state.noLoomLessonIds.push(id);
            }

            state.failedLessonIds = [...new Set(state.failedLessonIds)];
            state.noLoomLessonIds = [...new Set(state.noLoomLessonIds)];
            saveResults();
            saveState();
        }

        function advanceLesson(tone) {
            state.queueIndex += 1;
            state.currentTarget = null;
            state.status = 'between-lessons';
            state.tone = 'amber';
            state.message = 'Lesson recorded.';
            saveState();
        }

        function recordCourseFailure(course, message) {
            addLog(`${course.courseTitle}: ${message}`, 'error');
        }

        async function navigateToCatalog() {
            if (isCatalogPage()) {
                setPhase('running', 'Back at course catalog.', 'amber');
                return;
            }

            cancelPendingWaits();
            const generation = ++state.routeGeneration;
            setPhase(
                'returning-to-catalog',
                'Returning to course catalog…',
                'amber'
            );
            const catalogUrl = state.catalogUrl || getCatalogUrl();
            const link = [...document.querySelectorAll('a[href]')]
                .find((anchor) => {
                    try {
                        return new URL(anchor.href).pathname.replace(/\/$/, '') ===
                            new URL(catalogUrl).pathname.replace(/\/$/, '');
                    } catch {
                        return false;
                    }
                });

            if (link) {
                link.click();
            } else {
                state.message = 'Reloaded catalog. Click Resume if navigation paused.';
                saveState();
                location.assign(catalogUrl);
                return;
            }

            const returned = await waitFor(
                isCatalogPage,
                settings.routeTimeoutMs,
                generation
            );

            if (!returned) {
                throw new Error('Could not return to the course catalog.');
            }

            setPhase('running', 'Ready for the next course.', 'amber');
        }

        function startAllCourses() {
            if (!ensureSafeSkoolPage()) {
                return;
            }

            cancelPendingWaits();
            const oldLog = state.activityLog;
            const generation = state.routeGeneration + 1;
            state = {
                ...defaultState(),
                mode: 'all',
                status: 'scanning-catalog',
                tone: 'amber',
                message: 'Starting all-course collection…',
                catalogUrl: getCatalogUrl(),
                routeGeneration: generation,
                activityLog: oldLog,
                startedAt: new Date().toISOString()
            };
            addLog('Started automatic collection for all courses.');
            scheduleDrive();
        }

        function startCurrentCourse() {
            if (!ensureSafeSkoolPage()) {
                return;
            }

            if (!isCoursePage()) {
                notify('Open a course lesson first.');
                return;
            }

            cancelPendingWaits();
            const oldLog = state.activityLog;
            const oldCourses = state.courseQueue;
            const generation = state.routeGeneration + 1;
            state = {
                ...defaultState(),
                mode: 'current',
                status: 'scanning-course',
                tone: 'amber',
                message: 'Starting current-course collection…',
                catalogUrl: getCatalogUrl(),
                courseQueue: oldCourses,
                routeGeneration: generation,
                activityLog: oldLog,
                startedAt: new Date().toISOString()
            };
            addLog(`Started current course: ${getCurrentCourseTitle()}`);
            scheduleDrive();
        }

        function pauseRun() {
            if (!ACTIVE_PHASES.has(state.status)) {
                return;
            }

            state.interruptedStatus = state.status;
            state.status = 'paused';
            state.tone = 'purple';
            state.message = 'Paused. Click Resume to continue.';
            state.routeGeneration += 1;
            cancelPendingWaits();
            addLog('Collection paused.', 'paused');
        }

        function resumeRun() {
            if (!['paused', 'awaiting-resume', 'error'].includes(state.status)) {
                return;
            }

            state.status = 'running';
            state.tone = 'amber';
            state.message = 'Resuming collection…';
            state.currentTarget = null;
            state.interruptedStatus = null;
            saveState();
            addLog('Collection resumed.', 'info');
            scheduleDrive();
        }

        function stopRun() {
            state.routeGeneration += 1;
            cancelPendingWaits();
            state.status = 'stopped';
            state.tone = 'red';
            state.message = 'Stopped. Saved progress is still available.';
            state.currentTarget = null;
            saveState();
            addLog('Collection stopped.', 'error');
        }

        function armOrConfirmReset() {
            if (isResetConfirmationActive(resetConfirmationDeadline)) {
                performFullReset();
                return;
            }

            clearTimeout(resetConfirmationTimer);
            resetConfirmationDeadline = Date.now() + 10000;
            state.tone = 'red';
            state.message = 'Click Confirm reset within 10 seconds to erase all collection data.';
            saveState();
            resetConfirmationTimer = setTimeout(() => {
                cancelResetConfirmation();
            }, 10050);
        }

        function cancelResetConfirmation() {
            clearTimeout(resetConfirmationTimer);
            resetConfirmationTimer = null;
            resetConfirmationDeadline = 0;
            state.tone = ACTIVE_PHASES.has(state.status)
                ? 'amber'
                : 'gray';
            state.message = 'Reset cancelled. Collection data was not changed.';
            saveState();
        }

        function performFullReset() {
            if (!isResetConfirmationActive(resetConfirmationDeadline)) {
                armOrConfirmReset();
                return;
            }

            const nextGeneration = state.routeGeneration + 1;
            clearTimeout(resetConfirmationTimer);
            resetConfirmationTimer = null;
            resetConfirmationDeadline = 0;
            cancelPendingWaits();

            const snapshot = buildResetSnapshot(settings);
            items = snapshot.items;
            results = snapshot.results;
            settings = normalizeSettings(snapshot.settings);
            state = {
                ...snapshot.state,
                routeGeneration: nextGeneration,
                tone: 'gray',
                message: 'Collection reset. Ready to start again.'
            };

            GM_setValue(ITEMS_KEY, items);
            GM_setValue(RESULTS_KEY, results);
            GM_setValue(METADATA_KEY, snapshot.metadata);
            GM_setValue(SETTINGS_KEY, settings);
            saveState();
        }

        function failRun(message) {
            state.routeGeneration += 1;
            cancelPendingWaits();
            state.status = 'error';
            state.tone = 'red';
            state.message = cleanText(message);
            state.currentTarget = null;
            saveState();
            addLog(message, 'error');
        }

        function completeRun(message) {
            state.status = 'completed';
            state.tone = 'black';
            state.message = cleanText(message);
            state.currentTarget = null;
            state.completedAt = new Date().toISOString();
            state.retryOnly = false;
            saveState();
            addLog(message, 'completed');
        }

        async function rescanSidebar() {
            if (!isCoursePage()) {
                notify('Open a course before rescanning its sidebar.');
                return;
            }

            const wasActive = ACTIVE_PHASES.has(state.status);

            if (wasActive) {
                pauseRun();
            }

            await expandCollapsedSections();
            const sections = sectionDataFromDom();
            const courseTitle = getCurrentCourseTitle();
            const currentLesson = state.queue[state.queueIndex];
            state.queue = buildQueueFromSectionData(
                courseTitle,
                findKnownCourseIndex(courseTitle),
                sections,
                location.href
            );
            state.queueReady = true;
            state.queueIndex = currentLesson
                ? Math.max(0, state.queue.findIndex((lesson) => {
                    return lessonKey(lesson) === lessonKey(currentLesson);
                }))
                : 0;
            state.status = wasActive ? 'paused' : 'idle';
            state.tone = wasActive ? 'purple' : 'gray';
            state.message = `Rescanned ${sections.length} sections and ${state.queue.length} lessons.`;
            saveState();
            addLog(state.message);
        }

        function retryFailedLessons() {
            const retryable = Object.values(results).filter((result) => {
                return (
                    result.status === 'error' ||
                    result.status === 'no-loom'
                );
            });

            if (!retryable.length) {
                notify('No failed or no-video lessons to retry.');
                return;
            }

            cancelPendingWaits();
            const oldLog = state.activityLog;
            const oldCourses = state.courseQueue;
            const generation = state.routeGeneration + 1;
            const currentMode = isCoursePage() ? 'current' : 'all';
            state = {
                ...defaultState(),
                mode: currentMode,
                status: currentMode === 'all'
                    ? 'scanning-catalog'
                    : 'scanning-course',
                tone: 'amber',
                message: 'Preparing failed lessons for retry…',
                catalogUrl: getCatalogUrl(),
                courseQueue: currentMode === 'all' ? [] : oldCourses,
                routeGeneration: generation,
                activityLog: oldLog,
                retryOnly: true,
                startedAt: new Date().toISOString()
            };
            addLog(`Retrying ${retryable.length} failed or no-video lessons.`);
            scheduleDrive();
        }

        function mergeIncomingMetadata(rawMetadata) {
            const metadata = normalizeMetadata(rawMetadata);
            const target = state.currentTarget;

            if (
                !metadata.id ||
                !target ||
                !canCommitLessonDetection(
                    state,
                    target.generation,
                    target.lessonId
                ) ||
                !verifyIntendedLesson(target.lesson) ||
                !activePaneLoomIds(target.lesson).has(metadata.id)
            ) {
                return;
            }

            const item = items.find((candidate) => {
                return candidate.provider === 'loom' &&
                    candidate.id === metadata.id;
            });

            if (!item) {
                return;
            }

            item.metadata = mergeMetadata(
                item.metadata,
                metadata,
                metadata.id
            );
            saveItems();
        }

        function createElement(tag, className = '', text = '') {
            const element = document.createElement(tag);

            if (className) {
                element.className = className;
            }

            if (text) {
                element.textContent = text;
            }

            return element;
        }

        function actionButton(label, action, className = '') {
            const button = createElement(
                'button',
                `slc-button ${className}`.trim(),
                label
            );
            button.type = 'button';
            button.dataset.action = action;

            return button;
        }

        function createUi() {
            if (!document.body) {
                return;
            }

            if (document.getElementById(UI_ID)) {
                ui = collectUiNodes(document.getElementById(UI_ID));
                return;
            }

            if (!document.getElementById(STYLE_ID)) {
                const style = document.createElement('style');
                style.id = STYLE_ID;
                style.textContent = `
#${UI_ID}{position:fixed;right:16px;bottom:16px;width:min(390px,calc(100vw - 24px));max-height:90vh;z-index:2147483646;font:13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f7f7f7;background:#171717;border:1px solid #3d3d3d;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden}
#${UI_ID} *{box-sizing:border-box}
#${UI_ID}.slc-collapsed .slc-body{display:none}
#${UI_ID} .slc-header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0f0f0f;border-bottom:1px solid #333}
#${UI_ID} .slc-title{font-weight:800;flex:1}
#${UI_ID} .slc-badge{font-size:11px;font-weight:800;padding:4px 8px;border-radius:999px;background:#666;color:#fff}
#${UI_ID}[data-tone="amber"] .slc-badge{background:#b7791f}
#${UI_ID}[data-tone="green"] .slc-badge{background:#15803d}
#${UI_ID}[data-tone="blue"] .slc-badge{background:#1d4ed8}
#${UI_ID}[data-tone="gray"] .slc-badge{background:#6b7280}
#${UI_ID}[data-tone="red"] .slc-badge{background:#b91c1c}
#${UI_ID}[data-tone="purple"] .slc-badge{background:#7e22ce}
#${UI_ID}[data-tone="black"] .slc-badge{background:#000}
#${UI_ID} .slc-body{padding:10px;overflow:auto;max-height:calc(90vh - 45px)}
#${UI_ID} .slc-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:8px}
#${UI_ID} .slc-actions.six{grid-template-columns:repeat(3,minmax(0,1fr))}
#${UI_ID} .slc-button{border:1px solid #4b4b4b;border-radius:8px;background:#292929;color:#fff;padding:7px 8px;font:inherit;font-weight:700;cursor:pointer}
#${UI_ID} .slc-button:hover:not(:disabled){background:#363636}
#${UI_ID} .slc-button:disabled{opacity:.4;cursor:not-allowed}
#${UI_ID} .slc-button.primary{background:#2563eb;border-color:#3b82f6}
#${UI_ID} .slc-button.warn{background:#7c2d12;border-color:#c2410c}
#${UI_ID} .slc-button.icon{padding:3px 7px;min-width:30px}
#${UI_ID} .slc-current{display:grid;grid-template-columns:88px 1fr;gap:4px 8px;padding:8px;background:#222;border-radius:9px;margin-bottom:8px}
#${UI_ID} .slc-label{color:#a8a8a8}
#${UI_ID} .slc-value{min-width:0;overflow-wrap:anywhere;font-weight:650}
#${UI_ID} .slc-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-bottom:8px}
#${UI_ID} .slc-count{padding:6px 3px;text-align:center;background:#232323;border-radius:8px}
#${UI_ID} .slc-count strong{display:block;font-size:16px}
#${UI_ID} .slc-count span{font-size:10px;color:#bdbdbd}
#${UI_ID} .slc-verified{padding:6px 8px;margin:-2px 0 8px;border-radius:8px;background:#202020;color:#d4d4d4;font-size:11px;text-align:center}
#${UI_ID} .slc-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#aaa;margin:9px 0 5px}
#${UI_ID} .slc-hierarchy,#${UI_ID} .slc-log{background:#101010;border:1px solid #303030;border-radius:8px;padding:7px;max-height:150px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
#${UI_ID} .slc-hierarchy-row{padding:2px 0 2px 12px;color:#ddd}
#${UI_ID} .slc-hierarchy-heading{font-weight:800;color:#fff;margin-top:5px}
#${UI_ID} .slc-log-row{padding:3px 0;border-bottom:1px solid #242424;color:#cfcfcf}
#${UI_ID} .slc-log-row:last-child{border-bottom:0}
#${UI_ID} .slc-settings{display:flex;align-items:center;gap:7px;margin:8px 0}
#${UI_ID} .slc-settings input{width:65px;background:#111;color:#fff;border:1px solid #444;border-radius:6px;padding:5px}
`;
                document.documentElement.appendChild(style);
            }

            const root = createElement('aside');
            root.id = UI_ID;
            root.dataset.tone = state.tone;

            const header = createElement('div', 'slc-header');
            const title = createElement(
                'div',
                'slc-title',
                'Skool Loom Collector'
            );
            const badge = createElement('div', 'slc-badge', 'Ready');
            badge.dataset.node = 'badge';
            const collapse = actionButton('–', 'collapse', 'icon');
            header.append(title, badge, collapse);

            const body = createElement('div', 'slc-body');
            const starts = createElement('div', 'slc-actions');
            starts.append(
                actionButton('Start all courses', 'start-all', 'primary'),
                actionButton('Start current course', 'start-current', 'primary')
            );
            const controls = createElement('div', 'slc-actions six');
            controls.append(
                actionButton('Pause', 'pause'),
                actionButton('Resume', 'resume'),
                actionButton('Stop', 'stop', 'warn'),
                actionButton('Reset collection', 'reset', 'warn'),
                actionButton('Rescan sidebar', 'rescan'),
                actionButton('Retry failed', 'retry')
            );

            const current = createElement('div', 'slc-current');
            [
                ['Progress', 'progress'],
                ['Course', 'course'],
                ['Section', 'section'],
                ['Lesson', 'lesson'],
                ['Status', 'status']
            ].forEach(([label, node]) => {
                const value = createElement('div', 'slc-value', '—');
                value.dataset.node = node;
                current.append(
                    createElement('div', 'slc-label', label),
                    value
                );
            });

            const counts = createElement('div', 'slc-counts');
            [
                ['found', 'Found'],
                ['already', 'Already'],
                ['noLoom', 'No Video'],
                ['failed', 'Failed']
            ].forEach(([node, label]) => {
                const cell = createElement('div', 'slc-count');
                const strong = createElement('strong', '', '0');
                strong.dataset.node = node;
                cell.append(strong, createElement('span', '', label));
                counts.appendChild(cell);
            });
            const verifiedSummary = createElement(
                'div',
                'slc-verified',
                'Verified Videos: 0 · Legacy excluded: 0'
            );
            verifiedSummary.dataset.node = 'verifiedSummary';

            const settingsRow = createElement('label', 'slc-settings');
            settingsRow.textContent = 'Lesson timeout (seconds):';
            const timeoutInput = document.createElement('input');
            timeoutInput.type = 'number';
            timeoutInput.min = '2';
            timeoutInput.max = '60';
            timeoutInput.step = '1';
            timeoutInput.dataset.node = 'timeout';
            timeoutInput.value = String(settings.lessonTimeoutMs / 1000);
            settingsRow.appendChild(timeoutInput);

            const exportsRow = createElement('div', 'slc-actions six');
            exportsRow.append(
                actionButton('Copy structured', 'copy-structured', 'primary'),
                actionButton('Copy URLs only', 'copy-urls'),
                actionButton('Export TXT', 'export-txt'),
                actionButton('Export CSV', 'export-csv'),
                actionButton('Export JSON', 'export-json')
            );

            const hierarchyTitle = createElement(
                'div',
                'slc-section-title',
                'Hierarchy preview'
            );
            const hierarchy = createElement('div', 'slc-hierarchy');
            hierarchy.dataset.node = 'hierarchy';
            const logTitle = createElement(
                'div',
                'slc-section-title',
                'Activity log'
            );
            const log = createElement('div', 'slc-log');
            log.dataset.node = 'log';

            body.append(
                starts,
                controls,
                current,
                counts,
                verifiedSummary,
                settingsRow,
                exportsRow,
                hierarchyTitle,
                hierarchy,
                logTitle,
                log
            );
            root.append(header, body);
            root.addEventListener('click', handleUiClick);
            root.addEventListener('change', handleUiChange);
            document.body.appendChild(root);
            ui = collectUiNodes(root);
            renderUi();
        }

        function collectUiNodes(root) {
            const nodes = { root, buttons: {} };

            root.querySelectorAll('[data-node]').forEach((element) => {
                nodes[element.dataset.node] = element;
            });
            root.querySelectorAll('[data-action]').forEach((button) => {
                nodes.buttons[button.dataset.action] = button;
            });

            return nodes;
        }

        function handleUiClick(event) {
            const button = event.target.closest('[data-action]');

            if (!button || button.disabled) {
                return;
            }

            const actions = {
                'start-all': startAllCourses,
                'start-current': startCurrentCourse,
                pause: pauseRun,
                resume: resumeRun,
                stop: stopRun,
                reset: armOrConfirmReset,
                rescan: rescanSidebar,
                retry: retryFailedLessons,
                'copy-structured': copyStructuredText,
                'copy-urls': copyVerifiedUrls,
                'export-txt': exportTxt,
                'export-csv': exportCsv,
                'export-json': exportJson,
                collapse: () => {
                    ui.root.classList.toggle('slc-collapsed');
                    button.textContent = ui.root.classList.contains('slc-collapsed')
                        ? '+'
                        : '–';
                }
            };

            actions[button.dataset.action]?.();
        }

        function handleUiChange(event) {
            if (event.target.dataset.node !== 'timeout') {
                return;
            }

            settings.lessonTimeoutMs = clampNumber(
                Number(event.target.value) * 1000,
                2000,
                60000,
                DEFAULT_SETTINGS.lessonTimeoutMs
            );
            GM_setValue(SETTINGS_KEY, settings);
            event.target.value = String(settings.lessonTimeoutMs / 1000);
            addLog(`Lesson timeout set to ${event.target.value} seconds.`);
        }

        function scheduleRender() {
            clearTimeout(renderTimer);
            renderTimer = setTimeout(renderUi, 60);
        }

        function setNodeText(node, value) {
            if (node) {
                node.textContent = value;
            }
        }

        function renderUi() {
            createUi();

            if (!ui) {
                return;
            }

            ui.root.dataset.tone = state.tone || 'gray';
            setNodeText(ui.badge, statusLabel(state.status));

            const current = state.currentTarget?.lesson ||
                state.queue[state.queueIndex] ||
                null;
            const progress = state.queue.length
                ? `${Math.min(
                    state.queueIndex + (state.queueIndex < state.queue.length ? 1 : 0),
                    state.queue.length
                )} / ${state.queue.length}`
                : '0 / 0';

            setNodeText(ui.progress, progress);
            setNodeText(ui.course, current?.courseTitle || currentCourseLabel());
            setNodeText(ui.section, current?.sectionTitle || '—');
            setNodeText(ui.lesson, current?.lessonTitle || '—');
            setNodeText(ui.status, state.message || statusLabel(state.status));

            const counts = resultCounts();
            setNodeText(ui.found, String(counts.found));
            setNodeText(ui.already, String(counts.already));
            setNodeText(ui.noLoom, String(counts.noLoom));
            setNodeText(ui.failed, String(counts.failed));
            const verifiedView = buildVerifiedCollection(results, items);
            setNodeText(
                ui.verifiedSummary,
                `Verified Videos: ${verifiedView.items.length} · Legacy excluded: ${verifiedView.legacyCount}`
            );

            if (ui.timeout && document.activeElement !== ui.timeout) {
                ui.timeout.value = String(settings.lessonTimeoutMs / 1000);
            }

            const active = ACTIVE_PHASES.has(state.status);
            ui.buttons.pause.disabled = !active;
            ui.buttons.resume.disabled = ![
                'paused',
                'awaiting-resume',
                'error'
            ].includes(state.status);
            ui.buttons.stop.disabled = !active && state.status !== 'paused';
            ui.buttons['start-current'].disabled = !isCoursePage() || active;
            ui.buttons['start-all'].disabled = active;
            ui.buttons.reset.textContent = isResetConfirmationActive(
                resetConfirmationDeadline
            )
                ? 'Confirm reset'
                : 'Reset collection';
            renderHierarchy();
            renderLog();
        }

        function currentCourseLabel() {
            if (
                state.mode === 'all' &&
                state.courseQueue[state.courseQueueIndex]
            ) {
                return state.courseQueue[state.courseQueueIndex].courseTitle;
            }

            return isCoursePage()
                ? getCurrentCourseTitle()
                : '—';
        }

        function statusLabel(status) {
            const labels = {
                idle: 'Ready',
                'scanning-catalog': 'Scanning',
                'entering-course': 'Loading',
                'scanning-course': 'Scanning',
                running: 'Running',
                'navigating-lesson': 'Loading',
                'waiting-for-lesson': 'Loading',
                collecting: 'Scanning',
                'between-lessons': 'Saved',
                'returning-to-catalog': 'Loading',
                paused: 'Paused',
                'awaiting-resume': 'Resume',
                stopped: 'Stopped',
                error: 'Error',
                completed: 'Completed'
            };

            return labels[status] || cleanText(status) || 'Ready';
        }

        function resultCounts() {
            const values = Object.values(results);

            return {
                found: values.filter((result) => {
                    return result.status === 'found' && result.outcome !== 'already';
                }).length,
                already: values.filter((result) => {
                    return result.status === 'found' && result.outcome === 'already';
                }).length,
                noLoom: values.filter((result) => {
                    return result.status === 'no-loom';
                }).length,
                failed: values.filter((result) => {
                    return result.status === 'error';
                }).length
            };
        }

        function renderHierarchy() {
            ui.hierarchy.textContent = '';
            const recent = Object.values(results)
                .filter((result) => result?.lesson)
                .sort((left, right) => {
                    return compareLessons(left.lesson, right.lesson);
                })
                .slice(-24);

            if (!recent.length) {
                ui.hierarchy.textContent = 'No lesson results yet.';
                return;
            }

            let previousHeading = '';

            recent.forEach((result) => {
                const lesson = normalizeLessonPage(result.lesson);
                const heading = [
                    lesson.courseTitle,
                    lesson.sectionTitle
                ].filter(Boolean).join(' · ');

                if (heading !== previousHeading) {
                    ui.hierarchy.appendChild(createElement(
                        'div',
                        'slc-hierarchy-heading',
                        heading
                    ));
                    previousHeading = heading;
                }

                const firstReference = resultVideoReferences(result)[0];
                const item = firstReference
                    ? items.find((candidate) => {
                        return videoRecordKey(
                            candidate.provider,
                            candidate.id
                        ) === videoRecordKey(
                            firstReference.provider,
                            firstReference.id
                        );
                    })
                    : null;
                const summary = formatMetadataSummary(item?.metadata);
                const status = result.status === 'found'
                    ? 'Found'
                    : result.status === 'no-loom'
                        ? 'No Video'
                        : 'Error';
                const index = String(lesson.lessonIndex + 1).padStart(2, '0');
                const text = `${index}. ${lesson.lessonTitle} — ${status}${summary ? ` — ${summary}` : ''}`;
                ui.hierarchy.appendChild(createElement(
                    'div',
                    'slc-hierarchy-row',
                    text
                ));
            });
        }

        function renderLog() {
            ui.log.textContent = '';
            const entries = state.activityLog.slice(-80).reverse();

            if (!entries.length) {
                ui.log.textContent = 'Activity will appear here.';
                return;
            }

            entries.forEach((entry) => {
                const time = entry.at
                    ? new Date(entry.at).toLocaleTimeString()
                    : '';
                ui.log.appendChild(createElement(
                    'div',
                    'slc-log-row',
                    `${time}  ${entry.message}`
                ));
            });
        }

        function formatMetadataSummary(metadata) {
            if (!metadata || typeof metadata !== 'object') {
                return '';
            }

            return [
                formatQuality(metadata),
                Array.isArray(metadata.formats)
                    ? metadata.formats.join(' + ')
                    : ''
            ].filter(Boolean).join(' ');
        }

        function downloadTextFile(filename, content, mimeType) {
            const blob = new Blob([content], {
                type: `${mimeType};charset=utf-8`
            });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        }

        function exportTxt() {
            const text = buildStructuredText(results, items);
            const view = buildVerifiedCollection(results, items);

            if (!text) {
                notify('No verified lesson results to export yet.');
                return;
            }

            downloadTextFile(
                'skool-loom-collection.txt',
                text,
                'text/plain'
            );
            notify(
                `Exported ${view.items.length} verified video URLs from ${view.lessonCount} lessons.`
            );
        }

        function exportCsv() {
            downloadTextFile(
                'skool-loom-lessons.csv',
                buildCsv(results, items),
                'text/csv'
            );
            notify('Exported ordered CSV.');
        }

        function exportJson() {
            const output = buildJsonExport({
                state,
                results,
                items,
                settings
            });
            downloadTextFile(
                'skool-loom-collection.json',
                JSON.stringify(output, null, 2),
                'application/json'
            );
            notify('Exported hierarchical JSON.');
        }

        function copyStructuredText() {
            const text = buildStructuredText(results, items);
            const view = buildVerifiedCollection(results, items);

            if (!text) {
                notify('No verified lesson results to copy yet.');
                return;
            }

            GM_setClipboard(text);
            notify(
                `Copied ${view.items.length} verified video URLs from ${view.lessonCount} lessons.`
            );
        }

        function copyVerifiedUrls() {
            const view = buildVerifiedCollection(results, items);
            const text = view.items
                .map((item) => item.url)
                .filter(Boolean)
                .join('\n');

            if (!text) {
                notify('No verified video URLs to copy yet.');
                return;
            }

            GM_setClipboard(text);
            notify(`Copied ${view.items.length} verified video URLs.`);
        }

        function notify(message) {
            state.message = cleanText(message);
            saveState();
        }

        function patchHistoryOnce() {
            if (window.__SKOOL_LOOM_HISTORY_PATCH_V3__) {
                return;
            }

            window.__SKOOL_LOOM_HISTORY_PATCH_V3__ = true;
            ['pushState', 'replaceState'].forEach((method) => {
                const original = history[method];
                history[method] = function (...args) {
                    const value = original.apply(this, args);
                    window.dispatchEvent(new Event(ROUTE_EVENT));
                    return value;
                };
            });
            window.addEventListener('popstate', () => {
                window.dispatchEvent(new Event(ROUTE_EVENT));
            });
        }

        function initialize() {
            createUi();
            patchHistoryOnce();

            if (!rootObserver) {
                rootObserver = new MutationObserver((mutations) => {
                    const relevant = mutations.some((mutation) => {
                        const target = mutation.target?.nodeType === 1
                            ? mutation.target
                            : mutation.target?.parentElement;

                        return !target?.closest?.(`#${UI_ID}`);
                    });

                    if (!relevant) {
                        return;
                    }

                    createUi();
                    scheduleRender();
                });
                rootObserver.observe(document.documentElement, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: [
                        'href',
                        'src',
                        'data-src',
                        'data-url',
                        'data-video-url',
                        'title'
                    ]
                });
            }

            window.addEventListener(ROUTE_EVENT, () => {
                scheduleRender();
            });
            window.addEventListener('message', (event) => {
                try {
                    const eventHost = new URL(event.origin)
                        .hostname
                        .replace(/^www\./, '');

                    if (eventHost !== 'loom.com') {
                        return;
                    }
                } catch {
                    return;
                }

                if (
                    event.data?.type ===
                    'SKOOL_LOOM_COLLECTOR_METADATA_V3'
                ) {
                    mergeIncomingMetadata(event.data.metadata);
                }
            });
            window.addEventListener('beforeunload', cancelPendingWaits);

            if (typeof GM_addValueChangeListener === 'function') {
                GM_addValueChangeListener(
                    METADATA_KEY,
                    (_key, _oldValue, newValue, remote) => {
                        if (!remote || !state.currentTarget) {
                            return;
                        }

                        const store = normalizeMetadataStore(newValue);
                        const ids = activePaneLoomIds(
                            state.currentTarget.lesson
                        );

                        ids.forEach((id) => {
                            if (store[id]) {
                                mergeIncomingMetadata(store[id]);
                            }
                        });
                    }
                );
            }

            if (state.status === 'awaiting-resume') {
                addLog(
                    'A previous automatic run was interrupted. Resume is available.',
                    'paused'
                );
            }

            scheduleRender();
        }

        GM_registerMenuCommand('Start all Skool courses', startAllCourses);
        GM_registerMenuCommand('Start current Skool course', startCurrentCourse);
        GM_registerMenuCommand('Pause collection', pauseRun);
        GM_registerMenuCommand('Resume collection', resumeRun);
        GM_registerMenuCommand('Stop collection', stopRun);
        GM_registerMenuCommand('Rescan current sidebar', rescanSidebar);
        GM_registerMenuCommand('Retry failed lessons', retryFailedLessons);
        GM_registerMenuCommand('Copy structured collection', copyStructuredText);
        GM_registerMenuCommand('Copy verified video URLs only', copyVerifiedUrls);
        GM_registerMenuCommand('Reset all collection data', armOrConfirmReset);
        GM_registerMenuCommand('Export structured collection TXT', exportTxt);
        GM_registerMenuCommand('Export lesson CSV', exportCsv);
        GM_registerMenuCommand('Export hierarchy JSON', exportJson);

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initialize, {
                once: true
            });
        } else {
            initialize();
        }
    }
})();
