# Bili Download Browser Extension

This folder contains the Bili Download browser extension and its optional local
streaming companion.

## Current Version

- Manifest V3 Chrome/Edge extension.
- Reads Bilibili video/Bangumi pages and Bilibili, Douyu, or Huya desktop live-room pages.
- Uses the browser's current Bilibili login cookie and shows the detected account in the popup.
- Fetches video metadata, all cookie-accessible qualities, and DASH stream metadata from Bilibili web APIs.
- Downloads directly available non-DASH streams as a single browser download.
- Downloads DASH qualities and muxes video/audio into a single MP4 in the browser.
- Falls back to the browser downloads API and records diagnostics if page-context downloading fails.
- Optionally delegates a user-selected single DASH download or live recording to
  a separately installed Native Messaging companion for streaming disk output.
- Records HTTPS FLV + AVC live streams at the qualities exposed by the current
  page session. Douyu uses its page-provided official resolver; Huya uses the
  public player data already present on the page.
- No local `bili.json` import is needed for the extension.

## Current Limits

- Browser-side DASH muxing currently remuxes supported MP4-based DASH streams without re-encoding.
- Danmaku download and burning are not handled yet.
- The extension only downloads content that the current browser session can access.
- Page-context downloads, browser muxing, and browser live recording still buffer media in memory. The extension derives conservative limits from media metadata and the device's reported memory, then stops before an unsafe buffer can grow without bounds. These protections are automatic rather than user-facing settings.
- The first multi-site live release supports only standard desktop room pages and HTTPS FLV + AVC. It does not support HLS, HEVC, replay, mobile pages, scheduled recording, danmaku, or chat capture.

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
5. Open a supported Bilibili video/live page, Douyu numeric room, or Huya numeric/alias room and click the extension icon.

Downloaded files are placed under the browser downloads folder in a `BiliDownload` subfolder.

## Optional Local Streaming Companion

The browser-only path works immediately after loading the extension. The local
companion is opt-in: it can stream a currently authorized DASH or live source
to disk without keeping the entire recording in browser memory. It does not
receive browser cookies, `Authorization`, arbitrary headers, browser-profile
paths, site API URLs, or arbitrary request headers.

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

The Chromium smoke test starts an isolated temporary browser profile, loads the `extension` directory unpacked, and does **not** contact a live site or start a download. It verifies that:

- the MV3 extension page receives its runtime and `background.js` responds to a harmless diagnostic request;
- Chrome has enabled both media-header rulesets and evaluates the Bilibili, Douyu, and Huya rules for `xmlhttprequest`, `media`, and `other` requests;
- the same rule does not match `main_frame`, `sub_frame`, `image`, or `object`; and
- the side-panel document renders its core controls.

The test checks common Chrome, Edge, and Chromium locations. If none can run unpacked extensions in the current environment, it reports a TAP skip and exits successfully. To require a particular browser in CI (and turn an unavailable/blocked extension runtime into a failure), set `BILI_CHROMIUM_EXECUTABLE` explicitly. Chrome for Testing or a compatible Chromium build is recommended:

```powershell
$env:BILI_CHROMIUM_EXECUTABLE = 'C:\path\to\chrome.exe'
node --test extension\tests\chromium-unpacked-smoke.mjs
```

For an authenticated end-to-end download check, load the extension manually and use only media you are authorized to download. Confirm both a native single-file download and a DASH/page-context download on a small file. The automated test deliberately does not use browser cookies, live-site requests, or real media transfers.

An explicit metadata-only real-site probe is available for manual validation. It never requests a media URL and is disabled unless opted in:

```powershell
$env:BILI_ENABLE_LIVE_PROBE = '1'
npm run probe:live
```

## Permission and DNR Scope

- `activeTab` is not requested: every supported page execution target is covered by explicit Bilibili, Douyu, and Huya page hosts, and the panel rejects unrelated URLs before injection.
- Host permissions include only the required page/API hosts and verified media-CDN families. No localhost or catch-all permission is requested.
- Site-specific DNR rules set the matching Bilibili, Douyu, or Huya `Referer` and `Origin` only for `xmlhttprequest`, `media`, and `other`. Navigation, frames, images, and objects never receive those overrides.
- `declarativeNetRequestFeedback` remains intentionally: the extension's user-facing diagnostics use `testMatchOutcome` and best-effort rule-match events to explain a failed media request. It does not broaden the host list or permit request modification beyond the static rules above.
- `nativeMessaging` is requested solely for the optional host named
  `com.bili_download.stream_companion`. The extension opens it only after the
  user enables the local companion route or presses its check button. The host
  registration restricts which extension IDs may connect; it does not grant
  host permissions, browser-profile access, or cookie access.

## Supported live URL forms

- Bilibili: `https://live.bilibili.com/<numeric-room>`
- Douyu: `https://www.douyu.com/<numeric-room>`
- Huya: `https://www.huya.com/<numeric-room-or-anchor-alias>`

Huya recording reuses the official player authorization already present on the
open room page. Browser recording reconnects Huya's short AVC FLV responses
with the player-supported timestamp cursor and removes overlapping FLV tags
before saving one file. The optional companion keeps independently playable
FLV segments and advances the same cursor between connections. Return to the
original room page if that page is closed or the official player is no longer
available to refresh an expired source.

All access stays within the current browser session. The extension does not
bypass login, payment, region, DRM, or copyright restrictions.
