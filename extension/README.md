# Bili Download Browser Extension

This folder contains the pure browser-extension prototype for Bili Download.

## Current MVP

- Manifest V3 Chrome/Edge extension.
- Reads the current Bilibili video page and extracts the BV id.
- Fetches video metadata and available qualities from Bilibili web APIs.
- Starts browser downloads for directly available non-DASH streams.
- Uses the browser's current Bilibili login state; no local `bili.json` import is needed.

## Current Limits

- DASH video/audio separation is not handled yet.
- Danmaku download and burning are not handled yet.
- The extension only downloads content that the current browser session can access.

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

Support DASH by downloading video and audio streams first. After that, evaluate browser-side MP4 muxing.
