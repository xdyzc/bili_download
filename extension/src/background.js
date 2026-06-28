const API_BASE = "https://api.bilibili.com";
const DIAGNOSTIC_STORAGE_KEY = "lastDiagnostic";
const DNR_TEST_TYPES = ["main_frame", "other", "media", "xmlhttprequest"];
const PROGRESS_MESSAGE_TYPE = "BILI_DOWNLOAD_PAGE_PROGRESS";
const PROGRESS_PORT_NAME = "BILI_DOWNLOAD_PROGRESS_PORT";
const SIZE_PROBE_TIMEOUT_MS = 2500;

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

  if (message?.type === "BILI_DOWNLOAD_PREPARE_AUDIO") {
    prepareAudioDownload(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_LOAD_LIVE") {
    loadLive(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING") {
    prepareLiveRecording(message.payload)
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
  if (isBangumiPage(page)) {
    return loadBangumi(page);
  }

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

async function loadBangumi(page) {
  const seasonId = normalizeId(page?.seasonId) || extractSeasonId(page?.url);
  const epId = normalizeId(page?.epId) || extractEpId(page?.url);
  const tabId = normalizeTabId(page?.tabId);
  if (!seasonId && !epId) {
    throw new Error("No Bangumi season or episode id was found on this page.");
  }

  const [seasonPayload, account] = await Promise.all([
    fetchBangumiSeason({ seasonId, epId, tabId }),
    fetchAccountStatus().catch((error) => ({
      isLogin: false,
      username: "",
      userId: null,
      vipLabel: "",
      error: error.message
    }))
  ]);
  const season = expectResult(seasonPayload);
  const pages = normalizeBangumiEpisodes(season.episodes || []);
  const episode = selectBangumiEpisode(pages, { epId, pageUrl: page?.url, season });

  if (!episode?.cid || !episode?.epId) {
    throw new Error("Could not find a playable Bangumi episode.");
  }

  const playUrl = await fetchPgcPlayUrl({
    epId: episode.epId,
    cid: episode.cid,
    tabId
  });
  assertPlayablePgc(playUrl);

  const availability = await buildQualityAvailability({
    bvid: episode.bvid,
    epId: episode.epId,
    cid: episode.cid,
    playUrl,
    account,
    source: "bangumi",
    tabId
  });
  const qualities = buildQualityOptions(playUrl, availability);
  const title = page?.title || buildBangumiTitle(season, episode);

  return {
    source: "bangumi",
    bvid: episode.bvid || `ep${episode.epId}`,
    aid: episode.aid || null,
    seasonId: Number(season.season_id || seasonId) || null,
    epId: episode.epId,
    title,
    ownerName: season.up_info?.uname || season.season_title || "",
    page: episode,
    pages,
    account,
    currentQuality: selectDefaultQuality(qualities, playUrl.quality),
    directAvailable: qualities.some((quality) => quality.available && quality.mode === "direct"),
    dashAvailable: qualities.some((quality) => quality.available && quality.mode === "dash"),
    qualities
  };
}

async function loadLive(page) {
  const roomId = normalizeId(page?.roomId) || extractLiveRoomId(page?.url);
  if (!roomId) {
    throw new Error("No live room id was found on this page.");
  }

  const [roomPayload, account] = await Promise.all([
    fetchLiveRoomInfo(roomId),
    fetchAccountStatus().catch((error) => ({
      isLogin: false,
      username: "",
      userId: null,
      vipLabel: "",
      error: error.message
    }))
  ]);
  const room = normalizeLiveRoom(roomPayload, roomId);
  const title = page?.title || room.title || `live_${room.roomId}`;
  let playInfo = { qualities: [], streams: [], currentQuality: null };
  let qualities = [];
  if (room.liveStatus === 1) {
    const playPayload = await fetchLivePlayInfo(room.roomId);
    playInfo = normalizeLivePlayInfo(expectData(playPayload));
    qualities = await buildLiveQualityOptions({
      roomId: room.roomId,
      playInfo,
      account
    });
  }

  return {
    source: "live",
    roomId: room.roomId,
    shortId: room.shortId,
    title,
    liveStatus: room.liveStatus,
    liveStatusText: room.liveStatus === 1 ? "直播中" : "未开播",
    anchorName: room.anchorName,
    account,
    currentQuality: selectDefaultQuality(qualities, playInfo.currentQuality),
    qualities
  };
}

async function prepareLiveRecording(payload) {
  const roomId = normalizeId(payload?.roomId) || extractLiveRoomId(payload?.url);
  const title = payload?.title || (roomId ? `live_${roomId}` : "bili_live");
  const requestedQuality = Number(payload?.quality) || 0;
  if (!roomId) {
    throw new Error("Missing live room id.");
  }

  const roomPayload = await fetchLiveRoomInfo(roomId);
  const room = normalizeLiveRoom(roomPayload, roomId);
  if (room.liveStatus !== 1) {
    throw new Error("当前直播间未开播，不能开始录制。");
  }

  const playPayload = await fetchLivePlayInfo(room.roomId, requestedQuality || 10000);
  const playInfo = normalizeLivePlayInfo(expectData(playPayload));
  const stream = selectLiveFlvStream(playInfo, requestedQuality);
  if (!stream?.url) {
    if (requestedQuality) {
      throw unavailableQualityError(requestedQuality);
    }
    throw new Error("没有找到可录制的 FLV 直播流。");
  }

  const baseName = safeFilename(`${title}_${timestampForFilename(new Date())}`);
  const segment = {
    url: stream.url,
    filename: `BiliDownload/${baseName}.flv`,
    size: 0,
    candidates: stream.candidates,
    context: {
      roomId: room.roomId,
      shortId: room.shortId,
      title,
      source: "live",
      segmentIndex: 1,
      segmentCount: 1,
      role: "live",
      roleLabel: "直播",
      format: "flv",
      codec: stream.codec,
      quality: stream.quality,
      qualityLabel: stream.qualityLabel,
      downloadMethod: "live-recording"
    }
  };

  return {
    mode: "live",
    count: 1,
    format: "flv",
    live: {
      roomId: room.roomId,
      shortId: room.shortId,
      title,
      liveStatus: room.liveStatus,
      quality: stream.quality,
      qualityLabel: stream.qualityLabel,
      protocol: stream.protocol,
      format: stream.format,
      codec: stream.codec
    },
    segments: [segment]
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
  const epId = normalizeId(payload?.epId);
  const tabId = normalizeTabId(payload?.tabId);
  const source = epId ? "bangumi" : "video";
  const cid = Number(payload?.cid);
  const quality = Number(payload?.quality);
  const title = payload?.title || bvid || (epId ? `ep${epId}` : "");

  if ((!bvid && !epId) || !cid || !quality) {
    throw new Error("Missing video, cid, or quality.");
  }

  const playUrl = await fetchMediaPlayUrl({ bvid, epId, cid, quality, tabId });
  if (source === "bangumi") {
    assertPlayablePgc(playUrl);
  }

  if (hasDashQuality(playUrl, quality)) {
    return prepareDashSegments({
      bvid,
      epId,
      cid,
      quality,
      title,
      playUrl,
      source
    });
  }

  if (hasExactDirectQuality(playUrl, quality)) {
    const directSegments = buildDirectSegmentPlans(playUrl);
    return prepareDurlSegments({
      bvid,
      epId,
      cid,
      quality: responseQuality(playUrl) || quality,
      title,
      playUrl,
      segments: directSegments,
      source
    });
  }

  const directPlayUrl = await fetchMediaPlayUrl({ bvid, epId, cid, quality, fnval: 0, tabId });
  if (source === "bangumi") {
    assertPlayablePgc(directPlayUrl);
  }
  if (hasExactDirectQuality(directPlayUrl, quality)) {
    const legacyDirectSegments = buildDirectSegmentPlans(directPlayUrl);
    return prepareDurlSegments({
      bvid,
      epId,
      cid,
      quality: responseQuality(directPlayUrl) || quality,
      title,
      playUrl: directPlayUrl,
      segments: legacyDirectSegments,
      source
    });
  }

  throw unavailableQualityError(quality);
}

async function prepareAudioDownload(payload) {
  const bvid = normalizeBvid(payload?.bvid);
  const epId = normalizeId(payload?.epId);
  const tabId = normalizeTabId(payload?.tabId);
  const cid = Number(payload?.cid);
  const title = payload?.title || bvid || (epId ? `ep${epId}` : "");

  if ((!bvid && !epId) || !cid) {
    throw new Error("Missing video or cid.");
  }

  const playUrl = await fetchMediaPlayUrl({ bvid, epId, cid, tabId });
  if (epId) {
    assertPlayablePgc(playUrl);
  }
  return prepareAudioSegment({
    bvid,
    epId,
    cid,
    title,
    playUrl
  });
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

function prepareDurlSegments({ bvid, epId = null, cid, quality, title, playUrl, segments, source = "video" }) {
  const extension = extensionFor(playUrl.format);
  const baseName = safeFilename(`${title}_${quality}`);
  const preparedSegments = [];

  for (const [index, segmentPlan] of segments.entries()) {
    const suffix = segments.length > 1 ? `_part${index + 1}` : "";
    const filename = `BiliDownload/${baseName}${suffix}${extension}`;
    const context = {
      bvid,
      epId,
      cid,
      quality,
      title,
      source,
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

function prepareDashSegments({ bvid, epId = null, cid, quality, title, playUrl, source = "video" }) {
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
        epId,
        cid,
        quality: videoStream.id || quality,
        title,
        source,
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

async function fetchMediaPlayUrl({ bvid, epId, cid, quality, fnval = 4048, tabId = null }) {
  if (epId) {
    return fetchPgcPlayUrl({ epId, cid, quality, fnval, tabId });
  }
  return fetchPlayUrl({ bvid, cid, quality, fnval });
}

async function fetchBangumiSeason({ seasonId, epId, tabId = null }) {
  const params = new URLSearchParams();
  if (seasonId) {
    params.set("season_id", String(seasonId));
  } else {
    params.set("ep_id", String(epId));
  }
  return fetchJsonPreferPage(`${API_BASE}/pgc/view/web/season?${params.toString()}`, tabId);
}

async function fetchPgcPlayUrl({ epId, cid, quality, fnval = 4048, tabId = null }) {
  const params = new URLSearchParams({
    ep_id: String(epId),
    cid: String(cid),
    qn: String(quality || 127),
    fnval: String(fnval),
    fnver: "0",
    fourk: "1",
    platform: "pc",
    from_client: "BROWSER",
    otype: "json"
  });

  const payload = await fetchJsonPreferPage(`${API_BASE}/pgc/player/web/playurl?${params.toString()}`, tabId);
  return normalizePlayUrl(expectResult(payload));
}

async function fetchLiveRoomInfo(roomId) {
  const payload = await fetchJson(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${encodeURIComponent(roomId)}`);
  const init = expectData(payload);
  const realRoomId = Number(init.room_id) || Number(roomId);

  let info = {};
  try {
    info = expectData(await fetchJson(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(realRoomId)}`
    ));
  } catch (_error) {
    info = {};
  }

  return {
    ...init,
    ...info,
    room_id: realRoomId,
    short_id: Number(init.short_id || info.short_id) || null,
    live_status: Number(init.live_status ?? info.live_status) || 0
  };
}

async function fetchLivePlayInfo(roomId, quality = 10000) {
  const params = new URLSearchParams({
    room_id: String(roomId),
    protocol: "0,1",
    format: "0,1,2",
    codec: "0,1",
    qn: String(Number(quality) || 10000),
    platform: "web",
    ptype: "8"
  });
  return fetchJson(`https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?${params.toString()}`);
}

async function fetchJsonPreferPage(url, tabId) {
  const numericTabId = normalizeTabId(tabId);
  if (numericTabId && chrome.scripting?.executeScript) {
    try {
      return await fetchJsonFromPage(url, numericTabId);
    } catch (_error) {
      // Page-origin requests preserve Bilibili's player context. Fall back to the
      // service worker path so older pages and tests still have a best-effort route.
    }
  }
  return fetchJson(url);
}

async function fetchJsonFromPage(url, tabId) {
  const [injection] = await chrome.scripting.executeScript({
    target: {
      tabId
    },
    world: "MAIN",
    func: fetchJsonInPage,
    args: [url]
  });
  const result = injection?.result;
  if (!result?.ok) {
    throw new Error(result?.error || "Page API fetch failed.");
  }
  if (!result.responseOk) {
    throw new Error(`Bilibili API returned HTTP ${result.status || "unknown"}.`);
  }
  return result.payload;
}

async function fetchJsonInPage(url) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "application/json, text/plain, */*"
      },
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      cache: "no-store"
    });
    return {
      ok: true,
      responseOk: response.ok,
      status: response.status,
      payload: await response.json()
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message
    };
  }
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

function expectResult(payload) {
  if (Number(payload?.code) !== 0) {
    throw new Error(payload?.message || payload?.msg || "Bilibili API returned an error.");
  }

  if (!payload?.result || typeof payload.result !== "object") {
    throw new Error("Bilibili API response did not include result.");
  }

  return payload.result;
}

async function buildQualityAvailability({ bvid, epId = null, cid, playUrl, account, source = "video", tabId = null }) {
  const availability = new Map();
  const requestedCodes = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];

  const dashQualityCodes = new Set((playUrl.dashVideos || []).map((stream) => stream.id));
  await Promise.all(Array.from(dashQualityCodes).map((code) => (
    markQualityAvailable(availability, code, "dash", playUrl)
  )));

  if (hasDirectStreams(playUrl)) {
    await markQualityAvailable(availability, responseQuality(playUrl), "direct", playUrl);
  }

  const missingCodes = requestedCodes
    .map((code) => Number(code))
    .filter((code) => Number.isFinite(code) && !availability.get(code)?.available);
  await Promise.all(missingCodes.map(async (code) => {
    try {
      const dashPlayUrl = await fetchMediaPlayUrl({ bvid, epId, cid, quality: code, fnval: 4048, tabId });
      if (hasDashQuality(dashPlayUrl, code)) {
        await markQualityAvailable(availability, code, "dash", dashPlayUrl);
        return;
      }
      if (hasExactDirectQuality(dashPlayUrl, code)) {
        await markQualityAvailable(availability, code, "direct", dashPlayUrl);
        return;
      }

      const directPlayUrl = await fetchMediaPlayUrl({ bvid, epId, cid, quality: code, fnval: 0, tabId });
      if (hasExactDirectQuality(directPlayUrl, code)) {
        await markQualityAvailable(availability, code, "direct", directPlayUrl);
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
    availability.set(numericCode, unavailableQualityInfo(account, qualityRequirement(playUrl, numericCode, source)));
  }

  return availability;
}

async function markQualityAvailable(availability, code, mode, playUrl = null) {
  const numericCode = Number(code);
  if (!Number.isFinite(numericCode) || numericCode <= 0) {
    return;
  }
  const current = availability.get(numericCode);
  if (current?.mode === "dash" && mode !== "dash") {
    return;
  }
  if (current?.mode === mode && current.estimatedSize) {
    return;
  }

  const stream = mode === "dash" ? findBestDashVideo(playUrl, numericCode) : null;
  const sizeInfo = await resolveQualitySize(playUrl, numericCode, mode);
  availability.set(numericCode, {
    available: true,
    mode,
    reason: "",
    estimatedSize: sizeInfo.size || current?.estimatedSize || 0,
    estimatedSizeSource: sizeInfo.source || current?.estimatedSizeSource || "",
    estimatedSizeApproximate: sizeInfo.approximate || false,
    stream: stream || current?.stream || null
  });
}

function unavailableQualityInfo(account, requirement = null) {
  if (requirement?.needVip) {
    return {
      available: false,
      mode: "",
      reason: "vip-required"
    };
  }

  if (requirement?.needLogin) {
    return {
      available: false,
      mode: "",
      reason: "login-required"
    };
  }

  return {
    available: false,
    mode: "",
    reason: account?.isLogin ? "unavailable" : "login-required"
  };
}

async function buildLiveQualityOptions({ roomId, playInfo, account }) {
  const qualityMap = new Map();
  for (const quality of playInfo?.qualities || []) {
    if (quality?.code) {
      qualityMap.set(quality.code, quality);
    }
  }

  for (const code of playInfo?.acceptQualities || []) {
    if (!qualityMap.has(code)) {
      qualityMap.set(code, {
        code,
        label: `QN ${code}`
      });
    }
  }

  for (const stream of playInfo?.streams || []) {
    if (!stream.quality || qualityMap.has(stream.quality)) {
      continue;
    }
    qualityMap.set(stream.quality, {
      code: stream.quality,
      label: stream.qualityLabel || `QN ${stream.quality}`
    });
  }

  const qualities = Array.from(qualityMap.values())
    .filter((quality) => Number(quality.code) > 0)
    .sort((left, right) => Number(right.code) - Number(left.code));
  const availableByQuality = groupLiveFlvStreamsByQuality(playInfo);
  const missingQualities = qualities
    .map((quality) => Number(quality.code))
    .filter((code) => !availableByQuality.has(code));

  await Promise.all(missingQualities.map(async (code) => {
    try {
      const payload = await fetchLivePlayInfo(roomId, code);
      const probed = normalizeLivePlayInfo(expectData(payload));
      for (const [quality, streams] of groupLiveFlvStreamsByQuality(probed)) {
        const current = availableByQuality.get(quality) || [];
        availableByQuality.set(quality, [...current, ...streams]);
      }
      for (const quality of probed.qualities) {
        if (!qualityMap.has(quality.code)) {
          qualityMap.set(quality.code, quality);
        }
      }
    } catch (_error) {
      // Live playurl probing is best effort. The advertised quality list remains useful.
    }
  }));

  return Array.from(qualityMap.values())
    .filter((quality) => Number(quality.code) > 0)
    .sort((left, right) => Number(right.code) - Number(left.code))
    .map((quality) => {
      const code = Number(quality.code);
      const stream = bestLiveStream(availableByQuality.get(code) || []);
      const available = Boolean(stream?.url);
      return {
        code,
        label: buildLiveQualityLabel(quality, stream),
        estimatedSize: 0,
        estimatedSizeSource: "",
        estimatedSizeApproximate: false,
        available,
        mode: available ? "live" : "",
        reason: available ? "" : liveUnavailableReason(account)
      };
    });
}

function liveUnavailableReason(account) {
  return account?.isLogin ? "unavailable" : "login-required";
}

function groupLiveFlvStreamsByQuality(playInfo) {
  const result = new Map();
  for (const stream of Array.isArray(playInfo?.streams) ? playInfo.streams : []) {
    if (!isUsableLiveFlvStream(stream)) {
      continue;
    }
    const current = result.get(stream.quality) || [];
    current.push(stream);
    result.set(stream.quality, current);
  }
  return result;
}

function buildLiveQualityLabel(quality, stream = null) {
  const parts = [
    String(quality?.label || stream?.qualityLabel || `QN ${quality?.code || ""}`).trim(),
    compactLiveCodec(stream?.codec)
  ];
  return parts.filter(Boolean).join(" · ");
}

function compactLiveCodec(value) {
  const codec = String(value || "").toLowerCase();
  if (!codec) {
    return "";
  }
  if (codec === "avc" || codec.includes("avc") || codec.includes("h264")) {
    return "AVC";
  }
  if (codec === "hevc" || codec.includes("hevc") || codec.includes("h265")) {
    return "HEVC";
  }
  return codec.toUpperCase();
}

function prepareAudioSegment({ bvid, epId = null, cid, title, playUrl }) {
  const audioStream = selectDashAudio(playUrl);
  if (!audioStream) {
    throw new Error("DASH response did not include an audio stream.");
  }

  const candidates = buildDashCandidates(audioStream);
  if (!candidates.length) {
    throw new Error("DASH audio stream did not include a media URL.");
  }

  const baseName = safeFilename(title);
  const segment = {
    url: candidates[0].url,
    filename: `BiliDownload/${baseName}.m4a`,
    size: Number(audioStream.size) || 0,
    candidates,
    context: {
      bvid,
      epId,
      cid,
      quality: Number(audioStream.id) || 0,
      title,
      source: epId ? "bangumi" : "video",
      segmentIndex: 1,
      segmentCount: 1,
      role: "audio",
      roleLabel: "\u97f3\u9891",
      format: "audio",
      codecs: audioStream.codecs || "",
      mimeType: audioStream.mimeType || "",
      downloadMethod: "page-blob"
    }
  };

  return {
    count: 1,
    segments: [segment],
    format: "audio",
    mode: "audio",
    audio: pickDashStream(audioStream)
  };
}

function buildQualityOptions(playUrl, availability = new Map()) {
  const qualities = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];
  const descriptions = Array.isArray(playUrl.accept_description) ? playUrl.accept_description : [];
  const supportByQuality = new Map((playUrl.supportFormats || []).map((item) => [
    Number(item.quality),
    item
  ]));
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
    const stream = dashByQuality.get(numericCode) || info.stream || null;
    return {
      code: numericCode,
      label: buildQualityLabel(
        numericCode,
        descriptions[index] || supportByQuality.get(numericCode)?.description || supportByQuality.get(numericCode)?.newDescription,
        stream
      ),
      estimatedSize: Number(info.estimatedSize) || estimateQualitySize(playUrl, numericCode, info.mode) || 0,
      estimatedSizeSource: info.estimatedSizeSource || "",
      estimatedSizeApproximate: Boolean(info.estimatedSizeApproximate),
      available: info.available,
      mode: info.mode || "",
      reason: info.reason || ""
    };
  });
}

function buildQualityLabel(code, description, stream) {
  const base = String(description || "").trim() || `QN ${code}`;
  return [
    base,
    compactResolution(stream),
    compactFrameRate(stream?.frameRate),
    compactVideoCodec(stream?.codecs)
  ].filter(Boolean).join(" · ");
}

function compactResolution(stream) {
  const width = Number(stream?.width) || 0;
  const height = Number(stream?.height) || 0;
  if (width && height) {
    return `${width}x${height}`;
  }

  if (height) {
    return `${height}p`;
  }

  return "";
}

function compactFrameRate(value) {
  const parsed = frameRateNumber(value);
  if (!parsed) {
    return "";
  }

  const rounded = Math.round(parsed);
  return `${rounded}fps`;
}

function compactVideoCodec(value) {
  const codec = String(value || "").toLowerCase();
  if (!codec) {
    return "";
  }

  if (codec.startsWith("avc1")) {
    return "AVC";
  }
  if (codec.startsWith("hev1") || codec.startsWith("hvc1")) {
    return "HEVC";
  }
  if (codec.startsWith("av01")) {
    return "AV1";
  }
  if (codec.startsWith("vp09") || codec.startsWith("vp9")) {
    return "VP9";
  }

  return String(value).split(".")[0].toUpperCase();
}

function normalizePlayUrl(data) {
  const dash = data.dash || {};
  return {
    ...data,
    durl: Array.isArray(data.durl) ? data.durl : (Array.isArray(data.durls) ? data.durls : []),
    accept_quality: Array.isArray(data.accept_quality) ? data.accept_quality.map((item) => Number(item)) : [],
    accept_description: Array.isArray(data.accept_description) ? data.accept_description : [],
    supportFormats: normalizeSupportFormats(data.support_formats),
    isDrm: Boolean(data.is_drm),
    isPreview: Boolean(Number(data.is_preview)),
    canWatchReason: Number(data.can_watch_reason) || 0,
    status: Number(data.status) || 0,
    timeLength: optionalNumber(data.timelength ?? data.time_length ?? data.duration) || 0,
    dashVideos: (Array.isArray(dash.video) ? dash.video : [])
      .map(parseDashMedia)
      .filter((item) => item.url),
    dashAudios: (Array.isArray(dash.audio) ? dash.audio : [])
      .map(parseDashMedia)
      .filter((item) => item.url)
  };
}

function normalizeSupportFormats(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      quality: Number(item?.quality) || 0,
      description: String(item?.description || ""),
      newDescription: String(item?.new_description || item?.display_desc || ""),
      needLogin: Boolean(item?.need_login),
      needVip: Boolean(item?.need_vip),
      hasPreview: Boolean(item?.has_preview),
      canWatchReason: Number(item?.can_watch_qn_reason) || 0
    }))
    .filter((item) => item.quality);
}

function qualityRequirement(playUrl, quality, source) {
  if (source !== "bangumi") {
    return null;
  }
  return (playUrl.supportFormats || []).find((item) => Number(item.quality) === Number(quality)) || null;
}

function assertPlayablePgc(playUrl) {
  const code = Number(playUrl.code);
  if (Number.isFinite(code) && code !== 0) {
    throw new Error(playUrl.message || "PGC playurl returned an error.");
  }

  if (playUrl.isDrm) {
    throw new Error("\u8be5\u756a\u5267\u4f7f\u7528 DRM \u4fdd\u62a4\uff0c\u5f53\u524d\u63d2\u4ef6\u4e0d\u80fd\u4e0b\u8f7d\u3002");
  }

  if (playUrl.isPreview || playUrl.canWatchReason) {
    throw new Error(playUrl.message || "\u5f53\u524d\u8d26\u53f7\u65e0\u6cd5\u5b8c\u6574\u89c2\u770b\u8fd9\u4e00\u96c6\uff0c\u4e0d\u80fd\u4e0b\u8f7d\u3002");
  }
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
  const video = findBestDashVideo(playUrl, requestedQuality);
  if (!video) {
    const available = uniqueDashQualities(playUrl).map((stream) => stream.id).join(", ");
    throw new Error(`Quality ${requestedQuality} was not found in DASH streams. Available qualities: ${available}`);
  }

  return video;
}

function findBestDashVideo(playUrl, requestedQuality) {
  const candidates = (playUrl?.dashVideos || []).filter((stream) => stream.id === requestedQuality);
  if (!candidates.length) {
    return null;
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

async function resolveQualitySize(playUrl, quality, mode) {
  const apiSize = estimateQualitySize(playUrl, quality, mode);
  if (apiSize) {
    return {
      size: apiSize,
      source: "api",
      approximate: false
    };
  }

  const probedSize = await probeQualitySize(playUrl, quality, mode);
  if (probedSize) {
    return {
      size: probedSize,
      source: "headers",
      approximate: false
    };
  }

  const bandwidthSize = estimateQualitySizeByBandwidth(playUrl, quality, mode);
  if (bandwidthSize) {
    return {
      size: bandwidthSize,
      source: "bandwidth",
      approximate: true
    };
  }

  return {
    size: 0,
    source: "",
    approximate: false
  };
}

function estimateQualitySize(playUrl, quality, mode) {
  if (!playUrl || !mode) {
    return 0;
  }

  if (mode === "dash") {
    return estimateDashQualitySize(playUrl, quality);
  }

  if (mode === "direct") {
    return estimateDirectQualitySize(playUrl);
  }

  return 0;
}

function estimateDashQualitySize(playUrl, quality) {
  const videoStream = findBestDashVideo(playUrl, quality);
  const audioStream = selectDashAudio(playUrl);
  return positiveSize(videoStream?.size) + positiveSize(audioStream?.size);
}

function estimateDirectQualitySize(playUrl) {
  return buildDirectSegmentPlans(playUrl).reduce((total, segmentPlan) => (
    total + positiveSize(segmentPlan.source?.size)
  ), 0);
}

function positiveSize(value) {
  const size = Number(value) || 0;
  return size > 0 ? size : 0;
}

async function probeQualitySize(playUrl, quality, mode) {
  if (!playUrl || !mode) {
    return 0;
  }

  if (mode === "dash") {
    return probeDashQualitySize(playUrl, quality);
  }

  if (mode === "direct") {
    return probeDirectQualitySize(playUrl);
  }

  return 0;
}

async function probeDashQualitySize(playUrl, quality) {
  const videoStream = findBestDashVideo(playUrl, quality);
  const audioStream = selectDashAudio(playUrl);
  const sizes = await Promise.all([
    probeDashStreamSize(videoStream),
    probeDashStreamSize(audioStream)
  ]);

  if (sizes.some((size) => !size)) {
    return 0;
  }

  return sizes.reduce((total, size) => total + size, 0);
}

async function probeDirectQualitySize(playUrl) {
  const segments = buildDirectSegmentPlans(playUrl);
  if (!segments.length) {
    return 0;
  }

  const sizes = await Promise.all(segments.map((segmentPlan) => (
    probeMediaSizeFromUrls(segmentPlan.candidates.map((candidate) => candidate.url))
  )));

  if (sizes.some((size) => !size)) {
    return 0;
  }

  return sizes.reduce((total, size) => total + size, 0);
}

async function probeDashStreamSize(stream) {
  if (!stream?.url) {
    return 0;
  }

  const candidates = buildDashCandidates(stream).map((candidate) => candidate.url);
  return probeMediaSizeFromUrls(candidates);
}

async function probeMediaSizeFromUrls(urls) {
  const seen = new Set();
  for (const url of urls || []) {
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);

    const size = await probeMediaUrlSize(url);
    if (size) {
      return size;
    }
  }

  return 0;
}

async function probeMediaUrlSize(url) {
  const headSize = await probeMediaUrlHeadSize(url);
  if (headSize) {
    return headSize;
  }

  return probeMediaUrlRangeSize(url);
}

async function probeMediaUrlHeadSize(url) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "HEAD",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Accept": "*/*"
      }
    });
    if (!response?.ok) {
      return 0;
    }
    return contentLengthFromHeaders(response.headers);
  } catch (_error) {
    return 0;
  }
}

async function probeMediaUrlRangeSize(url) {
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Accept": "*/*",
        "Range": "bytes=0-0"
      }
    });
    if (response?.status !== 206) {
      return 0;
    }

    return contentRangeTotal(response.headers.get("content-range")) ||
      contentLengthFromHeaders(response.headers);
  } catch (_error) {
    return 0;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeoutId = null;
  try {
    const fetchOptions = controller
      ? {
        ...options,
        signal: controller.signal
      }
      : options;
    const timeout = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        controller?.abort();
        resolve(null);
      }, SIZE_PROBE_TIMEOUT_MS);
    });
    return await Promise.race([
      fetch(url, fetchOptions),
      timeout
    ]);
  } catch (_error) {
    return null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

function contentLengthFromHeaders(headers) {
  return positiveSize(headers?.get?.("content-length"));
}

function contentRangeTotal(value) {
  const match = String(value || "").match(/\/(\d+)$/);
  return match ? positiveSize(match[1]) : 0;
}

function estimateQualitySizeByBandwidth(playUrl, quality, mode) {
  if (mode !== "dash") {
    return 0;
  }

  const durationSeconds = playUrlDurationSeconds(playUrl);
  if (!durationSeconds) {
    return 0;
  }

  const videoStream = findBestDashVideo(playUrl, quality);
  const audioStream = selectDashAudio(playUrl);
  const totalBandwidth = positiveSize(videoStream?.bandwidth) + positiveSize(audioStream?.bandwidth);
  if (!totalBandwidth) {
    return 0;
  }

  return Math.round((totalBandwidth * durationSeconds) / 8);
}

function playUrlDurationSeconds(playUrl) {
  const value = positiveSize(playUrl?.timeLength);
  if (!value) {
    return 0;
  }

  return value > 10000 ? value / 1000 : value;
}

function selectDefaultQuality(qualities, responseQualityValue) {
  const responseCode = Number(responseQualityValue);
  const responseOption = qualities.find((quality) => (
    quality.available && quality.code === responseCode
  ));
  const firstAvailable = qualities.find((quality) => quality.available);
  if (!firstAvailable) {
    return null;
  }

  if (responseOption && responseOption.code >= firstAvailable.code) {
    return responseOption.code;
  }

  return firstAvailable.code;
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

function normalizeBangumiEpisodes(episodes) {
  return (Array.isArray(episodes) ? episodes : [])
    .map((item, index) => {
      const pageIndex = index + 1;
      const epId = Number(item?.ep_id || item?.id) || 0;
      const title = bangumiEpisodeTitle(item, pageIndex);
      return {
        index: pageIndex,
        page: pageIndex,
        cid: Number(item?.cid) || 0,
        aid: Number(item?.aid) || 0,
        bvid: normalizeBvid(item?.bvid),
        epId,
        title,
        part: title
      };
    })
    .filter((item) => item.cid && item.epId);
}

function normalizeLiveRoom(room, fallbackRoomId) {
  const roomId = Number(room?.room_id || fallbackRoomId) || 0;
  return {
    roomId,
    shortId: Number(room?.short_id) || null,
    liveStatus: Number(room?.live_status) || 0,
    title: String(room?.title || `live_${roomId}`),
    anchorName: String(room?.uname || room?.anchor_name || "")
  };
}

function normalizeLivePlayInfo(data) {
  const playurl = data?.playurl_info?.playurl || data?.playurl || {};
  const qualities = (Array.isArray(playurl.g_qn_desc) ? playurl.g_qn_desc : [])
    .map((item) => ({
      code: Number(item?.qn) || 0,
      label: String(item?.desc || item?.media_base_desc?.detail_desc?.desc || item?.media_base_desc?.brief_desc?.desc || "")
    }))
    .filter((item) => item.code);
  const qualityMap = new Map(qualities.map((quality) => [quality.code, quality.label]));
  const acceptQualities = new Set(qualities.map((quality) => quality.code));
  const streams = [];

  for (const stream of Array.isArray(playurl.stream) ? playurl.stream : []) {
    for (const format of Array.isArray(stream?.format) ? stream.format : []) {
      for (const codec of Array.isArray(format?.codec) ? format.codec : []) {
        const candidates = liveUrlCandidates(codec);
        if (!candidates.length) {
          continue;
        }
        const quality = Number(codec?.current_qn) || 0;
        const codecAcceptQualities = (Array.isArray(codec?.accept_qn) ? codec.accept_qn : [])
          .map((item) => Number(item))
          .filter((item) => Number.isFinite(item) && item > 0);
        for (const code of codecAcceptQualities) {
          acceptQualities.add(code);
        }
        streams.push({
          protocol: String(stream?.protocol_name || ""),
          format: String(format?.format_name || ""),
          codec: String(codec?.codec_name || ""),
          quality,
          qualityLabel: qualityMap.get(quality) || (quality ? `QN ${quality}` : ""),
          acceptQualities: codecAcceptQualities,
          candidates,
          url: candidates[0].url,
          isPushing: codec?.is_pushing !== false
        });
      }
    }
  }

  return {
    roomId: Number(playurl.cid || data?.room_id) || 0,
    qualities,
    acceptQualities: Array.from(acceptQualities).sort((left, right) => right - left),
    currentQuality: streams.reduce((best, stream) => Math.max(best, Number(stream.quality) || 0), 0) || null,
    streams
  };
}

function liveUrlCandidates(codec) {
  const baseUrl = String(codec?.base_url || codec?.baseUrl || "");
  const infos = Array.isArray(codec?.url_info || codec?.urlInfo) ? (codec.url_info || codec.urlInfo) : [];
  const seen = new Set();
  return infos
    .map((info, index) => {
      const host = String(info?.host || "");
      const extra = String(info?.extra || "");
      const url = `${host}${baseUrl}${extra}`;
      return {
        url,
        kind: index === 0 ? "primary" : "backup",
        size: 0
      };
    })
    .filter((candidate) => candidate.url && !seen.has(candidate.url) && seen.add(candidate.url));
}

function selectLiveFlvStream(playInfo, requestedQuality = 0) {
  const streams = Array.isArray(playInfo?.streams) ? playInfo.streams : [];
  const requested = Number(requestedQuality) || 0;
  const flvStreams = streams.filter(isUsableLiveFlvStream);
  const fallbackStreams = streams.filter((stream) => stream.format === "flv" && stream.url);
  const source = flvStreams.length ? flvStreams : fallbackStreams;
  const candidates = requested
    ? source.filter((stream) => Number(stream.quality) === requested)
    : source;
  if (!candidates.length) {
    return null;
  }

  return bestLiveStream(candidates);
}

function isUsableLiveFlvStream(stream) {
  return stream?.protocol === "http_stream" &&
    stream?.format === "flv" &&
    Boolean(stream?.url) &&
    stream?.isPushing;
}

function bestLiveStream(streams) {
  const candidates = Array.isArray(streams) ? streams.filter((stream) => stream?.url) : [];
  if (!candidates.length) {
    return null;
  }
  return candidates.reduce((best, stream) => (
    liveStreamScore(stream) > liveStreamScore(best) ? stream : best
  ));
}

function liveStreamScore(stream) {
  const codecScore = String(stream?.codec || "").toLowerCase() === "avc" ? 1 : 0;
  return (Number(stream?.quality) || 0) * 10 + codecScore;
}

function bangumiEpisodeTitle(item, pageIndex) {
  const showTitle = String(item?.show_title || "").trim();
  if (showTitle) {
    return showTitle;
  }

  const episodeNumber = String(item?.title || "").trim();
  const longTitle = String(item?.long_title || "").trim();
  if (episodeNumber && longTitle) {
    return `第${episodeNumber}话 ${longTitle}`;
  }
  if (longTitle) {
    return longTitle;
  }
  if (episodeNumber) {
    return `第${episodeNumber}话`;
  }
  return `第${pageIndex}集`;
}

function selectBangumiEpisode(pages, { epId, pageUrl, season }) {
  const currentEpId = normalizeId(epId) || extractEpId(pageUrl);
  if (currentEpId) {
    const byEp = pages.find((item) => item.epId === currentEpId);
    if (byEp) {
      return byEp;
    }
  }

  return pages[0] || null;
}

function buildBangumiTitle(season, episode) {
  const seasonTitle = String(season?.season_title || season?.title || "").trim();
  if (seasonTitle && episode?.title) {
    return `${seasonTitle}_${episode.title}`;
  }
  return seasonTitle || episode?.title || `ep${episode?.epId || ""}`;
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

function normalizeId(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTabId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function extractSeasonId(value) {
  const match = String(value || "").match(/\/bangumi\/play\/ss(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractEpId(value) {
  const match = String(value || "").match(/\/bangumi\/play\/ep(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractLiveRoomId(value) {
  const match = String(value || "").match(/:\/\/live\.bilibili\.com\/(?:blanc\/)?(\d+)/);
  return match ? Number(match[1]) : null;
}

function isBangumiPage(page) {
  return page?.type === "bangumi" || /:\/\/www\.bilibili\.com\/bangumi\/play\//.test(String(page?.url || ""));
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

function timestampForFilename(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("") + "_" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
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
