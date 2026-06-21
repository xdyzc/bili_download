# Bili Download Browser Extension

This folder contains the pure browser-extension prototype for Bili Download.

## Current Version

- Manifest V3 Chrome/Edge extension.
- Reads the current Bilibili video page and extracts the BV id.
- Uses the browser's current Bilibili login cookie and shows the detected account in the popup.
- Fetches video metadata, all cookie-accessible qualities, and DASH stream metadata from Bilibili web APIs.
- Downloads directly available non-DASH streams as a single browser download.
- Downloads DASH qualities and muxes video/audio into a single MP4 in the browser.
- Falls back to the browser downloads API and records diagnostics if page-context downloading fails.
- No local `bili.json` import is needed for the extension.

## Current Limits

- Browser-side DASH muxing currently remuxes supported MP4-based DASH streams without re-encoding.
- Danmaku download and burning are not handled yet.
- The extension only downloads content that the current browser session can access.
- Page-context downloads and browser muxing currently buffer media in memory before saving, so very large files can be memory-heavy.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this `extension` folder.
5. Open a Bilibili video page and click the extension icon.

Downloaded files are placed under the browser downloads folder in a `BiliDownload` subfolder.

## Verify

Run the extension smoke test from the project root:

```powershell
& 'C:\Users\36300\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --test extension\tests\smoke.mjs
```

## Next Milestone

Improve large-file streaming and add danmaku support.
