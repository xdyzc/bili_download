# Bili Download Browser Extension

This is the first browser-extension prototype for the local Bili Download project.

## Current Scope

- Manifest V3 Chrome/Edge extension.
- Reads the current Bilibili video page and extracts the BV id.
- Shows the BV id and page title in the popup.
- Prepares a call to the local downloader at `http://127.0.0.1:8765/api/downloads`.

The local HTTP downloader service is the next milestone. Until that service exists, the popup can identify and copy the BV id, while "send to local downloader" will report that the local app is not connected.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this `extension` folder.

## Planned Bridge

The plugin should stay thin. It reads the page context and sends a request to the local Python app, while the local app keeps handling cookies, quality selection, media downloading, ffmpeg merging, and optional danmaku video generation.
