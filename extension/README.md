# Bili Download Browser Extension

This folder contains the Bili Download browser extension and its optional local
streaming companion.

## Current Version

- Manifest V3 Chrome/Edge extension.
- Reads the current Bilibili video page and extracts the BV id.
- Uses the browser's current Bilibili login cookie and shows the detected account in the popup.
- Fetches video metadata, all cookie-accessible qualities, and DASH stream metadata from Bilibili web APIs.
- Downloads directly available non-DASH streams as a single browser download.
- Downloads DASH qualities and muxes video/audio into a single MP4 in the browser.
- Falls back to the browser downloads API and records diagnostics if page-context downloading fails.
- Optionally delegates a user-selected single DASH download or live recording to
  a separately installed Native Messaging companion for streaming disk output.
- No local `bili.json` import is needed for the extension.

## Current Limits

- Browser-side DASH muxing currently remuxes supported MP4-based DASH streams without re-encoding.
- Danmaku download and burning are not handled yet.
- The extension only downloads content that the current browser session can access.
- Page-context downloads and browser muxing still buffer media in memory before saving. The side panel therefore applies configurable DASH file/memory limits (default 512 MB input and 1.5 GB memory budget) and stops unsafe downloads before they can grow without bounds.
- Live FLV recording also buffers data in memory. It has configurable duration, file-size, and memory-budget limits (default 120 minutes, 1 GB file size, and 1.5 GB memory budget). Its effective buffer cap is the lower of the file limit and memory budget divided by a conservative 3× save peak; it automatically stops when either size or duration is reached and does not save an empty recording.

- The optional companion is never selected silently: enable it in the side
  panel first. It writes to `%USERPROFILE%\Videos\BiliDownload` by default and
  has its own 128 GiB raw-input budget. The companion checks free space before
  accepting a task, combines reservations across active tasks, and checks again
  before DASH remuxing. It rejects a task with a safe disk-space error when the
  target volume cannot accommodate the conservative peak.

## Load Locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this `extension` folder.
5. Open a Bilibili video page and click the extension icon.

Downloaded files are placed under the browser downloads folder in a `BiliDownload` subfolder.

## Optional Local Streaming Companion

The browser-only path works immediately after loading the extension. The local
companion is opt-in: it can stream a currently authorized DASH or live source
to disk without keeping the entire recording in browser memory. It does not
receive browser cookies, `Authorization`, arbitrary headers, browser-profile
paths, or Bilibili API URLs.

Build and register the companion only after loading this unpacked extension,
because its native-host manifest must contain the extension ID shown by
`chrome://extensions` or `edge://extensions`. Follow the build and registration
instructions in [companion/README.md](companion/README.md). Then open the side
panel, expand **Local streaming companion (optional)**, choose the route you
want, and use **Check companion**. If it is unavailable, the extension keeps
the normal browser path and its browser safety limits.

An interrupted companion task can be explicitly **Reauthorize and start** from
the task center. This obtains fresh short-lived URLs through the currently
signed-in page/API flow; it is not a bypass and does not restore a URL from
extension storage.

## Verify

Run the fast source-level smoke tests from the project root (Node.js 22 or newer):

```powershell
npm test
```

Run the unpacked-Chromium smoke test as well when a compatible Chromium build is available:

```powershell
npm run test:browser
```

The Chromium smoke test starts an isolated temporary browser profile, loads the `extension` directory unpacked, and does **not** contact Bilibili or start a download. It verifies that:

- the MV3 extension page receives its runtime and `background.js` responds to a harmless diagnostic request;
- Chrome has enabled the `bili_media_headers` ruleset and evaluates it for `xmlhttprequest`, `media`, and `other` requests;
- the same rule does not match `main_frame`, `sub_frame`, `image`, or `object`; and
- the side-panel document renders its core controls.

The test checks common Chrome, Edge, and Chromium locations. If none can run unpacked extensions in the current environment, it reports a TAP skip and exits successfully. To require a particular browser in CI (and turn an unavailable/blocked extension runtime into a failure), set `BILI_CHROMIUM_EXECUTABLE` explicitly. Chrome for Testing or a compatible Chromium build is recommended:

```powershell
$env:BILI_CHROMIUM_EXECUTABLE = 'C:\path\to\chrome.exe'
node --test extension\tests\chromium-unpacked-smoke.mjs
```

For an authenticated end-to-end download check, load the extension manually and use only media you are authorized to download. Confirm both a native single-file download and a DASH/page-context download on a small file. The automated test deliberately does not use browser cookies, live Bilibili requests, or real media transfers.

## Permission and DNR Scope

- `activeTab` is not requested: every supported page execution target is already covered by the declared Bilibili hosts and the popup rejects non-Bilibili URLs before injecting a script.
- The API, page, live, and four known media-CDN host families remain declared because the current API calls, page-context fallback, live recording, and CDN candidates use them. No localhost or catch-all host permission is requested.
- Media-header DNR rules apply only to the four Bilibili media-CDN families and only to `xmlhttprequest`, `media`, and `other`. `other` is retained for browser-managed native downloads; `xmlhttprequest` and `media` support extension/page fetching and media requests. Navigation, frames, images, and objects never receive the overridden `Referer`/`Origin` headers.
- `declarativeNetRequestFeedback` remains intentionally: the extension's user-facing diagnostics use `testMatchOutcome` and best-effort rule-match events to explain a failed media request. It does not broaden the host list or permit request modification beyond the static rules above.
- `nativeMessaging` is requested solely for the optional host named
  `com.bili_download.stream_companion`. The extension opens it only after the
  user enables the local companion route or presses its check button. The host
  registration restricts which extension IDs may connect; it does not grant
  host permissions, browser-profile access, or cookie access.

## Next Milestone

Add danmaku and subtitle export while preserving the extension's existing
privacy and task-recovery boundaries.
