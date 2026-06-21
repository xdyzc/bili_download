const API_BASE = "https://api.bilibili.com";
const DIAGNOSTIC_STORAGE_KEY = "lastDiagnostic";
const DNR_TEST_TYPES = ["main_frame", "other", "media", "xmlhttprequest"];
const PROGRESS_MESSAGE_TYPE = "BILI_DOWNLOAD_PAGE_PROGRESS";
const PROGRESS_PORT_NAME = "BILI_DOWNLOAD_PROGRESS_PORT";

let lastDiagnostic = null;
const progressPorts = new Set();

configureSidePanelBehavior();
chrome.runtime.onInstalled?.addListener(configureSidePanelBehavior);

function configureSidePanelBehavior() {
  const behaviorPromise = chrome.sidePanel?.setPanelBehavior?.({
    openPanelOnActionClick: true
  });
  behaviorPromise?.catch?.(() => {});
}

chrome.action?.onClicked?.addListener((tab) => {
  if (!chrome.sidePanel?.open || !tab?.windowId) {
    return;
  }
  const openPromise = chrome.sidePanel.open({
    windowId: tab.windowId
  });
  openPromise?.catch?.(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
    loadVideo(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_GET_ACCOUNT") {
    fetchAccountStatus()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_START_DIRECT") {
    startDirectDownload(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
    prepareDirectDownload(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC") {
    setLastDiagnostic(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === PROGRESS_MESSAGE_TYPE) {
    relayProgress(message.payload, _sender?.tab?.id);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
    getLastDiagnostic()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onConnect?.addListener((port) => {
  if (port.name !== PROGRESS_PORT_NAME) {
    return;
  }

  progressPorts.add(port);
  port.onDisconnect.addListener(() => {
    progressPorts.delete(port);
  });
});

function relayProgress(payload, tabId) {
  const safePayload = normalizeProgressPayload(payload);
  const message = {
    type: PROGRESS_MESSAGE_TYPE,
    payload: {
      ...safePayload,
      tabId: Number(tabId) || 0
    }
  };

  for (const port of progressPorts) {
    try {
      port.postMessage(message);
    } catch (_error) {
      progressPorts.delete(port);
    }
  }
}

function normalizeProgressPayload(value) {
  return {
    receivedBytes: Number(value?.receivedBytes) || 0,
    totalBytes: Number(value?.totalBytes) || 0,
    segmentIndex: Number(value?.segmentIndex) || 0,
    segmentCount: Number(value?.segmentCount) || 0,
    candidateIndex: Number(value?.candidateIndex) || 0,
    candidateCount: Number(value?.candidateCount) || 0,
    done: Boolean(value?.done)
  };
}

if (chrome.declarativeNetRequest?.onRuleMatchedDebug) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    const url = info?.request?.url || "";
    if (!isMediaHost(url)) {
      return;
    }

    const diagnostic = lastDiagnostic || createBaseDiagnostic({ mediaUrl: url });
    diagnostic.dnrMatchedEvents = [
      ...(diagnostic.dnrMatchedEvents || []),
      {
        at: new Date().toISOString(),
        ruleId: info.rule?.ruleId,
        rulesetId: info.rule?.rulesetId,
        request: pickRequestDetails(info.request)
      }
    ].slice(-10);
    setLastDiagnostic(diagnostic);
  });
}

async function loadVideo(page) {
  const bvid = normalizeBvid(page?.bvid);
  if (!bvid) {
    throw new Error("No BV id was found on this page.");
  }

  const [infoPayload, account] = await Promise.all([
    fetchJson(`${API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`),
    fetchAccountStatus().catch((error) => ({
      isLogin: false,
      username: "",
      userId: null,
      vipLabel: "",
      error: error.message
    }))
  ]);
  const info = expectData(infoPayload);
  const pages = normalizeVideoPages(info.pages || []);
  const pageNumber = readPageNumber(page?.url);
  const videoPage = selectVideoPage(pages, pageNumber);

  if (!videoPage?.cid) {
    throw new Error("Could not find the video cid.");
  }

  const playUrl = await fetchPlayUrl({
    bvid,
    cid: videoPage.cid
  });
  const availability = await buildQualityAvailability({
    bvid,
    cid: videoPage.cid,
    playUrl,
    account
  });

  const qualities = buildQualityOptions(playUrl, availability);
  return {
    bvid,
    aid: info.aid,
    title: page?.title || info.title || bvid,
    ownerName: info.owner?.name || "",
    page: {
      index: videoPage.index || videoPage.page || 1,
      cid: videoPage.cid,
      title: videoPage.title || videoPage.part || ""
    },
    pages,
    account,
    currentQuality: selectDefaultQuality(qualities, playUrl.quality),
    directAvailable: qualities.some((quality) => quality.available && quality.mode === "direct"),
    dashAvailable: qualities.some((quality) => quality.available && quality.mode === "dash"),
    qualities
  };
}

async function fetchAccountStatus() {
  const payload = await fetchJson(`${API_BASE}/x/web-interface/nav`);
  const data = expectData(payload);
  const vipInfo = data.vipInfo || {};
  const vipLabel = vipInfo.label || {};
  const labelText = typeof vipLabel === "object" ? vipLabel.text : "";
  const userId = Number(data.mid);

  return {
    isLogin: Boolean(data.isLogin),
    username: String(data.uname || ""),
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    vipLabel: String(labelText || ""),
    source: "browser-cookie"
  };
}

async function startDirectDownload(payload) {
  const prepared = await prepareDirectDownload(payload);
  const ids = [];
  const diagnostics = [];

  for (const segment of prepared.segments) {
    const candidates = readCandidates(segment);
    const candidateDiagnostics = [];
    let lastError = null;
    let downloaded = false;

    for (const [candidateIndex, candidate] of candidates.entries()) {
      try {
        const result = await downloadFileWithDiagnostics({
          options: {
            url: candidate.url,
            filename: segment.filename,
            conflictAction: "uniquify",
            saveAs: false
          },
          context: {
            ...segment.context,
            downloadMethod: "background-download",
            candidateIndex: candidateIndex + 1,
            candidateCount: candidates.length,
            candidateKind: candidate.kind
          }
        });
        ids.push(result.id);
        diagnostics.push(result.diagnostic);
        candidateDiagnostics.push(result.diagnostic);
        downloaded = true;
        break;
      } catch (error) {
        lastError = error;
        const diagnostic = error.diagnostic || {
          phase: "download-error",
          error: error.message,
          request: {
            media: summarizeUrl(candidate.url),
            filename: segment.filename
          }
        };
        diagnostics.push(diagnostic);
        candidateDiagnostics.push(diagnostic);
      }
    }

    if (!downloaded) {
      if (lastError?.diagnostic) {
        lastError.diagnostic.allCandidateDiagnostics = candidateDiagnostics
          .filter((diagnostic) => diagnostic !== lastError.diagnostic)
          .map((diagnostic) => sanitizeForMessage(diagnostic));
      }
      throw lastError || new Error("All media candidates failed.");
    }
  }

  return {
    ids,
    count: ids.length,
    diagnostics,
    method: "background-download"
  };
}

async function prepareDirectDownload(payload) {
  const bvid = normalizeBvid(payload?.bvid);
  const cid = Number(payload?.cid);
  const quality = Number(payload?.quality);
  const title = payload?.title || bvid;

  if (!bvid || !cid || !quality) {
    throw new Error("Missing video, cid, or quality.");
  }

  const playUrl = await fetchPlayUrl({ bvid, cid, quality });

  if (hasDashQuality(playUrl, quality)) {
    return prepareDashSegments({
      bvid,
      cid,
      quality,
      title,
      playUrl
    });
  }

  if (hasExactDirectQuality(playUrl, quality)) {
    const directSegments = buildDirectSegmentPlans(playUrl);
    return prepareDurlSegments({
      bvid,
      cid,
      quality: responseQuality(playUrl) || quality,
      title,
      playUrl,
      segments: directSegments
    });
  }

  const directPlayUrl = await fetchPlayUrl({ bvid, cid, quality, fnval: 0 });
  if (hasExactDirectQuality(directPlayUrl, quality)) {
    const legacyDirectSegments = buildDirectSegmentPlans(directPlayUrl);
    return prepareDurlSegments({
      bvid,
      cid,
      quality: responseQuality(directPlayUrl) || quality,
      title,
      playUrl: directPlayUrl,
      segments: legacyDirectSegments
    });
  }

  throw unavailableQualityError(quality);
}

function buildDirectSegmentPlans(playUrl) {
  return Array.isArray(playUrl.durl)
    ? playUrl.durl
        .map((item) => ({
          source: item,
          candidates: buildSegmentCandidates(item)
        }))
        .filter((item) => item.candidates.length)
    : [];
}

function prepareDurlSegments({ bvid, cid, quality, title, playUrl, segments }) {
  const extension = extensionFor(playUrl.format);
  const baseName = safeFilename(`${title}_${quality}`);
  const preparedSegments = [];

  for (const [index, segmentPlan] of segments.entries()) {
    const suffix = segments.length > 1 ? `_part${index + 1}` : "";
    const filename = `BiliDownload/${baseName}${suffix}${extension}`;
    const context = {
      bvid,
      cid,
      quality,
      title,
      segmentIndex: index + 1,
      segmentCount: segments.length,
      format: playUrl.format
    };
    preparedSegments.push({
      url: segmentPlan.candidates[0].url,
      filename,
      size: Number(segmentPlan.source?.size) || 0,
      candidates: segmentPlan.candidates,
      context: {
        ...context,
        downloadMethod: "page-blob"
      }
    });
  }

  return {
    count: preparedSegments.length,
    segments: preparedSegments,
    format: playUrl.format,
    mode: "durl"
  };
}

function prepareDashSegments({ bvid, cid, quality, title, playUrl }) {
  const videoStream = selectDashVideo(playUrl, quality);
  const audioStream = selectDashAudio(playUrl);
  if (!audioStream) {
    throw new Error("DASH response did not include an audio stream.");
  }

  const baseName = safeFilename(`${title}_${videoStream.id || quality}`);
  const streams = [
    {
      role: "video",
      label: "\u89c6\u9891",
      stream: videoStream,
      filename: `BiliDownload/${baseName}_video.m4s`
    },
    {
      role: "audio",
      label: "\u97f3\u9891",
      stream: audioStream,
      filename: `BiliDownload/${baseName}_audio.m4s`
    }
  ];

  const preparedSegments = streams.map((item, index) => {
    const candidates = buildDashCandidates(item.stream);
    if (!candidates.length) {
      throw new Error(`DASH ${item.role} stream did not include a media URL.`);
    }

    return {
      url: candidates[0].url,
      filename: item.filename,
      size: Number(item.stream.size) || 0,
      candidates,
      context: {
        bvid,
        cid,
        quality: videoStream.id || quality,
        title,
        segmentIndex: index + 1,
        segmentCount: streams.length,
        role: item.role,
        roleLabel: item.label,
        format: "dash",
        codecs: item.stream.codecs || "",
        mimeType: item.stream.mimeType || "",
        downloadMethod: "page-blob"
      }
    };
  });

  return {
    count: preparedSegments.length,
    segments: preparedSegments,
    format: "dash",
    mode: "dash",
    dash: {
      video: pickDashStream(videoStream),
      audio: pickDashStream(audioStream)
    }
  };
}

function buildSegmentCandidates(segment) {
  const urls = [
    segment?.url,
    ...(Array.isArray(segment?.backup_url) ? segment.backup_url : []),
    ...(Array.isArray(segment?.backupUrl) ? segment.backupUrl : [])
  ];
  const seen = new Set();
  return urls
    .filter((url) => typeof url === "string" && url)
    .filter((url) => {
      if (seen.has(url)) {
        return false;
      }
      seen.add(url);
      return true;
    })
    .map((url, index) => ({
      url,
      kind: index === 0 ? "primary" : "backup",
      size: Number(segment?.size) || 0
    }));
}

function buildDashCandidates(stream) {
  const urls = [
    stream?.url,
    ...(Array.isArray(stream?.backupUrls) ? stream.backupUrls : [])
  ];
  const seen = new Set();
  return urls
    .filter((url) => typeof url === "string" && url)
    .filter((url) => {
      if (seen.has(url)) {
        return false;
      }
      seen.add(url);
      return true;
    })
    .map((url, index) => ({
      url,
      kind: index === 0 ? "primary" : "backup",
      size: Number(stream?.size) || 0
    }));
}

function readCandidates(segment) {
  const candidates = Array.isArray(segment?.candidates)
    ? segment.candidates.filter((candidate) => candidate?.url)
    : [];
  if (candidates.length) {
    return candidates;
  }
  return segment?.url ? [{ url: segment.url, kind: "primary" }] : [];
}

async function fetchPlayUrl({ bvid, cid, quality, fnval = 4048 }) {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(quality || 127),
    fnval: String(fnval),
    fnver: "0",
    fourk: "0",
    otype: "json"
  });

  const payload = await fetchJson(`${API_BASE}/x/player/playurl?${params.toString()}`);
  return normalizePlayUrl(expectData(payload));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Accept": "application/json, text/plain, */*"
    }
  });

  if (!response.ok) {
    throw new Error(`Bilibili API returned HTTP ${response.status}.`);
  }

  return response.json();
}

function expectData(payload) {
  if (Number(payload?.code) !== 0) {
    throw new Error(payload?.message || payload?.msg || "Bilibili API returned an error.");
  }

  if (!payload?.data || typeof payload.data !== "object") {
    throw new Error("Bilibili API response did not include data.");
  }

  return payload.data;
}

async function buildQualityAvailability({ bvid, cid, playUrl, account }) {
  const availability = new Map();
  const requestedCodes = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];

  for (const stream of playUrl.dashVideos || []) {
    markQualityAvailable(availability, stream.id, "dash");
  }

  if (hasDirectStreams(playUrl)) {
    markQualityAvailable(availability, responseQuality(playUrl), "direct");
  }

  const missingCodes = requestedCodes
    .map((code) => Number(code))
    .filter((code) => Number.isFinite(code) && !availability.get(code)?.available);
  await Promise.all(missingCodes.map(async (code) => {
    try {
      const directPlayUrl = await fetchPlayUrl({ bvid, cid, quality: code, fnval: 0 });
      if (hasExactDirectQuality(directPlayUrl, code)) {
        markQualityAvailable(availability, code, "direct");
      }
    } catch (_error) {
      // The DASH response still gives us the advertised list; legacy direct probing is best effort.
    }
  }));

  for (const code of requestedCodes) {
    const numericCode = Number(code);
    if (!Number.isFinite(numericCode) || availability.has(numericCode)) {
      continue;
    }
    availability.set(numericCode, unavailableQualityInfo(account));
  }

  return availability;
}

function markQualityAvailable(availability, code, mode) {
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode) || numericCode <= 0) {
    return;
  }
  const current = availability.get(numericCode);
  if (current?.mode === "dash") {
    return;
  }
  availability.set(numericCode, {
    available: true,
    mode,
    reason: ""
  });
}

function unavailableQualityInfo(account) {
  return {
    available: false,
    mode: "",
    reason: account?.isLogin ? "unavailable" : "login-required"
  };
}

function buildQualityOptions(playUrl, availability = new Map()) {
  const qualities = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];
  const descriptions = Array.isArray(playUrl.accept_description) ? playUrl.accept_description : [];
  const dashByQuality = new Map();

  for (const stream of playUrl.dashVideos || []) {
    const current = dashByQuality.get(stream.id);
    if (!current || compareDashStreams(stream, current) > 0) {
      dashByQuality.set(stream.id, stream);
    }
  }

  return qualities.map((code, index) => {
    const numericCode = Number(code);
    const info = availability.get(numericCode) || unavailableQualityInfo(null);
    return {
      code: numericCode,
      label: buildQualityLabel(numericCode, descriptions[index], dashByQuality.get(numericCode)),
      available: info.available,
      mode: info.mode || "",
      reason: info.reason || ""
    };
  });
}

function buildQualityLabel(code, description, stream) {
  const detail = [];
  if (stream?.height) {
    detail.push(`${stream.height}p`);
  }
  if (stream?.frameRate) {
    detail.push(`${stream.frameRate}fps`);
  }
  if (stream?.codecs) {
    detail.push(stream.codecs);
  }

  const suffix = detail.length ? ` (${detail.join(" ")})` : "";
  return `${code} - ${description || "Unknown"}${suffix}`;
}

function normalizePlayUrl(data) {
  const dash = data.dash || {};
  return {
    ...data,
    durl: Array.isArray(data.durl) ? data.durl : [],
    accept_quality: Array.isArray(data.accept_quality) ? data.accept_quality.map((item) => Number(item)) : [],
    accept_description: Array.isArray(data.accept_description) ? data.accept_description : [],
    dashVideos: (Array.isArray(dash.video) ? dash.video : [])
      .map(parseDashMedia)
      .filter((item) => item.url),
    dashAudios: (Array.isArray(dash.audio) ? dash.audio : [])
      .map(parseDashMedia)
      .filter((item) => item.url)
  };
}

function parseDashMedia(item) {
  const id = Number(item?.id);
  const backupUrls = item?.backup_url || item?.backupUrl || item?.backup_urls || [];
  return {
    id: Number.isFinite(id) ? id : 0,
    url: String(item?.base_url || item?.baseUrl || ""),
    backupUrls: Array.isArray(backupUrls) ? backupUrls.map((url) => String(url)).filter(Boolean) : [],
    bandwidth: optionalNumber(item?.bandwidth),
    codecs: String(item?.codecs || ""),
    mimeType: String(item?.mime_type || item?.mimeType || ""),
    width: optionalNumber(item?.width),
    height: optionalNumber(item?.height),
    frameRate: String(item?.frame_rate || item?.frameRate || ""),
    size: optionalNumber(item?.size) || 0
  };
}

function selectDashVideo(playUrl, requestedQuality) {
  let candidates = playUrl.dashVideos.filter((stream) => stream.id === requestedQuality);
  if (!candidates.length) {
    const available = uniqueDashQualities(playUrl).map((stream) => stream.id).join(", ");
    throw new Error(`Quality ${requestedQuality} was not found in DASH streams. Available qualities: ${available}`);
  }

  return candidates.reduce((best, stream) => (
    compareDashStreams(stream, best) > 0 ? stream : best
  ));
}

function hasDashQuality(playUrl, requestedQuality) {
  return playUrl.dashVideos.some((stream) => stream.id === requestedQuality);
}

function hasDirectStreams(playUrl) {
  return buildDirectSegmentPlans(playUrl).length > 0;
}

function hasExactDirectQuality(playUrl, requestedQuality) {
  return hasDirectStreams(playUrl) && responseQuality(playUrl) === requestedQuality;
}

function responseQuality(playUrl) {
  return Number(playUrl.quality) || 0;
}

function selectDefaultQuality(qualities, responseQualityValue) {
  const responseCode = Number(responseQualityValue);
  const responseOption = qualities.find((quality) => (
    quality.available && quality.code === responseCode
  ));
  if (responseOption) {
    return responseOption.code;
  }

  const firstAvailable = qualities.find((quality) => quality.available);
  return firstAvailable?.code || null;
}

function unavailableQualityError(quality) {
  return new Error(`Quality ${quality} is not downloadable with the current browser Cookie. Please log in or choose a marked available quality.`);
}

function selectDashAudio(playUrl) {
  const audios = playUrl.dashAudios || [];
  if (!audios.length) {
    return null;
  }

  return audios.reduce((best, stream) => (
    (stream.bandwidth || 0) > (best.bandwidth || 0) ? stream : best
  ));
}

function uniqueDashQualities(playUrl) {
  const result = [];
  const seen = new Set();
  for (const stream of [...(playUrl.dashVideos || [])].sort((left, right) => right.id - left.id)) {
    if (seen.has(stream.id)) {
      continue;
    }
    seen.add(stream.id);
    result.push(stream);
  }
  return result;
}

function compareDashStreams(left, right) {
  const leftScore = dashScore(left);
  const rightScore = dashScore(right);
  for (let index = 0; index < leftScore.length; index += 1) {
    if (leftScore[index] !== rightScore[index]) {
      return leftScore[index] - rightScore[index];
    }
  }
  return 0;
}

function dashScore(stream) {
  const codecScore = String(stream?.codecs || "").startsWith("av01") ? 0 : 1;
  return [
    Number(stream?.id) || 0,
    frameRateNumber(stream?.frameRate),
    Number(stream?.bandwidth) || 0,
    codecScore
  ];
}

function frameRateNumber(value) {
  const parsed = Number.parseFloat(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickDashStream(stream) {
  return {
    id: stream.id,
    bandwidth: stream.bandwidth,
    codecs: stream.codecs,
    mimeType: stream.mimeType,
    width: stream.width,
    height: stream.height,
    frameRate: stream.frameRate,
    size: stream.size
  };
}

function selectVideoPage(pages, pageNumber) {
  return pages.find((item) => Number(item.index || item.page) === pageNumber) || pages[0] || null;
}

function normalizeVideoPages(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((item, index) => {
      const pageIndex = Number(item?.page) || index + 1;
      const title = String(item?.part || item?.title || `P${pageIndex}`);
      return {
        index: pageIndex,
        page: pageIndex,
        cid: Number(item?.cid) || 0,
        title,
        part: title
      };
    })
    .filter((item) => item.cid);
}

function readPageNumber(url) {
  try {
    const value = new URL(url || "").searchParams.get("p");
    return Math.max(Number(value) || 1, 1);
  } catch (_error) {
    return 1;
  }
}

function normalizeBvid(value) {
  const match = String(value || "").match(/BV[0-9A-Za-z]{10}/);
  return match ? match[0] : "";
}

function extensionFor(format) {
  const normalized = String(format || "").toLowerCase();
  if (normalized.includes("mp4")) {
    return ".mp4";
  }
  if (normalized.includes("flv")) {
    return ".flv";
  }
  return ".mp4";
}

function safeFilename(value) {
  return String(value || "bili_video")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[ ._]+$/g, "")
    .slice(0, 120) || "bili_video";
}

async function downloadFileWithDiagnostics({ options, context }) {
  const diagnostic = createBaseDiagnostic({
    mediaUrl: options.url,
    filename: options.filename,
    context
  });
  diagnostic.phase = "probing-dnr";
  diagnostic.dnr = await testDnrRules(options.url);
  await setLastDiagnostic(diagnostic);

  try {
    diagnostic.phase = "starting-download";
    await setLastDiagnostic(diagnostic);
    const id = await downloadFile(options);
    diagnostic.downloadId = id;
    diagnostic.phase = "download-started";
    diagnostic.initialItem = pickDownloadItem(await getDownloadItem(id));
    await setLastDiagnostic(diagnostic);

    const observed = await observeDownload(id, diagnostic);
    if (observed.item?.state === "interrupted" || observed.delta?.error) {
      const reason = observed.item?.error || observed.delta?.error?.current || "download interrupted";
      throw new DownloadDiagnosticError(`Download failed: ${reason}`, diagnostic);
    }

    return { id, diagnostic };
  } catch (error) {
    if (error instanceof DownloadDiagnosticError) {
      throw error;
    }
    diagnostic.phase = "download-error";
    diagnostic.error = error.message;
    await setLastDiagnostic(diagnostic);
    throw new DownloadDiagnosticError(error.message, diagnostic);
  }
}

function downloadFile(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (id) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(id);
    });
  });
}

function observeDownload(id, diagnostic, timeoutMs = 12000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = async (payload) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      chrome.downloads.onChanged.removeListener(listener);
      await setLastDiagnostic(diagnostic);
      resolve(payload);
    };

    const listener = async (delta) => {
      if (delta.id !== id) {
        return;
      }

      const item = await getDownloadItem(id);
      diagnostic.events.push({
        at: new Date().toISOString(),
        delta: pickDownloadDelta(delta),
        item: pickDownloadItem(item)
      });
      diagnostic.latestItem = pickDownloadItem(item);

      if (item?.state === "complete" || item?.state === "interrupted" || delta.error) {
        diagnostic.phase = item?.state || "download-changed";
        await finish({ item, delta, timeout: false });
        return;
      }

      await setLastDiagnostic(diagnostic);
    };

    chrome.downloads.onChanged.addListener(listener);
    timer = setTimeout(async () => {
      const item = await getDownloadItem(id);
      diagnostic.phase = "download-observation-timeout";
      diagnostic.latestItem = pickDownloadItem(item);
      await finish({ item, delta: null, timeout: true });
    }, timeoutMs);
  });
}

function getDownloadItem(id) {
  return new Promise((resolve, reject) => {
    chrome.downloads.search({ id }, (items) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(items?.[0] || null);
    });
  });
}

async function testDnrRules(url) {
  if (!chrome.declarativeNetRequest?.testMatchOutcome) {
    return { available: false, reason: "testMatchOutcome unavailable" };
  }

  const checks = [];
  for (const type of DNR_TEST_TYPES) {
    try {
      const result = await chrome.declarativeNetRequest.testMatchOutcome({
        url,
        type,
        initiator: "https://www.bilibili.com",
        tabId: -1
      });
      checks.push({
        type,
        matchedRules: (result.matchedRules || []).map((item) => ({
          ruleId: item.ruleId,
          rulesetId: item.rulesetId
        }))
      });
    } catch (error) {
      checks.push({ type, error: error.message });
    }
  }

  return {
    available: true,
    checks
  };
}

function createBaseDiagnostic({ mediaUrl = "", filename = "", context = null }) {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    phase: "created",
    context,
    request: {
      media: summarizeUrl(mediaUrl),
      filename
    },
    events: [],
    dnrMatchedEvents: []
  };
}

async function setLastDiagnostic(diagnostic) {
  lastDiagnostic = sanitizeForMessage(diagnostic);
  try {
    await chrome.storage?.local?.set({ [DIAGNOSTIC_STORAGE_KEY]: lastDiagnostic });
  } catch (_error) {
    // Diagnostics are best-effort and should not break downloads.
  }
}

async function getLastDiagnostic() {
  if (lastDiagnostic) {
    return lastDiagnostic;
  }

  try {
    const stored = await chrome.storage?.local?.get(DIAGNOSTIC_STORAGE_KEY);
    return stored?.[DIAGNOSTIC_STORAGE_KEY] || null;
  } catch (_error) {
    return null;
  }
}

function errorResponse(error) {
  return {
    ok: false,
    error: error.message,
    diagnostic: sanitizeForMessage(error.diagnostic || lastDiagnostic || null)
  };
}

function sanitizeForMessage(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return {
      phase: value.phase || "diagnostic-serialization-error",
      error: value.error || "Diagnostic could not be serialized.",
      context: sanitizeForMessage(value.context),
      request: sanitizeForMessage(value.request),
      latestItem: sanitizeForMessage(value.latestItem)
    };
  }
}

class DownloadDiagnosticError extends Error {
  constructor(message, diagnostic) {
    super(message);
    this.name = "DownloadDiagnosticError";
    this.diagnostic = diagnostic;
  }
}

function pickDownloadDelta(delta) {
  return {
    id: delta.id,
    state: delta.state || null,
    error: delta.error || null,
    danger: delta.danger || null,
    url: delta.url || null,
    finalUrl: delta.finalUrl || null,
    mime: delta.mime || null,
    filename: delta.filename || null,
    totalBytes: delta.totalBytes || null
  };
}

function pickDownloadItem(item) {
  if (!item) {
    return null;
  }

  return {
    id: item.id,
    url: summarizeUrl(item.url),
    finalUrl: summarizeUrl(item.finalUrl),
    filename: item.filename,
    mime: item.mime,
    state: item.state,
    error: item.error,
    danger: item.danger,
    fileSize: item.fileSize,
    totalBytes: item.totalBytes,
    bytesReceived: item.bytesReceived,
    canResume: item.canResume,
    paused: item.paused,
    exists: item.exists,
    byExtensionName: item.byExtensionName,
    startTime: item.startTime,
    endTime: item.endTime
  };
}

function pickRequestDetails(request) {
  return {
    url: summarizeUrl(request?.url),
    method: request?.method,
    type: request?.type,
    tabId: request?.tabId,
    initiator: request?.initiator
  };
}

function summarizeUrl(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return {
      host: url.host,
      path: url.pathname.slice(0, 180),
      searchLength: url.search.length,
      sample: `${url.origin}${url.pathname}${url.search ? "?..." : ""}`
    };
  } catch (_error) {
    return String(value).slice(0, 240);
  }
}

function isMediaHost(value) {
  try {
    const host = new URL(value).host;
    return (
      host.endsWith("bilivideo.com") ||
      host.endsWith("bilivideo.cn") ||
      host.endsWith("hdslb.com")
    );
  } catch (_error) {
    return false;
  }
}
