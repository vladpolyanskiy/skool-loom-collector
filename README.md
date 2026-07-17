# Skool Loom Collector

A Tampermonkey userscript that automatically walks through Skool classroom lessons and collects Loom share URLs with their course, section, and lesson relationships.

It does **not** download videos, press Play, bypass authentication, or bypass DRM. It only records Loom links from lessons the signed-in account can normally access.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [raw userscript](https://raw.githubusercontent.com/vladpolyanskiy/skool-loom-collector/main/skool-loom-collector.user.js).
3. Tampermonkey should offer to install it. Confirm the installation.
4. Open a Skool classroom page and refresh it.

## Use

The floating panel provides two collection modes:

- **Start all courses** scans the classroom catalog and processes courses in their visible order.
- **Start current course** processes only the course currently open.

The collector expands course sections, visits lessons one at a time in the same tab, waits for the active lesson content, and stores Loom URLs found only in that active lesson.

You can pause, resume, stop, rescan the sidebar, and retry failed lessons. Progress is saved locally through Tampermonkey storage.

## Copy and export

- **Copy structured** copies a readable course → section → lesson → status → Loom URL hierarchy.
- **Copy URLs only** copies one verified Loom share URL per line.
- **Export TXT** downloads the same readable hierarchy.
- **Export CSV** creates lesson-oriented spreadsheet data.
- **Export JSON** preserves the complete verified hierarchy and video metadata.

Legacy URLs saved by earlier versions remain stored for backward compatibility but are excluded from normal verified copy/export output.

## Reset

**Reset collection** clears all saved collection data and starts from zero while preserving timeout settings. It requires a second **Confirm reset** click within ten seconds.

## Safety and limitations

- Use this only with courses you are authorized to access.
- The script does not attempt to unlock restricted lessons or bypass authentication.
- Skool is a single-page application and may change its DOM. If collection stops detecting course cards, sections, or lessons, open an issue with the visible error log and a DOM screenshot that does not expose private course content.
- Loom URLs may grant access to the associated recording. Treat exported links as private unless the course owner permits sharing them.

## License

[MIT](LICENSE)

