const API_BASE = "https://api.bilibili.com";
const DIAGNOSTIC_STORAGE_KEY = "lastDiagnostic";
const DIRECT_DOWNLOAD_TASK_STORAGE_KEY = "directDownloadTasks";
const COMPANION_DOWNLOAD_TASK_STORAGE_KEY = "companionDownloadTasks";
const BATCH_DOWNLOAD_JOB_STORAGE_KEY = "batchDownloadJobs";
const DNR_TEST_TYPES = ["main_frame", "other", "media", "xmlhttprequest"];
const PROGRESS_MESSAGE_TYPE = "BILI_DOWNLOAD_PAGE_PROGRESS";
const PROGRESS_PORT_NAME = "BILI_DOWNLOAD_PROGRESS_PORT";
const PLAY_URL_CACHE_TTL_MS = 45 * 1000;
const PLAY_URL_CACHE_LIMIT = 40;
const DIRECT_DOWNLOAD_TASK_HISTORY_LIMIT = 20;
const BATCH_DOWNLOAD_JOB_HISTORY_LIMIT = 20;
const DIRECT_DOWNLOAD_SNAPSHOT_MIN_INTERVAL_MS = 1500;
const DIRECT_DOWNLOAD_SNAPSHOT_MIN_BYTES_DELTA = 1024 * 1024;
const DIRECT_DOWNLOAD_CANDIDATE_REFRESH_LIMIT = 2;
const BATCH_DOWNLOAD_JOB_ITEM_LIMIT = 500;
const COMPANION_NATIVE_HOST_NAME = "com.bili_download.stream_companion";
const COMPANION_PROTOCOL_VERSION = 1;
const COMPANION_TASK_HISTORY_LIMIT = 20;
const COMPANION_DEFAULT_MAX_BYTES = 128 * 1024 * 1024 * 1024;
const COMPANION_MAX_BYTES = 128 * 1024 * 1024 * 1024;
const COMPANION_DEFAULT_LIVE_DURATION_SECONDS = 2 * 60 * 60;
const COMPANION_MAX_LIVE_DURATION_SECONDS = 24 * 60 * 60;
const COMPANION_DEFAULT_LIVE_SEGMENT_SECONDS = 5 * 60;
const COMPANION_MAX_LIVE_SEGMENT_SECONDS = 60 * 60;
const COMPANION_SNAPSHOT_MIN_INTERVAL_MS = 1500;
const COMPANION_SNAPSHOT_MIN_BYTES_DELTA = 1024 * 1024;
const COMPANION_START_TIMEOUT_MS = 8000;

let lastDiagnostic = null;
const progressPorts = new Set();
const directDownloadTasks = new Map();
const directDownloadIds = new Map();
let directDownloadTaskSequence = 0;
let directDownloadTasksRestored = false;
let directDownloadTasksRestorePromise = null;
let directDownloadTasksPersistOperation = Promise.resolve();
let directDownloadTasksPersistTimer = null;
let directDownloadTasksLastPersistAt = 0;
const directDownloadTaskPersistMetadata = new Map();
const companionDownloadTasks = new Map();
const companionDownloadPorts = new Map();
let companionSharedDownloadPort = null;
let companionDownloadTaskSequence = 0;
let companionDownloadTasksRestored = false;
let companionDownloadTasksRestorePromise = null;
let companionDownloadTasksPersistOperation = Promise.resolve();
let companionDownloadTasksPersistTimer = null;
let companionDownloadTasksLastPersistAt = 0;
const companionDownloadTaskPersistMetadata = new Map();
const batchDownloadJobs = new Map();
let batchDownloadJobSequence = 0;
let batchDownloadJobsRestored = false;
let batchDownloadJobsRestorePromise = null;
let batchDownloadJobsPersistOperation = Promise.resolve();
const playUrlCache = new Map();
const douyuTabResolutionOperations = new Map();

const LIVE_SITE_ADAPTERS = Object.freeze({
  bilibili: Object.freeze({
    load: loadBilibiliLive,
    prepare: prepareBilibiliLiveRecording
  }),
  douyu: Object.freeze({
    load: loadDouyuLive,
    prepare: prepareDouyuLiveRecording
  }),
  huya: Object.freeze({
    load: loadHuyaLive,
    prepare: prepareHuyaLiveRecording
  })
});

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

  if (message?.type === "BILI_DOWNLOAD_COMPANION_PING") {
    pingCompanionNativeHost()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_START_COMPANION") {
    startCompanionDownload(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_GET_COMPANION_TASK") {
    getCompanionDownloadTask(message.payload?.taskId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_LIST_COMPANION_TASKS") {
    listCompanionDownloadTasks(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_CONTROL_COMPANION_TASK") {
    controlCompanionDownloadTask(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_GET_DIRECT_TASK") {
    getDirectDownloadTask(message.payload?.taskId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_LIST_DIRECT_TASKS") {
    listDirectDownloadTasks(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_CONTROL_DIRECT") {
    controlDirectDownloadTask(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_CREATE_BATCH_JOB") {
    createBatchDownloadJob(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_GET_BATCH_JOB") {
    getBatchDownloadJob(message.payload?.batchJobId)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_LIST_BATCH_JOBS") {
    listBatchDownloadJobs(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse(errorResponse(error)));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_UPDATE_BATCH_JOB") {
    updateBatchDownloadJob(message.payload)
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
      .catch((error) => sendResponse(errorResponse(error)));
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
      .catch((error) => sendResponse(errorResponse(error)));
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
  const normalized = {
    receivedBytes: Number(value?.receivedBytes) || 0,
    totalBytes: Number(value?.totalBytes) || 0,
    segmentIndex: Number(value?.segmentIndex) || 0,
    segmentCount: Number(value?.segmentCount) || 0,
    candidateIndex: Number(value?.candidateIndex) || 0,
    candidateCount: Number(value?.candidateCount) || 0,
    done: Boolean(value?.done),
    taskId: typeof value?.taskId === "string" ? value.taskId : "",
    taskState: typeof value?.taskState === "string" ? value.taskState : "",
    nativeDownload: Boolean(value?.nativeDownload),
    downloadIds: Array.isArray(value?.downloadIds)
      ? value.downloadIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)
      : [],
    error: typeof value?.error === "string" ? redactDiagnosticText(value.error) : ""
  };

  // Keep the legacy progress shape stable for page and browser-download
  // clients. Companion-only fields are opt-in so existing consumers do not
  // mistake a local task for a Chrome downloads task.
  if (value?.companionDownload) {
    normalized.companionDownload = true;
    normalized.companionKind = normalizeCompanionKind(value?.companionKind);
    normalized.phase = normalizeCompanionPhase(value?.phase);
    normalized.recoverable = Boolean(value?.recoverable);
    normalized.segmentCount = Number(value?.segmentCount) || normalized.segmentCount;
    normalized.reconnectAttempt = Number(value?.reconnectAttempt) || 0;
  }
  return normalized;
}

chrome.downloads?.onChanged?.addListener((delta) => {
  handleDirectDownloadChange(delta).catch(() => {
    // Native download events are best-effort. The browser still owns the file transfer.
  });
});

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
  restoreDirectDownloadTasks().catch(() => {});
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

  const playUrl = await fetchMediaPlayUrlCached({
    bvid,
    cid: videoPage.cid,
    tabId: normalizeTabId(page?.tabId)
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

  const playUrl = await fetchMediaPlayUrlCached({
    bvid: episode.bvid,
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
  const site = normalizeLiveSite(page?.site || siteFromUrl(page?.url));
  return LIVE_SITE_ADAPTERS[site].load({ ...page, site });
}

async function prepareLiveRecording(payload) {
  const site = normalizeLiveSite(payload?.site || siteFromUrl(payload?.url));
  return LIVE_SITE_ADAPTERS[site].prepare({ ...payload, site });
}

async function loadBilibiliLive(page) {
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
    site: "bilibili",
    roomKey: String(room.roomId),
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

async function prepareBilibiliLiveRecording(payload) {
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
      site: "bilibili",
      roomKey: String(room.roomId),
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
      site: "bilibili",
      roomKey: String(room.roomId),
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
  await restoreDirectDownloadTasks();
  const prepared = payload?.prepared || await prepareDirectDownload(payload);
  if (prepared?.mode !== "durl" && prepared?.mode !== "audio") {
    throw new Error("Native downloads only support standalone media streams.");
  }

  const task = createDirectDownloadTask(prepared, normalizeTabId(payload?.tabId));
  directDownloadTasks.set(task.id, task);
  pruneDirectDownloadTasks(task.id);
  persistDirectDownloadTasks({ force: true }).catch(() => {});
  await queueDirectDownloadTask(task, () => advanceDirectDownloadTask(task));
  return snapshotDirectDownloadTask(task);
}

function createDirectDownloadTask(prepared, tabId = null) {
  const sourceSegments = Array.isArray(prepared?.segments) ? prepared.segments : [];
  if (!sourceSegments.length) {
    throw new Error("Direct stream response did not include a downloadable segment.");
  }

  const segments = sourceSegments.map((source, index) => {
    const candidates = readCandidates(source);
    if (!candidates.length) {
      throw new Error(`Direct stream segment ${index + 1} did not include a media URL.`);
    }

    return {
      index: index + 1,
      filename: String(source.filename || `BiliDownload/direct_${index + 1}.mp4`),
      size: Number(source.size) || 0,
      context: directTaskContext(source.context),
      candidates,
      candidateCount: candidates.length,
      candidateIndex: 0,
      candidateRefreshCount: 0,
      downloadId: null,
      state: "queued",
      receivedBytes: 0,
      totalBytes: Number(source.size) || 0,
      error: "",
      diagnostic: null,
      candidateDiagnostics: []
    };
  });

  const now = new Date().toISOString();
  return {
    id: createDirectDownloadTaskId(),
    tabId: normalizeTabId(tabId),
    mode: String(prepared?.mode || "durl"),
    format: String(prepared?.format || ""),
    createdAt: now,
    updatedAt: now,
    state: "queued",
    error: "",
    requestedAction: "",
    segments,
    operation: Promise.resolve()
  };
}

async function loadDouyuLive(page) {
  const roomKey = normalizeLiveRoomKey(page?.roomKey || extractLiveRoomKey(page?.url, "douyu"));
  if (!/^\d+$/.test(roomKey)) {
    throw new Error("没有识别到斗鱼直播间号。");
  }
  const room = normalizeDouyuRoom(await fetchJsonPreferPage(
    `https://www.douyu.com/betard/${encodeURIComponent(roomKey)}`,
    page?.tabId
  ), roomKey);
  const qualities = normalizeDouyuQualities(room.multirates);
  return {
    source: "live",
    site: "douyu",
    roomKey: String(room.roomId),
    roomId: room.roomId,
    title: room.title,
    liveStatus: room.liveStatus,
    liveStatusText: room.liveStatus === 1 ? "直播中" : "未开播",
    anchorName: room.anchorName,
    account: null,
    currentQuality: qualities[0]?.code || null,
    qualities
  };
}

async function prepareDouyuLiveRecording(payload) {
  const roomKey = normalizeLiveRoomKey(payload?.roomKey || payload?.roomId || extractLiveRoomKey(payload?.url, "douyu"));
  if (!/^\d+$/.test(roomKey)) {
    throw new Error("没有识别到斗鱼直播间号。");
  }
  const room = normalizeDouyuRoom(await fetchJsonPreferPage(
    `https://www.douyu.com/betard/${encodeURIComponent(roomKey)}`,
    payload?.tabId
  ), roomKey);
  if (room.liveStatus !== 1) {
    throw new Error("当前斗鱼直播间未开播，不能开始录制。");
  }
  const qualities = normalizeDouyuQualities(room.multirates);
  const requestedQuality = Number(payload?.quality) || qualities[0]?.code || 0;
  const quality = qualities.find((item) => item.code === requestedQuality);
  if (!quality) {
    throw unavailableQualityError(requestedQuality);
  }
  const resolved = await resolveDouyuStreamFromPage({
    tabId: payload?.tabId,
    roomId: room.roomId,
    ownerUid: room.ownerUid,
    rate: quality.siteCode
  });
  const url = buildDouyuFlvUrl(resolved);
  if (!url) {
    throw new Error("斗鱼没有返回可录制的 HTTPS AVC FLV 直播流。");
  }
  return buildSiteLivePreparation({
    site: "douyu",
    roomKey: String(room.roomId),
    roomId: room.roomId,
    title: room.title,
    anchorName: room.anchorName,
    quality: quality.code,
    qualityLabel: quality.label,
    candidates: [{ url, kind: "primary", size: 0 }]
  });
}

async function loadHuyaLive(page) {
  const roomKey = normalizeLiveRoomKey(page?.roomKey || extractLiveRoomKey(page?.url, "huya"));
  if (!roomKey) {
    throw new Error("没有识别到虎牙房间标识。");
  }
  const live = await readHuyaLiveStateFromPage(page?.tabId, 0, false);
  const qualities = normalizeHuyaQualities(live.qualities);
  return {
    source: "live",
    site: "huya",
    roomKey: String(live.roomKey || roomKey),
    roomId: normalizeId(live.roomId),
    title: live.title || page?.title || `huya_${roomKey}`,
    liveStatus: live.liveStatus === 1 ? 1 : 0,
    liveStatusText: live.liveStatus === 1 ? "直播中" : "未开播",
    anchorName: live.anchorName || "",
    account: null,
    currentQuality: qualities[0]?.code || null,
    qualities: live.liveStatus === 1 ? qualities : []
  };
}

async function prepareHuyaLiveRecording(payload) {
  const roomKey = normalizeLiveRoomKey(payload?.roomKey || payload?.roomId || extractLiveRoomKey(payload?.url, "huya"));
  if (!roomKey) {
    throw new Error("没有识别到虎牙房间标识。");
  }
  const requestedQuality = Number(payload?.quality) || 0;
  const live = await readHuyaLiveStateFromPage(payload?.tabId, requestedQuality, true);
  if (live.liveStatus !== 1) {
    throw new Error("当前虎牙直播间未开播，不能开始录制。");
  }
  const qualities = normalizeHuyaQualities(live.qualities);
  const quality = requestedQuality
    ? qualities.find((item) => item.code === requestedQuality)
    : qualities[0];
  if (!quality || !Array.isArray(live.candidates) || !live.candidates.length) {
    throw unavailableQualityError(requestedQuality);
  }
  return buildSiteLivePreparation({
    site: "huya",
    roomKey: String(live.roomKey || roomKey),
    roomId: normalizeId(live.roomId),
    title: live.title || payload?.title || `huya_${roomKey}`,
    anchorName: live.anchorName || "",
    quality: quality.code,
    qualityLabel: quality.label,
    candidates: live.candidates
  });
}

function normalizeDouyuRoom(payload, fallbackRoomKey) {
  const room = payload?.room || {};
  const roomId = normalizeId(room.room_id || fallbackRoomKey);
  if (!roomId) {
    throw new Error("斗鱼房间信息不完整，请刷新直播页后重试。");
  }
  return {
    roomId,
    ownerUid: normalizeId(room.owner_uid),
    title: String(room.room_name || `douyu_${roomId}`).trim(),
    anchorName: String(room.owner_name || "").trim(),
    liveStatus: Number(room.show_status) === 1 ? 1 : 0,
    multirates: Array.isArray(room.multirates) ? room.multirates : []
  };
}

function normalizeDouyuQualities(multirates) {
  const seen = new Set();
  return (Array.isArray(multirates) ? multirates : [])
    .map((item) => {
      const siteCode = Number(item?.type);
      if (!Number.isFinite(siteCode) || siteCode < 0) {
        return null;
      }
      const code = siteCode === 0 ? 10000 : siteCode;
      return {
        code,
        siteCode,
        label: String(item?.name || (siteCode === 0 ? "原画" : `画质 ${siteCode}`)),
        estimatedSize: 0,
        estimatedSizeSource: "",
        estimatedSizeApproximate: false,
        available: true,
        mode: "live",
        reason: ""
      };
    })
    .filter((item) => item && !seen.has(item.code) && seen.add(item.code));
}

function normalizeHuyaQualities(qualities) {
  const seen = new Set();
  return (Array.isArray(qualities) ? qualities : [])
    .map((item) => {
      const bitrate = Number(item?.bitrate);
      if (!Number.isFinite(bitrate) || bitrate < 0 || Number(item?.codecType) !== 0) {
        return null;
      }
      const code = bitrate === 0 ? 10000 : bitrate;
      return {
        code,
        siteCode: bitrate,
        label: String(item?.label || (bitrate === 0 ? "原画" : `${bitrate} Kbps`)),
        estimatedSize: 0,
        estimatedSizeSource: "",
        estimatedSizeApproximate: false,
        available: true,
        mode: "live",
        reason: ""
      };
    })
    .filter((item) => item && !seen.has(item.code) && seen.add(item.code));
}

async function resolveDouyuStreamFromPage({ tabId, roomId, ownerUid, rate }) {
  const numericTabId = normalizeTabId(tabId);
  if (!numericTabId) {
    throw new Error("斗鱼直播页不可用，请回到原直播间后重试。");
  }
  const previous = douyuTabResolutionOperations.get(numericTabId) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: numericTabId },
      world: "MAIN",
      func: resolveDouyuStreamInPage,
      args: [Number(roomId), Number(ownerUid) || 0, Number(rate) || 0]
    });
    const result = injection?.result;
    if (!result?.ok) {
      throw new Error(result?.error || "斗鱼播放器尚未准备好，请刷新直播页后重试。");
    }
    return result.payload;
  });
  douyuTabResolutionOperations.set(numericTabId, operation);
  try {
    return await operation;
  } catch (error) {
    throw new Error(error?.message || "斗鱼取流失败，请刷新直播页后重试。");
  } finally {
    if (douyuTabResolutionOperations.get(numericTabId) === operation) {
      douyuTabResolutionOperations.delete(numericTabId);
    }
  }
}

async function resolveDouyuStreamInPage(roomId, ownerUid, rate) {
  const waitUntilReady = async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (typeof globalThis.getLegacyFirstStream === "function") {
        return globalThis.getLegacyFirstStream;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return null;
  };
  const resolver = await waitUntilReady();
  if (!resolver) {
    return { ok: false, error: "斗鱼播放器尚未准备好，请刷新直播页后重试。" };
  }
  const originalFetch = globalThis.fetch;
  let matched = false;
  const wrappedFetch = function(input, init = {}) {
    let url = "";
    try {
      url = new URL(typeof input === "string" ? input : input?.url || "", location.origin);
    } catch (_error) {
      return originalFetch.call(this, input, init);
    }
    if (url.origin === location.origin && url.pathname === `/lapi/live/getH5PlayV1/${roomId}`) {
      const body = new URLSearchParams(String(init?.body || ""));
      body.set("rate", String(Number(rate) || 0));
      body.set("hevc", "0");
      body.set("fa", "0");
      matched = true;
      return originalFetch.call(this, input, { ...init, body: body.toString() });
    }
    return originalFetch.call(this, input, init);
  };
  globalThis.fetch = wrappedFetch;
  try {
    const data = await resolver({
      roomID: Number(roomId),
      owner_uid: Number(ownerUid) || 0,
      cookiePre: "",
      nonce: ""
    });
    if (!matched || !data || typeof data !== "object") {
      return { ok: false, error: "斗鱼没有返回可录制的直播流。" };
    }
    return {
      ok: true,
      payload: {
        roomId: Number(data.room_id) || Number(roomId),
        rate: Number(data.rate),
        rtmpUrl: String(data.rtmp_url || ""),
        rtmpLive: String(data.rtmp_live || ""),
        isMixed: Boolean(data.is_mixed),
        rtcUrl: String(data.rtc_stream_url || "")
      }
    };
  } catch (_error) {
    return { ok: false, error: "斗鱼取流失败，请刷新直播页后重试。" };
  } finally {
    if (globalThis.fetch === wrappedFetch) {
      globalThis.fetch = originalFetch;
    }
  }
}

function buildDouyuFlvUrl(stream) {
  const isMixed = Boolean(stream?.isMixed ?? stream?.is_mixed);
  const rtcUrl = String(stream?.rtcUrl || stream?.rtc_stream_url || "");
  const rtmpUrl = String(stream?.rtmpUrl || stream?.rtmp_url || "");
  const rtmpLive = String(stream?.rtmpLive || stream?.rtmp_live || "");
  if (!stream || isMixed || rtcUrl || !rtmpUrl || !rtmpLive) {
    return "";
  }
  try {
    const base = rtmpUrl.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
    const live = rtmpLive.replace(/^\/+/, "");
    const url = new URL(`${base}/${live}`);
    return url.protocol === "https:" &&
      /\.flv$/i.test(url.pathname) &&
      isAllowedCompanionMediaUrl(url.href, "douyu")
      ? url.href
      : "";
  } catch (_error) {
    return "";
  }
}

async function readHuyaLiveStateFromPage(tabId, quality, includeSources) {
  const numericTabId = normalizeTabId(tabId);
  if (!numericTabId) {
    throw new Error("虎牙直播页不可用，请回到原直播间后重试。");
  }
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: numericTabId },
    world: "MAIN",
    func: readHuyaLiveStateInPage,
    args: [Number(quality) || 0, Boolean(includeSources)]
  });
  const result = injection?.result;
  if (!result?.ok) {
    throw new Error(result?.error || "虎牙播放器尚未准备好，请刷新直播页后重试。");
  }
  return result.payload;
}

async function readHuyaLiveStateInPage(requestedQuality, includeSources) {
  let stream = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    stream = globalThis.hyPlayerConfig?.stream;
    if (stream && Array.isArray(stream.data)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!stream || !Array.isArray(stream.data)) {
    return { ok: false, error: "虎牙播放器尚未准备好，请刷新直播页后重试。" };
  }
  const groups = stream.data.filter((item) => Array.isArray(item?.gameStreamInfoList));
  const group = groups.find((item) => Number(item?.gameLiveInfo?.codecType) === 0) || null;
  const info = group?.gameLiveInfo || groups[0]?.gameLiveInfo || {};
  const roomKey = String(info.profileRoom || info.privateHost || location.pathname.split("/").filter(Boolean)[0] || "");
  const qualitySource = Array.isArray(stream.vMultiStreamInfo)
    ? stream.vMultiStreamInfo
    : (Array.isArray(group?.vMultiStreamInfo) ? group.vMultiStreamInfo : []);
  const qualities = qualitySource
    .map((item) => ({
      label: String(item?.sDisplayName || ""),
      bitrate: Number(item?.iBitRate) || 0,
      codecType: Number(item?.iCodecType) || 0
    }));
  const candidates = [];
  if (includeSources && group) {
    let roomPlayer = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      roomPlayer = globalThis.TT_ROOM_PLAYER;
      if (typeof roomPlayer?.initComplete === "function") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (typeof roomPlayer?.initComplete !== "function") {
      return { ok: false, error: "虎牙官方播放器尚未准备好，请刷新直播页后重试。" };
    }

    const officialPlayer = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value || null);
      };
      const timeout = setTimeout(() => finish(null), 5000);
      try {
        roomPlayer.initComplete((player) => {
          clearTimeout(timeout);
          finish(player);
        });
      } catch (_error) {
        clearTimeout(timeout);
        finish(null);
      }
    });
    const anticode = officialPlayer?.vcore?.h5player?.player?.anticode;
    let officialAntiCode = String(anticode?.getAnticode?.() || "").replace(/^\?/, "");
    if ((!officialAntiCode || anticode?.isInvalid?.()) && typeof anticode?.valid === "function") {
      const refreshed = await Promise.race([
        Promise.resolve().then(() => anticode.valid()).then(() => true).catch(() => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 5000))
      ]);
      if (refreshed) {
        officialAntiCode = String(anticode.getAnticode?.() || "").replace(/^\?/, "");
      }
    }
    const officialParams = new URLSearchParams(officialAntiCode);
    if (
      !officialAntiCode ||
      officialAntiCode.length > 2048 ||
      /[\r\n]/.test(officialAntiCode) ||
      !officialParams.get("wsSecret") ||
      !officialParams.get("wsTime")
    ) {
      return { ok: false, error: "虎牙官方播放器没有提供可用的录制授权，请刷新直播页后重试。" };
    }

    let initialStartPts = -1;
    try {
      const currentDts = Math.trunc(Number(officialPlayer?.getCurrentSeiDts?.()));
      if (Number.isSafeInteger(currentDts) && currentDts >= 0) {
        initialStartPts = Math.max(currentDts - 2000, 0);
      }
    } catch (_error) {
      initialStartPts = -1;
    }

    const requestedBitrate = Number(requestedQuality) === 10000 ? 0 : Number(requestedQuality) || 0;
    const seen = new Set();
    let flvCount = 0;
    let hlsCount = 0;
    for (const item of group.gameStreamInfoList) {
      if (candidates.length >= 6 || (flvCount >= 3 && hlsCount >= 3)) {
        break;
      }
      const suffix = String(item?.sFlvUrlSuffix || "").toLowerCase();
      const base = String(item?.sFlvUrl || "").replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
      const streamName = String(item?.sStreamName || "");
      let url = "";
      try {
        if (flvCount >= 3 || suffix !== "flv" || !base || !streamName) {
          throw new Error("no flv source");
        }
        const parsed = new URL(`${base}/${streamName}.${suffix}?${officialAntiCode}`);
        if (requestedBitrate > 0) {
          parsed.searchParams.set("ratio", String(requestedBitrate));
        } else {
          parsed.searchParams.delete("ratio");
        }
        parsed.searchParams.delete("codec");
        parsed.searchParams.set("timeStamp", String(Date.now()));
        if (initialStartPts >= 0) {
          parsed.searchParams.set("startPts", String(initialStartPts));
        } else {
          parsed.searchParams.delete("startPts");
        }
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === "https:" && (host === "flv.huya.com" || host.endsWith(".flv.huya.com"))) {
          url = parsed.href;
        }
      } catch (_error) {
        url = "";
      }
      if (url && !seen.has(url)) {
        seen.add(url);
        candidates.push({ url, protocol: "flv", kind: candidates.length ? "backup" : "primary", size: 0 });
        flvCount += 1;
      }

      const hlsSuffix = String(item?.sHlsUrlSuffix || "m3u8").replace(/^\./, "").toLowerCase();
      const hlsBase = String(item?.sHlsUrl || "").replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
      if (!hlsBase || !streamName || !/^m3u8$/i.test(hlsSuffix)) {
        continue;
      }
      let hlsUrl = "";
      try {
        // `sHlsAntiCode` in the initial player configuration is only an
        // authorization template and is commonly stale by the time recording
        // starts.  The official player has already refreshed the matching
        // AVC authorization for this browser session; the HLS and FLV entries
        // share that template, so use only the current player value here.
        const hlsAntiCode = officialAntiCode;
        if (!hlsAntiCode || hlsAntiCode.length > 2048 || /[\r\n]/.test(hlsAntiCode)) {
          throw new Error("invalid hls authorization");
        }
        const parsed = new URL(`${hlsBase}/${streamName}.${hlsSuffix}?${hlsAntiCode}`);
        if (requestedBitrate > 0) {
          parsed.searchParams.set("ratio", String(requestedBitrate));
        } else {
          parsed.searchParams.delete("ratio");
        }
        parsed.searchParams.delete("codec");
        const host = parsed.hostname.toLowerCase();
        if (parsed.protocol === "https:" && (
          host === "hls.huya.com" || host.endsWith(".hls.huya.com") ||
          host === "alhls.huya.com"
        )) {
          hlsUrl = parsed.href;
        }
      } catch (_error) {
        hlsUrl = "";
      }
      if (hlsUrl && !seen.has(hlsUrl)) {
        seen.add(hlsUrl);
        candidates.push({ url: hlsUrl, protocol: "hls", kind: "hls", size: 0 });
        hlsCount += 1;
      }
    }
  }
  return {
    ok: true,
    payload: {
      roomKey,
      roomId: Number(info.profileRoom) || null,
      title: String(info.roomName || info.introduction || info.nick || `huya_${roomKey}`).trim(),
      anchorName: String(info.nick || "").trim(),
      liveStatus: groups.some((item) => item.gameStreamInfoList.length) ? 1 : 0,
      qualities,
      candidates
    }
  };
}

function buildSiteLivePreparation({ site, roomKey, roomId, title, anchorName, quality, qualityLabel, candidates }) {
  const siteLabel = liveSiteDisplayName(site);
  const parts = [siteLabel, anchorName, title].map((item) => String(item || "").trim()).filter(Boolean);
  const uniqueParts = parts.filter((item, index) => parts.indexOf(item) === index);
  const outputTitle = uniqueParts.join("_") || `${site}_${roomKey}`;
  const baseName = safeFilename(`${outputTitle}_${timestampForFilename(new Date())}`);
  const normalizedCandidates = (Array.isArray(candidates) ? candidates : []).slice(0, 6);
  const segment = {
    url: normalizedCandidates[0]?.url || "",
    filename: `BiliDownload/${baseName}.flv`,
    size: 0,
    candidates: normalizedCandidates,
    context: {
      site,
      roomKey: String(roomKey || ""),
      roomId: normalizeId(roomId),
      title: outputTitle,
      source: "live",
      segmentIndex: 1,
      segmentCount: 1,
      role: "live",
      roleLabel: "直播",
      format: "flv",
      codec: "avc",
      quality: Number(quality) || 0,
      qualityLabel: String(qualityLabel || ""),
      downloadMethod: "live-recording"
    }
  };
  return {
    mode: "live",
    count: 1,
    format: "flv",
    live: {
      site,
      roomKey: String(roomKey || ""),
      roomId: normalizeId(roomId),
      title: outputTitle,
      liveStatus: 1,
      quality: Number(quality) || 0,
      qualityLabel: String(qualityLabel || ""),
      protocol: "http_stream",
      format: "flv",
      codec: "avc"
    },
    segments: [segment]
  };
}

function createDirectDownloadTaskId() {
  directDownloadTaskSequence += 1;
  return `direct-${Date.now().toString(36)}-${directDownloadTaskSequence.toString(36)}`;
}

function directTaskContext(context) {
  return {
    bvid: String(context?.bvid || ""),
    epId: normalizeId(context?.epId),
    cid: Number(context?.cid) || 0,
    quality: Number(context?.quality) || 0,
    title: String(context?.title || ""),
    source: String(context?.source || "video"),
    segmentIndex: Number(context?.segmentIndex) || 0,
    segmentCount: Number(context?.segmentCount) || 0,
    format: String(context?.format || ""),
    role: String(context?.role || ""),
    roleLabel: String(context?.roleLabel || ""),
    downloadMethod: "native-download"
  };
}

function queueDirectDownloadTask(task, operation) {
  const previous = task.operation || Promise.resolve();
  const next = previous.then(operation, operation);
  task.operation = next.catch(() => {});
  return next;
}

async function advanceDirectDownloadTask(task) {
  if (isDirectDownloadTaskTerminal(task) || task.state === "paused") {
    return;
  }

  const activeSegment = task.segments.find(isDirectDownloadSegmentActive);
  if (activeSegment) {
    await publishDirectDownloadTask(task);
    return;
  }

  const nextSegment = task.segments.find((segment) => segment.state === "queued");
  if (!nextSegment) {
    if (task.segments.every((segment) => segment.state === "complete")) {
      await finishDirectDownloadTask(task, "complete");
    }
    return;
  }

  await startDirectDownloadSegment(task, nextSegment);
}

async function startDirectDownloadSegment(task, segment) {
  if (await honorPendingDirectTaskControl(task, segment)) {
    return;
  }

  let candidate = segment.candidates[segment.candidateIndex];
  if (!candidate) {
    const refreshed = await refreshDirectDownloadTaskCandidates(task, segment);
    candidate = refreshed ? segment.candidates[segment.candidateIndex] : null;
    if (!candidate) {
      await failDirectDownloadSegment(task, segment, segment.error || "All media candidates failed.");
      return;
    }
  }

  const context = {
    ...segment.context,
    candidateIndex: segment.candidateIndex + 1,
    candidateCount: segment.candidates.length,
    candidateKind: candidate.kind
  };
  const diagnostic = createBaseDiagnostic({
    mediaUrl: candidate.url,
    filename: segment.filename,
    context
  });
  diagnostic.phase = "starting-download";
  segment.diagnostic = diagnostic;
  segment.candidateDiagnostics.push(diagnostic);
  task.state = "starting";
  task.error = "";
  relayProgress(directDownloadTaskProgress(task), task.tabId);
  const dnrPromise = testDnrRules(candidate.url).catch((error) => ({
    available: false,
    error: error.message,
    checks: []
  }));

  try {
    if (await honorPendingDirectTaskControl(task, segment)) {
      return;
    }
    const downloadId = await downloadFile({
      url: candidate.url,
      filename: segment.filename,
      conflictAction: "uniquify",
      saveAs: false
    });

    segment.downloadId = downloadId;
    segment.state = "in_progress";
    directDownloadIds.set(downloadId, {
      taskId: task.id,
      segmentIndex: segment.index
    });
    diagnostic.dnr = await dnrPromise;
    if (await honorPendingDirectTaskControl(task, segment, downloadId)) {
      return;
    }
    diagnostic.downloadId = downloadId;
    diagnostic.phase = "download-started";
    let initialItem = null;
    try {
      initialItem = await getDownloadItem(downloadId);
    } catch (_error) {
      // The native transfer is already owned by Chrome even when its initial item cannot be queried.
    }
    diagnostic.initialItem = pickDownloadItem(initialItem);
    task.state = "in_progress";
    task.updatedAt = new Date().toISOString();
    await setLastDiagnostic(diagnostic);
    await publishDirectDownloadTask(task);
    if (initialItem?.state === "complete" || initialItem?.state === "interrupted") {
      await applyDirectDownloadChange(task, segment, {
        id: downloadId,
        state: { current: initialItem.state },
        error: initialItem.error ? { current: initialItem.error } : null
      });
    }
  } catch (error) {
    diagnostic.phase = "download-error";
    diagnostic.error = error.message;
    segment.error = error.message;
    await setLastDiagnostic(diagnostic);
    segment.candidateIndex += 1;
    segment.downloadId = null;
    segment.state = "queued";
    if (segment.candidateIndex < segment.candidates.length) {
      await startDirectDownloadSegment(task, segment);
      return;
    }
    if (await refreshDirectDownloadTaskCandidates(task, segment)) {
      await startDirectDownloadSegment(task, segment);
      return;
    }
    await failDirectDownloadSegment(task, segment, error.message);
  }
}

async function refreshDirectDownloadTaskCandidates(task, targetSegment) {
  if (!task || !targetSegment || isDirectDownloadTaskTerminal(task)) {
    return false;
  }
  if (Number(targetSegment.candidateRefreshCount) >= DIRECT_DOWNLOAD_CANDIDATE_REFRESH_LIMIT) {
    targetSegment.error = "Media URL refresh limit was reached.";
    return false;
  }

  targetSegment.candidateRefreshCount = (Number(targetSegment.candidateRefreshCount) || 0) + 1;
  try {
    const prepared = await rebuildDirectDownloadTaskPayload(task, targetSegment);
    const preparedSegments = Array.isArray(prepared?.segments) ? prepared.segments : [];
    const preparedTarget = preparedSegments[targetSegment.index - 1];
    if (!preparedTarget || !readCandidates(preparedTarget).length) {
      throw new Error("Refreshed media response did not include the expected direct stream segment.");
    }

    for (const segment of task.segments) {
      if (segment.state !== "queued") {
        continue;
      }
      const refreshedSegment = preparedSegments[segment.index - 1];
      const candidates = readCandidates(refreshedSegment);
      if (!candidates.length) {
        continue;
      }
      segment.candidates = candidates;
      segment.candidateCount = candidates.length;
      segment.candidateIndex = 0;
      segment.size = Number(refreshedSegment.size) || segment.size;
      segment.totalBytes = Number(refreshedSegment.size) || segment.totalBytes || segment.size;
      segment.context = directTaskContext({
        ...segment.context,
        ...refreshedSegment.context
      });
      segment.error = "";
    }

    task.format = String(prepared.format || task.format || "");
    task.error = "";
    await publishDirectDownloadTask(task, { force: true });
    return Boolean(targetSegment.candidates[targetSegment.candidateIndex]);
  } catch (error) {
    const message = redactDiagnosticText(`Could not refresh media URLs: ${error?.message || "unknown error"}`);
    targetSegment.error = message;
    task.error = message;
    await publishDirectDownloadTask(task, { force: true });
    return false;
  }
}

async function rebuildDirectDownloadTaskPayload(task, segment) {
  const context = directTaskContext(segment?.context);
  const bvid = normalizeBvid(context.bvid);
  const epId = normalizeId(context.epId);
  const cid = Number(context.cid);
  const title = context.title || bvid || (epId ? `ep${epId}` : "");
  if ((!bvid && !epId) || !cid) {
    throw new Error("The saved direct download metadata is incomplete.");
  }

  if (task.mode === "audio") {
    return prepareAudioDownload({
      bvid,
      epId,
      cid,
      title,
      tabId: task.tabId
    });
  }

  const quality = Number(context.quality);
  if (!quality) {
    throw new Error("The saved direct download quality is incomplete.");
  }
  const source = epId ? "bangumi" : "video";
  const playUrl = await fetchMediaPlayUrl({
    bvid,
    epId,
    cid,
    quality,
    fnval: 0,
    tabId: task.tabId
  });
  if (epId) {
    assertPlayablePgc(playUrl);
  }
  if (!hasExactDirectQuality(playUrl, quality)) {
    throw unavailableQualityError(quality);
  }
  const directSegments = buildDirectSegmentPlans(playUrl);
  if (!directSegments.length) {
    throw new Error("Refreshed direct stream response did not include downloadable segments.");
  }
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

async function honorPendingDirectTaskControl(task, segment, downloadId = null) {
  const action = task.requestedAction || (task.state === "canceled" ? "cancel" : "");
  if (action === "cancel") {
    if (Number.isInteger(downloadId) && downloadId > 0) {
      await controlNativeDownload(downloadId, "cancel").catch(() => {});
    }
    await finishDirectDownloadTask(task, "canceled");
    return true;
  }
  if (action === "pause") {
    if (Number.isInteger(downloadId) && downloadId > 0) {
      await controlNativeDownload(downloadId, "pause").catch(() => {});
      task.state = "paused";
      await publishDirectDownloadTask(task);
      return true;
    }
    task.state = "paused";
    await publishDirectDownloadTask(task);
    return true;
  }
  return false;
}

async function handleDirectDownloadChange(delta) {
  const downloadId = Number(delta?.id);
  let mappedDownload = directDownloadIds.get(downloadId);
  if (!mappedDownload) {
    await restoreDirectDownloadTasks();
    mappedDownload = directDownloadIds.get(downloadId);
  }
  if (!mappedDownload) {
    return;
  }

  const task = directDownloadTasks.get(mappedDownload.taskId);
  const segment = task?.segments.find((item) => item.index === mappedDownload.segmentIndex);
  if (!task || !segment) {
    directDownloadIds.delete(downloadId);
    return;
  }

  await queueDirectDownloadTask(task, () => applyDirectDownloadChange(task, segment, delta));
}

async function applyDirectDownloadChange(task, segment, delta) {
  if (!isDirectDownloadSegmentActive(segment)) {
    return;
  }

  let item = null;
  try {
    item = await getDownloadItem(segment.downloadId);
  } catch (_error) {
    // A missing item is handled below from the event delta.
  }

  const observedState = item?.state || delta?.state?.current || "";
  const diagnostic = segment.diagnostic;
  if (diagnostic) {
    diagnostic.events.push({
      at: new Date().toISOString(),
      delta: pickDownloadDelta(delta),
      item: pickDownloadItem(item)
    });
    diagnostic.latestItem = pickDownloadItem(item);
  }

  segment.receivedBytes = Number(item?.bytesReceived) || segment.receivedBytes;
  segment.totalBytes = Number(item?.totalBytes) || segment.totalBytes || segment.size;
  task.updatedAt = new Date().toISOString();

  if (task.state === "canceled") {
    segment.state = "canceled";
    directDownloadIds.delete(Number(delta?.id));
    await finishDirectDownloadTask(task, "canceled");
    return;
  }

  if (observedState === "complete") {
    segment.state = "complete";
    segment.receivedBytes = Number(item?.bytesReceived || item?.fileSize) || segment.totalBytes || segment.size;
    segment.totalBytes = Number(item?.totalBytes || item?.fileSize) || segment.totalBytes || segment.receivedBytes;
    if (diagnostic) {
      diagnostic.phase = "complete";
      diagnostic.error = null;
      diagnostic.saved = {
        filename: item?.filename || segment.filename,
        mime: item?.mime || "",
        size: segment.receivedBytes,
        method: "native-download",
        mode: task.mode,
        savedToDisk: true
      };
      await setLastDiagnostic(diagnostic);
    }
    directDownloadIds.delete(Number(delta?.id));
    await advanceDirectDownloadTask(task);
    return;
  }

  const interrupted = observedState === "interrupted" || Boolean(delta?.error);
  if (interrupted) {
    const reason = item?.error || delta?.error?.current || "download interrupted";
    if (diagnostic) {
      diagnostic.phase = "interrupted";
      diagnostic.error = reason;
      await setLastDiagnostic(diagnostic);
    }
    directDownloadIds.delete(Number(delta?.id));
    segment.error = reason;
    segment.downloadId = null;
    if (isUserCanceledNativeDownload(reason, task)) {
      segment.state = "canceled";
      await finishDirectDownloadTask(task, "canceled");
      return;
    }
    if (isNativeDownloadShutdown(reason)) {
      await failDirectDownloadSegment(task, segment, reason);
      return;
    }
    segment.candidateIndex += 1;
    segment.state = "queued";
    if (segment.candidateIndex < segment.candidates.length) {
      await startDirectDownloadSegment(task, segment);
      return;
    }
    if (await refreshDirectDownloadTaskCandidates(task, segment)) {
      await startDirectDownloadSegment(task, segment);
      return;
    }
    await failDirectDownloadSegment(task, segment, reason);
    return;
  }

  if (diagnostic) {
    diagnostic.phase = observedState || "download-changed";
    await setLastDiagnostic(diagnostic);
  }
  syncDirectDownloadPausedState(task, segment, item, delta);
  await publishDirectDownloadTask(task);
}

function isUserCanceledNativeDownload(reason, task = null) {
  const normalized = String(reason || "").toUpperCase();
  return normalized.includes("USER_CANCELED") || task?.requestedAction === "cancel";
}

function isNativeDownloadShutdown(reason) {
  return String(reason || "").toUpperCase().includes("USER_SHUTDOWN");
}

function isDirectDownloadSegmentActive(segment) {
  return ["in_progress", "starting", "paused"].includes(String(segment?.state || ""));
}

function syncDirectDownloadPausedState(task, segment, item, delta) {
  const paused = item?.paused === true || delta?.paused?.current === true;
  const resumed = item?.paused === false || delta?.paused?.current === false;
  if (paused) {
    segment.state = "paused";
    task.state = "paused";
    return;
  }
  if (resumed) {
    segment.state = "in_progress";
    if (task.state === "paused" && task.requestedAction !== "pause") {
      task.state = "in_progress";
    }
  }
}

async function failDirectDownloadSegment(task, segment, reason) {
  segment.state = "interrupted";
  segment.error = reason;
  task.error = reason;
  const diagnostic = segment.diagnostic;
  if (diagnostic) {
    diagnostic.phase = "interrupted";
    diagnostic.error = reason;
    diagnostic.allCandidateDiagnostics = segment.candidateDiagnostics
      .filter((item) => item !== diagnostic)
      .map((item) => sanitizeForMessage(item));
    await setLastDiagnostic(diagnostic);
  }
  await finishDirectDownloadTask(task, "interrupted", reason);
}

async function finishDirectDownloadTask(task, state, error = "") {
  task.state = state;
  task.error = error || task.error || "";
  task.updatedAt = new Date().toISOString();
  for (const segment of task.segments) {
    if (state === "canceled" && (segment.state === "queued" || segment.state === "starting" ||
      segment.state === "in_progress" || segment.state === "paused")) {
      segment.state = "canceled";
    }
    if (isDirectDownloadTaskTerminal(task)) {
      segment.candidates = [];
    }
    if (segment.downloadId) {
      directDownloadIds.delete(segment.downloadId);
    }
  }
  pruneDirectDownloadTasks(task.id);
  await publishDirectDownloadTask(task, { force: true });
}

async function controlDirectDownloadTask(payload) {
  const taskId = String(payload?.taskId || "");
  const action = String(payload?.action || "");
  await restoreDirectDownloadTasks();
  const task = directDownloadTasks.get(taskId);
  if (!task) {
    const stored = await getDirectDownloadTask(taskId);
    if (stored) {
      throw new Error("This direct download task can no longer be controlled. Please use the browser download shelf.");
    }
    throw new Error("Direct download task was not found.");
  }
  if (!["pause", "resume", "cancel"].includes(action)) {
    throw new Error("Unknown direct download action.");
  }
  task.requestedAction = action;

  return queueDirectDownloadTask(task, async () => {
    if (isDirectDownloadTaskTerminal(task)) {
      return snapshotDirectDownloadTask(task);
    }

    const activeIds = task.segments
      .filter((segment) => isDirectDownloadSegmentActive(segment) && Number.isInteger(segment.downloadId))
      .map((segment) => segment.downloadId);

    if (action === "pause") {
      await Promise.all(activeIds.map((id) => controlNativeDownload(id, "pause")));
      task.state = "paused";
    } else if (action === "resume") {
      await Promise.all(activeIds.map((id) => controlNativeDownload(id, "resume")));
      for (const segment of task.segments) {
        if (segment.state === "paused") {
          segment.state = "in_progress";
        }
      }
      task.state = "in_progress";
      await advanceDirectDownloadTask(task);
    } else {
      try {
        await Promise.all(activeIds.map((id) => controlNativeDownload(id, "cancel")));
      } catch (error) {
        if (task.requestedAction === "cancel") {
          task.requestedAction = "";
        }
        await publishDirectDownloadTask(task, { force: true });
        throw error;
      }
      if (!activeIds.length) {
        await finishDirectDownloadTask(task, "canceled");
        return snapshotDirectDownloadTask(task);
      }
      // Chrome owns the final transition.  Do not report a terminal cancel
      // until its download record actually changes, otherwise a failed or
      // completed native transfer could be mislabeled as canceled.
      task.state = "canceling";
      task.updatedAt = new Date().toISOString();
      await publishDirectDownloadTask(task, { force: true });
      return snapshotDirectDownloadTask(task);
    }

    if (task.requestedAction === action) {
      task.requestedAction = "";
    }

    task.updatedAt = new Date().toISOString();
    await publishDirectDownloadTask(task);
    return snapshotDirectDownloadTask(task);
  });
}

function controlNativeDownload(id, action) {
  return new Promise((resolve, reject) => {
    const method = chrome.downloads?.[action];
    if (typeof method !== "function") {
      reject(new Error(`chrome.downloads.${action} is unavailable.`));
      return;
    }

    let settled = false;
    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    try {
      const result = method.call(chrome.downloads, id, () => {
        const error = chrome.runtime?.lastError;
        finish(error ? new Error(error.message) : null);
      });
      result?.then?.(() => finish()).catch((error) => finish(error));
    } catch (error) {
      finish(error);
    }
  });
}

function isDirectDownloadTaskTerminal(task) {
  return ["complete", "interrupted", "canceled"].includes(task?.state || task?.taskState || "");
}

async function getDirectDownloadTask(taskId) {
  const normalizedTaskId = String(taskId || "");
  await restoreDirectDownloadTasks();
  const task = directDownloadTasks.get(normalizedTaskId);
  if (task) {
    return snapshotDirectDownloadTask(task);
  }

  try {
    const stored = await chrome.storage?.local?.get(DIRECT_DOWNLOAD_TASK_STORAGE_KEY);
    const tasks = Array.isArray(stored?.[DIRECT_DOWNLOAD_TASK_STORAGE_KEY])
      ? stored[DIRECT_DOWNLOAD_TASK_STORAGE_KEY]
      : [];
    const snapshot = tasks.find((item) => item?.taskId === normalizedTaskId) || null;
    return snapshot ? sanitizeForMessage(snapshot) : null;
  } catch (_error) {
    return null;
  }
}

async function listDirectDownloadTasks(payload = {}) {
  await restoreDirectDownloadTasks();
  const tabId = normalizeTabId(payload?.tabId);
  const activeOnly = Boolean(payload?.activeOnly);
  return Array.from(directDownloadTasks.values())
    .filter((task) => !tabId || task.tabId === tabId)
    .filter((task) => !activeOnly || !isDirectDownloadTaskTerminal(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .map((task) => snapshotDirectDownloadTask(task));
}

async function restoreDirectDownloadTasks() {
  if (directDownloadTasksRestored) {
    return;
  }
  if (directDownloadTasksRestorePromise) {
    return directDownloadTasksRestorePromise;
  }

  directDownloadTasksRestorePromise = (async () => {
    try {
      const stored = await chrome.storage?.local?.get(DIRECT_DOWNLOAD_TASK_STORAGE_KEY);
      const snapshots = Array.isArray(stored?.[DIRECT_DOWNLOAD_TASK_STORAGE_KEY])
        ? stored[DIRECT_DOWNLOAD_TASK_STORAGE_KEY]
        : [];
      let restoredChanged = false;
      const restoredTasks = [];
      for (const snapshot of snapshots) {
        const taskId = String(snapshot?.taskId || "");
        if (!taskId || directDownloadTasks.has(taskId)) {
          continue;
        }
        const task = restoreDirectDownloadTask(snapshot);
        // Older snapshots may contain raw error text. Re-persist any snapshot
        // changed by the same privacy boundary used for new task snapshots.
        const safeSnapshot = sanitizeForMessage(snapshot);
        restoredChanged = restoredChanged || task.restoreChanged || JSON.stringify(snapshot) !== JSON.stringify(safeSnapshot);
        directDownloadTasks.set(task.id, task);
        restoredTasks.push(task);
        for (const segment of task.segments) {
          if (Number.isInteger(segment.downloadId) && segment.downloadId > 0 &&
            isDirectDownloadSegmentActive(segment)) {
            directDownloadIds.set(segment.downloadId, {
              taskId: task.id,
              segmentIndex: segment.index
            });
          }
        }
      }
      pruneDirectDownloadTasks();
      await reconcileRestoredDirectDownloadTasks(restoredTasks);
      await resumeRestoredDirectDownloadTasks(restoredTasks);
      if (restoredChanged) {
        await persistDirectDownloadTasks({ force: true });
      }
    } catch (_error) {
      // The browser still owns native downloads if a service-worker snapshot cannot be restored.
    } finally {
      directDownloadTasksRestored = true;
      directDownloadTasksRestorePromise = null;
    }
  })();

  return directDownloadTasksRestorePromise;
}

async function reconcileRestoredDirectDownloadTasks(tasks) {
  const operations = [];
  for (const task of tasks) {
    if (isDirectDownloadTaskTerminal(task)) {
      continue;
    }
    for (const segment of task.segments) {
      if (!isDirectDownloadSegmentActive(segment) || !Number.isInteger(segment.downloadId) || segment.downloadId <= 0) {
        continue;
      }
      operations.push(queueDirectDownloadTask(task, () => reconcileRestoredDirectDownloadSegment(task, segment)));
    }
  }
  await Promise.all(operations);
}

async function reconcileRestoredDirectDownloadSegment(task, segment) {
  const downloadId = segment.downloadId;
  let item = null;
  try {
    item = await getDownloadItem(downloadId);
  } catch (_error) {
    // Keep the stored state when Chrome's downloads database is temporarily unavailable.
    return;
  }

  if (!item) {
    const message = "Native download record was unavailable during service worker recovery.";
    segment.state = "interrupted";
    segment.error = message;
    segment.downloadId = null;
    directDownloadIds.delete(downloadId);
    await finishDirectDownloadTask(task, "interrupted", message);
    return;
  }

  await applyDirectDownloadChange(task, segment, {
    id: downloadId,
    state: { current: item.state || "" },
    error: item.error ? { current: item.error } : null,
    paused: typeof item.paused === "boolean" ? { current: item.paused } : null
  });
}

async function resumeRestoredDirectDownloadTasks(tasks) {
  const operations = [];
  for (const task of tasks) {
    if (isDirectDownloadTaskTerminal(task) || task.state === "paused") {
      continue;
    }
    if (task.segments.some(isDirectDownloadSegmentActive)) {
      continue;
    }
    operations.push(queueDirectDownloadTask(task, () => advanceDirectDownloadTask(task)));
  }
  await Promise.all(operations);
}

function restoreDirectDownloadTask(snapshot) {
  const now = new Date().toISOString();
  let restoreChanged = false;
  const segments = Array.isArray(snapshot?.segments) ? snapshot.segments.map((source, index) => {
    const downloadId = Number(source?.downloadId) || null;
    let state = String(source?.state || "queued");
    // A service worker can be suspended after we persisted `starting` but
    // before Chrome returns a download id.  There is no browser-owned task to
    // reconcile in that case, so put the segment back in the safe reprepare
    // queue instead of leaving a permanently active-looking task.
    if (isDirectDownloadSegmentActive({ state }) && !(Number.isInteger(downloadId) && downloadId > 0)) {
      state = "queued";
      restoreChanged = true;
    }
    return {
    index: Number(source?.index) || index + 1,
    filename: String(source?.filename || ""),
    size: Number(source?.size) || 0,
    context: directTaskContext(source?.context),
    candidates: [],
    candidateCount: Number(source?.candidateCount) || 0,
    candidateIndex: Math.max((Number(source?.candidateIndex) || 1) - 1, 0),
    candidateRefreshCount: Math.max(Number(source?.candidateRefreshCount) || 0, 0),
    downloadId: Number.isInteger(downloadId) && downloadId > 0 ? downloadId : null,
    state,
    receivedBytes: Number(source?.receivedBytes) || 0,
    totalBytes: Number(source?.totalBytes) || Number(source?.size) || 0,
    error: redactDiagnosticText(String(source?.error || "")),
    diagnostic: null,
    candidateDiagnostics: []
    };
  }) : [];

  let taskState = String(snapshot?.state || "queued");
  const hasReconciledNativeSegment = segments.some((segment) => (
    isDirectDownloadSegmentActive(segment) && Number.isInteger(segment.downloadId) && segment.downloadId > 0
  ));
  if (restoreChanged && !hasReconciledNativeSegment && ["starting", "in_progress"].includes(taskState)) {
    taskState = "queued";
  }

  const task = {
    id: String(snapshot?.taskId || ""),
    tabId: normalizeTabId(snapshot?.tabId),
    mode: String(snapshot?.mode || "durl"),
    format: String(snapshot?.format || ""),
    createdAt: String(snapshot?.createdAt || now),
    updatedAt: String(snapshot?.updatedAt || now),
    state: taskState,
    error: redactDiagnosticText(String(snapshot?.error || "")),
    requestedAction: "",
    segments,
    operation: Promise.resolve(),
    restoreChanged
  };
  return task;
}

function pruneDirectDownloadTasks(preserveTaskId = "") {
  let terminalCount = Array.from(directDownloadTasks.values())
    .filter(isDirectDownloadTaskTerminal)
    .length;
  const removable = Array.from(directDownloadTasks.values())
    .filter((task) => task.id !== preserveTaskId && isDirectDownloadTaskTerminal(task))
    .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
  while (terminalCount > DIRECT_DOWNLOAD_TASK_HISTORY_LIMIT && removable.length) {
    const task = removable.shift();
    directDownloadTasks.delete(task.id);
    directDownloadTaskPersistMetadata.delete(task.id);
    terminalCount -= 1;
  }
}

async function publishDirectDownloadTask(task, options = {}) {
  task.updatedAt = new Date().toISOString();
  await persistDirectDownloadTasks({
    force: Boolean(options.force) || isDirectDownloadTaskTerminal(task)
  });
  relayProgress(directDownloadTaskProgress(task), task.tabId);
}

function directDownloadTaskSnapshotsForStorage() {
  const tasks = Array.from(directDownloadTasks.values());
  const active = tasks
    .filter((task) => !isDirectDownloadTaskTerminal(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const terminal = tasks
    .filter(isDirectDownloadTaskTerminal)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, DIRECT_DOWNLOAD_TASK_HISTORY_LIMIT);
  return [...active, ...terminal]
    .map((task) => snapshotDirectDownloadTask(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function directDownloadTaskPersistenceFingerprint(snapshot) {
  return JSON.stringify({
    state: snapshot.state,
    error: snapshot.error,
    completedCount: snapshot.completedCount,
    downloadIds: snapshot.downloadIds,
    segments: (snapshot.segments || []).map((segment) => ({
      index: segment.index,
      state: segment.state,
      downloadId: segment.downloadId,
      candidateIndex: segment.candidateIndex,
      candidateCount: segment.candidateCount,
      candidateRefreshCount: segment.candidateRefreshCount,
      error: segment.error
    }))
  });
}

function shouldPersistDirectDownloadTasks(snapshots, force) {
  if (force || !directDownloadTasksLastPersistAt) {
    return true;
  }
  const now = Date.now();
  for (const snapshot of snapshots) {
    const previous = directDownloadTaskPersistMetadata.get(snapshot.taskId);
    const fingerprint = directDownloadTaskPersistenceFingerprint(snapshot);
    if (!previous || previous.fingerprint !== fingerprint) {
      return true;
    }
    const receivedDelta = Math.abs((Number(snapshot.receivedBytes) || 0) - previous.receivedBytes);
    const totalDelta = Math.abs((Number(snapshot.totalBytes) || 0) - previous.totalBytes);
    if (receivedDelta >= DIRECT_DOWNLOAD_SNAPSHOT_MIN_BYTES_DELTA ||
      totalDelta >= DIRECT_DOWNLOAD_SNAPSHOT_MIN_BYTES_DELTA ||
      now - previous.persistedAt >= DIRECT_DOWNLOAD_SNAPSHOT_MIN_INTERVAL_MS) {
      return true;
    }
  }
  return false;
}

function scheduleDirectDownloadTasksPersistence() {
  if (directDownloadTasksPersistTimer !== null || typeof setTimeout !== "function") {
    return;
  }
  const elapsed = Math.max(Date.now() - directDownloadTasksLastPersistAt, 0);
  const delay = Math.max(DIRECT_DOWNLOAD_SNAPSHOT_MIN_INTERVAL_MS - elapsed, 0);
  directDownloadTasksPersistTimer = setTimeout(() => {
    directDownloadTasksPersistTimer = null;
    persistDirectDownloadTasks().catch(() => {});
  }, delay);
}

async function persistDirectDownloadTasks(options = {}) {
  const force = Boolean(options.force);
  const snapshots = directDownloadTaskSnapshotsForStorage();
  if (!shouldPersistDirectDownloadTasks(snapshots, force)) {
    scheduleDirectDownloadTasksPersistence();
    return false;
  }
  if (directDownloadTasksPersistTimer !== null && typeof clearTimeout === "function") {
    clearTimeout(directDownloadTasksPersistTimer);
    directDownloadTasksPersistTimer = null;
  }

  const write = async () => {
    const currentSnapshots = directDownloadTaskSnapshotsForStorage();
    try {
      await chrome.storage?.local?.set({ [DIRECT_DOWNLOAD_TASK_STORAGE_KEY]: currentSnapshots });
      const persistedAt = Date.now();
      directDownloadTasksLastPersistAt = persistedAt;
      directDownloadTaskPersistMetadata.clear();
      for (const snapshot of currentSnapshots) {
        directDownloadTaskPersistMetadata.set(snapshot.taskId, {
          fingerprint: directDownloadTaskPersistenceFingerprint(snapshot),
          receivedBytes: Number(snapshot.receivedBytes) || 0,
          totalBytes: Number(snapshot.totalBytes) || 0,
          persistedAt
        });
      }
      return true;
    } catch (_error) {
      // Native transfers continue even if the task snapshot cannot be persisted.
      return false;
    }
  };
  const operation = directDownloadTasksPersistOperation.then(write, write);
  directDownloadTasksPersistOperation = operation.catch(() => {});
  return operation;
}

function snapshotDirectDownloadTask(task) {
  const progress = directDownloadTaskProgress(task);
  return sanitizeForMessage({
    taskId: task.id || task.taskId,
    state: task.state || task.taskState || "",
    mode: String(task.mode || "durl"),
    format: String(task.format || ""),
    createdAt: task.createdAt || "",
    updatedAt: task.updatedAt || "",
    tabId: Number(task.tabId) || 0,
    count: task.segments?.length || Number(task.count) || 0,
    completedCount: (task.segments || []).filter((segment) => segment.state === "complete").length,
    error: redactDiagnosticText(String(task.error || "")),
    downloadIds: progress.downloadIds,
    receivedBytes: progress.receivedBytes,
    totalBytes: progress.totalBytes,
    segments: (task.segments || []).map((segment) => ({
      index: Number(segment.index) || 0,
      downloadId: Number(segment.downloadId) || 0,
      state: String(segment.state || ""),
      filename: summarizeDiagnosticFilename(segment.filename || ""),
      size: Number(segment.size) || 0,
      receivedBytes: Number(segment.receivedBytes) || 0,
      totalBytes: Number(segment.totalBytes) || 0,
      candidateIndex: Number(segment.candidateIndex) + 1 || 0,
      candidateCount: Number(segment.candidateCount) ||
        (Array.isArray(segment.candidates) ? segment.candidates.length : 0),
      candidateRefreshCount: Number(segment.candidateRefreshCount) || 0,
      error: redactDiagnosticText(String(segment.error || "")),
      context: directTaskContext(segment.context)
    }))
  });
}

function directDownloadTaskProgress(task) {
  const segments = Array.isArray(task?.segments) ? task.segments : [];
  const activeSegment = segments.find(isDirectDownloadSegmentActive) ||
    segments.find((segment) => segment.state === "queued") ||
    segments.at(-1) || null;
  const totalBytes = segments.reduce((sum, segment) => sum + (Number(segment.totalBytes) || Number(segment.size) || 0), 0);
  const receivedBytes = segments.reduce((sum, segment) => {
    const received = Number(segment.receivedBytes) || 0;
    const total = Number(segment.totalBytes) || Number(segment.size) || 0;
    return sum + (segment.state === "complete" ? Math.max(received, total) : received);
  }, 0);

  return {
    receivedBytes,
    totalBytes,
    segmentIndex: Number(activeSegment?.index) || 0,
    segmentCount: segments.length,
    candidateIndex: Number(activeSegment?.candidateIndex) + 1 || 0,
    candidateCount: Number(activeSegment?.candidateCount) ||
      (Array.isArray(activeSegment?.candidates) ? activeSegment.candidates.length : 0),
    done: isDirectDownloadTaskTerminal(task),
    taskId: task?.id || task?.taskId || "",
    taskState: task?.state || task?.taskState || "",
    nativeDownload: true,
    downloadIds: segments.map((segment) => Number(segment.downloadId)).filter((id) => Number.isInteger(id) && id > 0),
    error: redactDiagnosticText(String(task?.error || ""))
  };
}

// The companion deliberately gets its own task store and port map. Browser
// download tasks can be reconciled from Chrome's downloads database after a
// service-worker restart; a Native Messaging port cannot. Keeping these paths
// separate makes that difference explicit and, critically, prevents signed CDN
// sources from becoming accidental recovery data in extension storage.
async function pingCompanionNativeHost() {
  if (!chrome.runtime?.connectNative) {
    throw companionUnavailableError();
  }

  let port;
  try {
    port = chrome.runtime.connectNative(COMPANION_NATIVE_HOST_NAME);
  } catch (_error) {
    throw companionUnavailableError();
  }
  if (!port?.onMessage?.addListener || !port?.onDisconnect?.addListener || !port?.postMessage) {
    try {
      port?.disconnect?.();
    } catch (_error) {
      // Nothing else can be recovered from an invalid Native Messaging port.
    }
    throw companionUnavailableError();
  }

  const requestId = createCompanionRequestId("ping");
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = typeof setTimeout === "function"
      ? setTimeout(() => finish(companionUnavailableError()), 5000)
      : null;

    const cleanup = () => {
      if (timeout !== null && typeof clearTimeout === "function") {
        clearTimeout(timeout);
      }
      try {
        port.onMessage?.removeListener?.(onMessage);
        port.onDisconnect?.removeListener?.(onDisconnect);
      } catch (_error) {
        // Listener cleanup is best-effort across Chromium versions.
      }
      try {
        port.disconnect?.();
      } catch (_error) {
        // Disconnecting an already-closed temporary ping port is harmless.
      }
    };
    const finish = (error = null, payload = null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(payload);
      }
    };
    const onMessage = (event) => {
      if (event?.type !== "pong" || String(event?.requestId || "") !== requestId) {
        return;
      }
      if (Number(event?.protocolVersion) !== COMPANION_PROTOCOL_VERSION ||
        String(event?.nativeHost || "") !== COMPANION_NATIVE_HOST_NAME) {
        finish(new Error("The local streaming companion uses an incompatible protocol."));
        return;
      }
      finish(null, {
        nativeHost: COMPANION_NATIVE_HOST_NAME,
        protocolVersion: COMPANION_PROTOCOL_VERSION
      });
    };
    const onDisconnect = () => finish(companionUnavailableError());

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    try {
      port.postMessage({
        version: COMPANION_PROTOCOL_VERSION,
        type: "ping",
        requestId
      });
    } catch (_error) {
      finish(companionUnavailableError());
    }
  });
}

async function startCompanionDownload(payload = {}) {
  await restoreCompanionDownloadTasks();
  const prepared = payload?.prepared;
  if (!prepared || typeof prepared !== "object") {
    throw new Error("A current DASH or live stream preparation is required for the local companion.");
  }

  const descriptor = describeCompanionPreparedDownload(prepared, payload);
  const task = createCompanionDownloadTask(descriptor, payload);
  companionDownloadTasks.set(task.id, task);
  pruneCompanionDownloadTasks(task.id);
  await persistCompanionDownloadTasks({ force: true });

  try {
    await startCompanionDownloadTask(task, descriptor);
  } catch (error) {
    // A missing host or an immediately rejected start is recoverable: the task
    // keeps only its safe API metadata and can obtain fresh signed URLs later.
    if (!isCompanionDownloadTaskTerminal(task)) {
      await interruptCompanionDownloadTask(task, companionUnavailableMessage(), { force: true });
    }
    throw error;
  }
  return snapshotCompanionDownloadTask(task);
}

function createCompanionDownloadTask(descriptor, payload = {}) {
  const now = new Date().toISOString();
  return {
    id: createCompanionDownloadTaskId(),
    tabId: normalizeTabId(payload?.tabId),
    kind: descriptor.kind,
    title: descriptor.metadata.title,
    outputName: descriptor.outputName,
    format: descriptor.metadata.format,
    metadata: descriptor.metadata,
    maxBytes: normalizeCompanionMaxBytes(payload?.maxBytes),
    maxDurationSeconds: descriptor.kind === "live"
      ? normalizeCompanionDurationSeconds(payload?.maxDurationSeconds)
      : 0,
    segmentDurationSeconds: descriptor.kind === "live"
      ? normalizeCompanionSegmentSeconds(payload?.segmentDurationSeconds)
      : 0,
    state: "starting",
    recoverable: false,
    error: "",
    phase: "",
    receivedBytes: 0,
    totalBytes: Number(descriptor.totalBytes) || 0,
    videoReceivedBytes: 0,
    videoTotalBytes: Number(descriptor.videoExpectedBytes) || 0,
    audioReceivedBytes: 0,
    audioTotalBytes: Number(descriptor.audioExpectedBytes) || 0,
    segmentIndex: 0,
    segmentCount: 0,
    reconnectAttempt: 0,
    createdAt: now,
    updatedAt: now,
    operation: Promise.resolve(),
    refreshInFlight: false
  };
}

function createCompanionDownloadTaskId() {
  companionDownloadTaskSequence += 1;
  return `companion-${Date.now().toString(36)}-${companionDownloadTaskSequence.toString(36)}`;
}

function createCompanionRequestId(prefix = "request") {
  companionDownloadTaskSequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${companionDownloadTaskSequence.toString(36)}`;
}

function describeCompanionPreparedDownload(prepared, payload = {}) {
  if (prepared?.mode === "dash") {
    return describeCompanionDashPreparation(prepared, payload);
  }
  if (prepared?.mode === "live") {
    return describeCompanionLivePreparation(prepared, payload);
  }
  throw new Error("The local companion currently supports DASH video/audio and live FLV recording only.");
}

function describeCompanionDashPreparation(prepared) {
  const segments = Array.isArray(prepared?.segments) ? prepared.segments : [];
  const video = segments.find((segment) => String(segment?.context?.role || "") === "video");
  const audio = segments.find((segment) => String(segment?.context?.role || "") === "audio");
  if (!video || !audio) {
    throw new Error("The DASH preparation did not include both video and audio streams.");
  }

  const context = video.context || {};
  const bvid = normalizeBvid(context.bvid);
  const epId = normalizeId(context.epId);
  const cid = Number(context.cid) || 0;
  const quality = Number(context.quality) || 0;
  if ((!bvid && !epId) || !cid || !quality) {
    throw new Error("The DASH preparation is missing the video metadata required to refresh sources.");
  }

  const title = normalizeCompanionTitle(context.title, bvid || `ep${epId}`);
  const videoSources = readCompanionSourceUrls(video);
  const audioSources = readCompanionSourceUrls(audio);
  const videoExpectedBytes = companionNonnegativeInteger(video.size);
  const audioExpectedBytes = companionNonnegativeInteger(audio.size);
  return {
    kind: "dash",
    metadata: {
      bvid,
      epId,
      cid,
      quality,
      title,
      source: epId ? "bangumi" : "video",
      format: "dash"
    },
    outputName: companionOutputName(title, "dash", quality),
    videoSources,
    audioSources,
    videoExpectedBytes,
    audioExpectedBytes,
    totalBytes: videoExpectedBytes + audioExpectedBytes
  };
}

function describeCompanionLivePreparation(prepared) {
  const segment = Array.isArray(prepared?.segments) ? prepared.segments[0] : null;
  const live = prepared?.live || {};
  const context = segment?.context || {};
  const site = normalizeLiveSite(live.site || context.site);
  const roomKey = normalizeLiveRoomKey(live.roomKey || context.roomKey || live.roomId || context.roomId);
  const roomId = normalizeId(live.roomId || context.roomId);
  const quality = Number(live.quality || context.quality) || 0;
  if (!roomKey || !quality) {
    throw new Error("The live preparation is missing the room or quality required to refresh sources.");
  }

  const title = normalizeCompanionTitle(live.title || context.title, `live_${roomKey}`);
  const siteOutputName = String(segment?.filename || "").split(/[\\/]/).at(-1) || "";
  const hlsSources = site === "huya" ? readCompanionSourceUrls(segment, site, "hls") : [];
  const format = hlsSources.length ? "hls" : "flv";
  const liveSources = hlsSources.length ? hlsSources : readCompanionSourceUrls(segment, site, "flv");
  return {
    kind: "live",
    metadata: {
      site,
      roomKey,
      roomId,
      shortId: normalizeId(live.shortId || context.shortId),
      quality,
      title,
      source: "live",
      format
    },
    outputName: site === "bilibili"
      ? companionOutputName(title, "live", quality)
      : format === "hls"
        ? companionOutputName(title, "live-hls", quality)
        : normalizeCompanionOutputName(siteOutputName, "live", title, quality),
    liveSources,
    liveFormat: format,
    totalBytes: 0,
    videoExpectedBytes: 0,
    audioExpectedBytes: 0
  };
}

function readCompanionSourceUrls(segment, site = "bilibili", protocol = "") {
  const urls = [];
  const seen = new Set();
  for (const candidate of readCandidates(segment)) {
    const url = String(candidate?.url || "");
    const candidateProtocol = String(candidate?.protocol || (isHlsMediaUrl(url) ? "hls" : "flv")).toLowerCase();
    if (protocol && candidateProtocol !== protocol) {
      continue;
    }
    if (!isAllowedCompanionMediaUrl(url, site) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }
  if (!urls.length) {
    if (protocol === "hls") {
      return [];
    }
    throw new Error("The prepared media source is not an allowed HTTPS media URL for this site.");
  }
  return urls;
}

function isHlsMediaUrl(value) {
  try {
    return /\.m3u8(?:$|[?#])/i.test(new URL(String(value || "")).pathname);
  } catch (_error) {
    return false;
  }
}

function isAllowedCompanionMediaUrl(value, site = "bilibili") {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || url.username || url.password) {
      return false;
    }
    const host = url.hostname.toLowerCase();
    const suffixes = {
      bilibili: ["bilivideo.com", "bilivideo.cn", "hdslb.com", "edge.mountaintoys.cn"],
      douyu: ["douyucdn.cn"],
      huya: ["flv.huya.com", "mobgslb.tbcache.com"]
    }[normalizeLiveSite(site)];
    const extended = normalizeLiveSite(site) === "huya"
      ? [...suffixes, "hls.huya.com", "alhls.huya.com"]
      : suffixes;
    return extended.some((suffix) => (
      host === suffix || host.endsWith(`.${suffix}`)
    ));
  } catch (_error) {
    return false;
  }
}

function normalizeCompanionTitle(value, fallback = "bili_download") {
  const source = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  if (!source || looksLikeDiagnosticUrl(source) || isLocalDiagnosticPath(source)) {
    return String(fallback || "bili_download").slice(0, 180);
  }
  return redactCompanionText(source).slice(0, 180) || String(fallback || "bili_download").slice(0, 180);
}

function companionOutputName(title, kind, quality = 0) {
  const labeled = kind === "dash" && quality ? `${title}_${quality}` : title;
  const stem = safeFilename(labeled).replace(/\.(?:mp4|flv|m4s)$/i, "") || "bili_download";
  return `${stem.slice(0, 110)}.${kind === "dash" ? "mp4" : kind === "live-hls" ? "mkv" : "flv"}`;
}

function buildCompanionStartMessage(task, descriptor) {
  const requestId = createCompanionRequestId("start");
  const base = {
    outputName: normalizeCompanionOutputName(task.outputName, task.kind, task.title, task.metadata?.quality),
    referer: task.kind === "live" ? liveSiteReferer(task.metadata?.site) : "https://www.bilibili.com/",
    maxBytes: normalizeCompanionMaxBytes(task.maxBytes)
  };
  let payload;
  if (task.kind === "dash") {
    payload = {
      ...base,
      video: companionStreamInput(descriptor.videoSources, descriptor.videoExpectedBytes),
      audio: companionStreamInput(descriptor.audioSources, descriptor.audioExpectedBytes)
    };
  } else {
    payload = {
      ...base,
      sources: descriptor.liveSources,
      format: descriptor.liveFormat || "flv",
      maxDurationSeconds: normalizeCompanionDurationSeconds(task.maxDurationSeconds),
      segmentDurationSeconds: normalizeCompanionSegmentSeconds(task.segmentDurationSeconds)
    };
  }
  return {
    requestId,
    message: {
      version: COMPANION_PROTOCOL_VERSION,
      type: task.kind === "dash" ? "start_dash" : "start_live",
      requestId,
      taskId: task.id,
      payload
    }
  };
}

function buildCompanionRefreshMessage(task, descriptor) {
  const requestId = createCompanionRequestId("refresh");
  let payload;
  if (task.kind === "dash") {
    payload = {
      referer: "https://www.bilibili.com/",
      video: companionStreamInput(descriptor.videoSources, descriptor.videoExpectedBytes),
      audio: companionStreamInput(descriptor.audioSources, descriptor.audioExpectedBytes)
    };
  } else {
    payload = {
      referer: liveSiteReferer(task.metadata?.site),
      sources: descriptor.liveSources,
      format: descriptor.liveFormat || task.metadata?.format || "flv"
    };
  }
  return {
    requestId,
    message: {
      version: COMPANION_PROTOCOL_VERSION,
      type: task.kind === "dash" ? "refresh_dash_sources" : "refresh_live_sources",
      requestId,
      taskId: task.id,
      payload
    }
  };
}

function companionStreamInput(sources, expectedBytes) {
  const payload = { sources: Array.isArray(sources) ? sources.slice() : [] };
  const size = companionNonnegativeInteger(expectedBytes);
  if (size > 0) {
    payload.expectedBytes = size;
  }
  return payload;
}

async function startCompanionDownloadTask(task, descriptor) {
  const { requestId, message } = buildCompanionStartMessage(task, descriptor);
  await connectCompanionDownloadPort(task, message, requestId);
}

async function connectCompanionDownloadPort(task, message, startRequestId) {
  if (!chrome.runtime?.connectNative) {
    throw companionUnavailableError();
  }
  const existing = companionDownloadPorts.get(task.id);
  if (existing?.port) {
    throw new Error("The local companion task already has an active connection.");
  }

  let port = companionSharedDownloadPort;
  if (!port) {
    try {
      port = chrome.runtime.connectNative(COMPANION_NATIVE_HOST_NAME);
    } catch (_error) {
      throw companionUnavailableError();
    }
  }
  if (!port?.onMessage?.addListener || !port?.onDisconnect?.addListener || !port?.postMessage) {
    try {
      port?.disconnect?.();
    } catch (_error) {
      // There is no valid port to clean up further.
    }
    throw companionUnavailableError();
  }
  companionSharedDownloadPort = port;

  return new Promise((resolve, reject) => {
    const runtime = {
      port,
      pendingRequestIds: new Set([String(startRequestId)]),
      startRequestId: String(startRequestId),
      startSettled: false,
      startTimeout: null,
      resolveStart: resolve,
      rejectStart: reject
    };
    companionDownloadPorts.set(task.id, runtime);

    const settleStart = (error = null) => {
      if (runtime.startSettled) {
        return;
      }
      runtime.startSettled = true;
      if (runtime.startTimeout !== null && typeof clearTimeout === "function") {
        clearTimeout(runtime.startTimeout);
        runtime.startTimeout = null;
      }
      if (error) {
        reject(error);
      } else {
        resolve(snapshotCompanionDownloadTask(task));
      }
    };
    runtime.settleStart = settleStart;

    const onMessage = (event) => {
      if (!isCompanionNativeEventForTask(event, task, runtime)) {
        return;
      }
      const eventType = String(event?.type || "");
      const operation = queueCompanionDownloadTask(task, () => (
        applyCompanionNativeEvent(task, runtime, event)
      ));
      operation.then(() => {
        if (eventType === "accepted" && String(event?.requestId || "") === runtime.startRequestId) {
          settleStart();
        } else if (eventType === "error" && String(event?.requestId || "") === runtime.startRequestId) {
          settleStart(new Error(task.error || "The local streaming companion rejected the request."));
        } else if (["completed", "canceled", "failed"].includes(eventType) && !runtime.startSettled) {
          settleStart(new Error(task.error || "The local streaming companion ended before accepting the task."));
        }
      }).catch(() => {
        if (eventType === "accepted" || eventType === "error") {
          settleStart(companionUnavailableError());
        }
      });
    };
    const onDisconnect = () => {
      if (companionSharedDownloadPort === port) {
        companionSharedDownloadPort = null;
      }
      if (companionDownloadPorts.get(task.id) !== runtime) {
        return;
      }
      companionDownloadPorts.delete(task.id);
      const operation = queueCompanionDownloadTask(task, () => (
        interruptCompanionDownloadTask(task, companionUnavailableMessage(), { force: true })
      ));
      operation.finally(() => settleStart(companionUnavailableError()));
    };
    runtime.onMessage = onMessage;
    runtime.onDisconnect = onDisconnect;
    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
    if (typeof setTimeout === "function") {
      runtime.startTimeout = setTimeout(() => {
        if (companionDownloadPorts.get(task.id) !== runtime) {
          return;
        }
        queueCompanionDownloadTask(task, async () => {
          if (!runtime.startSettled) {
            await interruptCompanionDownloadTask(task, companionUnavailableMessage(), { force: true });
          }
        }).finally(() => {
          if (!runtime.startSettled) {
            settleStart(companionUnavailableError());
          }
        });
      }, COMPANION_START_TIMEOUT_MS);
    }

    try {
      port.postMessage(message);
    } catch (_error) {
      companionDownloadPorts.delete(task.id);
      if (companionSharedDownloadPort === port) {
        companionSharedDownloadPort = null;
      }
      queueCompanionDownloadTask(task, () => (
        interruptCompanionDownloadTask(task, companionUnavailableMessage(), { force: true })
      )).finally(() => settleStart(companionUnavailableError()));
      try {
        port.disconnect?.();
      } catch (_disconnectError) {
        // The failed post already leaves no usable transport.
      }
    }
  });
}

function isCompanionNativeEventForTask(event, task, runtime) {
  if (!event || typeof event !== "object") {
    return false;
  }
  if (event.version !== undefined && Number(event.version) !== COMPANION_PROTOCOL_VERSION) {
    return false;
  }
  const type = String(event.type || "");
  if (!["accepted", "progress", "refresh_required", "sources_refreshed", "cancel_requested", "completed", "canceled", "failed", "error"].includes(type)) {
    return false;
  }
  const eventTaskId = String(event.taskId || "");
  if (eventTaskId && eventTaskId !== task.id) {
    return false;
  }
  if (type === "error") {
    const requestId = String(event.requestId || "");
    return Boolean(requestId && runtime.pendingRequestIds.has(requestId));
  }
  if (type === "accepted") {
    return eventTaskId === task.id && String(event.requestId || "") === runtime.startRequestId;
  }
  return Boolean(eventTaskId);
}

function queueCompanionDownloadTask(task, operation) {
  const previous = task.operation || Promise.resolve();
  const next = previous.then(operation, operation);
  task.operation = next.catch(() => {});
  return next;
}

async function applyCompanionNativeEvent(task, runtime, event) {
  const type = String(event?.type || "");
  const requestId = String(event?.requestId || "");
  if (requestId) {
    runtime.pendingRequestIds.delete(requestId);
  }

  if (type === "accepted") {
    task.state = "in_progress";
    task.recoverable = false;
    task.error = "";
    task.outputName = normalizeCompanionOutputName(
      event?.outputName,
      task.kind,
      task.title,
      task.metadata?.quality
    );
    await publishCompanionDownloadTask(task, { force: true });
    return;
  }

  if (type === "progress") {
    applyCompanionProgress(task, event);
    if (!isCompanionDownloadTaskTerminal(task) && task.state !== "canceling") {
      task.state = "in_progress";
      task.recoverable = false;
    }
    await publishCompanionDownloadTask(task);
    return;
  }

  if (type === "refresh_required") {
    if (isCompanionDownloadTaskTerminal(task) || task.state === "canceling") {
      return;
    }
    task.state = "refreshing";
    task.recoverable = false;
    task.error = "";
    await publishCompanionDownloadTask(task, { force: true });
    await refreshCompanionDownloadSources(task, runtime);
    return;
  }

  if (type === "sources_refreshed") {
    if (!isCompanionDownloadTaskTerminal(task) && task.state !== "canceling") {
      task.state = "in_progress";
      task.recoverable = false;
      task.error = "";
      await publishCompanionDownloadTask(task, { force: true });
    }
    return;
  }

  if (type === "cancel_requested") {
    if (!isCompanionDownloadTaskTerminal(task)) {
      task.state = "canceling";
      task.recoverable = false;
      await publishCompanionDownloadTask(task, { force: true });
    }
    return;
  }

  if (type === "completed" || type === "canceled" || type === "failed") {
    const terminalState = type === "completed" ? "complete" : type;
    const bytesWritten = companionNonnegativeInteger(event?.bytesWritten);
    if (bytesWritten > 0) {
      task.receivedBytes = Math.max(task.receivedBytes, bytesWritten);
      task.totalBytes = Math.max(task.totalBytes, bytesWritten);
    }
    const message = type === "failed" ? normalizeCompanionErrorMessage(event?.message) : "";
    await finishCompanionDownloadTask(task, terminalState, message);
    return;
  }

  if (type === "error") {
    await finishCompanionDownloadTask(task, "failed", normalizeCompanionErrorMessage(event?.message));
  }
}

function applyCompanionProgress(task, event) {
  const phase = normalizeCompanionPhase(event?.phase);
  const received = companionNonnegativeInteger(event?.receivedBytes);
  const total = companionNonnegativeInteger(event?.totalBytes);
  task.phase = phase;
  task.segmentIndex = companionNonnegativeInteger(event?.segmentIndex);
  task.segmentCount = companionNonnegativeInteger(event?.segmentCount) || task.segmentCount;
  task.reconnectAttempt = companionNonnegativeInteger(event?.reconnectAttempt);

  if (task.kind === "dash") {
    if (phase === "download_video") {
      task.videoReceivedBytes = Math.max(task.videoReceivedBytes, received);
      task.videoTotalBytes = Math.max(task.videoTotalBytes, total);
    } else if (phase === "download_audio") {
      task.audioReceivedBytes = Math.max(task.audioReceivedBytes, received);
      task.audioTotalBytes = Math.max(task.audioTotalBytes, total);
    } else if (phase === "muxing") {
      task.videoReceivedBytes = Math.max(task.videoReceivedBytes, task.videoTotalBytes);
      task.audioReceivedBytes = Math.max(task.audioReceivedBytes, task.audioTotalBytes);
    }
    task.receivedBytes = task.videoReceivedBytes + task.audioReceivedBytes;
    task.totalBytes = Math.max(task.totalBytes, task.videoTotalBytes + task.audioTotalBytes);
    return;
  }

  task.receivedBytes = Math.max(task.receivedBytes, received);
  task.totalBytes = Math.max(task.totalBytes, total);
}

async function refreshCompanionDownloadSources(task, runtime) {
  if (task.refreshInFlight || isCompanionDownloadTaskTerminal(task)) {
    return;
  }
  task.refreshInFlight = true;
  try {
    const prepared = await rebuildCompanionDownloadTaskPayload(task);
    const descriptor = describeCompanionPreparedDownload(prepared, {
      maxBytes: task.maxBytes,
      maxDurationSeconds: task.maxDurationSeconds,
      segmentDurationSeconds: task.segmentDurationSeconds
    });
    if (descriptor.kind !== task.kind || (task.kind === "live" && descriptor.metadata.format !== task.metadata?.format)) {
      throw new Error("The refreshed media no longer matches the local companion task type.");
    }
    const { requestId, message } = buildCompanionRefreshMessage(task, descriptor);
    const activeRuntime = companionDownloadPorts.get(task.id);
    if (activeRuntime !== runtime || activeRuntime?.port !== runtime.port) {
      throw companionUnavailableError();
    }
    runtime.pendingRequestIds.add(String(requestId));
    runtime.port.postMessage(message);
  } catch (error) {
    if (task.kind === "live" && normalizeLiveSite(task.metadata?.site) !== "bilibili") {
      await interruptCompanionDownloadTask(
        task,
        "直播源需要重新授权，请回到原直播间后重试。",
        { force: true }
      );
    } else {
      await finishCompanionDownloadTask(task, "failed", normalizeCompanionErrorMessage(error?.message));
    }
  } finally {
    task.refreshInFlight = false;
  }
}

async function rebuildCompanionDownloadTaskPayload(task) {
  const metadata = normalizeCompanionTaskMetadata(task?.metadata, task?.kind);
  if (!metadata) {
    throw new Error("The saved local companion metadata is incomplete.");
  }
  if (task.kind === "dash") {
    return prepareDirectDownload({
      bvid: metadata.bvid,
      epId: metadata.epId,
      cid: metadata.cid,
      quality: metadata.quality,
      title: metadata.title,
      tabId: task.tabId
    });
  }
  return prepareLiveRecording({
    site: metadata.site,
    roomKey: metadata.roomKey,
    roomId: metadata.roomId,
    title: metadata.title,
    quality: metadata.quality,
    tabId: task.tabId
  });
}

async function getCompanionDownloadTask(taskId) {
  await restoreCompanionDownloadTasks();
  const task = companionDownloadTasks.get(String(taskId || ""));
  return task ? snapshotCompanionDownloadTask(task) : null;
}

async function listCompanionDownloadTasks(payload = {}) {
  await restoreCompanionDownloadTasks();
  const tabId = normalizeTabId(payload?.tabId);
  const activeOnly = Boolean(payload?.activeOnly);
  return Array.from(companionDownloadTasks.values())
    .filter((task) => !tabId || task.tabId === tabId)
    .filter((task) => !activeOnly || !isCompanionDownloadTaskTerminal(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .map((task) => snapshotCompanionDownloadTask(task));
}

async function controlCompanionDownloadTask(payload = {}) {
  await restoreCompanionDownloadTasks();
  const task = companionDownloadTasks.get(String(payload?.taskId || ""));
  if (!task) {
    throw new Error("The local companion task was not found.");
  }
  const action = String(payload?.action || "").toLowerCase();
  if (action === "cancel") {
    if (isCompanionDownloadTaskTerminal(task)) {
      return snapshotCompanionDownloadTask(task);
    }
    task.state = "canceling";
    task.recoverable = false;
    task.error = "";
    await publishCompanionDownloadTask(task, { force: true });
    const runtime = companionDownloadPorts.get(task.id);
    if (!runtime?.port) {
      await finishCompanionDownloadTask(task, "canceled");
      return snapshotCompanionDownloadTask(task);
    }
    const requestId = createCompanionRequestId("cancel");
    runtime.pendingRequestIds.add(requestId);
    try {
      runtime.port.postMessage({
        version: COMPANION_PROTOCOL_VERSION,
        type: "cancel",
        requestId,
        taskId: task.id
      });
    } catch (_error) {
      await interruptCompanionDownloadTask(task, companionUnavailableMessage(), { force: true });
    }
    return snapshotCompanionDownloadTask(task);
  }

  if (action === "resume") {
    if (!task.recoverable || task.state !== "interrupted") {
      throw new Error("Only an interrupted local companion task can be resumed.");
    }
    task.state = "starting";
    task.recoverable = false;
    task.error = "";
    task.phase = "";
    await publishCompanionDownloadTask(task, { force: true });
    try {
      const prepared = await rebuildCompanionDownloadTaskPayload(task);
      const descriptor = describeCompanionPreparedDownload(prepared, {
        maxBytes: task.maxBytes,
        maxDurationSeconds: task.maxDurationSeconds,
        segmentDurationSeconds: task.segmentDurationSeconds
      });
      if (descriptor.kind !== task.kind) {
        throw new Error("The refreshed media no longer matches the saved local companion task.");
      }
      await startCompanionDownloadTask(task, descriptor);
      return snapshotCompanionDownloadTask(task);
    } catch (error) {
      await interruptCompanionDownloadTask(task, normalizeCompanionErrorMessage(error?.message), { force: true });
      throw error;
    }
  }

  throw new Error("Unsupported local companion task action.");
}

function isCompanionDownloadTaskTerminal(task) {
  return ["complete", "canceled", "failed", "interrupted"].includes(String(task?.state || ""));
}

async function finishCompanionDownloadTask(task, state, error = "") {
  if (!task) {
    return;
  }
  task.state = normalizeCompanionTaskState(state, "failed");
  task.recoverable = false;
  task.error = error ? normalizeCompanionErrorMessage(error) : "";
  task.phase = task.state === "complete" ? "complete" : task.phase;
  await publishCompanionDownloadTask(task, { force: true });
  releaseCompanionDownloadPort(task.id);
}

async function interruptCompanionDownloadTask(task, message = companionUnavailableMessage(), options = {}) {
  if (!task || isCompanionDownloadTaskTerminal(task)) {
    return;
  }
  task.state = "interrupted";
  task.recoverable = true;
  task.error = normalizeCompanionErrorMessage(message);
  task.phase = "";
  await publishCompanionDownloadTask(task, { force: Boolean(options.force) });
  releaseCompanionDownloadPort(task.id);
}

function releaseCompanionDownloadPort(taskId) {
  const runtime = companionDownloadPorts.get(taskId);
  if (!runtime) {
    return;
  }
  companionDownloadPorts.delete(taskId);
  try {
    runtime.port?.onMessage?.removeListener?.(runtime.onMessage);
    runtime.port?.onDisconnect?.removeListener?.(runtime.onDisconnect);
  } catch (_error) {
    // A port can disappear while listeners are being removed.
  }
  if (companionDownloadPorts.size === 0 && companionSharedDownloadPort === runtime.port) {
    companionSharedDownloadPort = null;
    try {
      runtime.port?.disconnect?.();
    } catch (_error) {
      // The task snapshot has already been safely persisted.
    }
  }
}

async function restoreCompanionDownloadTasks() {
  if (companionDownloadTasksRestored) {
    return;
  }
  if (companionDownloadTasksRestorePromise) {
    return companionDownloadTasksRestorePromise;
  }
  companionDownloadTasksRestorePromise = (async () => {
    try {
      const stored = await chrome.storage?.local?.get(COMPANION_DOWNLOAD_TASK_STORAGE_KEY);
      const snapshots = Array.isArray(stored?.[COMPANION_DOWNLOAD_TASK_STORAGE_KEY])
        ? stored[COMPANION_DOWNLOAD_TASK_STORAGE_KEY]
        : [];
      let changed = false;
      for (const snapshot of snapshots) {
        const task = restoreCompanionDownloadTask(snapshot);
        if (!task || companionDownloadTasks.has(task.id)) {
          changed = true;
          continue;
        }
        if (!isCompanionDownloadTaskTerminal(task)) {
          task.state = "interrupted";
          task.recoverable = true;
          task.error = "The extension restarted before the local companion connection could be restored.";
          task.phase = "";
          task.updatedAt = new Date().toISOString();
          changed = true;
        }
        const safeSnapshot = snapshotCompanionDownloadTask(task);
        changed = changed || JSON.stringify(snapshot) !== JSON.stringify(safeSnapshot);
        companionDownloadTasks.set(task.id, task);
      }
      pruneCompanionDownloadTasks();
      if (changed) {
        await persistCompanionDownloadTasks({ force: true });
      }
    } catch (_error) {
      // Listing local task history must stay useful even if storage is briefly unavailable.
    } finally {
      companionDownloadTasksRestored = true;
      companionDownloadTasksRestorePromise = null;
    }
  })();
  return companionDownloadTasksRestorePromise;
}

function restoreCompanionDownloadTask(snapshot) {
  const id = String(snapshot?.taskId || "");
  const kind = normalizeCompanionKind(snapshot?.kind);
  const metadata = normalizeCompanionTaskMetadata(snapshot?.metadata || snapshot?.resume, kind);
  if (!id || !kind || !metadata) {
    return null;
  }
  const now = new Date().toISOString();
  const state = normalizeCompanionTaskState(snapshot?.state, "interrupted");
  return {
    id,
    tabId: normalizeTabId(snapshot?.tabId),
    kind,
    title: normalizeCompanionTitle(snapshot?.title || metadata.title, metadata.title),
    outputName: normalizeCompanionOutputName(snapshot?.outputName, kind, metadata.title, metadata.quality),
    format: String(snapshot?.format || metadata.format || ""),
    metadata,
    maxBytes: normalizeCompanionMaxBytes(snapshot?.maxBytes),
    maxDurationSeconds: kind === "live" ? normalizeCompanionDurationSeconds(snapshot?.maxDurationSeconds) : 0,
    segmentDurationSeconds: kind === "live" ? normalizeCompanionSegmentSeconds(snapshot?.segmentDurationSeconds) : 0,
    state,
    recoverable: Boolean(snapshot?.recoverable) || state === "interrupted",
    error: normalizeCompanionErrorMessage(snapshot?.error),
    phase: normalizeCompanionPhase(snapshot?.phase),
    receivedBytes: companionNonnegativeInteger(snapshot?.receivedBytes),
    totalBytes: companionNonnegativeInteger(snapshot?.totalBytes),
    videoReceivedBytes: companionNonnegativeInteger(snapshot?.videoReceivedBytes),
    videoTotalBytes: companionNonnegativeInteger(snapshot?.videoTotalBytes),
    audioReceivedBytes: companionNonnegativeInteger(snapshot?.audioReceivedBytes),
    audioTotalBytes: companionNonnegativeInteger(snapshot?.audioTotalBytes),
    segmentIndex: companionNonnegativeInteger(snapshot?.segmentIndex),
    segmentCount: companionNonnegativeInteger(snapshot?.segmentCount),
    reconnectAttempt: companionNonnegativeInteger(snapshot?.reconnectAttempt),
    createdAt: String(snapshot?.createdAt || now),
    updatedAt: String(snapshot?.updatedAt || now),
    operation: Promise.resolve(),
    refreshInFlight: false
  };
}

function normalizeCompanionTaskMetadata(value, kind) {
  if (kind === "dash") {
    const bvid = normalizeBvid(value?.bvid);
    const epId = normalizeId(value?.epId);
    const cid = Number(value?.cid) || 0;
    const quality = Number(value?.quality) || 0;
    if ((!bvid && !epId) || !cid || !quality) {
      return null;
    }
    return {
      bvid,
      epId,
      cid,
      quality,
      title: normalizeCompanionTitle(value?.title, bvid || `ep${epId}`),
      source: epId ? "bangumi" : "video",
      format: "dash"
    };
  }
  if (kind === "live") {
    const site = normalizeLiveSite(value?.site);
    const roomKey = normalizeLiveRoomKey(value?.roomKey || value?.roomId);
    const roomId = normalizeId(value?.roomId);
    const quality = Number(value?.quality) || 0;
    if (!roomKey || !quality) {
      return null;
    }
    return {
      site,
      roomKey,
      roomId,
      shortId: normalizeId(value?.shortId),
      quality,
      title: normalizeCompanionTitle(value?.title, `live_${roomKey}`),
      source: "live",
      format: value?.format === "hls" ? "hls" : "flv"
    };
  }
  return null;
}

function pruneCompanionDownloadTasks(preserveTaskId = "") {
  let terminalCount = Array.from(companionDownloadTasks.values())
    .filter(isCompanionDownloadTaskTerminal)
    .length;
  const removable = Array.from(companionDownloadTasks.values())
    .filter((task) => task.id !== preserveTaskId && isCompanionDownloadTaskTerminal(task))
    .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
  while (terminalCount > COMPANION_TASK_HISTORY_LIMIT && removable.length) {
    const task = removable.shift();
    companionDownloadTasks.delete(task.id);
    companionDownloadTaskPersistMetadata.delete(task.id);
    terminalCount -= 1;
  }
}

async function publishCompanionDownloadTask(task, options = {}) {
  task.updatedAt = new Date().toISOString();
  await persistCompanionDownloadTasks({
    force: Boolean(options.force) || isCompanionDownloadTaskTerminal(task)
  });
  relayProgress(companionDownloadTaskProgress(task), task.tabId);
}

function companionDownloadTaskProgress(task) {
  return {
    receivedBytes: companionNonnegativeInteger(task?.receivedBytes),
    totalBytes: companionNonnegativeInteger(task?.totalBytes),
    segmentIndex: companionNonnegativeInteger(task?.segmentIndex),
    segmentCount: companionNonnegativeInteger(task?.segmentCount),
    candidateIndex: 0,
    candidateCount: 0,
    done: isCompanionDownloadTaskTerminal(task),
    taskId: String(task?.id || ""),
    taskState: normalizeCompanionTaskState(task?.state, "interrupted"),
    nativeDownload: false,
    companionDownload: true,
    companionKind: normalizeCompanionKind(task?.kind),
    site: normalizeCompanionKind(task?.kind) === "live"
      ? normalizeLiveSite(task?.metadata?.site)
      : "",
    phase: normalizeCompanionPhase(task?.phase),
    recoverable: Boolean(task?.recoverable),
    reconnectAttempt: companionNonnegativeInteger(task?.reconnectAttempt),
    downloadIds: [],
    error: normalizeCompanionErrorMessage(task?.error)
  };
}

function companionDownloadTaskSnapshotsForStorage() {
  const tasks = Array.from(companionDownloadTasks.values());
  const active = tasks
    .filter((task) => !isCompanionDownloadTaskTerminal(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const terminal = tasks
    .filter(isCompanionDownloadTaskTerminal)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, COMPANION_TASK_HISTORY_LIMIT);
  return [...active, ...terminal]
    .map((task) => snapshotCompanionDownloadTask(task))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function companionDownloadTaskPersistenceFingerprint(snapshot) {
  return JSON.stringify({
    state: snapshot.state,
    recoverable: snapshot.recoverable,
    error: snapshot.error,
    phase: snapshot.phase,
    segmentIndex: snapshot.segmentIndex,
    segmentCount: snapshot.segmentCount,
    reconnectAttempt: snapshot.reconnectAttempt
  });
}

function shouldPersistCompanionDownloadTasks(snapshots, force) {
  if (force || !companionDownloadTasksLastPersistAt) {
    return true;
  }
  const now = Date.now();
  for (const snapshot of snapshots) {
    const previous = companionDownloadTaskPersistMetadata.get(snapshot.taskId);
    const fingerprint = companionDownloadTaskPersistenceFingerprint(snapshot);
    if (!previous || previous.fingerprint !== fingerprint) {
      return true;
    }
    const receivedDelta = Math.abs((Number(snapshot.receivedBytes) || 0) - previous.receivedBytes);
    const totalDelta = Math.abs((Number(snapshot.totalBytes) || 0) - previous.totalBytes);
    if (receivedDelta >= COMPANION_SNAPSHOT_MIN_BYTES_DELTA ||
      totalDelta >= COMPANION_SNAPSHOT_MIN_BYTES_DELTA ||
      now - previous.persistedAt >= COMPANION_SNAPSHOT_MIN_INTERVAL_MS) {
      return true;
    }
  }
  return false;
}

function scheduleCompanionDownloadTasksPersistence() {
  if (companionDownloadTasksPersistTimer !== null || typeof setTimeout !== "function") {
    return;
  }
  const elapsed = Math.max(Date.now() - companionDownloadTasksLastPersistAt, 0);
  const delay = Math.max(COMPANION_SNAPSHOT_MIN_INTERVAL_MS - elapsed, 0);
  companionDownloadTasksPersistTimer = setTimeout(() => {
    companionDownloadTasksPersistTimer = null;
    persistCompanionDownloadTasks().catch(() => {});
  }, delay);
}

async function persistCompanionDownloadTasks(options = {}) {
  const force = Boolean(options.force);
  const snapshots = companionDownloadTaskSnapshotsForStorage();
  if (!shouldPersistCompanionDownloadTasks(snapshots, force)) {
    scheduleCompanionDownloadTasksPersistence();
    return false;
  }
  if (companionDownloadTasksPersistTimer !== null && typeof clearTimeout === "function") {
    clearTimeout(companionDownloadTasksPersistTimer);
    companionDownloadTasksPersistTimer = null;
  }
  const write = async () => {
    const currentSnapshots = companionDownloadTaskSnapshotsForStorage();
    try {
      await chrome.storage?.local?.set({ [COMPANION_DOWNLOAD_TASK_STORAGE_KEY]: currentSnapshots });
      const persistedAt = Date.now();
      companionDownloadTasksLastPersistAt = persistedAt;
      companionDownloadTaskPersistMetadata.clear();
      for (const snapshot of currentSnapshots) {
        companionDownloadTaskPersistMetadata.set(snapshot.taskId, {
          fingerprint: companionDownloadTaskPersistenceFingerprint(snapshot),
          receivedBytes: companionNonnegativeInteger(snapshot.receivedBytes),
          totalBytes: companionNonnegativeInteger(snapshot.totalBytes),
          persistedAt
        });
      }
      return true;
    } catch (_error) {
      return false;
    }
  };
  const operation = companionDownloadTasksPersistOperation.then(write, write);
  companionDownloadTasksPersistOperation = operation.catch(() => {});
  return operation;
}

function snapshotCompanionDownloadTask(task) {
  return sanitizeForMessage({
    taskId: String(task?.id || task?.taskId || ""),
    tabId: normalizeTabId(task?.tabId) || 0,
    kind: normalizeCompanionKind(task?.kind),
    title: normalizeCompanionTitle(task?.title || task?.metadata?.title, "bili_download"),
    outputName: normalizeCompanionOutputName(task?.outputName, task?.kind, task?.title || task?.metadata?.title, task?.metadata?.quality),
    format: String(task?.format || task?.metadata?.format || ""),
    state: normalizeCompanionTaskState(task?.state, "interrupted"),
    recoverable: Boolean(task?.recoverable),
    error: normalizeCompanionErrorMessage(task?.error),
    phase: normalizeCompanionPhase(task?.phase),
    receivedBytes: companionNonnegativeInteger(task?.receivedBytes),
    totalBytes: companionNonnegativeInteger(task?.totalBytes),
    segmentIndex: companionNonnegativeInteger(task?.segmentIndex),
    segmentCount: companionNonnegativeInteger(task?.segmentCount),
    reconnectAttempt: companionNonnegativeInteger(task?.reconnectAttempt),
    maxBytes: normalizeCompanionMaxBytes(task?.maxBytes),
    maxDurationSeconds: normalizeCompanionKind(task?.kind) === "live"
      ? normalizeCompanionDurationSeconds(task?.maxDurationSeconds)
      : 0,
    segmentDurationSeconds: normalizeCompanionKind(task?.kind) === "live"
      ? normalizeCompanionSegmentSeconds(task?.segmentDurationSeconds)
      : 0,
    createdAt: String(task?.createdAt || ""),
    updatedAt: String(task?.updatedAt || ""),
    // This is intentionally a whitelist of re-preparation identifiers. Do not
    // add prepared segments, sources, URLs, headers, cookies, or a referer.
    metadata: normalizeCompanionTaskMetadata(task?.metadata, task?.kind)
  });
}

function normalizeCompanionTaskState(value, fallback = "") {
  const state = String(value || "") === "completed" ? "complete" : String(value || "");
  return ["starting", "in_progress", "refreshing", "canceling", "complete", "canceled", "failed", "interrupted"].includes(state)
    ? state
    : fallback;
}

function normalizeCompanionKind(value) {
  const kind = String(value || "");
  return kind === "dash" || kind === "live" ? kind : "";
}

function normalizeCompanionPhase(value) {
  const phase = String(value || "") === "completed" ? "complete" : String(value || "");
  return ["download_video", "download_audio", "muxing", "connecting", "recording", "reconnecting", "complete"].includes(phase)
    ? phase
    : "";
}

function normalizeCompanionOutputName(value, kind, title, quality) {
  const source = String(value || "").trim();
  if (!source || /[\\/]/.test(source) || isLocalDiagnosticPath(source) || looksLikeDiagnosticUrl(source)) {
    return companionOutputName(normalizeCompanionTitle(title, "bili_download"), normalizeCompanionKind(kind) || "dash", Number(quality) || 0);
  }
  const safe = safeFilename(source);
  if (normalizeCompanionKind(kind) === "live" && /\.mkv$/i.test(safe)) {
    return safe.slice(0, 115);
  }
  const stem = safe.replace(/\.(?:mp4|flv|m4s|mkv)$/i, "");
  return `${stem.slice(0, 110) || "bili_download"}.${normalizeCompanionKind(kind) === "live" ? "flv" : "mp4"}`;
}

function normalizeCompanionMaxBytes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMPANION_DEFAULT_MAX_BYTES;
  }
  return Math.max(1, Math.min(Math.floor(parsed), COMPANION_MAX_BYTES));
}

function normalizeCompanionDurationSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMPANION_DEFAULT_LIVE_DURATION_SECONDS;
  }
  return Math.max(1, Math.min(Math.floor(parsed), COMPANION_MAX_LIVE_DURATION_SECONDS));
}

function normalizeCompanionSegmentSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return COMPANION_DEFAULT_LIVE_SEGMENT_SECONDS;
  }
  return Math.max(1, Math.min(Math.floor(parsed), COMPANION_MAX_LIVE_SEGMENT_SECONDS));
}

function companionNonnegativeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.min(Math.floor(parsed), Number.MAX_SAFE_INTEGER);
}

function normalizeCompanionErrorMessage(value) {
  const message = redactCompanionText(String(value || "")).replace(/[\r\n\t]+/g, " ").trim();
  return message.slice(0, 500);
}

function redactCompanionText(value) {
  // The native protocol guarantees that it never emits URLs, but keep this
  // second boundary here as well: a third-party replacement host must not be
  // able to smuggle an unsigned or otherwise non-query URL into task history.
  return redactDiagnosticText(String(value || "")).replace(
    /(?:(?:https?|wss?):\/\/|\/\/)[^\s"'<>`]+/gi,
    "[URL redacted]"
  );
}

function companionUnavailableMessage() {
  return "The local streaming companion connection is unavailable. Install or restart the companion, then resume the task.";
}

function companionUnavailableError() {
  return new Error(companionUnavailableMessage());
}

async function createBatchDownloadJob(payload = {}) {
  await restoreBatchDownloadJobs();
  const sourceItems = Array.isArray(payload?.items) ? payload.items.slice(0, BATCH_DOWNLOAD_JOB_ITEM_LIMIT) : [];
  if (!sourceItems.length) {
    throw new Error("A batch download job needs at least one page item.");
  }

  const now = new Date().toISOString();
  const items = sourceItems.map((item, index) => createBatchDownloadJobItem(item, index + 1));
  const job = {
    id: createBatchDownloadJobId(),
    tabId: normalizeTabId(payload?.tabId),
    title: normalizeBatchDisplayText(payload?.title || ""),
    state: "queued",
    error: "",
    currentIndex: 1,
    createdAt: now,
    updatedAt: now,
    items
  };
  batchDownloadJobs.set(job.id, job);
  pruneBatchDownloadJobs(job.id);
  await persistBatchDownloadJobs();
  return snapshotBatchDownloadJob(job);
}

async function getBatchDownloadJob(batchJobId) {
  await restoreBatchDownloadJobs();
  const job = batchDownloadJobs.get(String(batchJobId || ""));
  if (!job) {
    return null;
  }
  await synchronizeBatchDownloadJobsWithDirectTasks([job]);
  return snapshotBatchDownloadJob(job);
}

async function listBatchDownloadJobs(payload = {}) {
  await restoreBatchDownloadJobs();
  const tabId = normalizeTabId(payload?.tabId);
  const activeOnly = Boolean(payload?.activeOnly);
  const jobs = Array.from(batchDownloadJobs.values())
    .filter((job) => !tabId || job.tabId === tabId)
    .filter((job) => !activeOnly || !isBatchDownloadJobTerminal(job))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  await synchronizeBatchDownloadJobsWithDirectTasks(jobs);
  return jobs.map((job) => snapshotBatchDownloadJob(job));
}

async function updateBatchDownloadJob(payload = {}) {
  await restoreBatchDownloadJobs();
  const batchJobId = String(payload?.batchJobId || "");
  const job = batchDownloadJobs.get(batchJobId);
  if (!job) {
    throw new Error("Batch download job was not found.");
  }
  const patch = payload?.patch && typeof payload.patch === "object" ? payload.patch : payload;
  // Batch terminal states are one-way. A stale side-panel runner may still
  // finish an awaited prepare/download after another panel has canceled the
  // job; accepting its old in-progress patch would resurrect the queue.
  if (isBatchDownloadJobTerminal(job)) {
    return snapshotBatchDownloadJob(job);
  }
  let changed = false;

  if (Object.prototype.hasOwnProperty.call(patch, "state")) {
    const state = normalizeBatchDownloadJobState(patch.state, job.state);
    changed = changed || state !== job.state;
    job.state = state;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "error")) {
    const error = redactDiagnosticText(String(patch.error || ""));
    changed = changed || error !== job.error;
    job.error = error;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "currentIndex")) {
    const currentIndex = normalizeBatchCurrentIndex(patch.currentIndex, job.items.length, job.currentIndex);
    changed = changed || currentIndex !== job.currentIndex;
    job.currentIndex = currentIndex;
  }

  const itemUpdates = Array.isArray(patch.itemUpdates)
    ? patch.itemUpdates
    : (patch.item && typeof patch.item === "object" ? [patch.item] : []);
  for (const itemPatch of itemUpdates) {
    const index = normalizeBatchCurrentIndex(itemPatch?.index, job.items.length, 0);
    if (!index || !job.items[index - 1]) {
      throw new Error("Batch item index was not found.");
    }
    const previous = job.items[index - 1];
    const next = createBatchDownloadJobItem({ ...previous, ...itemPatch }, index, previous);
    job.items[index - 1] = next;
    changed = true;
  }

  if (changed) {
    job.updatedAt = new Date().toISOString();
    await persistBatchDownloadJobs();
  }
  await synchronizeBatchDownloadJobsWithDirectTasks([job]);
  return snapshotBatchDownloadJob(job);
}

function createBatchDownloadJobId() {
  batchDownloadJobSequence += 1;
  return `batch-${Date.now().toString(36)}-${batchDownloadJobSequence.toString(36)}`;
}

function createBatchDownloadJobItem(source, index, previous = null) {
  const item = source && typeof source === "object" ? source : {};
  const bvid = normalizeBvid(item.bvid ?? previous?.bvid);
  const epId = normalizeId(item.epId ?? previous?.epId);
  const cid = Number(item.cid ?? previous?.cid);
  if ((!bvid && !epId) || !Number.isFinite(cid) || cid <= 0) {
    throw new Error(`Batch item ${index} needs a video/episode ID and cid.`);
  }
  const mode = normalizeBatchDownloadMode(item.mode ?? previous?.mode);
  const sourceKind = normalizeBatchDownloadSource(item.source ?? previous?.source, epId);
  const title = normalizeBatchDisplayText(item.title ?? previous?.title ?? bvid ?? (epId ? `ep${epId}` : ""));
  const itemId = normalizeBatchDisplayText(item.itemId ?? previous?.itemId ?? `item-${index}`).slice(0, 120) || `item-${index}`;
  const directTaskId = normalizeBatchDirectTaskId(item.directTaskId ?? previous?.directTaskId);
  const now = new Date().toISOString();
  return {
    index,
    itemId,
    bvid,
    epId,
    cid: Math.floor(cid),
    quality: Math.max(Number(item.quality ?? previous?.quality) || 0, 0),
    title,
    source: sourceKind,
    pageIndex: Math.max(Math.floor(Number(item.pageIndex ?? previous?.pageIndex) || index), 1),
    pageLabel: normalizeBatchDisplayText(item.pageLabel ?? previous?.pageLabel ?? ""),
    mode,
    format: normalizeBatchDisplayText(item.format ?? previous?.format ?? "").slice(0, 80),
    state: normalizeBatchDownloadJobState(item.state ?? previous?.state, "queued"),
    error: redactDiagnosticText(String(item.error ?? previous?.error ?? "")),
    directTaskId,
    attempt: Math.max(Math.floor(Number(item.attempt ?? previous?.attempt) || 0), 0),
    createdAt: String(previous?.createdAt || now),
    updatedAt: now
  };
}

function normalizeBatchDownloadJobState(value, fallback = "queued") {
  const state = String(value || "").toLowerCase();
  return ["queued", "in_progress", "paused", "complete", "interrupted", "canceled"].includes(state)
    ? state
    : fallback;
}

function normalizeBatchDownloadMode(value) {
  const mode = String(value || "").toLowerCase();
  return ["durl", "audio", "dash"].includes(mode) ? mode : "";
}

function normalizeBatchDownloadSource(value, epId) {
  const source = String(value || "").toLowerCase();
  if (["video", "bangumi"].includes(source)) {
    return source;
  }
  return epId ? "bangumi" : "video";
}

function normalizeBatchDirectTaskId(value) {
  const taskId = String(value || "").trim();
  return /^direct-[a-z0-9-]+$/i.test(taskId) ? taskId.slice(0, 160) : "";
}

function normalizeBatchCurrentIndex(value, itemCount, fallback = 0) {
  const index = Math.floor(Number(value));
  if (!Number.isInteger(index) || index < 1 || index > Math.max(Number(itemCount) || 0, 0)) {
    return fallback;
  }
  return index;
}

function normalizeBatchDisplayText(value) {
  return redactDiagnosticText(String(value || "")).slice(0, 240);
}

function isBatchDownloadJobTerminal(job) {
  return ["complete", "interrupted", "canceled"].includes(String(job?.state || ""));
}

async function restoreBatchDownloadJobs() {
  if (batchDownloadJobsRestored) {
    return;
  }
  if (batchDownloadJobsRestorePromise) {
    return batchDownloadJobsRestorePromise;
  }

  batchDownloadJobsRestorePromise = (async () => {
    try {
      await restoreDirectDownloadTasks();
      const stored = await chrome.storage?.local?.get(BATCH_DOWNLOAD_JOB_STORAGE_KEY);
      const snapshots = Array.isArray(stored?.[BATCH_DOWNLOAD_JOB_STORAGE_KEY])
        ? stored[BATCH_DOWNLOAD_JOB_STORAGE_KEY]
        : [];
      let changed = false;
      for (const snapshot of snapshots) {
        const batchJobId = String(snapshot?.batchJobId || "");
        if (!batchJobId || batchDownloadJobs.has(batchJobId)) {
          continue;
        }
        const job = restoreBatchDownloadJob(snapshot);
        batchDownloadJobs.set(job.id, job);
        changed = changed || JSON.stringify(snapshot) !== JSON.stringify(snapshotBatchDownloadJob(job));
      }
      pruneBatchDownloadJobs();
      changed = (await synchronizeBatchDownloadJobsWithDirectTasks(Array.from(batchDownloadJobs.values()))) || changed;
      if (changed) {
        await persistBatchDownloadJobs();
      }
    } catch (_error) {
      // The caller can still create a new batch job if an old snapshot cannot be read.
    } finally {
      batchDownloadJobsRestored = true;
      batchDownloadJobsRestorePromise = null;
    }
  })();
  return batchDownloadJobsRestorePromise;
}

function restoreBatchDownloadJob(snapshot) {
  const now = new Date().toISOString();
  const rawItems = Array.isArray(snapshot?.items) ? snapshot.items.slice(0, BATCH_DOWNLOAD_JOB_ITEM_LIMIT) : [];
  const items = rawItems.map((item, index) => createBatchDownloadJobItem(item, index + 1));
  return {
    id: String(snapshot?.batchJobId || ""),
    tabId: normalizeTabId(snapshot?.tabId),
    title: normalizeBatchDisplayText(snapshot?.title || ""),
    state: normalizeBatchDownloadJobState(snapshot?.state, "queued"),
    error: redactDiagnosticText(String(snapshot?.error || "")),
    currentIndex: normalizeBatchCurrentIndex(snapshot?.currentIndex, items.length, items.length ? 1 : 0),
    createdAt: String(snapshot?.createdAt || now),
    updatedAt: String(snapshot?.updatedAt || now),
    items
  };
}

async function synchronizeBatchDownloadJobsWithDirectTasks(jobs) {
  let changed = false;
  for (const job of jobs) {
    if (!job || isBatchDownloadJobTerminal(job)) {
      continue;
    }
    let hasInProgress = false;
    let allComplete = job.items.length > 0;
    for (const item of job.items) {
      const task = item.directTaskId ? directDownloadTasks.get(item.directTaskId) : null;
      if (task) {
        const state = task.state === "starting"
          ? "in_progress"
          : normalizeBatchDownloadJobState(task.state, item.state);
        const error = redactDiagnosticText(String(task.error || ""));
        if (item.state !== state || item.error !== error) {
          item.state = state;
          item.error = error;
          item.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      hasInProgress = hasInProgress || ["in_progress", "paused", "starting"].includes(item.state);
      allComplete = allComplete && item.state === "complete";
    }
    const nextState = allComplete ? "complete" : (hasInProgress ? "in_progress" : job.state);
    if (nextState !== job.state) {
      job.state = nextState;
      job.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) {
    await persistBatchDownloadJobs();
  }
  return changed;
}

function pruneBatchDownloadJobs(preserveJobId = "") {
  let terminalCount = Array.from(batchDownloadJobs.values())
    .filter(isBatchDownloadJobTerminal)
    .length;
  const removable = Array.from(batchDownloadJobs.values())
    .filter((job) => job.id !== preserveJobId && isBatchDownloadJobTerminal(job))
    .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
  while (terminalCount > BATCH_DOWNLOAD_JOB_HISTORY_LIMIT && removable.length) {
    const job = removable.shift();
    batchDownloadJobs.delete(job.id);
    terminalCount -= 1;
  }
}

function batchDownloadJobSnapshotsForStorage() {
  const jobs = Array.from(batchDownloadJobs.values());
  const active = jobs.filter((job) => !isBatchDownloadJobTerminal(job));
  const terminal = jobs
    .filter(isBatchDownloadJobTerminal)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    .slice(0, BATCH_DOWNLOAD_JOB_HISTORY_LIMIT);
  return [...active, ...terminal]
    .map((job) => snapshotBatchDownloadJob(job))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function persistBatchDownloadJobs() {
  const write = async () => {
    try {
      await chrome.storage?.local?.set({
        [BATCH_DOWNLOAD_JOB_STORAGE_KEY]: batchDownloadJobSnapshotsForStorage()
      });
      return true;
    } catch (_error) {
      return false;
    }
  };
  const operation = batchDownloadJobsPersistOperation.then(write, write);
  batchDownloadJobsPersistOperation = operation.catch(() => {});
  return operation;
}

function snapshotBatchDownloadJob(job) {
  return sanitizeForMessage({
    batchJobId: String(job?.id || job?.batchJobId || ""),
    tabId: Number(job?.tabId) || 0,
    title: normalizeBatchDisplayText(job?.title || ""),
    state: normalizeBatchDownloadJobState(job?.state, "queued"),
    error: redactDiagnosticText(String(job?.error || "")),
    currentIndex: normalizeBatchCurrentIndex(job?.currentIndex, job?.items?.length, 0),
    createdAt: String(job?.createdAt || ""),
    updatedAt: String(job?.updatedAt || ""),
    count: Array.isArray(job?.items) ? job.items.length : 0,
    completedCount: (job?.items || []).filter((item) => item.state === "complete").length,
    items: (job?.items || []).map((item, index) => ({
      index: Number(item?.index) || index + 1,
      itemId: normalizeBatchDisplayText(item?.itemId || `item-${index + 1}`).slice(0, 120),
      bvid: normalizeBvid(item?.bvid),
      epId: normalizeId(item?.epId),
      cid: Number(item?.cid) || 0,
      quality: Math.max(Number(item?.quality) || 0, 0),
      title: normalizeBatchDisplayText(item?.title || ""),
      source: normalizeBatchDownloadSource(item?.source, normalizeId(item?.epId)),
      pageIndex: Math.max(Number(item?.pageIndex) || index + 1, 1),
      pageLabel: normalizeBatchDisplayText(item?.pageLabel || ""),
      mode: normalizeBatchDownloadMode(item?.mode),
      format: normalizeBatchDisplayText(item?.format || "").slice(0, 80),
      state: normalizeBatchDownloadJobState(item?.state, "queued"),
      error: redactDiagnosticText(String(item?.error || "")),
      directTaskId: normalizeBatchDirectTaskId(item?.directTaskId),
      attempt: Math.max(Number(item?.attempt) || 0, 0),
      createdAt: String(item?.createdAt || ""),
      updatedAt: String(item?.updatedAt || "")
    }))
  });
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

  const playUrl = await fetchMediaPlayUrlCached({ bvid, epId, cid, quality, tabId });
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

  const directPlayUrl = await fetchMediaPlayUrlCached({ bvid, epId, cid, quality, fnval: 0, tabId });
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

  const playUrl = await fetchMediaPlayUrlCached({ bvid, epId, cid, tabId });
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
        downloadMethod: "native-download"
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

function fetchMediaPlayUrlCached(params) {
  const now = Date.now();
  const key = playUrlCacheKey(params);
  const cached = playUrlCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }
  if (cached) {
    playUrlCache.delete(key);
  }

  const entry = {
    expiresAt: now + PLAY_URL_CACHE_TTL_MS,
    promise: null
  };
  entry.promise = fetchMediaPlayUrl(params).then((playUrl) => {
    cachePlayUrlAliases(params, playUrl, entry);
    return playUrl;
  }, (error) => {
    removePlayUrlCacheEntry(entry);
    throw error;
  });
  playUrlCache.set(key, entry);
  prunePlayUrlCache(now);
  return entry.promise;
}

function playUrlCacheKey({ bvid, epId, cid, quality, fnval = 4048, tabId = null }) {
  const sourceId = epId ? `ep:${normalizeId(epId)}` : `bv:${normalizeBvid(bvid)}`;
  const requestQuality = Number(quality) || 127;
  const pageContext = epId ? (normalizeTabId(tabId) || 0) : 0;
  return [sourceId, Number(cid) || 0, requestQuality, Number(fnval) || 0, pageContext].join(":");
}

function cachePlayUrlAliases(params, playUrl, entry) {
  const qualities = new Set([
    Number(params?.quality) || 127,
    responseQuality(playUrl),
    ...(playUrl?.dashVideos || []).map((stream) => Number(stream.id))
  ]);
  for (const quality of qualities) {
    if (!quality) {
      continue;
    }
    playUrlCache.set(playUrlCacheKey({ ...params, quality }), entry);
  }
  prunePlayUrlCache();
}

function removePlayUrlCacheEntry(entry) {
  for (const [key, cached] of playUrlCache) {
    if (cached === entry) {
      playUrlCache.delete(key);
    }
  }
}

function prunePlayUrlCache(now = Date.now()) {
  for (const [key, entry] of playUrlCache) {
    if (entry.expiresAt <= now) {
      playUrlCache.delete(key);
    }
  }
  while (playUrlCache.size > PLAY_URL_CACHE_LIMIT) {
    playUrlCache.delete(playUrlCache.keys().next().value);
  }
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

async function buildQualityAvailability({ playUrl, account, source = "video" }) {
  const availability = new Map();
  const requestedCodes = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];

  const dashQualityCodes = new Set((playUrl.dashVideos || []).map((stream) => stream.id));
  await Promise.all(Array.from(dashQualityCodes).map((code) => (
    markQualityAvailable(availability, code, "dash", playUrl)
  )));

  if (hasDirectStreams(playUrl)) {
    await markQualityAvailable(availability, responseQuality(playUrl), "direct", playUrl);
  }

  const confirmedQuality = responseQuality(playUrl);
  if (confirmedQuality && !availability.has(confirmedQuality)) {
    availability.set(confirmedQuality, deferredQualityInfo(account, null, true));
  }

  for (const code of requestedCodes) {
    const numericCode = Number(code);
    if (!Number.isFinite(numericCode) || availability.has(numericCode)) {
      continue;
    }
    availability.set(numericCode, deferredQualityInfo(
      account,
      qualityRequirement(playUrl, numericCode, source)
    ));
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

function deferredQualityInfo(account, requirement = null, confirmed = false) {
  if (requirement?.needVip && !account?.vipLabel) {
    return unavailableQualityInfo(account, requirement);
  }
  if (!confirmed && (requirement?.needLogin || !requirement) && !account?.isLogin) {
    return unavailableQualityInfo(account, requirement);
  }
  return {
    available: true,
    mode: "",
    reason: "",
    estimatedSize: 0,
    estimatedSizeSource: "",
    estimatedSizeApproximate: false,
    stream: null
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
      downloadMethod: "native-download"
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
    .filter((candidate) => (
      candidate.url &&
      isAllowedCompanionMediaUrl(candidate.url, "bilibili") &&
      !seen.has(candidate.url) &&
      seen.add(candidate.url)
    ));
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

function normalizeLiveSite(value) {
  const site = String(value || "").toLowerCase();
  return ["bilibili", "douyu", "huya"].includes(site) ? site : "bilibili";
}

function normalizeLiveRoomKey(value) {
  const roomKey = String(value || "").trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(roomKey) ? roomKey : "";
}

function siteFromUrl(value) {
  const source = String(value || "");
  if (/^https:\/\/live\.bilibili\.com\//.test(source) || /^https:\/\/(?:www|m)\.bilibili\.com\//.test(source)) {
    return "bilibili";
  }
  if (/^https:\/\/www\.douyu\.com\//.test(source)) {
    return "douyu";
  }
  if (/^https:\/\/www\.huya\.com\//.test(source)) {
    return "huya";
  }
  return "";
}

function extractLiveRoomKey(value, site = siteFromUrl(value)) {
  const source = String(value || "");
  if (site === "bilibili") {
    return source.match(/:\/\/live\.bilibili\.com\/(?:blanc\/)?(\d+)/)?.[1] || "";
  }
  if (site === "douyu") {
    return source.match(/:\/\/www\.douyu\.com\/(\d+)(?:[/?#]|$)/)?.[1] || "";
  }
  if (site === "huya") {
    const roomKey = source.match(/:\/\/www\.huya\.com\/([A-Za-z0-9_-]+)(?:[/?#]|$)/)?.[1] || "";
    return ["g", "l", "m", "all", "index", "search"].includes(roomKey.toLowerCase()) ? "" : roomKey;
  }
  return "";
}

function liveSiteDisplayName(site) {
  return {
    bilibili: "Bilibili",
    douyu: "斗鱼",
    huya: "虎牙"
  }[normalizeLiveSite(site)];
}

function liveSiteReferer(site) {
  return {
    bilibili: "https://live.bilibili.com/",
    douyu: "https://www.douyu.com/",
    huya: "https://www.huya.com/"
  }[normalizeLiveSite(site)];
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
    const diagnostic = sanitizeForMessage(stored?.[DIAGNOSTIC_STORAGE_KEY] || null);
    if (!diagnostic) {
      return null;
    }

    // Older extension versions could persist a signed media URL. Rewrite a
    // recovered diagnostic through the same boundary before exposing it again.
    lastDiagnostic = diagnostic;
    try {
      await chrome.storage?.local?.set({ [DIAGNOSTIC_STORAGE_KEY]: diagnostic });
    } catch (_error) {
      // A failed migration must not hide an otherwise safe diagnostic.
    }
    return diagnostic;
  } catch (_error) {
    return null;
  }
}

function errorResponse(error) {
  return {
    ok: false,
    // Exceptions from a failed media request can include signed CDN URLs,
    // credentials, or a local output path. Keep the message useful without
    // allowing this response path to bypass the diagnostic privacy boundary.
    error: redactDiagnosticText(String(error?.message || "Unknown error")),
    diagnostic: sanitizeForMessage(error.diagnostic || lastDiagnostic || null)
  };
}

function sanitizeForMessage(value) {
  if (!value) {
    return null;
  }

  try {
    return sanitizeDiagnosticValue(value);
  } catch (_error) {
    return sanitizeDiagnosticValue({
      phase: value.phase || "diagnostic-serialization-error",
      error: value.error || "Diagnostic could not be serialized.",
      context: value.context,
      request: value.request,
      latestItem: value.latestItem
    });
  }
}

function sanitizeDiagnosticValue(value, seen = new WeakSet(), key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (key && isSensitiveDiagnosticField(key)) {
    return "[Sensitive value redacted]";
  }

  if (typeof value === "string") {
    if (key === "filename") {
      return summarizeDiagnosticFilename(value);
    }
    if (isLocalDiagnosticPath(value)) {
      return isDiagnosticUrlField(key)
        ? summarizeUrl(value)
        : summarizeLocalDiagnosticPath(value);
    }
    if (isDiagnosticUrlField(key) && looksLikeDiagnosticUrl(value)) {
      return summarizeUrl(value);
    }
    return redactDiagnosticText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "bigint") {
    return String(value);
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (key === "blob" || (typeof Blob !== "undefined" && value instanceof Blob)) {
    return undefined;
  }

  if (seen.has(value)) {
    return "[Circular diagnostic value]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, seen));
  }

  const sanitized = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === "blob") {
      continue;
    }

    const child = sanitizeDiagnosticValue(childValue, seen, childKey);
    if (child !== undefined) {
      sanitized[childKey] = child;
    }
  }
  return sanitized;
}

function isDiagnosticUrlField(key) {
  return /url|uri|href|origin|referrer|referer|endpoint|redirect|location/i.test(String(key || "")) ||
    key === "media";
}

function isSensitiveDiagnosticField(key) {
  const normalized = String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return /token|secret|cookie|authorization|credential|session|password|passwd/.test(normalized) ||
    /(?:^|[_-])(?:sign(?:ature)?|csrf|(?:api|access)[_-]?key)(?:$|[_-])/.test(normalized);
}

function looksLikeDiagnosticUrl(value) {
  return /^(?:(?:https?|wss?):)?\/\//i.test(String(value || "").trim());
}

function isLocalDiagnosticPath(value) {
  const text = String(value || "").trim();
  return /^file:\/\//i.test(text) ||
    /^[a-z]:[\\/]/i.test(text) ||
    /^\\\\/.test(text) ||
    /^\/(?!\/)/.test(text);
}

function redactDiagnosticText(value) {
  return redactLocalPathsInText(
    redactSensitiveValuesInText(
      redactSignedUrlsInText(value)
    )
  );
}

function redactSensitiveValuesInText(value) {
  const sensitiveField = "(?:[\\w-]*(?:token|secret|cookie|authorization|credential|session|password|passwd)[\\w-]*|sign(?:ature)?|csrf|(?:api|access)[_-]?key)";
  const assignmentPattern = new RegExp(
    `((?:^|[\\s,;{(\\[?&])["']?${sensitiveField}["']?\\s*(?:=|:)\\s*(?:Bearer\\s+)?)` +
      `(?!\\[Sensitive value redacted\\])(?:"(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;}&\\])]+)`,
    "gi"
  );
  let redacted = String(value).replace(assignmentPattern, "$1[Sensitive value redacted]");
  redacted = redacted.replace(
    /(\b(?:set-)?cookie\s*:\s*)[^\r\n|]*/gi,
    "$1[Sensitive value redacted]"
  );
  return redacted.replace(
    /(\bBearer\s+)(?!\[Sensitive value redacted\])[A-Za-z0-9._~+\/-]+=*/gi,
    "$1[Sensitive value redacted]"
  );
}

function redactLocalPathsInText(value) {
  let redacted = String(value);
  redacted = redacted.replace(/file:\/\/[^\s"'<>`)\]}]+/gi, (match) => summarizeLocalDiagnosticPath(match));
  redacted = redacted.replace(
    /(^|[\s"'`([{=,:;])(?:[a-z]:[\\/]|\\\\)[^\s"'<>`)\]}]+/gi,
    (match, prefix) => `${prefix}${summarizeLocalDiagnosticPath(match.slice(prefix.length))}`
  );
  return redacted.replace(
    /(^|[\s"'`([{=,:;])\/(?!\/)[^\s"'<>`)\]}]+/g,
    (match, prefix) => `${prefix}${summarizeLocalDiagnosticPath(match.slice(prefix.length))}`
  );
}

function summarizeLocalDiagnosticPath(value) {
  const filename = summarizeDiagnosticFilename(value);
  return filename ? `[local path ${filename}]` : "[local path redacted]";
}

function redactSignedUrlsInText(value) {
  return String(value).replace(/(?:(?:https?|wss?):\/\/|\/\/)[^\s"'<>`]+/gi, (match) => {
    if (/[?#]\.\.\.$/.test(match)) {
      return match;
    }
    const summary = summarizeUrl(match);
    const parsed = parseDiagnosticUrl(match);
    if (!parsed) {
      return /[?#]/.test(match) ? "[URL redacted]" : match;
    }
    if (!parsed?.search && !parsed?.hash) {
      return match;
    }

    const suffix = parsed.search ? "?…" : "#…";
    return summary?.host
      ? `[URL ${summary.host}${summary.path}${suffix}]`
      : "[URL redacted]";
  });
}

function parseDiagnosticUrl(value) {
  const text = String(value || "").trim();
  if (!looksLikeDiagnosticUrl(text)) {
    return null;
  }

  try {
    return new URL(text.startsWith("//") ? `https:${text}` : text);
  } catch (_error) {
    return null;
  }
}

function pickDownloadDelta(delta) {
  return {
    id: delta.id,
    state: delta.state || null,
    error: sanitizeDiagnosticValue(delta.error, new WeakSet(), "error") || null,
    danger: sanitizeDiagnosticValue(delta.danger, new WeakSet(), "danger") || null,
    url: pickDownloadUrlDelta(delta.url),
    finalUrl: pickDownloadUrlDelta(delta.finalUrl),
    mime: delta.mime || null,
    filename: pickDownloadFilenameDelta(delta.filename),
    totalBytes: delta.totalBytes || null
  };
}

function pickDownloadUrlDelta(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return summarizeUrl(value);
  }

  return {
    previous: value.previous ? summarizeUrl(value.previous) : null,
    current: value.current ? summarizeUrl(value.current) : null
  };
}

function pickDownloadFilenameDelta(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return summarizeDiagnosticFilename(value);
  }

  return {
    previous: value.previous ? summarizeDiagnosticFilename(value.previous) : null,
    current: value.current ? summarizeDiagnosticFilename(value.current) : null
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
    filename: summarizeDiagnosticFilename(item.filename),
    mime: item.mime,
    state: item.state,
    error: redactDiagnosticText(String(item.error || "")),
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

  if (isLocalDiagnosticPath(value)) {
    return {
      host: "",
      path: "[local path redacted]",
      searchLength: 0,
      sample: summarizeLocalDiagnosticPath(value)
    };
  }

  const url = parseDiagnosticUrl(value);
  if (url) {
    return {
      host: url.host,
      path: url.pathname.slice(0, 180),
      searchLength: url.search.length,
      sample: `${url.origin}${url.pathname}${url.search ? "?..." : ""}`
    };
  }

  return {
    host: "",
    path: "",
    searchLength: 0,
    sample: "[unparseable URL]"
  };
}

function summarizeDiagnosticFilename(value) {
  const source = String(value || "").trim();
  let normalized = source.replace(/\\/g, "/");
  if (/^file:\/\//i.test(source)) {
    try {
      const url = new URL(source);
      normalized = url.protocol === "file:" ? url.pathname.replace(/\\/g, "/") : normalized;
    } catch (_error) {
      normalized = source.replace(/^file:\/\/(?:localhost)?/i, "").replace(/\\/g, "/");
    }
  }
  if (!/^(?:[a-z]:\/|\/)/i.test(normalized)) {
    return normalized.slice(0, 240);
  }
  return normalized.split("/").filter(Boolean).pop()?.slice(0, 180) || "";
}

function isMediaHost(value) {
  try {
    const host = new URL(value).host;
    return (
      host.endsWith("bilivideo.com") ||
      host.endsWith("bilivideo.cn") ||
      host.endsWith("hdslb.com") ||
      host.endsWith("edge.mountaintoys.cn")
    );
  } catch (_error) {
    return false;
  }
}
