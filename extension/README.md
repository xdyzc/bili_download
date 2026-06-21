# Bili Download Browser Extension

This folder contains the pure browser-extension prototype for Bili Download.

## Current Version

- Manifest V3 Chrome/Edge extension.
- Reads the current Bilibili video page and extracts the BV id.
- Uses the browser's current Bilibili login cookie and shows the detected account in the popup.
- Fetches video metadata, all cookie-accessible qualities, and DASH stream metadata from Bilibili web APIs.
- Downloads directly available non-DASH streams as a single browser download.
- Downloads DASH qualities as separate video and audio `.m4s` files.
- Falls back to the browser downloads API and records diagnostics if page-context downloading fails.
- No local `bili.json` import is needed for the extension.

## Current Limits

- DASH video/audio muxing is not handled yet, so high-quality DASH downloads are saved as two files.
- Danmaku download and burning are not handled yet.
- The extension only downloads content that the current browser session can access.
- Page-context downloads currently buffer the whole file before saving, so large-file streaming is still a future step.

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

Evaluate browser-side MP4 muxing for DASH video/audio files.
