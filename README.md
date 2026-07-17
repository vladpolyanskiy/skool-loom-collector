# Skool Loom Collector

Built for people researching how to download videos from Skool courses and communities, this Tampermonkey userscript automatically walks classroom lessons and organizes Loom and YouTube URLs by course, section, and lesson.

It does **not** download videos, press Play, bypass authentication, or bypass DRM. It only records video links from lessons the signed-in account can normally access.

Created by [Vlad Polyanskiy](https://vladpoly.com).

Read the full guide: [How to Download Videos from Skool Without Opening Every Lesson](https://vladpoly.com/how-to-download-skool-videos/).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open the [raw userscript](https://raw.githubusercontent.com/vladpolyanskiy/skool-loom-collector/main/skool-loom-collector.user.js).
3. Tampermonkey should offer to install it. Confirm the installation.
4. Open a Skool classroom page and refresh it.

## Use

The floating panel provides two collection modes:

- **Start all courses** scans the classroom catalog and processes courses in their visible order.
- **Start current course** processes only the course currently open.

The collector expands course sections, visits lessons one at a time in the same tab, waits for the active lesson content, and stores Loom or YouTube URLs found only in that active lesson.

YouTube detection also supports Skool's lazy poster player, where only a `ytimg.com` thumbnail exists before Play is pressed.

You can pause, resume, stop, rescan the sidebar, retry failed lessons, or clear old failed/no-video results without deleting found videos. Progress is saved locally through Tampermonkey storage.

**Retry failed** matches lessons by their stable Skool route, so it still works if a newer sidebar scan places an older saved lesson under a different section heading or index.

## Copy and export

- **Copy structured** copies a readable course → section → lesson → video URL hierarchy.
- **Copy URLs only** copies one verified Loom or YouTube URL per line.
- **Export TXT** downloads the same readable hierarchy.
- **Export CSV** creates lesson-oriented spreadsheet data.
- **Export JSON** preserves the complete verified hierarchy and video metadata.

Legacy URLs saved by earlier versions remain stored for backward compatibility but are excluded from normal verified copy/export output.

## Reset

**Clear failed/no-video** removes saved Error and No Video lesson results from the preview, counts, copies, and exports while preserving every found video. It requires a second **Confirm clear** click within ten seconds.

**Reset collection** clears all saved collection data and starts from zero while preserving timeout settings. It requires a second **Confirm reset** click within ten seconds.

## Background tabs in Brave

The collector runs inside the Skool tab. Brave/Chromium may throttle or freeze hidden and inactive tabs, which also stops Skool's embedded video frame from loading. A userscript cannot override a frozen browser tab.

For reliable collection, keep the Skool tab selected in a non-minimized window. In **Brave Settings → System → Performance**, add `skool.com` under **Always keep these sites active**. If Brave interrupts the run, return to the Skool tab and click **Resume**. See [Brave's Memory Saver guide](https://support.brave.com/hc/en-us/articles/13383683902733-How-do-I-use-the-Memory-and-Energy-Saver-features-in-Brave) for the current setting.

## Safety and limitations

- Use this only with courses you are authorized to access.
- The script does not attempt to unlock restricted lessons or bypass authentication.
- Skool is a single-page application and may change its DOM. If collection stops detecting course cards, sections, or lessons, open an issue with the visible error log and a DOM screenshot that does not expose private course content.
- Loom URLs may grant access to the associated recording. Treat exported links as private unless the course owner permits sharing them.

## License

[MIT](LICENSE)
