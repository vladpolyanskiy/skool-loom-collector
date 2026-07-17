# I Built a Skool Video Collector for My BJJ Courses

I wanted to download BJJ courses that I already had access to on Skool. The first problem was not the download itself. It was finding and organizing every video without opening hundreds of lessons by hand.

So I made a Tampermonkey userscript called **Skool Loom Collector**. It opens lessons one at a time, records the video link, and keeps the same course, section, and lesson order shown on Skool.

The script does not press Play or download a video. It collects stable Loom and YouTube links from lessons that your own Skool account can already open. What you do with those links still depends on the course rules and the video platform's permissions.

## Why a normal page scraper was not enough

Skool behaves more like an app than a folder full of normal web pages. It can preload data for other lessons and leave parts of the previous lesson in memory. If a script searches the whole page, it can easily save the previous video's URL under the next lesson.

The collector avoids that by moving through the sidebar in order and checking that the intended lesson is actually active before it saves anything. It only looks for videos inside the active lesson area.

The course menus were another problem. Some BJJ courses are arranged by level and week. Some are standalone courses with one flat list of lessons. Some sections start collapsed. The script has to read the visible structure instead of assuming every course uses the same menu.

The videos are mixed too. Most of the courses we tested used Loom, but the wrestling course also used YouTube. Loom can provide share URLs, embed URLs, and links with a `sid` value. YouTube has watch, short, and embed URLs. In at least one lesson, Skool did not create a YouTube iframe at all—it showed a thumbnail from `ytimg.com` and waited for a click before creating the player. The collector can read that active-lesson thumbnail and recover the YouTube ID without pressing Play.

Not every lesson contains a video. Some are text, some temporarily fail to load, and some video frames appear late. The collector waits, retries, and records a clear result instead of silently attaching an old video to the wrong lesson.

## What the collector gives you

At the end, you have a structured list like this:

```text
Wrestling for BJJ Course!

Lessons
  01. Double Leg Defence
      https://www.youtube.com/watch?v=...
```

The same data can be copied immediately or downloaded as TXT, CSV, or JSON. Duplicate videos are stored once, but the collector remembers every lesson where the video appeared.

## What every button does

### Collection buttons

- **Start all courses** starts from the Skool course catalog and attempts every course in the order shown on the page.
- **Start current course** collects only the course that is currently open. This is the simplest fallback if an all-course run cannot enter a particular course.
- **Pause** safely stops after the current bit of work and keeps your place.
- **Resume** continues a paused or browser-interrupted run from the saved progress.
- **Stop** ends the current run without deleting anything already collected.
- **Rescan sidebar** reads the open course menu again. Use it if sections or lessons were expanded, loaded late, or changed after the first scan.
- **Retry failed** runs only lessons previously marked as an error or as having no detected video. It recognizes the lesson by its stable Skool route even if the course menu now groups that lesson under a different section.

### Cleanup buttons

- **Clear failed/no-video** removes saved `Error` and `No Video` lesson rows from the preview, counts, copies, and exports. It does **not** delete any found Loom or YouTube video. Click it once, then click **Confirm clear** within ten seconds.
- **Reset collection** deletes all saved collection data so you can start completely fresh. It keeps your timeout setting but removes found videos as well as lesson results. Click it once, then click **Confirm reset** within ten seconds.

Use **Clear failed/no-video** when your tests left a pile of bad rows. Use **Reset collection** only when you genuinely want to throw everything away.

### Copy and export buttons

- **Copy structured** puts a readable course → section → lesson → URL list on the clipboard. Found lessons do not get a pointless `Found` label; only missing or failed results are called out.
- **Copy URLs only** copies one verified Loom or YouTube URL per line, with no lesson headings.
- **Export TXT** downloads the same readable hierarchy used by Copy Structured.
- **Export CSV** downloads spreadsheet-friendly lesson rows in course order.
- **Export JSON** downloads the complete hierarchy, video metadata, lesson relationships, and saved run information.

The small **–** button in the panel header collapses the collector. It changes to **+**, which opens the panel again.

The **Lesson timeout** box is not a button. It controls how long the collector waits for a lesson's video to appear before recording No Video and moving on. Ten seconds is the normal starting point. Increase it if your connection or Skool is loading slowly.

## One important Brave limitation

The collector runs inside the Skool page. Brave and other Chromium browsers can throttle or freeze a tab when it is hidden, minimized, or left in the background. When that happens, the script's timers stop and the next Loom or YouTube frame may not load. A Tampermonkey script cannot force a frozen browser tab to keep running.

For the most reliable run:

1. Leave the Skool tab selected in a non-minimized Brave window.
2. Open **Brave Settings → System → Performance**.
3. Under **Always keep these sites active**, add `skool.com`.
4. If the run pauses after you work in another window, return to Skool and click **Resume**.

You do not need to watch every lesson or press Play. The tab just needs to remain active enough for Skool and its embedded video frame to load.

## The useful part

The result is not a mysterious bulk scraper. It is a patient course indexer. It does the boring clicking, preserves the BJJ course structure, supports both Loom and YouTube, and leaves you with a clean map of the material your account can access.

That map was the missing first step. Once the links are organized correctly, the rest of a personal study or offline workflow becomes much easier to manage.
