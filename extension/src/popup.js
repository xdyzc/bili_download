const TEXT = {
  checking: "\u68c0\u67e5\u5f53\u524d\u9875\u9762...",
  loading: "\u6b63\u5728\u8bfb\u53d6\u89c6\u9891\u4fe1\u606f...",
  ready: "\u53ef\u9009\u62e9\u6e05\u6670\u5ea6\u4e0b\u8f7d",
  collectionReady: "\u68c0\u6d4b\u5230\u591a\u4e2a\u5206 P\uff0c\u53ef\u9009\u62e9\u8981\u4e0b\u8f7d\u7684\u5206 P",
  copied: "\u89c6\u9891 ID \u5df2\u590d\u5236",
  noVideo: "\u5f53\u524d\u9875\u9762\u4e0d\u662f\u652f\u6301\u7684 Bilibili \u89c6\u9891\u6216\u756a\u5267\u9875",
  liveReady: "\u68c0\u6d4b\u5230\u76f4\u64ad\u95f4\uff0c\u53ef\u5f00\u59cb\u5f55\u5236",
  liveOffline: "\u5f53\u524d\u76f4\u64ad\u95f4\u672a\u5f00\u64ad",
  liveRecording: "\u6b63\u5728\u5f55\u5236\u76f4\u64ad...",
  liveStopping: "\u6b63\u5728\u7ed3\u675f\u5f55\u5236...",
  liveRecorded: "\u76f4\u64ad\u5f55\u5236\u5df2\u4fdd\u5b58",
  noQuality: "\u6ca1\u6709\u53ef\u7528\u6e05\u6670\u5ea6",
  qualityUnavailable: "\u8be5\u6e05\u6670\u5ea6\u9700\u8981 Cookie \u767b\u5f55\u540e\u624d\u80fd\u4e0b\u8f7d",
  noSelectedPages: "\u8bf7\u5148\u9009\u62e9\u8981\u4e0b\u8f7d\u7684\u5206 P",
  downloading: "\u6b63\u5728\u8bf7\u6c42\u89c6\u9891\u6587\u4ef6...",
  downloadingAudio: "\u6b63\u5728\u8bf7\u6c42\u97f3\u9891\u6587\u4ef6...",
  downloadingPages: "\u6b63\u5728\u4e0b\u8f7d\u9009\u4e2d\u5206 P...",
  downloadingPageAudio: "\u6b63\u5728\u4e0b\u8f7d\u9009\u4e2d\u97f3\u9891...",
  pagesDownloaded: "\u5df2\u4e0b\u8f7d\u9009\u4e2d\u5206 P",
  audioDownloaded: "\u97f3\u9891\u5df2\u4e0b\u8f7d",
  pageAudioDownloaded: "\u5df2\u4e0b\u8f7d\u9009\u4e2d\u97f3\u9891",
  muxing: "\u6b63\u5728\u5408\u5e76 MP4...",
  downloadStarted: "\u4e0b\u8f7d\u5df2\u5f00\u59cb",
  downloadCompleted: "\u4e0b\u8f7d\u5df2\u5b8c\u6210",
  dashMuxed: "DASH \u5df2\u5408\u5e76\u4e3a MP4",
  diagnosticCopied: "\u8bca\u65ad\u4fe1\u606f\u5df2\u590d\u5236",
  noDiagnostic: "\u6682\u65e0\u8bca\u65ad\u4fe1\u606f",
  paused: "\u5df2\u6682\u505c\u4e0b\u8f7d",
  resumed: "\u7ee7\u7eed\u4e0b\u8f7d...",
  canceling: "\u6b63\u5728\u53d6\u6d88\u4e0b\u8f7d...",
  canceled: "\u5df2\u53d6\u6d88\u4e0b\u8f7d"
};

const PROGRESS_MESSAGE_TYPE = "BILI_DOWNLOAD_PAGE_PROGRESS";
const PROGRESS_PORT_NAME = "BILI_DOWNLOAD_PROGRESS_PORT";
const PAGE_DOWNLOAD_CONTROL_EVENT = "bili-download-control";
const PARALLEL_RANGE_MIN_BYTES = 8 * 1024 * 1024;
const PARALLEL_RANGE_CHUNK_BYTES = 4 * 1024 * 1024;
const PARALLEL_RANGE_CONCURRENCY = 4;
const MEBIBYTE = 1024 * 1024;
const SAFETY_SETTINGS_STORAGE_KEY = "downloadSafetySettings";
const COMPANION_SETTINGS_STORAGE_KEY = "streamCompanionSettings";
const DIRECT_TASK_REFRESH_INTERVAL_MS = 2500;
const BATCH_TASK_REFRESH_INTERVAL_MS = 4000;
const COMPANION_TASK_REFRESH_INTERVAL_MS = 2500;
const DASH_MUX_MEMORY_MULTIPLIER = 3;
const LIVE_RECORDING_MEMORY_MULTIPLIER = 3;
const SAFETY_SETTINGS_DEFAULTS = Object.freeze({
  dashMaxFileMb: 512,
  dashMaxMemoryMb: 1536,
  liveMaxDurationMinutes: 120,
  liveMaxFileMb: 1024,
  liveMaxMemoryMb: 1536
});
const SAFETY_SETTINGS_BOUNDS = Object.freeze({
  dashMaxFileMb: { min: 16, max: 4096 },
  dashMaxMemoryMb: { min: 128, max: 8192 },
  liveMaxDurationMinutes: { min: 1, max: 720 },
  liveMaxFileMb: { min: 16, max: 4096 },
  liveMaxMemoryMb: { min: 32, max: 8192 }
});
const COMPANION_SETTINGS_DEFAULTS = Object.freeze({
  preferDash: false,
  preferLive: false
});

const state = {
  tabId: null,
  page: {
    type: "",
    bvid: "",
    seasonId: null,
    epId: null,
    roomId: null,
    title: "",
    url: ""
  },
  video: null,
  live: null,
  account: null,
  lastDiagnostic: null,
  progress: {
    active: false,
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
    startedAt: 0,
    lastAt: 0,
    segmentIndex: 0,
    segmentCount: 0,
    candidateIndex: 0,
    candidateCount: 0
  },
  busy: false,
  downloadControl: null,
  nativeDirectTasks: new Map(),
  nativeDirectTaskWaiters: new Map(),
  companionTasks: new Map(),
  companionTaskWaiters: new Map(),
  companionStatus: "unknown",
  companionSettings: normalizeCompanionSettings(COMPANION_SETTINGS_DEFAULTS),
  batchJobs: new Map(),
  batchJobWaiters: new Map(),
  batchRunPromise: null,
  batchResumeTimer: null,
  taskCenterLoading: false,
  taskCenterRefreshTimer: null,
  activeView: "main",
  refreshGeneration: 0,
  pagePickerOpen: false,
  selectedPageCids: null,
  safetySettings: normalizeSafetySettings(SAFETY_SETTINGS_DEFAULTS)
};

const mainView = document.querySelector("#main-view");
const settingsView = document.querySelector("#settings-view");
const viewTitleElement = document.querySelector("#view-title");
const settingsOpenButton = document.querySelector("#settings-open");
const settingsBackButton = document.querySelector("#settings-back");
const statusElement = document.querySelector("#status");
const accountElement = document.querySelector("#account");
const bvidInput = document.querySelector("#bvid");
const titleInput = document.querySelector("#title");
const qualitySelect = document.querySelector("#quality");
const qualitySizeElement = document.querySelector("#quality-size");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const downloadAudioButton = document.querySelector("#download-audio");
const liveRecordButton = document.querySelector("#live-record");
const pagePickerToggle = document.querySelector("#page-picker-toggle");
const pagePicker = document.querySelector("#page-picker");
const pageList = document.querySelector("#page-list");
const pageSelectAllButton = document.querySelector("#page-select-all");
const downloadSelectedPagesButton = document.querySelector("#download-selected-pages");
const downloadSelectedPageAudioButton = document.querySelector("#download-selected-page-audio");
const diagnosticButton = document.querySelector("#diagnostic");
const progressPanel = document.querySelector("#progress");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressSize = document.querySelector("#progress-size");
const progressSpeed = document.querySelector("#progress-speed");
const downloadControls = document.querySelector("#download-controls");
const pauseButton = document.querySelector("#pause");
const cancelButton = document.querySelector("#cancel");
const dashMaxFileInput = document.querySelector("#dash-max-file-mb");
const dashMaxMemoryInput = document.querySelector("#dash-max-memory-mb");
const liveMaxDurationInput = document.querySelector("#live-max-duration-minutes");
const liveMaxFileInput = document.querySelector("#live-max-file-mb");
const liveMaxMemoryInput = document.querySelector("#live-max-memory-mb");
const safetySettingsSummary = document.querySelector("#safety-settings-summary");
const safetySaveButton = document.querySelector("#safety-save");
const companionStatusElement = document.querySelector("#companion-status");
const companionCheckButton = document.querySelector("#companion-check");
const companionPreferDashInput = document.querySelector("#companion-prefer-dash");
const companionPreferLiveInput = document.querySelector("#companion-prefer-live");
const companionSaveButton = document.querySelector("#companion-save");
const taskCenter = document.querySelector("#task-center");
const taskCenterRefreshButton = document.querySelector("#task-center-refresh");
const taskCenterNote = document.querySelector("#task-center-note");
const taskList = document.querySelector("#task-list");

document.addEventListener("DOMContentLoaded", initialize);
settingsOpenButton?.addEventListener("click", showSettingsView);
settingsBackButton?.addEventListener("click", showMainView);
copyButton?.addEventListener("click", copyBvid);
downloadButton?.addEventListener("click", downloadSelectedQuality);
downloadAudioButton?.addEventListener("click", downloadCurrentAudio);
liveRecordButton?.addEventListener("click", toggleLiveRecording);
pagePickerToggle?.addEventListener("click", togglePagePicker);
pageSelectAllButton?.addEventListener("click", toggleAllPages);
downloadSelectedPagesButton?.addEventListener("click", downloadSelectedPages);
downloadSelectedPageAudioButton?.addEventListener("click", downloadSelectedPageAudio);
diagnosticButton?.addEventListener("click", copyDiagnostic);
qualitySelect.addEventListener?.("change", () => {
  updateQualitySize();
  updateControls();
});
pauseButton?.addEventListener("click", togglePauseDownload);
cancelButton?.addEventListener("click", cancelDownload);
safetySaveButton?.addEventListener("click", saveSafetySettings);
companionCheckButton?.addEventListener("click", () => {
  checkStreamingCompanion({ userInitiated: true }).catch(() => {});
});
companionSaveButton?.addEventListener("click", saveCompanionSettings);
taskCenterRefreshButton?.addEventListener("click", () => {
  refreshTaskCenter({ resumeBatch: false }).catch(() => {});
});
for (const input of [dashMaxFileInput, dashMaxMemoryInput, liveMaxDurationInput, liveMaxFileInput, liveMaxMemoryInput]) {
  input?.addEventListener("input", renderSafetySettingsSummary);
}
const progressPort = chrome.runtime.connect({ name: PROGRESS_PORT_NAME });
progressPort.onMessage.addListener((message) => {
  if (message?.type !== PROGRESS_MESSAGE_TYPE) {
    return;
  }

  const payload = message.payload || {};
  const payloadTabId = Number(payload.tabId) || 0;
  if (state.tabId && (payload.nativeDownload || payload.companionDownload) && payloadTabId !== Number(state.tabId)) {
    return;
  }
  if (payloadTabId && state.tabId && payloadTabId !== Number(state.tabId)) {
    return;
  }

  const directTask = receiveNativeDirectTaskProgress(payload);
  const companionTask = receiveCompanionTaskProgress(payload);
  const belongsToCurrentControl = payload.nativeDownload
    ? state.downloadControl?.nativeTaskId === directTask?.taskId
    : payload.companionDownload
      ? state.downloadControl?.companionTaskId === companionTask?.taskId
      : true;
  if (belongsToCurrentControl) {
    updateProgress(payload);
  }
});
chrome.tabs?.onActivated?.addListener(() => {
  if (!state.downloadControl) {
    refreshFromActiveTab({ force: true });
  }
});
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (tabId !== state.tabId || !changeInfo.url || state.downloadControl) {
    return;
  }
  refreshFromActiveTab({ force: true });
});

async function initialize() {
  renderActiveView();
  await Promise.all([loadSafetySettings(), loadCompanionSettings()]);
  await refreshFromActiveTab({ force: true });
}

function showSettingsView() {
  state.activeView = "settings";
  renderActiveView();
  refreshTaskCenter({ resumeBatch: false, silent: true }).catch(() => {});
  settingsBackButton?.focus?.();
}

function showMainView() {
  state.activeView = "main";
  renderActiveView();
  settingsOpenButton?.focus?.();
}

function renderActiveView() {
  const showSettings = state.activeView === "settings";
  if (mainView) {
    mainView.hidden = showSettings;
  }
  if (settingsView) {
    settingsView.hidden = !showSettings;
  }
  if (settingsOpenButton) {
    settingsOpenButton.hidden = showSettings;
  }
  if (settingsBackButton) {
    settingsBackButton.hidden = !showSettings;
  }
  if (viewTitleElement) {
    viewTitleElement.textContent = showSettings ? "任务与设置" : "Bili Download";
  }
}

async function loadSafetySettings() {
  let stored = null;
  try {
    stored = await chrome.storage?.local?.get(SAFETY_SETTINGS_STORAGE_KEY);
  } catch (_error) {
    // Keep the conservative defaults when extension storage is unavailable.
  }
  state.safetySettings = normalizeSafetySettings(stored?.[SAFETY_SETTINGS_STORAGE_KEY]);
  renderSafetySettings();
}

async function saveSafetySettings() {
  state.safetySettings = normalizeSafetySettings(readSafetySettingsInputs());
  renderSafetySettings();
  try {
    await chrome.storage?.local?.set({
      [SAFETY_SETTINGS_STORAGE_KEY]: state.safetySettings
    });
    setStatus("已保存内存与录制保护设置");
  } catch (_error) {
    setStatus("保护设置已生效，但未能保存到浏览器");
  }
}

async function loadCompanionSettings() {
  let stored = null;
  try {
    stored = await chrome.storage?.local?.get(COMPANION_SETTINGS_STORAGE_KEY);
  } catch (_error) {
    // The browser downloader remains available with the conservative defaults.
  }
  state.companionSettings = normalizeCompanionSettings(stored?.[COMPANION_SETTINGS_STORAGE_KEY]);
  renderCompanionSettings();
}

async function saveCompanionSettings() {
  state.companionSettings = normalizeCompanionSettings(readCompanionSettingsInputs());
  renderCompanionSettings();
  try {
    await chrome.storage?.local?.set({
      [COMPANION_SETTINGS_STORAGE_KEY]: state.companionSettings
    });
    setStatus("本地流式助手偏好已保存");
  } catch (_error) {
    setStatus("本地流式助手偏好已生效，但未能保存到浏览器");
  }
}

function normalizeCompanionSettings(value) {
  const source = value || {};
  return {
    preferDash: Boolean(source.preferDash),
    preferLive: Boolean(source.preferLive)
  };
}

function readCompanionSettingsInputs() {
  return {
    preferDash: Boolean(companionPreferDashInput?.checked),
    preferLive: Boolean(companionPreferLiveInput?.checked)
  };
}

function renderCompanionSettings() {
  if (companionPreferDashInput) {
    companionPreferDashInput.checked = Boolean(state.companionSettings.preferDash);
  }
  if (companionPreferLiveInput) {
    companionPreferLiveInput.checked = Boolean(state.companionSettings.preferLive);
  }
  renderCompanionStatus();
}

function renderCompanionStatus() {
  if (!companionStatusElement) {
    return;
  }
  const status = String(state.companionStatus || "unknown");
  const labels = {
    unknown: "尚未检测",
    checking: "正在检测…",
    available: "已连接，可用于流式落盘",
    unavailable: "未检测到已注册的本地助手"
  };
  companionStatusElement.dataset.state = status;
  companionStatusElement.textContent = labels[status] || labels.unknown;
  if (companionCheckButton) {
    companionCheckButton.disabled = status === "checking";
  }
}

async function checkStreamingCompanion(options = {}) {
  if (state.companionStatus === "checking") {
    return false;
  }
  state.companionStatus = "checking";
  renderCompanionStatus();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_COMPANION_PING"
    });
    if (!response?.ok) {
      throw new Error(response?.error || "Native companion was not available.");
    }
    state.companionStatus = "available";
    renderCompanionStatus();
    if (options.userInitiated) {
      setStatus("本地流式助手已连接");
    }
    return true;
  } catch (_error) {
    state.companionStatus = "unavailable";
    renderCompanionStatus();
    if (options.userInitiated) {
      setStatus("未检测到本地流式助手；请按 README 构建并注册后重试");
    }
    return false;
  }
}

async function ensureStreamingCompanionAvailable() {
  return state.companionStatus === "available"
    ? true
    : checkStreamingCompanion();
}

function normalizeSafetySettings(value) {
  const source = value || {};
  return Object.fromEntries(Object.entries(SAFETY_SETTINGS_DEFAULTS).map(([key, fallback]) => {
    const bounds = SAFETY_SETTINGS_BOUNDS[key];
    const numeric = Number(source[key]);
    const normalized = Number.isFinite(numeric)
      ? Math.min(Math.max(Math.round(numeric), bounds.min), bounds.max)
      : fallback;
    return [key, normalized];
  }));
}

function readSafetySettingsInputs() {
  return {
    dashMaxFileMb: dashMaxFileInput?.value,
    dashMaxMemoryMb: dashMaxMemoryInput?.value,
    liveMaxDurationMinutes: liveMaxDurationInput?.value,
    liveMaxFileMb: liveMaxFileInput?.value,
    liveMaxMemoryMb: liveMaxMemoryInput?.value
  };
}

function renderSafetySettings() {
  const settings = state.safetySettings;
  if (dashMaxFileInput) {
    dashMaxFileInput.value = String(settings.dashMaxFileMb);
  }
  if (dashMaxMemoryInput) {
    dashMaxMemoryInput.value = String(settings.dashMaxMemoryMb);
  }
  if (liveMaxDurationInput) {
    liveMaxDurationInput.value = String(settings.liveMaxDurationMinutes);
  }
  if (liveMaxFileInput) {
    liveMaxFileInput.value = String(settings.liveMaxFileMb);
  }
  if (liveMaxMemoryInput) {
    liveMaxMemoryInput.value = String(settings.liveMaxMemoryMb);
  }
  renderSafetySettingsSummary();
}

function renderSafetySettingsSummary() {
  if (!safetySettingsSummary) {
    return;
  }
  const settings = normalizeSafetySettings(readSafetySettingsInputs());
  const dashLimits = getDashSafetyLimits(settings);
  const liveLimits = getLiveSafetyLimits(settings);
  safetySettingsSummary.textContent = `实际缓冲上限：DASH ${formatBytes(dashLimits.maxInputBytes)} · 直播 ${formatBytes(liveLimits.maxBytes)}。达到时长或大小上限时自动停止。`;
}

function getDashSafetyLimits(settings = state.safetySettings) {
  const normalized = normalizeSafetySettings(settings);
  const maxFileBytes = normalized.dashMaxFileMb * MEBIBYTE;
  const maxMemoryBytes = normalized.dashMaxMemoryMb * MEBIBYTE;
  return {
    maxFileBytes,
    maxMemoryBytes,
    maxInputBytes: Math.min(maxFileBytes, Math.floor(maxMemoryBytes / DASH_MUX_MEMORY_MULTIPLIER))
  };
}

function getLiveSafetyLimits(settings = state.safetySettings) {
  const normalized = normalizeSafetySettings(settings);
  const maxFileBytes = normalized.liveMaxFileMb * MEBIBYTE;
  const maxMemoryBytes = normalized.liveMaxMemoryMb * MEBIBYTE;
  return {
    maxFileBytes,
    maxMemoryBytes,
    maxBytes: Math.min(maxFileBytes, Math.floor(maxMemoryBytes / LIVE_RECORDING_MEMORY_MULTIPLIER)),
    maxDurationMs: normalized.liveMaxDurationMinutes * 60 * 1000
  };
}

function knownSegmentSize(segment) {
  const directSize = normalizeMediaLimitBytes(segment?.size);
  if (directSize) {
    return directSize;
  }
  return normalizeMediaLimitBytes(readCandidates(segment)[0]?.size);
}

function assertDashInputWithinSafetyLimits(inputBytes, safety, phase) {
  const bytes = normalizeMediaLimitBytes(inputBytes);
  if (!bytes) {
    return;
  }
  if (bytes > safety.maxFileBytes) {
    throw createMediaSafetyLimitError(
      `DASH ${phase}媒体为 ${formatBytes(bytes)}，超过设置的 DASH 文件上限 ${formatBytes(safety.maxFileBytes)}；为防止浏览器内存耗尽，未开始合并。请降低清晰度，或在“内存与录制保护”中调高上限。`
    );
  }
  if (bytes > safety.maxInputBytes) {
    throw dashSafetyLimitError(safety, bytes, phase);
  }
}

function dashSafetyLimitError(safety, bytes, phase) {
  return createMediaSafetyLimitError(dashSafetyLimitMessage(safety, bytes, phase));
}

function dashSafetyLimitMessage(safety, bytes = 0, phase = "下载") {
  const memoryBound = safety.maxInputBytes < safety.maxFileBytes;
  const limitLabel = memoryBound
    ? `DASH 内存预算 ${formatBytes(safety.maxMemoryBytes)}（合并峰值按约 ${DASH_MUX_MEMORY_MULTIPLIER} 倍估算）`
    : `DASH 文件上限 ${formatBytes(safety.maxFileBytes)}`;
  const measured = normalizeMediaLimitBytes(bytes);
  return `DASH ${phase}${measured ? `媒体为 ${formatBytes(measured)}，` : ""}超过${limitLabel}对应的安全缓冲上限 ${formatBytes(safety.maxInputBytes)}；已停止且未保存该文件。请降低清晰度，或在“内存与录制保护”中调高上限。`;
}

function normalizeMediaLimitBytes(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

function createMediaSafetyLimitError(message) {
  const error = new Error(message);
  error.name = "MediaSafetyLimitError";
  error.safetyLimit = true;
  return error;
}

function isMediaSafetyLimitError(error) {
  return error?.name === "MediaSafetyLimitError" || error?.safetyLimit === true;
}

function liveRecordingResultStatus(diagnostic, fallbackFilename = "") {
  const saved = diagnostic?.saved || {};
  const savedToDisk = saved.savedToDisk === true && Number(saved.size) > 0;
  if (!savedToDisk) {
    return saved.stopReason === "duration" || saved.stopReason === "size"
      ? "已达到直播录制安全上限，但尚未接收到直播数据，未保存文件"
      : "已停止直播录制，未保存文件（尚未接收到直播数据）";
  }
  const filename = filenameForPageDownload(saved.filename || fallbackFilename);
  if (saved.stopReason === "duration" || saved.stopReason === "size") {
    return `已达到直播录制安全上限，已自动停止并保存已录制部分: ${filename}`;
  }
  return `${TEXT.liveRecorded}: ${filename}`;
}

async function refreshFromActiveTab(options = {}) {
  if (state.busy && !options.force) {
    return;
  }

  const generation = state.refreshGeneration + 1;
  state.refreshGeneration = generation;
  setBusy(true);
  setStatus(TEXT.checking);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (generation !== state.refreshGeneration) {
      return;
    }
    const tabId = tab?.id || null;
    const page = await readPage(tab);
    if (generation !== state.refreshGeneration) {
      return;
    }
    page.tabId = tabId;
    state.tabId = tabId;
    state.page = page;
    await loadLastDiagnostic();
    if (generation !== state.refreshGeneration) {
      return;
    }
    await refreshTaskCenter({ resumeBatch: true, silent: true });
    if (generation !== state.refreshGeneration) {
      return;
    }

    if (!hasSupportedPageId(state.page)) {
      setStatus(TEXT.noVideo);
      render();
      return;
    }

    if (state.page.type === "live") {
      await loadLiveFromPage();
      return;
    }

    setStatus(TEXT.loading);
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_LOAD_VIDEO",
      payload: state.page
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load video.");
    }
    if (generation !== state.refreshGeneration) {
      return;
    }

    state.video = response.payload;
    state.live = null;
    state.account = response.payload.account || null;
    state.page.type = state.video.source || state.page.type || "video";
    state.page.bvid = state.video.bvid;
    state.page.seasonId = state.video.seasonId || state.page.seasonId || null;
    state.page.epId = state.video.epId || state.page.epId || null;
    state.page.title = state.video.title;
    state.selectedPageCids = null;
    render();
    setStatus(videoHasAvailableQuality(state.video)
      ? (videoHasMultiplePages(state.video) ? TEXT.collectionReady : TEXT.ready)
      : TEXT.noQuality);
  } catch (error) {
    if (generation === state.refreshGeneration) {
      setStatus(error.message);
      render();
    }
  } finally {
    if (generation === state.refreshGeneration) {
      setBusy(false);
    }
  }
}

async function readPage(tab) {
  const fromUrl = {
    type: pageTypeFromUrl(tab?.url || ""),
    bvid: extractBvid(tab?.url || ""),
    seasonId: extractSeasonId(tab?.url || ""),
    epId: extractEpId(tab?.url || ""),
    roomId: extractLiveRoomId(tab?.url || ""),
    title: tab?.title || "",
    url: tab?.url || "",
    tabId: tab?.id || null
  };

  if (!tab?.id || !isSupportedBilibiliUrl(tab.url)) {
    return fromUrl;
  }

  try {
    const page = await chrome.tabs.sendMessage(tab.id, {
      type: "BILI_DOWNLOAD_GET_PAGE"
    });
    return {
      type: page?.type || fromUrl.type,
      bvid: page?.bvid || fromUrl.bvid,
      seasonId: page?.seasonId || fromUrl.seasonId,
      epId: page?.epId || fromUrl.epId,
      roomId: page?.roomId || fromUrl.roomId,
      title: page?.title || fromUrl.title,
      url: page?.url || fromUrl.url,
      tabId: fromUrl.tabId
    };
  } catch (_error) {
    return fromUrl;
  }
}

function render() {
  bvidInput.value = displayPageId(state.page);
  titleInput.value = state.page.title;
  renderAccount();
  renderQualities();
  renderPages();
  renderMode();
  updateControls();
}

function renderMode() {
  const isLive = state.page.type === "live";
  setElementHidden(downloadButton, isLive);
  setElementHidden(downloadAudioButton, isLive);
  setElementHidden(liveRecordButton, !isLive);
  setElementHidden(qualitySelect, false);
  setElementHidden(qualitySizeElement, isLive);
  const qualityLabel = document.querySelector?.("label[for=\"quality\"]");
  setElementHidden(qualityLabel, false);
}

function setElementHidden(element, hidden) {
  if (element) {
    element.hidden = Boolean(hidden);
  }
}

function renderAccount() {
  if (!accountElement) {
    return;
  }

  const account = state.account;
  if (!account) {
    accountElement.textContent = "\u672a\u9a8c\u8bc1";
    return;
  }

  if (account.isLogin) {
    const vip = account.vipLabel ? ` - ${account.vipLabel}` : "";
    accountElement.textContent = `${account.username || "\u5df2\u767b\u5f55"}${vip}`;
    return;
  }

  accountElement.textContent = account.error ? "\u9a8c\u8bc1\u5931\u8d25" : "\u672a\u767b\u5f55";
}

function renderQualities() {
  qualitySelect.replaceChildren();
  const qualitySource = currentQualitySource();
  const qualities = qualitySource?.qualities || [];
  const selectedCode = Number(qualitySelect.value) || qualitySource?.currentQuality;

  for (const quality of qualities) {
    const option = document.createElement("option");
    option.value = String(quality.code);
    option.textContent = displayQualityLabel(quality);
    option.disabled = quality.available === false;
    if (quality.code === selectedCode) {
      option.selected = true;
    }
    qualitySelect.append(option);
  }

  const selected = selectedQualityOption();
  if (!selected || selected.disabled) {
    const firstAvailable = Array.from(qualitySelect.children).find((option) => !option.disabled);
    if (firstAvailable) {
      qualitySelect.value = firstAvailable.value;
    }
  }

  updateQualitySize();
}

function displayQualityLabel(quality) {
  const parts = [quality.label || String(quality.code || "")];

  if (quality.available !== false) {
    return parts.filter(Boolean).join(" · ");
  }

  const suffix = quality.reason === "login-required"
    ? "\u9700\u8981 Cookie"
    : quality.reason === "vip-required"
      ? "\u9700\u8981\u5927\u4f1a\u5458"
      : "\u5f53\u524d\u4e0d\u53ef\u7528";
  parts.push(suffix);
  return parts.filter(Boolean).join(" · ");
}

function updateQualitySize() {
  if (!qualitySizeElement) {
    return;
  }

  if (state.page.type === "live") {
    qualitySizeElement.textContent = "预计大小：直播录制无固定大小";
    return;
  }

  const quality = selectedQualityData();
  if (!quality) {
    qualitySizeElement.textContent = "\u9884\u8ba1\u5927\u5c0f\uff1a--";
    return;
  }

  if (quality.available === false) {
    qualitySizeElement.textContent = `\u9884\u8ba1\u5927\u5c0f\uff1a${unavailableQualityText(quality)}`;
    return;
  }

  const size = formatQualitySize(quality) || "--";
  const mode = quality.mode === "dash"
    ? "\u89c6\u9891+\u97f3\u9891\uff0c\u4e0b\u8f7d\u540e\u5408\u5e76"
    : quality.mode === "direct"
      ? "\u5355\u6587\u4ef6"
      : "";
  qualitySizeElement.textContent = `\u9884\u8ba1\u5927\u5c0f\uff1a${size}${mode ? `\uff08${mode}\uff09` : ""}`;
}

function selectedQualityData() {
  const selectedCode = Number(qualitySelect.value);
  return (currentQualitySource()?.qualities || []).find((quality) => Number(quality.code) === selectedCode) || null;
}

function currentQualitySource() {
  return state.page.type === "live" ? state.live : state.video;
}

function formatQualitySize(quality) {
  const size = Number(quality?.estimatedSize) || 0;
  if (size <= 0) {
    return "";
  }

  const prefix = quality?.estimatedSizeApproximate ? "\u7ea6 " : "";
  return `${prefix}${formatBytes(size)}`;
}

function unavailableQualityText(quality) {
  if (quality.reason === "login-required") {
    return "\u9700 Cookie \u540e\u83b7\u53d6";
  }
  if (quality.reason === "vip-required") {
    return "\u9700\u5927\u4f1a\u5458\u540e\u83b7\u53d6";
  }
  return "\u5f53\u524d\u4e0d\u53ef\u7528";
}

function renderPages() {
  if (!pagePicker || !pageList || !pagePickerToggle) {
    return;
  }

  const pages = state.video?.pages || [];
  const hasMultiplePages = pages.length > 1;
  const selectedCids = state.selectedPageCids;
  pagePickerToggle.hidden = !hasMultiplePages;
  pagePicker.hidden = !hasMultiplePages || !state.pagePickerOpen;
  pageList.replaceChildren();

  if (!hasMultiplePages) {
    return;
  }

  for (const page of pages) {
    const row = document.createElement("label");
    row.className = "page-option";
    row.title = page.title || "";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = String(page.cid);
    checkbox.dataset.pageIndex = String(page.index);
    checkbox.checked = selectedCids
      ? selectedCids.has(Number(page.cid))
      : Number(page.cid) === Number(state.video.page?.cid);
    checkbox.addEventListener?.("change", () => {
      syncSelectedPageCids();
      updateControls();
    });

    const index = document.createElement("span");
    index.className = "page-index";
    index.textContent = `P${String(page.index).padStart(2, "0")}`;

    const title = document.createElement("span");
    title.className = "page-title";
    title.textContent = page.title || `P${page.index}`;

    row.append(checkbox, index, title);
    pageList.append(row);
  }

  updatePageSelectionAction();
}

function togglePagePicker() {
  state.pagePickerOpen = !state.pagePickerOpen;
  renderPages();
  updateControls();
}

function toggleAllPages() {
  const checkboxes = pageCheckboxes();
  const shouldSelectAll = checkboxes.some((checkbox) => !checkbox.checked);
  for (const checkbox of checkboxes) {
    checkbox.checked = shouldSelectAll;
  }
  syncSelectedPageCids();
  updatePageSelectionAction();
  updateControls();
}

function updatePageSelectionAction() {
  if (!pageSelectAllButton) {
    return;
  }
  const checkboxes = pageCheckboxes();
  const allSelected = Boolean(checkboxes.length) && checkboxes.every((checkbox) => checkbox.checked);
  pageSelectAllButton.textContent = allSelected ? "\u6e05\u7a7a" : "\u5168\u9009";
}

function pageCheckboxes() {
  return pageList && typeof pageList.querySelectorAll === "function"
    ? Array.from(pageList.querySelectorAll("input[type=\"checkbox\"]"))
    : [];
}

function selectedPages() {
  const selectedCids = new Set(pageCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => Number(checkbox.value)));
  return (state.video?.pages || []).filter((page) => selectedCids.has(Number(page.cid)));
}

function syncSelectedPageCids() {
  state.selectedPageCids = new Set(pageCheckboxes()
    .filter((checkbox) => checkbox.checked)
    .map((checkbox) => Number(checkbox.value)));
}

async function copyBvid() {
  const pageId = displayPageId(state.page);
  if (!pageId) {
    return;
  }

  await navigator.clipboard.writeText(pageId);
  setStatus(TEXT.copied);
}

async function downloadSelectedQuality() {
  if (!state.video || !qualitySelect.value) {
    return;
  }

  if (!selectedQualityAvailable()) {
    setStatus(TEXT.qualityUnavailable);
    updateControls();
    return;
  }

  const control = createDownloadControl();
  state.downloadControl = control;
  setBusy(true);
  resetProgress();
  setStatus(TEXT.downloading);

  try {
    const prepared = await preparePageDownload({
      ...state.video.page
    }, Number(qualitySelect.value), state.video.title);
    const result = await downloadPreparedPayload(prepared);
    if (prepared.mode === "durl") {
      setStatus(`${TEXT.downloadCompleted}: ${result?.completedCount || prepared.count}`);
    } else if (prepared.mode !== "dash") {
      setStatus(`${TEXT.downloadStarted}: ${prepared.count}`);
    }
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      setStatus(TEXT.canceled);
      return;
    }
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
    }
    setBusy(false);
  }
}

async function loadLiveFromPage() {
  setStatus(TEXT.loading);
  const response = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_LOAD_LIVE",
    payload: state.page
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to load live room.");
  }

  state.video = null;
  state.live = response.payload;
  state.account = response.payload.account || null;
  state.page.type = "live";
  state.page.roomId = state.live.roomId;
  state.page.title = state.live.title;
  state.selectedPageCids = null;
  render();
  setStatus(state.live.liveStatus === 1
    ? (qualityDataHasAvailable(state.live) ? TEXT.liveReady : TEXT.noQuality)
    : TEXT.liveOffline);
}

async function downloadCurrentAudio() {
  if (!state.video) {
    return;
  }

  const control = createDownloadControl();
  state.downloadControl = control;
  setBusy(true);
  resetProgress();
  setStatus(TEXT.downloadingAudio);

  try {
    const prepared = await prepareAudioDownload({
      ...state.video.page
    }, audioDownloadTitle(state.video.title, state.video.page));
    await downloadPreparedPayload(prepared, TEXT.downloadingAudio);
    setStatus(`${TEXT.audioDownloaded}: ${prepared.count}`);
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      setStatus(TEXT.canceled);
      return;
    }
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
    }
    setBusy(false);
  }
}

async function downloadSelectedPages() {
  if (!state.video || !qualitySelect.value) {
    return;
  }

  if (!selectedQualityAvailable()) {
    setStatus(TEXT.qualityUnavailable);
    updateControls();
    return;
  }

  const pages = selectedPages();
  if (!pages.length) {
    setStatus(TEXT.noSelectedPages);
    updateControls();
    return;
  }

  const control = createDownloadControl();
  state.downloadControl = control;
  setBusy(true);
  resetProgress();
  setStatus(TEXT.downloadingPages);

  try {
    const quality = Number(qualitySelect.value);
    const job = await createBatchJob(
      pages.map((page) => pageBatchItem(page, quality, "video")),
      { title: `${state.video.title}（多分 P 视频）` }
    );
    control.batchJobId = job.jobId;
    await resumeBatchJob(job.jobId, { userInitiated: true });
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      setStatus(TEXT.canceled);
      return;
    }
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
    }
    setBusy(false);
  }
}

async function downloadSelectedPageAudio() {
  if (!state.video) {
    return;
  }

  const pages = selectedPages();
  if (!pages.length) {
    setStatus(TEXT.noSelectedPages);
    updateControls();
    return;
  }

  const control = createDownloadControl();
  state.downloadControl = control;
  setBusy(true);
  resetProgress();
  setStatus(TEXT.downloadingPageAudio);

  try {
    const job = await createBatchJob(
      pages.map((page) => pageBatchItem(page, 0, "audio")),
      { title: `${state.video.title}（多分 P 音频）` }
    );
    control.batchJobId = job.jobId;
    await resumeBatchJob(job.jobId, { userInitiated: true });
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      setStatus(TEXT.canceled);
      return;
    }
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
    }
    setBusy(false);
  }
}

async function toggleLiveRecording() {
  if (state.downloadControl?.liveRecording) {
    stopLiveRecording();
    return;
  }

  await startLiveRecording();
}

async function startLiveRecording() {
  if (!state.live?.roomId) {
    return;
  }
  if (state.live.liveStatus !== 1) {
    setStatus(TEXT.liveOffline);
    return;
  }
  if (!selectedQualityAvailable()) {
    setStatus(TEXT.qualityUnavailable);
    updateControls();
    return;
  }

  const control = createDownloadControl();
  control.liveRecording = true;
  control.liveStartedAt = 0;
  control.liveDeadlineAt = 0;
  state.downloadControl = control;
  resetProgress();
  setStatus(TEXT.liveRecording);
  updateControls();

  let prepared = null;
  let usedCompanion = false;
  try {
    prepared = await prepareLiveRecording();
    if (state.companionSettings.preferLive && await ensureStreamingCompanionAvailable()) {
      usedCompanion = true;
      const task = await downloadPreparedCompanionPayload(prepared);
      setStatus(task.outputName
        ? `本地流式助手已完成录制：${task.outputName}`
        : TEXT.liveRecorded);
      return;
    }
    const diagnostic = await recordLiveSegment(prepared.segments[0], control);
    state.lastDiagnostic = diagnostic;
    await saveDiagnostic(diagnostic);
    setStatus(liveRecordingResultStatus(diagnostic, prepared.segments[0].filename));
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      if (usedCompanion) {
        setStatus(TEXT.canceled);
        return;
      }
      const diagnostic = error.diagnostic || state.lastDiagnostic;
      if (diagnostic) {
        state.lastDiagnostic = diagnostic;
        await saveDiagnostic(diagnostic);
      }
      setStatus(liveRecordingResultStatus(diagnostic, prepared?.segments?.[0]?.filename));
      return;
    }
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
    }
    completeProgress();
    updateControls();
  }
}

function stopLiveRecording() {
  const control = state.downloadControl;
  if (!control?.liveRecording || control.canceled) {
    return;
  }

  setStatus(TEXT.liveStopping);
  control.canceled = true;
  control.paused = false;
  if (control.companionTaskId) {
    requestCompanionTaskControl(control.companionTaskId, "cancel")
      .catch((error) => {
        if (state.downloadControl === control) {
          control.canceled = false;
          setStatus(error.message || "无法结束本地流式助手录制。");
          updateControls();
        }
      });
    renderDownloadControls();
    updateControls();
    return;
  }
  for (const abortController of control.abortControllers) {
    abortController.abort();
  }
  resumeDownloadWaiters(control);
  renderDownloadControls();
  updateControls();
}

async function prepareLiveRecording() {
  const prepared = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING",
    payload: {
      roomId: state.live.roomId,
      title: state.live.title,
      url: state.page.url,
      quality: Number(qualitySelect.value)
    }
  });

  if (!prepared?.ok) {
    state.lastDiagnostic = prepared?.diagnostic || state.lastDiagnostic;
    throw new Error(prepared?.error || "Failed to prepare live recording.");
  }

  return prepared.payload;
}

async function preparePageDownload(page, quality, title) {
  const prepared = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: state.video.bvid,
      epId: page.epId || state.video.epId || null,
      cid: Number(page.cid),
      tabId: state.tabId,
      quality,
      title
    }
  });

  if (!prepared?.ok) {
    state.lastDiagnostic = prepared?.diagnostic || state.lastDiagnostic;
    throw new Error(prepared?.error || "Failed to prepare download.");
  }

  return prepared.payload;
}

async function prepareAudioDownload(page, title) {
  const prepared = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_PREPARE_AUDIO",
    payload: {
      bvid: state.video.bvid,
      epId: page.epId || state.video.epId || null,
      cid: Number(page.cid),
      tabId: state.tabId,
      title
    }
  });

  if (!prepared?.ok) {
    state.lastDiagnostic = prepared?.diagnostic || state.lastDiagnostic;
    throw new Error(prepared?.error || "Failed to prepare audio download.");
  }

  return prepared.payload;
}

async function downloadPreparedPayload(prepared, statusText = TEXT.downloading, options = {}) {
  if (prepared.mode === "dash") {
    if (options.allowCompanion !== false && await shouldUseStreamingCompanionForDash(prepared)) {
      return downloadPreparedCompanionPayload(prepared, options);
    }
    return downloadDashAsMp4(prepared);
  }

  if (prepared.mode === "durl" || prepared.mode === "audio") {
    return downloadPreparedDirectPayload(prepared);
  }

  for (const [index, segment] of prepared.segments.entries()) {
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    const role = segment.context?.roleLabel || segment.context?.role || "";
    const suffix = role ? ` ${index + 1}/${prepared.count} ${role}` : ` ${index + 1}/${prepared.count}`;
    setStatus(`${statusText}${suffix}`);
    const diagnostic = await downloadSegment(segment);
    state.lastDiagnostic = diagnostic;
  }
  await saveDiagnostic(state.lastDiagnostic);
}

async function shouldUseStreamingCompanionForDash(prepared) {
  if (!state.companionSettings.preferDash) {
    return false;
  }
  return ensureStreamingCompanionAvailable();
}

async function downloadPreparedCompanionPayload(prepared, options = {}) {
  const started = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: {
      prepared,
      tabId: state.tabId
    }
  });
  if (!started?.ok || !started?.payload?.taskId) {
    throw new Error(started?.error || "无法启动本地流式助手。");
  }

  const task = rememberCompanionTask(started.payload);
  if (typeof options.onStarted === "function") {
    await options.onStarted(task);
  }
  const control = state.downloadControl;
  if (control) {
    control.companionTaskId = task.taskId;
  }
  if (control?.canceled) {
    requestCompanionTaskControl(task.taskId, "cancel").catch(() => {});
    throw downloadCanceledError();
  }
  beginCompanionTaskProgress(task);
  let completedTask = null;
  try {
    completedTask = await waitForCompanionTask(task.taskId);
  } finally {
    if (control?.companionTaskId === task.taskId && isCompanionTaskTerminal(state.companionTasks.get(task.taskId))) {
      control.companionTaskId = "";
    }
  }
  if (completedTask.state !== "complete") {
    if (completedTask.state === "canceled") {
      throw downloadCanceledError();
    }
    throw new Error(completedTask.error || "本地流式助手任务未完成。");
  }
  completeProgress(completedTask);
  return completedTask;
}

function beginCompanionTaskProgress(task) {
  state.progress.active = true;
  state.progress.receivedBytes = Number(task?.receivedBytes) || 0;
  state.progress.totalBytes = Number(task?.totalBytes) || 0;
  state.progress.percent = state.progress.totalBytes
    ? Math.min((state.progress.receivedBytes / state.progress.totalBytes) * 100, 100)
    : 0;
  state.progress.speedBytesPerSecond = 0;
  state.progress.durationMs = Number(task?.durationMs) || 0;
  state.progress.startedAt = Date.now();
  state.progress.lastAt = state.progress.startedAt;
  state.progress.segmentIndex = Number(task?.segmentIndex) || 0;
  state.progress.segmentCount = Number(task?.segmentCount) || 0;
  state.progress.candidateIndex = 0;
  state.progress.candidateCount = 0;
  renderProgress();
}

function safeCompanionDisplayText(value, maxLength = 240) {
  return String(value || "")
    .replace(/https?:\/\/[^\s]+/gi, "[已隐藏链接]")
    .replace(/[a-z]:[\\/][^\s]+/gi, "[已隐藏本地路径]")
    .replace(/[\\/]/g, "")
    .slice(0, maxLength);
}

function safeCompanionOutputName(value) {
  const raw = String(value || "").split(/[\\/]/).at(-1) || "";
  return safeCompanionDisplayText(raw, 180);
}

function normalizeCompanionTaskState(value) {
  const stateValue = String(value || "").toLowerCase();
  if (stateValue === "completed") {
    return "complete";
  }
  return ["queued", "starting", "in_progress", "refreshing", "canceling", "complete", "failed", "interrupted", "canceled"]
    .includes(stateValue)
    ? stateValue
    : "";
}

function rememberCompanionTask(task) {
  const normalized = {
    taskId: String(task?.taskId || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 160),
    tabId: Number(task?.tabId) || 0,
    kind: ["dash", "live"].includes(String(task?.kind || "").toLowerCase())
      ? String(task.kind).toLowerCase()
      : "",
    title: safeCompanionDisplayText(task?.title || "", 240),
    outputName: safeCompanionOutputName(task?.outputName || ""),
    state: normalizeCompanionTaskState(task?.state || task?.taskState),
    receivedBytes: Math.max(Number(task?.receivedBytes) || 0, 0),
    totalBytes: Math.max(Number(task?.totalBytes) || 0, 0),
    segmentIndex: Math.max(Number(task?.segmentIndex) || 0, 0),
    segmentCount: Math.max(Number(task?.segmentCount) || 0, 0),
    durationMs: Math.max(Number(task?.durationMs) || 0, 0),
    error: safeCompanionDisplayText(task?.error || "", 240),
    recoverable: Boolean(task?.recoverable),
    createdAt: String(task?.createdAt || ""),
    updatedAt: String(task?.updatedAt || "")
  };
  if (normalized.taskId) {
    const previous = state.companionTasks.get(normalized.taskId) || {};
    state.companionTasks.set(normalized.taskId, {
      ...previous,
      ...normalized
    });
  }
  return state.companionTasks.get(normalized.taskId) || normalized;
}

function receiveCompanionTaskProgress(payload) {
  if (!payload?.companionDownload || !payload?.taskId) {
    return null;
  }
  const previous = state.companionTasks.get(String(payload.taskId)) || {};
  const task = rememberCompanionTask({
    ...previous,
    taskId: payload.taskId,
    tabId: payload.tabId ?? previous.tabId,
    kind: payload.companionKind || payload.kind || previous.kind,
    title: payload.title || previous.title,
    outputName: payload.outputName || previous.outputName,
    state: payload.taskState || payload.state || previous.state,
    receivedBytes: payload.receivedBytes ?? previous.receivedBytes,
    totalBytes: payload.totalBytes ?? previous.totalBytes,
    segmentIndex: payload.segmentIndex ?? previous.segmentIndex,
    segmentCount: payload.segmentCount ?? previous.segmentCount,
    durationMs: payload.durationMs ?? previous.durationMs,
    error: payload.error || previous.error,
    recoverable: payload.recoverable ?? previous.recoverable,
    createdAt: payload.createdAt || previous.createdAt,
    updatedAt: payload.updatedAt || previous.updatedAt
  });
  if (isCompanionTaskTerminal(task)) {
    settleCompanionTaskWaiter(task);
  }
  renderTaskCenter();
  scheduleTaskCenterRefresh();
  return task;
}

function isCompanionTaskTerminal(task) {
  return ["complete", "failed", "interrupted", "canceled"].includes(String(task?.state || task?.taskState || ""));
}

function waitForCompanionTask(taskId) {
  const task = state.companionTasks.get(taskId);
  if (isCompanionTaskTerminal(task)) {
    return task.state === "complete"
      ? Promise.resolve(task)
      : Promise.reject(companionTaskError(task));
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    state.companionTaskWaiters.set(taskId, waiter);
    const latest = state.companionTasks.get(taskId);
    if (isCompanionTaskTerminal(latest)) {
      settleCompanionTaskWaiter(latest);
      return;
    }
    scheduleCompanionTaskPoll(taskId, waiter);
  });
}

function scheduleCompanionTaskPoll(taskId, waiter) {
  waiter.timer = setTimeout(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
        payload: { taskId }
      });
      if (response?.ok && response.payload) {
        const task = rememberCompanionTask(response.payload);
        if (isCompanionTaskTerminal(task)) {
          settleCompanionTaskWaiter(task);
          return;
        }
      }
    } catch (_error) {
      // The background progress port normally arrives first; polling covers worker restarts.
    }
    if (state.companionTaskWaiters.get(taskId) === waiter) {
      scheduleCompanionTaskPoll(taskId, waiter);
    }
  }, COMPANION_TASK_REFRESH_INTERVAL_MS);
  waiter.timer?.unref?.();
}

function settleCompanionTaskWaiter(task) {
  const taskId = String(task?.taskId || "");
  const waiter = state.companionTaskWaiters.get(taskId);
  if (!waiter) {
    return;
  }
  state.companionTaskWaiters.delete(taskId);
  if (waiter.timer) {
    clearTimeout(waiter.timer);
  }
  if (task?.state === "complete") {
    waiter.resolve(task);
  } else {
    waiter.reject(companionTaskError(task));
  }
}

function companionTaskError(task) {
  if (task?.state === "canceled") {
    return downloadCanceledError();
  }
  return new Error(task?.error || "本地流式助手任务已中断。");
}

async function requestCompanionTaskControl(taskId, action) {
  const response = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_CONTROL_COMPANION_TASK",
    payload: { taskId, action }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "无法控制本地流式助手任务。");
  }
  return response.payload ? rememberCompanionTask(response.payload) : null;
}

async function downloadPreparedDirectPayload(prepared, options = {}) {
  const started = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_START_DIRECT",
    payload: {
      prepared,
      tabId: state.tabId
    }
  });

  if (!started?.ok || !started?.payload?.taskId) {
    state.lastDiagnostic = started?.diagnostic || state.lastDiagnostic;
    throw new Error(started?.error || "Failed to start native download.");
  }

  const task = rememberNativeDirectTask(started.payload);
  const control = state.downloadControl;
  if (control) {
    control.nativeTaskId = task.taskId;
  }
  try {
    if (typeof options.onStarted === "function") {
      await options.onStarted(task);
    }
  } catch (error) {
    // A native transfer already exists at this point.  If its batch linkage
    // cannot be persisted, request cancellation rather than leaving an
    // untracked download that a reopened side panel would start again.
    requestNativeDirectTaskControl(task.taskId, "cancel").catch(() => {});
    if (control?.nativeTaskId === task.taskId) {
      control.nativeTaskId = "";
    }
    throw error;
  }
  if (control?.canceled) {
    requestNativeDirectTaskControl(task.taskId, "cancel").catch(() => {});
    throw downloadCanceledError();
  }
  if (control?.paused) {
    await requestNativeDirectTaskControl(task.taskId, "pause");
  }
  beginNativeDirectTaskProgress(task);
  let completedTask = null;
  try {
    completedTask = await waitForNativeDirectTask(task.taskId);
  } catch (error) {
    await loadNativeDirectTaskDiagnostic();
    throw error;
  }
  if (completedTask.state !== "complete") {
    if (completedTask.state === "canceled") {
      throw downloadCanceledError();
    }
    throw new Error(completedTask.error || "Native download was interrupted.");
  }

  completeProgress(completedTask);
  await loadNativeDirectTaskDiagnostic();
  return completedTask;
}

function beginNativeDirectTaskProgress(task) {
  state.progress.active = true;
  state.progress.receivedBytes = Number(task?.receivedBytes) || 0;
  state.progress.totalBytes = Number(task?.totalBytes) || 0;
  state.progress.percent = state.progress.totalBytes
    ? Math.min((state.progress.receivedBytes / state.progress.totalBytes) * 100, 100)
    : 0;
  state.progress.speedBytesPerSecond = 0;
  state.progress.durationMs = 0;
  state.progress.startedAt = Date.now();
  state.progress.lastAt = state.progress.startedAt;
  const activeSegment = Array.isArray(task?.segments)
    ? task.segments.find((segment) => segment.state === "in_progress" || segment.state === "starting") || task.segments[0]
    : null;
  state.progress.segmentIndex = Number(activeSegment?.index) || 0;
  state.progress.segmentCount = Number(task?.count) || (Array.isArray(task?.segments) ? task.segments.length : 0);
  state.progress.candidateIndex = Number(activeSegment?.candidateIndex) || 0;
  state.progress.candidateCount = Number(activeSegment?.candidateCount) || 0;
  renderProgress();
}

function rememberNativeDirectTask(task) {
  const normalized = {
    ...task,
    taskId: String(task?.taskId || ""),
    state: String(task?.state || task?.taskState || ""),
    receivedBytes: Number(task?.receivedBytes) || 0,
    totalBytes: Number(task?.totalBytes) || 0,
    error: String(task?.error || "")
  };
  if (normalized.taskId) {
    state.nativeDirectTasks.set(normalized.taskId, normalized);
  }
  return normalized;
}

function receiveNativeDirectTaskProgress(payload) {
  if (!payload?.nativeDownload || !payload?.taskId) {
    return null;
  }

  const previous = state.nativeDirectTasks.get(payload.taskId) || {};
  const task = rememberNativeDirectTask({
    ...previous,
    taskId: payload.taskId,
    state: payload.taskState || previous.state,
    taskState: payload.taskState || previous.taskState,
    receivedBytes: payload.receivedBytes,
    totalBytes: payload.totalBytes,
    error: payload.error || previous.error,
    downloadIds: payload.downloadIds || previous.downloadIds
  });
  if (isNativeDirectTaskTerminal(task)) {
    settleNativeDirectTaskWaiter(task);
  }
  renderTaskCenter();
  scheduleTaskCenterRefresh();
  return task;
}

function waitForNativeDirectTask(taskId) {
  const task = state.nativeDirectTasks.get(taskId);
  if (isNativeDirectTaskTerminal(task)) {
    return task.state === "complete"
      ? Promise.resolve(task)
      : Promise.reject(nativeDirectTaskError(task));
  }

  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: null
    };
    state.nativeDirectTaskWaiters.set(taskId, waiter);
    const latest = state.nativeDirectTasks.get(taskId);
    if (isNativeDirectTaskTerminal(latest)) {
      settleNativeDirectTaskWaiter(latest);
      return;
    }
    scheduleNativeDirectTaskPoll(taskId, waiter);
  });
}

function scheduleNativeDirectTaskPoll(taskId, waiter) {
  waiter.timer = setTimeout(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "BILI_DOWNLOAD_GET_DIRECT_TASK",
        payload: { taskId }
      });
      if (response?.ok && response.payload) {
        const task = rememberNativeDirectTask(response.payload);
        if (isNativeDirectTaskTerminal(task)) {
          settleNativeDirectTaskWaiter(task);
          return;
        }
      }
    } catch (_error) {
      // Port updates normally arrive first; polling only covers a worker restart.
    }

    if (state.nativeDirectTaskWaiters.get(taskId) === waiter) {
      scheduleNativeDirectTaskPoll(taskId, waiter);
    }
  }, 2000);
}

function settleNativeDirectTaskWaiter(task) {
  const taskId = String(task?.taskId || "");
  const waiter = state.nativeDirectTaskWaiters.get(taskId);
  if (!waiter) {
    return;
  }
  state.nativeDirectTaskWaiters.delete(taskId);
  if (waiter.timer) {
    clearTimeout(waiter.timer);
  }
  settleNativeDirectTask(task, waiter);
}

function settleNativeDirectTask(task, waiter = null) {
  if (task?.state === "complete") {
    waiter?.resolve(task);
    return task;
  }
  const error = nativeDirectTaskError(task);
  waiter?.reject(error);
  return error;
}

function nativeDirectTaskError(task) {
  if (task?.state === "canceled") {
    return downloadCanceledError();
  }
  return new Error(task?.error || "Native download was interrupted.");
}

function isNativeDirectTaskTerminal(task) {
  return ["complete", "interrupted", "canceled"].includes(task?.state || task?.taskState || "");
}

async function requestNativeDirectTaskControl(taskId, action) {
  const response = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_CONTROL_DIRECT",
    payload: { taskId, action }
  });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to control native download.");
  }
  return response.payload ? rememberNativeDirectTask(response.payload) : null;
}

async function loadNativeDirectTaskDiagnostic() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_GET_DIAGNOSTIC"
    });
    if (response?.ok && response.payload) {
      state.lastDiagnostic = response.payload;
    }
  } catch (_error) {
    // The background already persisted its own diagnostic; this only refreshes the side panel.
  }
}

async function refreshTaskCenter(options = {}) {
  if (state.taskCenterLoading || !state.tabId) {
    renderTaskCenter();
    return;
  }

  state.taskCenterLoading = true;
  try {
    const [directResponse, batchResponse, companionResponse] = await Promise.all([
      sendTaskCenterMessage({
        type: "BILI_DOWNLOAD_LIST_DIRECT_TASKS",
        payload: { tabId: state.tabId, activeOnly: false }
      }),
      sendTaskCenterMessage({
        type: "BILI_DOWNLOAD_LIST_BATCH_JOBS",
        payload: { tabId: state.tabId, activeOnly: false }
      }),
      sendTaskCenterMessage({
        type: "BILI_DOWNLOAD_LIST_COMPANION_TASKS",
        payload: { tabId: state.tabId, activeOnly: false }
      })
    ]);
    for (const task of Array.isArray(directResponse?.payload) ? directResponse.payload : []) {
      rememberNativeDirectTask(task);
    }
    for (const job of Array.isArray(batchResponse?.payload) ? batchResponse.payload : []) {
      rememberBatchJob(job);
    }
    const companionTasks = Array.isArray(companionResponse?.payload)
      ? companionResponse.payload
      : (Array.isArray(companionResponse?.payload?.tasks) ? companionResponse.payload.tasks : []);
    for (const task of companionTasks) {
      rememberCompanionTask(task);
    }
  } finally {
    state.taskCenterLoading = false;
    renderTaskCenter();
    scheduleTaskCenterRefresh();
  }

  if (options.resumeBatch) {
    resumeVisibleBatchJobs().catch(() => {});
  }
}

async function sendTaskCenterMessage(message) {
  try {
    const response = await chrome.runtime.sendMessage(message);
    return response?.ok ? response : null;
  } catch (_error) {
    return null;
  }
}

function rememberBatchJob(job) {
  const normalized = {
    ...job,
    jobId: String(job?.jobId || job?.batchJobId || job?.id || ""),
    state: String(job?.state || ""),
    tabId: Number(job?.tabId) || 0,
    currentIndex: Math.max(Number(job?.currentIndex) || 0, 0),
    itemCount: Math.max(Number(job?.itemCount) || Number(job?.count) || (Array.isArray(job?.items) ? job.items.length : 0), 0),
    completedCount: Math.max(Number(job?.completedCount) || 0, 0),
    error: String(job?.error || "")
  };
  if (normalized.jobId) {
    state.batchJobs.set(normalized.jobId, normalized);
  }
  return normalized;
}

function isBatchJobTerminal(job) {
  return ["complete", "canceled"].includes(String(job?.state || ""));
}

function isTaskCenterItemActive(item) {
  return !["complete", "failed", "interrupted", "canceled"].includes(String(item?.state || item?.taskState || ""));
}

function visibleTaskCenterItems() {
  const tabId = Number(state.tabId) || 0;
  if (!tabId) {
    return [];
  }
  const belongsToCurrentTab = (item) => Number(item?.tabId) === tabId;
  const direct = Array.from(state.nativeDirectTasks.values())
    .filter(belongsToCurrentTab)
    .map((task) => ({ kind: "direct", item: task }));
  const batches = Array.from(state.batchJobs.values())
    .filter(belongsToCurrentTab)
    .map((job) => ({ kind: "batch", item: job }));
  const companion = Array.from(state.companionTasks.values())
    .filter(belongsToCurrentTab)
    .map((task) => ({ kind: "companion", item: task }));
  return [...direct, ...companion, ...batches]
    .sort((left, right) => {
      const leftActive = isTaskCenterItemActive(left.item) ? 0 : 1;
      const rightActive = isTaskCenterItemActive(right.item) ? 0 : 1;
      if (leftActive !== rightActive) {
        return leftActive - rightActive;
      }
      return String(right.item.updatedAt || right.item.createdAt || "")
        .localeCompare(String(left.item.updatedAt || left.item.createdAt || ""));
    })
    .slice(0, 24);
}

function renderTaskCenter() {
  if (!taskCenter || !taskCenterNote || !taskList) {
    return;
  }
  const tasks = visibleTaskCenterItems();
  taskList.replaceChildren();
  if (!tasks.length) {
    taskCenterNote.textContent = "当前页面没有由扩展管理的下载任务。";
    return;
  }

  const activeCount = tasks.filter((entry) => isTaskCenterItemActive(entry.item)).length;
  taskCenterNote.textContent = activeCount
    ? `当前页面有 ${activeCount} 个进行中的任务；关闭侧边栏后可在此继续查看和控制。`
    : `显示最近 ${tasks.length} 个任务。`;
  for (const entry of tasks) {
    taskList.append(renderTaskCenterRow(entry.kind, entry.item));
  }
}

function renderTaskCenterRow(kind, item) {
  const row = document.createElement("article");
  row.className = "task-row";
  const heading = document.createElement("div");
  heading.className = "task-row-head";
  const title = document.createElement("span");
  title.className = "task-row-title";
  title.textContent = taskCenterTitle(kind, item);
  title.title = title.textContent;
  const stateLabel = document.createElement("span");
  stateLabel.className = "task-state";
  stateLabel.dataset.state = String(item.state || "");
  stateLabel.textContent = taskStateLabel(item.state);
  heading.append(title, stateLabel);

  const meta = document.createElement("div");
  meta.className = "task-row-meta";
  const progress = document.createElement("span");
  progress.textContent = taskCenterProgress(kind, item);
  const detail = document.createElement("span");
  detail.textContent = taskCenterDetail(kind, item);
  meta.append(progress, detail);
  row.append(heading, meta);

  const actions = renderTaskCenterActions(kind, item);
  if (actions) {
    row.append(actions);
  }
  return row;
}

function taskCenterTitle(kind, item) {
  if (kind === "batch") {
    return String(item.title || item.label || "多分 P 下载队列");
  }
  if (kind === "companion") {
    const label = item.kind === "live" ? "直播录制" : "DASH 下载";
    return `${label} · ${String(item.title || item.outputName || "本地流式助手")}`;
  }
  const segment = Array.isArray(item.segments) ? item.segments[0] : null;
  return String(item.title || segment?.context?.title || segment?.title || "媒体下载");
}

function taskStateLabel(value) {
  return ({
    queued: "等待中",
    starting: "正在启动",
    in_progress: "下载中",
    paused: "已暂停",
    refreshing: "正在刷新地址",
    canceling: "正在取消",
    complete: "已完成",
    failed: "失败",
    interrupted: "已中断",
    canceled: "已取消"
  })[String(value || "")] || "未知";
}

function taskCenterProgress(kind, item) {
  if (kind === "batch") {
    const total = Number(item.itemCount) || (Array.isArray(item.items) ? item.items.length : 0);
    const completed = Number(item.completedCount) || 0;
    return total ? `${completed}/${total} 个条目` : "队列准备中";
  }
  const received = Number(item.receivedBytes) || 0;
  const total = Number(item.totalBytes) || 0;
  return `${formatBytes(received)} / ${total ? formatBytes(total) : "--"}`;
}

function taskCenterDetail(kind, item) {
  if (item.error) {
    return String(item.error).slice(0, 80);
  }
  if (kind === "batch") {
    return String(item.kind === "audio" || item.mode === "audio" ? "音频" : "视频");
  }
  if (kind === "companion") {
    return item.kind === "live" ? "本地流式助手 · 分段直播录制" : "本地流式助手 · DASH 流式落盘";
  }
  const completeCount = Number(item.completedCount) || 0;
  const count = Number(item.count) || (Array.isArray(item.segments) ? item.segments.length : 0);
  return count > 1 ? `分段 ${completeCount}/${count}` : "原生下载";
}

function renderTaskCenterActions(kind, item) {
  if (kind === "direct") {
    if (isNativeDirectTaskTerminal(item)) {
      return null;
    }
    const actions = document.createElement("div");
    actions.className = "task-row-actions";
    const pause = document.createElement("button");
    pause.type = "button";
    pause.textContent = item.state === "paused" ? "继续" : "暂停";
    pause.addEventListener("click", () => {
      controlTaskCenterDirectTask(item.taskId, item.state === "paused" ? "resume" : "pause").catch(() => {});
    });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "danger";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => {
      controlTaskCenterDirectTask(item.taskId, "cancel").catch(() => {});
    });
    actions.append(pause, cancel);
    return actions;
  }

  if (kind === "companion") {
    const canResume = item.state === "interrupted" && item.recoverable;
    if (isCompanionTaskTerminal(item) && !canResume) {
      return null;
    }
    const actions = document.createElement("div");
    actions.className = "task-row-actions";
    const action = document.createElement("button");
    action.type = "button";
    action.className = canResume ? "" : "danger";
    action.textContent = canResume ? "重新授权并开始" : "取消";
    action.addEventListener("click", () => {
      controlTaskCenterCompanionTask(item.taskId, canResume ? "resume" : "cancel").catch(() => {});
    });
    actions.append(action);
    return actions;
  }

  if (isBatchJobTerminal(item)) {
    return null;
  }
  const actions = document.createElement("div");
  actions.className = "task-row-actions";
  const resume = document.createElement("button");
  resume.type = "button";
  resume.textContent = item.state === "paused" ? "继续" : "查看";
  resume.addEventListener("click", () => {
    resumeBatchJob(item.jobId, { userInitiated: true }).catch(() => {});
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "danger";
  cancel.textContent = "取消";
  cancel.addEventListener("click", () => {
    cancelBatchJob(item.jobId).catch(() => {});
  });
  actions.append(resume, cancel);
  return actions;
}

async function controlTaskCenterDirectTask(taskId, action) {
  const task = await requestNativeDirectTaskControl(taskId, action);
  if (task && state.downloadControl?.nativeTaskId === task.taskId) {
    state.downloadControl.paused = task.state === "paused";
    if (isNativeDirectTaskTerminal(task)) {
      state.downloadControl = null;
      setBusy(false);
    }
  }
  renderTaskCenter();
}

async function controlTaskCenterCompanionTask(taskId, action = "cancel") {
  const task = await requestCompanionTaskControl(taskId, action);
  if (task && state.downloadControl?.companionTaskId === task.taskId && isCompanionTaskTerminal(task)) {
    state.downloadControl = null;
    setBusy(false);
  }
  renderTaskCenter();
  scheduleTaskCenterRefresh();
}

function scheduleTaskCenterRefresh() {
  if (state.taskCenterRefreshTimer && typeof clearTimeout === "function") {
    clearTimeout(state.taskCenterRefreshTimer);
  }
  state.taskCenterRefreshTimer = null;
  const tabId = Number(state.tabId) || 0;
  if (!tabId) {
    return;
  }
  const isActiveOnCurrentTab = (item) => Number(item?.tabId) === tabId && isTaskCenterItemActive(item);
  const hasActiveDirect = Array.from(state.nativeDirectTasks.values()).some(isActiveOnCurrentTab);
  const hasActiveCompanion = Array.from(state.companionTasks.values()).some(isActiveOnCurrentTab);
  const hasActiveBatch = Array.from(state.batchJobs.values()).some(isActiveOnCurrentTab);
  if (!hasActiveDirect && !hasActiveCompanion && !hasActiveBatch) {
    return;
  }
  const delay = (hasActiveDirect || hasActiveCompanion)
    ? Math.min(DIRECT_TASK_REFRESH_INTERVAL_MS, COMPANION_TASK_REFRESH_INTERVAL_MS)
    : BATCH_TASK_REFRESH_INTERVAL_MS;
  const timer = setTimeout(() => {
    state.taskCenterRefreshTimer = null;
    refreshTaskCenter({ resumeBatch: true, silent: true }).catch(() => {});
  }, delay);
  // Node-based smoke tests should not stay alive solely for a UI polling timer.
  // Browser timer ids are numbers and intentionally have no `unref` method.
  timer?.unref?.();
  state.taskCenterRefreshTimer = timer;
}

async function resumeVisibleBatchJobs() {
  if (state.batchRunPromise || state.downloadControl) {
    return;
  }
  const tabId = Number(state.tabId) || 0;
  if (!tabId) {
    return;
  }
  const job = Array.from(state.batchJobs.values())
    .filter((item) => ["queued", "in_progress"].includes(String(item?.state || "")))
    .filter((item) => Number(item?.tabId) === tabId)
    .sort((left, right) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")))
    .at(0);
  if (job?.jobId) {
    await resumeBatchJob(job.jobId);
  }
}

async function createBatchJob(items, options = {}) {
  const response = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_CREATE_BATCH_JOB",
    payload: {
      tabId: state.tabId,
      title: options.title || state.video?.title || "多分 P 下载队列",
      items
    }
  });
  const job = response?.payload ? rememberBatchJob(response.payload) : null;
  if (!response?.ok || !job?.jobId) {
    throw new Error(response?.error || "无法保存多分 P 下载队列。");
  }
  renderTaskCenter();
  return job;
}

async function getBatchJob(jobId) {
  const response = await sendTaskCenterMessage({
    type: "BILI_DOWNLOAD_GET_BATCH_JOB",
    payload: { batchJobId: jobId }
  });
  return response?.payload ? rememberBatchJob(response.payload) : null;
}

async function updateBatchJob(jobId, patch) {
  const response = await chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_UPDATE_BATCH_JOB",
    payload: { batchJobId: jobId, patch }
  });
  const job = response?.payload ? rememberBatchJob(response.payload) : null;
  if (!response?.ok || !job?.jobId) {
    throw new Error(response?.error || "无法更新下载队列状态。");
  }
  renderTaskCenter();
  scheduleTaskCenterRefresh();
  return job;
}

function pageBatchItem(page, quality, kind = "video") {
  const pageIndex = Number(page?.index || page?.page) || 1;
  const title = kind === "audio"
    ? audioDownloadTitle(state.video?.title || "bili_audio", page)
    : pageDownloadTitle(state.video?.title || "bili_video", page);
  return {
    itemId: `${kind}-${pageIndex}-${Number(page?.cid) || 0}`,
    bvid: state.video?.bvid || "",
    epId: page?.epId || state.video?.epId || null,
    cid: Number(page?.cid),
    quality: kind === "audio" ? 0 : Number(quality),
    title,
    source: state.video?.source || state.page.type || "video",
    pageIndex,
    pageLabel: `P${String(pageIndex).padStart(2, "0")}`,
    kind,
    // The background's persisted schema intentionally has no arbitrary `kind`
    // field. `audio` is also a valid persisted mode, so use it as the stable
    // discriminator until the item is prepared again after a panel reload.
    mode: kind === "audio" ? "audio" : ""
  };
}

async function prepareBatchItem(item) {
  const isAudio = item?.kind === "audio" || item?.mode === "audio";
  const response = await chrome.runtime.sendMessage({
    type: isAudio ? "BILI_DOWNLOAD_PREPARE_AUDIO" : "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: item?.bvid,
      epId: item?.epId || null,
      cid: Number(item?.cid),
      tabId: state.tabId,
      quality: Number(item?.quality) || undefined,
      title: item?.title || "bili_download"
    }
  });
  if (!response?.ok) {
    state.lastDiagnostic = response?.diagnostic || state.lastDiagnostic;
    throw new Error(response?.error || "无法重新准备下载媒体。");
  }
  return response.payload;
}

async function resumeBatchJob(jobId, options = {}) {
  if (!jobId) {
    return null;
  }
  if (state.batchRunPromise) {
    return state.batchRunPromise;
  }
  const operation = runBatchJob(jobId, options);
  state.batchRunPromise = operation;
  try {
    return await operation;
  } finally {
    if (state.batchRunPromise === operation) {
      state.batchRunPromise = null;
    }
    scheduleTaskCenterRefresh();
  }
}

async function runBatchJob(jobId, options = {}) {
  let job = await getBatchJob(jobId);
  if (!job) {
    return null;
  }
  if (isBatchJobTerminal(job)) {
    return job;
  }
  if (["paused", "interrupted"].includes(String(job.state || "")) && !options.userInitiated) {
    return job;
  }
  if (!job.tabId || !state.tabId || Number(job.tabId) !== Number(state.tabId)) {
    if (options.userInitiated) {
      setStatus("请先切换回创建此下载队列的页面，再继续该任务。");
    }
    return job;
  }

  let control = state.downloadControl;
  if (!control) {
    control = createDownloadControl();
    state.downloadControl = control;
    setBusy(true);
  }
  control.batchJobId = job.jobId;
  control.batchJob = true;
  resetProgress();
  await updateBatchJob(job.jobId, { state: "in_progress", error: "" });

  try {
    const items = Array.isArray(job.items) ? job.items : [];
    for (const [offset, storedItem] of items.entries()) {
      const index = offset + 1;
      let item = storedItem || {};
      if (item.state === "complete" || item.state === "canceled") {
        continue;
      }
      await waitForDownloadControl();
      throwIfDownloadCanceled();
      setStatus(`${item.kind === "audio" || item.mode === "audio" ? TEXT.downloadingPageAudio : TEXT.downloadingPages} ${index}/${items.length} ${item.pageLabel || ""}`.trim());

      if (item.directTaskId) {
        const direct = await loadOrWaitForBatchDirectTask(item.directTaskId, control, {
          resumePaused: Boolean(options.userInitiated)
        });
        if (direct?.state === "complete") {
          job = await updateBatchJob(job.jobId, {
            currentIndex: index,
            itemUpdates: [{ index, state: "complete", error: "" }]
          });
          continue;
        }
        if (direct?.state === "canceled") {
          // A canceled browser task can be a prior failed batch cancellation.
          // Drop the stale linkage and prepare a fresh authorized task instead
          // of repeatedly treating the whole queue as canceled forever.
          job = await updateBatchJob(job.jobId, {
            currentIndex: index,
            itemUpdates: [{ index, state: "queued", directTaskId: "", error: "" }]
          });
          item = job.items?.[offset] || { ...item, directTaskId: "", state: "queued" };
        } else {
          // A stale or terminal failed native task is retried by obtaining a fresh
          // play-url below. The direct task itself keeps its historical diagnostic.
          job = await updateBatchJob(job.jobId, {
            currentIndex: index,
            itemUpdates: [{ index, state: "queued", directTaskId: "", error: "" }]
          });
          item = job.items?.[offset] || { ...item, directTaskId: "", state: "queued" };
        }
      }

      if (item.state === "in_progress" && item.mode === "dash") {
        // A side-panel/browser mux cannot survive a panel teardown. No partial
        // output is saved, so returning this item to the queue is safe.
        job = await updateBatchJob(job.jobId, {
          currentIndex: index,
          itemUpdates: [{ index, state: "queued", error: "浏览器端 DASH 在面板关闭后将重新开始。" }]
        });
        item = job.items?.[offset] || { ...item, state: "queued" };
      }

      job = await updateBatchJob(job.jobId, {
        currentIndex: index,
        itemUpdates: [{ index, state: "preparing", attempt: (Number(item.attempt) || 0) + 1, error: "" }]
      });
      item = job.items?.[offset] || item;
      const prepared = await prepareBatchItem(item);
      job = await updateBatchJob(job.jobId, {
        currentIndex: index,
        itemUpdates: [{ index, state: "in_progress", mode: prepared.mode || "", format: prepared.format || "", error: "" }]
      });

      if (prepared.mode === "durl" || prepared.mode === "audio") {
        await downloadPreparedDirectPayload(prepared, {
          onStarted: async (task) => {
            job = await updateBatchJob(job.jobId, {
              currentIndex: index,
              itemUpdates: [{ index, state: "in_progress", directTaskId: task.taskId, mode: prepared.mode || "", format: prepared.format || "" }]
            });
          }
        });
      } else {
        // Batch recovery currently persists only browser/native direct task ids.
        // Keep its DASH path browser-only until it can persist the companion task
        // relationship without creating a duplicate download after panel reopen.
        await downloadPreparedPayload(prepared, TEXT.downloading, { allowCompanion: false });
      }
      job = await updateBatchJob(job.jobId, {
        currentIndex: index,
        itemUpdates: [{ index, state: "complete", error: "" }]
      });
    }
    job = await updateBatchJob(job.jobId, { state: "complete", error: "" });
    setStatus(`${job.title || TEXT.pagesDownloaded}: ${Number(job.completedCount) || items.length}`);
    return job;
  } catch (error) {
    const currentIndex = Math.max(Number(job.currentIndex) || 1, 1);
    if (isDownloadCanceledError(error)) {
      if (control?.batchCancelPending) {
        // cancelBatchJob confirms any surviving chrome.downloads task before it
        // marks the persisted queue terminal. Do not race it with a local abort.
        return job;
      }
      job = await updateBatchJob(job.jobId, {
        state: "canceled",
        error: "",
        itemUpdates: [{ index: currentIndex, state: "canceled", error: "" }]
      }).catch(() => job);
      setStatus(TEXT.canceled);
      return job;
    }
    const message = String(error?.message || "下载队列已暂停。");
    job = await updateBatchJob(job.jobId, {
      state: "paused",
      error: message,
      itemUpdates: [{ index: currentIndex, state: "queued", error: message }]
    }).catch(() => job);
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(`${message}；可在任务中心继续。`);
    return job;
  } finally {
    if (state.downloadControl === control) {
      state.downloadControl = null;
      setBusy(false);
    }
    renderTaskCenter();
  }
}

async function loadOrWaitForBatchDirectTask(taskId, control, options = {}) {
  let task = state.nativeDirectTasks.get(taskId) || null;
  if (!task) {
    const response = await sendTaskCenterMessage({
      type: "BILI_DOWNLOAD_GET_DIRECT_TASK",
      payload: { taskId }
    });
    task = response?.payload ? rememberNativeDirectTask(response.payload) : null;
  }
  if (!task) {
    return null;
  }
  control.nativeTaskId = task.taskId;
  control.paused = task.state === "paused";
  if (task.state === "paused" && options.resumePaused) {
    task = await requestNativeDirectTaskControl(task.taskId, "resume") || task;
    control.paused = task.state === "paused";
  }
  beginNativeDirectTaskProgress(task);
  try {
    return await waitForNativeDirectTask(task.taskId);
  } catch (_error) {
    return state.nativeDirectTasks.get(task.taskId) || task;
  } finally {
    if (control.nativeTaskId === task.taskId) {
      control.nativeTaskId = "";
    }
  }
}

async function waitForBatchCancellationTerminal(task, timeoutMs = 15000) {
  if (!task || isNativeDirectTaskTerminal(task)) {
    return task;
  }
  beginNativeDirectTaskProgress(task);
  if (typeof setTimeout !== "function") {
    return waitForNativeDirectTask(task.taskId);
  }
  let timeout = null;
  try {
    try {
      return await Promise.race([
        waitForNativeDirectTask(task.taskId),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("等待浏览器确认取消超时。")),
            timeoutMs
          );
        })
      ]);
    } catch (error) {
      const latest = state.nativeDirectTasks.get(task.taskId);
      if (isNativeDirectTaskTerminal(latest)) {
        return latest;
      }
      throw error;
    }
  } finally {
    if (timeout !== null && typeof clearTimeout === "function") {
      clearTimeout(timeout);
    }
  }
}

async function cancelBatchJob(jobId) {
  const job = state.batchJobs.get(jobId) || await getBatchJob(jobId);
  if (!job || isBatchJobTerminal(job)) {
    return;
  }
  const control = state.downloadControl;
  if (control?.batchJobId === jobId) {
    control.batchCancelPending = true;
    control.canceled = true;
    control.paused = false;
    for (const abortController of control.abortControllers) {
      abortController.abort();
    }
    resumeDownloadWaiters(control);
  }

  const directTaskIds = new Set((Array.isArray(job.items) ? job.items : [])
    .filter((item) => !["complete", "canceled"].includes(String(item?.state || "")))
    .map((item) => String(item?.directTaskId || ""))
    .filter(Boolean));
  if (control?.batchJobId === jobId && control.nativeTaskId) {
    directTaskIds.add(String(control.nativeTaskId));
  }

  let cancellationError = null;
  for (const taskId of directTaskIds) {
    try {
      const known = state.nativeDirectTasks.get(taskId);
      if (known && isNativeDirectTaskTerminal(known)) {
        continue;
      }
      let task = await requestNativeDirectTaskControl(taskId, "cancel");
      if (task?.state === "canceling") {
        task = await waitForBatchCancellationTerminal(task);
      }
      if (!task || !isNativeDirectTaskTerminal(task)) {
        throw new Error("未确认原生下载任务已经取消。");
      }
    } catch (error) {
      cancellationError = error;
      break;
    }
  }

  const currentIndex = Math.max(Number(job.currentIndex) || 1, 1);
  if (cancellationError) {
    const message = "未能确认所有浏览器下载已取消；队列已暂停，请重试取消或在浏览器下载列表中处理。";
    await updateBatchJob(jobId, {
      state: "paused",
      error: message,
      currentIndex,
      itemUpdates: [{ index: currentIndex, state: "queued", error: message }]
    });
    if (control?.batchJobId === jobId) {
      control.batchCancelPending = false;
      control.canceled = false;
      control.paused = true;
      resumeDownloadWaiters(control);
    }
    setStatus(message);
    renderDownloadControls();
    return;
  }

  const itemUpdates = (Array.isArray(job.items) ? job.items : [])
    .map((item, index) => ({ item, index: index + 1 }))
    .filter(({ item }) => !["complete", "canceled"].includes(String(item?.state || "")))
    .map(({ index }) => ({ index, state: "canceled", error: "" }));
  await updateBatchJob(jobId, {
    state: "canceled",
    error: "",
    currentIndex,
    itemUpdates
  });
  if (control?.batchJobId === jobId) {
    control.batchCancelPending = false;
  }
  setStatus(TEXT.canceled);
}

async function downloadDashAsMp4(prepared) {
  const safety = getDashSafetyLimits();
  const expectedInputBytes = prepared.segments.reduce((total, segment) => (
    total + knownSegmentSize(segment)
  ), 0);
  assertDashInputWithinSafetyLimits(expectedInputBytes, safety, "预计");

  const downloads = [];
  let bufferedInputBytes = 0;
  for (const [index, segment] of prepared.segments.entries()) {
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    const role = segment.context?.roleLabel || segment.context?.role || "";
    const suffix = role ? ` ${index + 1}/${prepared.count} ${role}` : ` ${index + 1}/${prepared.count}`;
    setStatus(`${TEXT.downloading}${suffix}`);
    const remainingBytes = safety.maxInputBytes - bufferedInputBytes;
    if (remainingBytes <= 0) {
      throw dashSafetyLimitError(safety, bufferedInputBytes, "已下载");
    }
    const diagnostic = await downloadSegment(segment, {
      save: false,
      maxBytes: remainingBytes,
      limitMessage: dashSafetyLimitMessage(safety, 0, "下载")
    });
    const blob = diagnostic.blob;
    downloads.push({
      segment,
      diagnostic,
      blob
    });
    delete diagnostic.blob;
    bufferedInputBytes += blob?.size || 0;
    assertDashInputWithinSafetyLimits(bufferedInputBytes, safety, "已下载");
    state.lastDiagnostic = diagnostic;
  }

  const video = downloads.find((item) => item.segment.context?.role === "video");
  const audio = downloads.find((item) => item.segment.context?.role === "audio");
  if (!video?.blob || !audio?.blob) {
    throw new Error("DASH video or audio data was not downloaded.");
  }

  await waitForDownloadControl();
  throwIfDownloadCanceled();
  setStatus(TEXT.muxing);
  beginMuxProgress(video.blob.size + audio.blob.size);
  try {
    const { muxDashToMp4 } = await loadDashMuxer();
    const merged = await muxDashToMp4({
      videoBlob: video.blob,
      audioBlob: audio.blob,
      outputName: dashOutputFilename(prepared)
    });
    if (merged?.blob?.size > safety.maxFileBytes) {
      throw new Error(`合并后的 MP4 为 ${formatBytes(merged.blob.size)}，超过设置的 DASH 文件上限 ${formatBytes(safety.maxFileBytes)}；未保存文件。请降低清晰度，或在“内存与录制保护”中调高上限。`);
    }
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    const downloadFilename = filenameForPageDownload(merged.filename);
    saveBlob(merged.blob, downloadFilename);
    completeProgress({
      size: merged.blob.size,
      totalBytes: merged.blob.size,
      receivedBytes: merged.blob.size
    });
    const diagnostic = createMuxDiagnostic(prepared, downloads, merged);
    state.lastDiagnostic = diagnostic;
    await saveDiagnostic(diagnostic);
    setStatus(`${TEXT.dashMuxed}: ${downloadFilename}`);
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      throw error;
    }
    const diagnostic = createMuxDiagnostic(prepared, downloads, null, error);
    state.lastDiagnostic = diagnostic;
    await saveDiagnostic(diagnostic);
    throw diagnosticError(error.message, diagnostic);
  }
}

async function downloadSegment(segment, options = {}) {
  const diagnostic = createPageDiagnostic(segment);
  const downloadOptions = {
    save: options.save !== false,
    maxBytes: normalizeMediaLimitBytes(options.maxBytes),
    limitMessage: String(options.limitMessage || "")
  };
  if (isExtensionFetchPreferred(segment.url)) {
    try {
      return await downloadViaExtensionBlob(segment, diagnostic, null, downloadOptions);
    } catch (error) {
      if (isDownloadCanceledError(error) || isMediaSafetyLimitError(error)) {
        throw error;
      }
      return downloadViaPageBlob(segment, diagnostic, error, downloadOptions);
    }
  }

  try {
    return await downloadViaPageBlob(segment, diagnostic, null, downloadOptions);
  } catch (error) {
    if (isDownloadCanceledError(error) || isMediaSafetyLimitError(error)) {
      throw error;
    }
    return downloadViaExtensionBlob(segment, diagnostic, error, downloadOptions);
  }
}

async function recordLiveSegment(segment, control) {
  const diagnostic = createPageDiagnostic(segment);
  const candidates = readCandidates(segment);
  let lastError = null;

  for (const [index, candidate] of candidates.entries()) {
    diagnostic.phase = "recording-live";
    diagnostic.context = {
      ...segment.context,
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      candidateKind: candidate.kind
    };
    diagnostic.request = {
      media: summarizeUrl(candidate.url),
      filename: segment.filename
    };

    try {
      const result = await fetchLiveRecording(candidate.url, filenameForPageDownload(segment.filename), control, {
        segmentIndex: 1,
        segmentCount: 1,
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        totalBytes: 0
      });
      diagnostic.candidateAttempts.push({
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        fetch: pickFetchResult(result)
      });
      diagnostic.fetch = pickFetchResult(result);
      diagnostic.phase = result.stoppedBySafetyLimit
        ? "stopped-by-safety-limit"
        : result.savedToDisk === false
          ? "stopped"
          : "complete";
      diagnostic.error = null;
      diagnostic.saved = {
        filename: result.filename,
        mime: result.mime,
        size: result.size,
        method: "live-recording",
        mode: "live-flv",
        savedToDisk: result.savedToDisk === true,
        stopReason: result.stopReason || ""
      };
      if (result.stoppedBySafetyLimit) {
        diagnostic.safety = {
          stopReason: result.stopReason,
          maxBytes: result.maxBytes,
          maxFileBytes: result.maxFileBytes,
          maxMemoryBytes: result.maxMemoryBytes,
          maxDurationMs: result.maxDurationMs
        };
      }
      completeProgress(result);
      await saveDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
      if (isDownloadCanceledError(error)) {
        const result = error.result || {};
        const savedToDisk = result.savedToDisk === true && Number(result.size) > 0;
        diagnostic.phase = savedToDisk ? "complete" : "stopped";
        diagnostic.error = null;
        diagnostic.saved = {
          filename: result.filename || filenameForPageDownload(segment.filename),
          mime: result.mime || "video/x-flv",
          size: result.size || 0,
          method: "live-recording",
          mode: "live-flv",
          savedToDisk,
          stopReason: result.stopReason || "user"
        };
        completeProgress(result);
        await saveDiagnostic(diagnostic);
        error.diagnostic = diagnostic;
        throw error;
      }

      diagnostic.phase = "live-recording-error";
      diagnostic.error = error.message;
      diagnostic.candidateAttempts.push({
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        error: error.message
      });
      await saveDiagnostic(diagnostic);
      lastError = diagnosticError(error.message, diagnostic);
    }
  }

  throw lastError || diagnosticError("All live stream candidates failed.", diagnostic);
}

async function fetchLiveRecording(url, filename, control, progressContext) {
  const abortController = new AbortController();
  control.abortControllers.add(abortController);
  const safety = getLiveSafetyLimits();
  const maxBytes = safety.maxBytes;
  const maxDurationMs = safety.maxDurationMs;
  const recordingStartedAt = Number(control.liveStartedAt) || Date.now();
  const deadlineAt = Number(control.liveDeadlineAt) || recordingStartedAt + maxDurationMs;
  control.liveStartedAt = recordingStartedAt;
  control.liveDeadlineAt = deadlineAt;
  const chunks = [];
  let receivedBytes = 0;
  let response = null;
  let stoppedByUser = false;
  let stoppedBySafetyLimit = false;
  let stopReason = "";
  let limitTimer = null;

  const durationMs = () => (
    Math.max(Date.now() - recordingStartedAt, 0)
  );
  const stoppedResult = (savedToDisk = false, blob = null) => ({
    ok: true,
    responseOk: Boolean(response?.ok),
    status: response?.status || 0,
    statusText: response?.statusText || "",
    mime: blob?.type || response?.headers?.get("content-type") || "video/x-flv",
    size: blob?.size || receivedBytes,
    totalBytes: blob?.size || receivedBytes,
    receivedBytes,
    durationMs: durationMs(),
    filename,
    mode: "live-flv",
    savedToDisk,
    stoppedByUser: stoppedByUser || control.canceled,
    stoppedBySafetyLimit,
    stopReason,
    maxBytes,
    maxFileBytes: safety.maxFileBytes,
    maxMemoryBytes: safety.maxMemoryBytes,
    maxDurationMs
  });
  const stopForSafetyLimit = (reason) => {
    if (control.canceled || stoppedBySafetyLimit) {
      return;
    }
    stoppedBySafetyLimit = true;
    stopReason = reason;
    abortController.abort();
  };

  try {
    if (control.canceled) {
      const error = downloadCanceledError();
      error.result = stoppedResult(false);
      throw error;
    }
    beginCandidateProgress({
      ...progressContext,
      totalBytes: 0
    });
    state.progress.durationMs = durationMs();
    renderProgress();
    const remainingDurationMs = Math.max(deadlineAt - Date.now(), 0);
    if (remainingDurationMs <= 0) {
      stoppedBySafetyLimit = true;
      stopReason = "duration";
      return stoppedResult(false);
    }
    if (typeof setTimeout === "function") {
      limitTimer = setTimeout(() => stopForSafetyLimit("duration"), remainingDurationMs);
    }
    response = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: {
        "Accept": "*/*"
      },
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status || "unknown"}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Live stream response did not include a readable body.");
    }

    while (true) {
      await waitForSpecificControl(control);
      if (control.canceled) {
        stoppedByUser = true;
        break;
      }
      let packet = null;
      try {
        packet = await reader.read();
      } catch (error) {
        if (control.canceled || error?.name === "AbortError") {
          stoppedByUser = control.canceled;
          break;
        }
        throw error;
      }

      if (packet.done) {
        break;
      }

      if (stoppedBySafetyLimit) {
        break;
      }
      const nextReceivedBytes = receivedBytes + packet.value.byteLength;
      if (maxBytes > 0 && nextReceivedBytes > maxBytes) {
        stopForSafetyLimit("size");
        break;
      }

      chunks.push(packet.value);
      receivedBytes = nextReceivedBytes;
      updateProgress({
        ...progressContext,
        receivedBytes,
        totalBytes: 0,
        done: false
      });
      if (maxBytes > 0 && receivedBytes >= maxBytes) {
        stopForSafetyLimit("size");
        break;
      }
    }

    state.progress.durationMs = durationMs();
    if (receivedBytes <= 0) {
      const result = stoppedResult(false);
      if (result.stoppedByUser) {
        const error = downloadCanceledError();
        error.result = result;
        throw error;
      }
      return result;
    }
    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") || "video/x-flv"
    });
    if (blob.size <= 0) {
      return stoppedResult(false);
    }

    saveBlob(blob, filename);
    return stoppedResult(true, blob);
  } catch (error) {
    if (stoppedBySafetyLimit) {
      return stoppedResult(false);
    }
    if (control.canceled && error?.name === "AbortError") {
      const canceled = downloadCanceledError();
      canceled.result = stoppedResult(false);
      throw canceled;
    }
    throw error;
  } finally {
    if (limitTimer !== null && typeof clearTimeout === "function") {
      clearTimeout(limitTimer);
    }
    control.abortControllers.delete(abortController);
  }
}

async function downloadViaPageBlob(segment, diagnostic = createPageDiagnostic(segment), previousError = null, options = {}) {
  const candidates = readCandidates(segment);
  let lastError = previousError;

  for (const [index, candidate] of candidates.entries()) {
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    diagnostic.phase = "fetching-page-blob";
    diagnostic.context = {
      ...segment.context,
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      candidateKind: candidate.kind
    };
    diagnostic.request = {
      media: summarizeUrl(candidate.url),
      filename: segment.filename
    };
    beginCandidateProgress({
      segmentIndex: segment.context?.segmentIndex || 1,
      segmentCount: segment.context?.segmentCount || 1,
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      totalBytes: candidate.size || segment.size || 0
    });

    try {
      const [injection] = await chrome.scripting.executeScript({
        target: {
          tabId: state.tabId
        },
        world: "MAIN",
        func: downloadMediaInPage,
        args: [
          candidate.url,
          filenameForPageDownload(segment.filename),
          options.save !== false,
          {
            segmentIndex: segment.context?.segmentIndex || 1,
            segmentCount: segment.context?.segmentCount || 1,
            candidateIndex: index + 1,
            candidateCount: candidates.length,
            totalBytes: candidate.size || segment.size || 0
          },
          PAGE_DOWNLOAD_CONTROL_EVENT,
          currentDownloadControlState(),
          {
            maxBytes: options.maxBytes,
            limitMessage: options.limitMessage
          }
        ]
      });

      const result = injection?.result;
      throwIfDownloadCanceled();
      const attempt = {
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        fetch: pickFetchResult(result)
      };
      diagnostic.candidateAttempts.push(attempt);
      diagnostic.fetch = attempt.fetch;

      if (result?.limitReached) {
        diagnostic.phase = "page-fetch-safety-limit";
        diagnostic.error = result.error || "媒体大小超过安全上限。";
        diagnostic.safety = {
          maxBytes: options.maxBytes || 0
        };
        await saveDiagnostic(diagnostic);
        const error = diagnosticError(diagnostic.error, diagnostic);
        error.safetyLimit = true;
        throw error;
      }

      if (!result?.ok) {
        if (state.downloadControl?.canceled) {
          throw downloadCanceledError();
        }
        diagnostic.phase = "page-fetch-message-error";
        diagnostic.error = result?.error || "Page fetch failed.";
        lastError = diagnosticError(diagnostic.error, diagnostic);
        await saveDiagnostic(diagnostic);
        continue;
      }

      if (!result.responseOk) {
        diagnostic.phase = "page-fetch-http-error";
        diagnostic.error = `HTTP ${result.status || "unknown"}`;
        lastError = diagnosticError(diagnostic.error, diagnostic);
        await saveDiagnostic(diagnostic);
        continue;
      }

      diagnostic.phase = "complete";
      diagnostic.error = null;
      completeProgress(result);
      diagnostic.saved = {
        filename: result.filename,
        mime: result.mime,
        size: result.size,
        method: "page-blob",
        mode: result.mode,
        savedToDisk: result.savedToDisk !== false
      };
      if (result.blob && options.save === false) {
        diagnostic.blob = result.blob;
      }
      await saveDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
      if (isDownloadCanceledError(error)) {
        throw error;
      }
      if (isMediaSafetyLimitError(error)) {
        throw error;
      }
      if (error.diagnostic) {
        lastError = error;
        continue;
      }

      diagnostic.phase = "page-blob-error";
      diagnostic.error = error.message;
      diagnostic.candidateAttempts.push({
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        error: error.message
      });
      await saveDiagnostic(diagnostic);
      lastError = diagnosticError(error.message, diagnostic);
    }
  }

  return downloadViaExtensionBlob(segment, diagnostic, lastError, options);
}

async function downloadViaExtensionBlob(segment, diagnostic, previousError, options = {}) {
  const candidates = readCandidates(segment);
  let lastError = previousError;

  for (const [index, candidate] of candidates.entries()) {
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    diagnostic.phase = "fetching-extension-blob";
    diagnostic.context = {
      ...segment.context,
      downloadMethod: "extension-blob",
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      candidateKind: candidate.kind
    };
    diagnostic.request = {
      media: summarizeUrl(candidate.url),
      filename: segment.filename
    };
    beginCandidateProgress({
      segmentIndex: segment.context?.segmentIndex || 1,
      segmentCount: segment.context?.segmentCount || 1,
      candidateIndex: index + 1,
      candidateCount: candidates.length,
      totalBytes: candidate.size || segment.size || 0
    });

    try {
      const result = await fetchMediaInExtension(
        candidate.url,
        filenameForPageDownload(segment.filename),
        options.save !== false,
        {
          segmentIndex: segment.context?.segmentIndex || 1,
          segmentCount: segment.context?.segmentCount || 1,
          candidateIndex: index + 1,
          candidateCount: candidates.length,
          totalBytes: candidate.size || segment.size || 0
        },
        {
          maxBytes: options.maxBytes,
          limitMessage: options.limitMessage
        }
      );
      const attempt = {
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        fetch: pickFetchResult(result)
      };
      diagnostic.extensionCandidateAttempts.push(attempt);
      diagnostic.fetch = attempt.fetch;

      if (result?.limitReached) {
        diagnostic.phase = "extension-fetch-safety-limit";
        diagnostic.error = result.error || "媒体大小超过安全上限。";
        diagnostic.safety = {
          maxBytes: options.maxBytes || 0
        };
        await saveDiagnostic(diagnostic);
        const error = diagnosticError(diagnostic.error, diagnostic);
        error.safetyLimit = true;
        throw error;
      }

      if (!result?.ok) {
        diagnostic.phase = "extension-fetch-message-error";
        diagnostic.error = result?.error || "Extension fetch failed.";
        lastError = diagnosticError(diagnostic.error, diagnostic);
        await saveDiagnostic(diagnostic);
        continue;
      }

      if (!result.responseOk) {
        diagnostic.phase = "extension-fetch-http-error";
        diagnostic.error = `HTTP ${result.status || "unknown"}`;
        lastError = diagnosticError(diagnostic.error, diagnostic);
        await saveDiagnostic(diagnostic);
        continue;
      }

      diagnostic.phase = "complete";
      diagnostic.error = null;
      completeProgress(result);
      diagnostic.saved = {
        filename: result.filename,
        mime: result.mime,
        size: result.size,
        method: "extension-blob",
        mode: result.mode,
        savedToDisk: result.savedToDisk !== false
      };
      if (result.blob && options.save === false) {
        diagnostic.blob = result.blob;
      }
      await saveDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
      if (isDownloadCanceledError(error)) {
        throw error;
      }
      if (isMediaSafetyLimitError(error)) {
        throw error;
      }
      diagnostic.phase = "extension-blob-error";
      diagnostic.error = error.message;
      diagnostic.extensionCandidateAttempts.push({
        at: new Date().toISOString(),
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        candidateKind: candidate.kind,
        request: {
          media: summarizeUrl(candidate.url)
        },
        error: error.message
      });
      await saveDiagnostic(diagnostic);
      lastError = diagnosticError(error.message, diagnostic);
    }
  }

  throw lastError || diagnosticError("All media candidates failed.", diagnostic);
}

async function copyDiagnostic() {
  if (!state.lastDiagnostic) {
    setStatus(TEXT.noDiagnostic);
    return;
  }

  const exportedDiagnostic = sanitizeDiagnosticForExport(state.lastDiagnostic);
  await navigator.clipboard.writeText(
    JSON.stringify(
      {
        page: sanitizeDiagnosticForExport(state.page),
        selectedQuality: qualitySelect.value,
        diagnostic: exportedDiagnostic
      },
      null,
      2
    )
  );
  setStatus(TEXT.diagnosticCopied);
}

async function loadLastDiagnostic() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_GET_DIAGNOSTIC"
    });
    if (response?.ok && response.payload) {
      state.lastDiagnostic = sanitizeDiagnosticForExport(response.payload);
    }
  } catch (_error) {
    state.lastDiagnostic = null;
  }
}

async function saveDiagnostic(diagnostic) {
  if (!diagnostic) {
    return;
  }

  const safeDiagnostic = sanitizeDiagnosticForExport(diagnostic);
  state.lastDiagnostic = safeDiagnostic;
  try {
    await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_SAVE_DIAGNOSTIC",
      payload: safeDiagnostic
    });
  } catch (_error) {
    // The copied diagnostic in this popup is enough if the service worker is asleep.
  }
}

function createPageDiagnostic(segment) {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    phase: "created",
    context: segment.context,
    request: {
      media: summarizeUrl(segment.url),
      filename: segment.filename
    },
    events: [],
    dnrMatchedEvents: [],
    candidateAttempts: [],
    extensionCandidateAttempts: []
  };
}

function createMuxDiagnostic(prepared, downloads, merged = null, error = null) {
  const firstSegment = prepared.segments?.[0] || {};
  const diagnostic = {
    version: 3,
    createdAt: new Date().toISOString(),
    phase: error ? "mux-error" : "complete",
    context: {
      ...(firstSegment.context || {}),
      format: "dash-muxed",
      segmentCount: prepared.count,
      downloadMethod: "browser-mux"
    },
    request: {
      media: downloads.map((item) => ({
        role: item.segment.context?.role || "",
        source: summarizeUrl(item.segment.url),
        filename: item.segment.filename,
        size: item.blob?.size || item.diagnostic?.saved?.size || 0
      })),
      filename: merged?.filename || dashOutputFilename(prepared)
    },
    events: [],
    dnrMatchedEvents: [],
    segmentDiagnostics: downloads.map((item) => sanitizeDiagnosticForNested(item.diagnostic)),
    mux: merged
      ? {
          ok: true,
          video: merged.video,
          audio: merged.audio,
          size: merged.blob.size
        }
      : {
          ok: false,
          error: error?.message || "Mux failed."
        }
  };

  if (merged) {
    diagnostic.saved = {
      filename: merged.filename,
      mime: merged.blob.type,
      size: merged.blob.size,
      method: "browser-mux",
      mode: "dash-muxed-mp4"
    };
  } else {
    diagnostic.error = error?.message || "Mux failed.";
  }
  return diagnostic;
}

function sanitizeDiagnosticForNested(diagnostic) {
  if (!diagnostic) {
    return null;
  }
  return sanitizeDiagnosticForExport(diagnostic);
}

function pickFetchResult(response) {
  if (!response) {
    return null;
  }

  if (!response.ok) {
    return {
      ok: false,
      error: response.error || ""
    };
  }

  return {
    ok: true,
    responseOk: response.responseOk,
    status: response.status,
    statusText: response.statusText,
    mime: response.mime,
    size: response.size,
    totalBytes: response.totalBytes,
    receivedBytes: response.receivedBytes,
    mode: response.mode,
    chunkCount: response.chunkCount,
    concurrency: response.concurrency,
    fallback: response.fallback,
    savedToDisk: response.savedToDisk
  };
}

function diagnosticError(message, diagnostic) {
  const error = new Error(message);
  error.diagnostic = diagnostic;
  return error;
}

function createDownloadControl() {
  return {
    paused: false,
    canceled: false,
    cancelPending: false,
    nativeTaskId: "",
    companionTaskId: "",
    batchJobId: "",
    abortControllers: new Set(),
    waiters: []
  };
}

function togglePauseDownload() {
  const control = state.downloadControl;
  if (!control || control.canceled) {
    return;
  }

  if (control.companionTaskId) {
    setStatus("本地流式助手任务暂不支持暂停；可在任务中心取消。");
    renderDownloadControls();
    return;
  }

  control.paused = !control.paused;
  if (control.paused) {
    setStatus(TEXT.paused);
  } else {
    setStatus(TEXT.resumed);
    resumeDownloadWaiters(control);
  }
  if (control.batchJobId) {
    updateBatchJob(control.batchJobId, {
      state: control.paused ? "paused" : "in_progress",
      error: ""
    }).catch(() => {});
  }
  if (control.nativeTaskId) {
    const requestedPause = control.paused;
    requestNativeDirectTaskControl(control.nativeTaskId, requestedPause ? "pause" : "resume")
      .catch((error) => {
        if (state.downloadControl === control && !control.canceled && control.paused === requestedPause) {
          control.paused = !requestedPause;
          setStatus(error.message);
          renderDownloadControls();
        }
      });
  } else {
    notifyPageDownloadControl();
  }
  renderDownloadControls();
}

async function cancelDownload() {
  const control = state.downloadControl;
  if (!control || control.canceled) {
    return;
  }

  if (control.batchJobId) {
    cancelBatchJob(control.batchJobId).catch((error) => {
      setStatus(error.message || "无法取消下载队列。");
    });
    return;
  }

  if (control.nativeTaskId) {
    const taskId = control.nativeTaskId;
    control.cancelPending = true;
    setStatus("正在确认取消原生下载…");
    renderDownloadControls();
    try {
      const task = await requestNativeDirectTaskControl(taskId, "cancel");
      if (!task || !["canceling", "canceled"].includes(String(task.state || ""))) {
        throw new Error("浏览器未确认原生下载已经进入取消流程。");
      }
      if (task.state !== "canceled") {
        setStatus("正在等待浏览器确认取消…");
        renderDownloadControls();
        return;
      }
      control.cancelPending = false;
      control.canceled = true;
      control.paused = false;
      for (const abortController of control.abortControllers) {
        abortController.abort();
      }
      resumeDownloadWaiters(control);
      settleNativeDirectTaskWaiter(task);
      clearProgress();
      setStatus(TEXT.canceled);
      renderDownloadControls();
      return;
    } catch (error) {
      if (state.downloadControl === control) {
        control.cancelPending = false;
        setStatus(error.message || "无法取消原生下载。");
        renderDownloadControls();
      }
      return;
    }
  }

  control.canceled = true;
  control.paused = false;
  for (const abortController of control.abortControllers) {
    abortController.abort();
  }
  resumeDownloadWaiters(control);
  if (control.companionTaskId) {
    requestCompanionTaskControl(control.companionTaskId, "cancel").catch((error) => {
      if (state.downloadControl === control) {
        control.canceled = false;
        setStatus(error.message || "无法取消本地流式助手任务。");
        renderDownloadControls();
      }
    });
  } else {
    notifyPageDownloadControl();
  }
  clearProgress();
  setStatus(TEXT.canceled);
  renderDownloadControls();
}

function resumeDownloadWaiters(control) {
  const waiters = control.waiters.splice(0);
  for (const resolve of waiters) {
    resolve();
  }
}

async function waitForDownloadControl() {
  const control = state.downloadControl;
  if (!control) {
    return;
  }

  await waitForSpecificControl(control);
}

async function waitForSpecificControl(control) {
  if (!control) {
    return;
  }

  while (control.paused && !control.canceled) {
    await new Promise((resolve) => control.waiters.push(resolve));
  }
  if (control.canceled && !control.liveRecording) {
    throw downloadCanceledError();
  }
}

function throwIfDownloadCanceled() {
  if (state.downloadControl?.canceled) {
    throw downloadCanceledError();
  }
}

function downloadCanceledError() {
  const error = new Error(TEXT.canceled);
  error.name = "DownloadCanceledError";
  return error;
}

function isDownloadCanceledError(error) {
  return error?.name === "DownloadCanceledError" ||
    (state.downloadControl?.canceled && error?.name === "AbortError");
}

function getDownloadAbortSignal() {
  const control = state.downloadControl;
  if (!control || typeof AbortController === "undefined") {
    return undefined;
  }

  const abortController = new AbortController();
  control.abortControllers.add(abortController);
  if (control.canceled) {
    abortController.abort();
  }
  return abortController.signal;
}

function notifyPageDownloadControl() {
  if (!state.tabId || !state.downloadControl) {
    return;
  }

  try {
    const promise = chrome.scripting.executeScript({
      target: {
        tabId: state.tabId
      },
      world: "MAIN",
      func: dispatchPageDownloadControl,
      args: [
        PAGE_DOWNLOAD_CONTROL_EVENT,
        {
          paused: state.downloadControl.paused,
          canceled: state.downloadControl.canceled
        }
      ]
    });
    promise?.catch?.(() => {});
  } catch (_error) {
    // Page-context controls are best-effort; extension fetches remain controlled.
  }
}

function currentDownloadControlState() {
  return {
    paused: Boolean(state.downloadControl?.paused),
    canceled: Boolean(state.downloadControl?.canceled)
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

function sanitizeDiagnosticForExport(value) {
  return sanitizeDiagnosticValue(value);
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

function filenameForPageDownload(filename) {
  const normalized = String(filename || "bili_video.mp4").replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || "bili_video.mp4";
}

function dashOutputFilename(prepared) {
  const video = prepared.segments?.find((segment) => segment.context?.role === "video") || prepared.segments?.[0];
  const normalized = String(video?.filename || "BiliDownload/bili_video.mp4")
    .replace(/\\/g, "/")
    .replace(/_(video|audio)\.m4s$/i, ".mp4")
    .replace(/\.m4s$/i, ".mp4");
  return normalized.endsWith(".mp4") ? normalized : `${normalized}.mp4`;
}

async function loadDashMuxer() {
  if (globalThis.__biliDownloadMuxer) {
    return globalThis.__biliDownloadMuxer;
  }
  return import("./dash-muxer.mjs");
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

function isExtensionFetchPreferred(value) {
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".bilivideo.com") ||
      host.endsWith(".bilivideo.cn") ||
      host.endsWith(".hdslb.com") ||
      host.endsWith(".edge.mountaintoys.cn");
  } catch (_error) {
    return false;
  }
}

async function downloadMediaInPage(url, filename, saveToDisk, progressContext, controlEventName, initialControlState = null, safety = null) {
  const control = {
    paused: Boolean(initialControlState?.paused),
    canceled: Boolean(initialControlState?.canceled),
    waiters: [],
    abortController: new AbortController()
  };
  const maxBytes = Number(safety?.maxBytes) > 0 ? Math.floor(Number(safety.maxBytes)) : 0;
  const limitMessage = String(safety?.limitMessage || "媒体大小超过安全上限，已停止且未保存文件。");
  const mediaSafetyLimitError = () => {
    const error = new Error(limitMessage);
    error.name = "MediaSafetyLimitError";
    return error;
  };
  if (control.canceled) {
    control.abortController.abort();
  }
  const onControl = (event) => {
    control.paused = Boolean(event.detail?.paused);
    if (event.detail?.canceled) {
      control.canceled = true;
      control.paused = false;
      control.abortController.abort();
    }
    const waiters = control.waiters.splice(0);
    for (const resolve of waiters) {
      resolve();
    }
  };
  window.addEventListener(controlEventName, onControl);
  const waitForControl = async () => {
    while (control.paused && !control.canceled) {
      await new Promise((resolve) => control.waiters.push(resolve));
    }
    if (control.canceled) {
      const error = new Error("\u5df2\u53d6\u6d88\u4e0b\u8f7d");
      error.name = "DownloadCanceledError";
      throw error;
    }
  };
  const sendProgress = (payload) => {
    try {
      window.dispatchEvent(new CustomEvent("bili-download-progress", {
        detail: payload
      }));
    } catch (_error) {
      // Progress is best-effort; the popup may have been closed.
    }
  };

  try {
    await waitForControl();
    const response = await fetch(url, {
      credentials: "include",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      cache: "no-store",
      signal: control.abortController.signal
    });
    const contentLength = Number(response.headers.get("content-length")) || 0;

    if (maxBytes > 0 && contentLength > maxBytes) {
      control.abortController.abort();
      throw mediaSafetyLimitError();
    }

    if (!response.ok) {
      if (maxBytes > 0) {
        return {
          ok: true,
          responseOk: false,
          status: response.status,
          statusText: response.statusText,
          mime: response.headers.get("content-type") || "",
          size: 0,
          totalBytes: contentLength,
          receivedBytes: 0,
          filename
        };
      }
      const errorBody = await response.blob();
      return {
        ok: true,
        responseOk: false,
        status: response.status,
        statusText: response.statusText,
        mime: errorBody.type || response.headers.get("content-type") || "",
        size: errorBody.size,
        totalBytes: contentLength,
        receivedBytes: 0,
        filename
      };
    }

    const reader = response.body?.getReader();
    const chunks = [];
    let receivedBytes = 0;
    let lastProgressAt = 0;

    if (!reader) {
      // A response without a readable stream cannot be capped while it is
      // materialized. DASH always supplies maxBytes, so fail safely instead
      // of allowing a malformed response to bypass the memory guard.
      if (maxBytes > 0) {
        throw mediaSafetyLimitError();
      }
      const body = await response.blob();
      receivedBytes = body.size;
      await waitForControl();
      sendProgress({
        ...progressContext,
        receivedBytes,
        totalBytes: body.size || contentLength,
        done: true
      });
      chunks.push(body);
    } else {
      while (true) {
        await waitForControl();
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await waitForControl();

        if (maxBytes > 0 && receivedBytes + value.byteLength > maxBytes) {
          control.abortController.abort();
          throw mediaSafetyLimitError();
        }
        chunks.push(value);
        receivedBytes += value.byteLength;
        const now = Date.now();
        if (now - lastProgressAt > 180) {
          lastProgressAt = now;
          sendProgress({
            ...progressContext,
            receivedBytes,
            totalBytes: contentLength,
            done: false
          });
        }
      }
    }

    await waitForControl();
    sendProgress({
      ...progressContext,
      receivedBytes,
      totalBytes: contentLength || receivedBytes,
      done: true
    });

    const mime = response.headers.get("content-type") || "video/mp4";
    const body = new Blob(chunks, {
      type: mime
    });

    if (saveToDisk !== false) {
      const blobUrl = URL.createObjectURL(body);
      try {
        const anchor = document.createElement("a");
        anchor.href = blobUrl;
        anchor.download = filename;
        anchor.rel = "noopener";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      }
    }

    return {
      ok: true,
      responseOk: true,
      status: response.status,
      statusText: response.statusText,
      mime: body.type || response.headers.get("content-type") || "",
      size: body.size,
      totalBytes: contentLength || body.size,
      receivedBytes,
      filename,
      mode: "page-blob",
      savedToDisk: saveToDisk !== false,
      blob: saveToDisk === false ? body : null
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      limitReached: error?.name === "MediaSafetyLimitError",
      filename,
      mode: "page-blob"
    };
  } finally {
    window.removeEventListener(controlEventName, onControl);
  }
}

function dispatchPageDownloadControl(controlEventName, detail) {
  window.dispatchEvent(new CustomEvent(controlEventName, {
    detail
  }));
}

async function fetchMediaInExtension(url, filename, saveToDisk, progressContext, safety = null) {
  const expectedSize = Number(progressContext?.totalBytes) || 0;
  const maxBytes = normalizeMediaLimitBytes(safety?.maxBytes);
  if (maxBytes > 0 && expectedSize > maxBytes) {
    return {
      ok: false,
      error: String(safety?.limitMessage || "媒体大小超过安全上限，已停止且未保存文件。"),
      limitReached: true,
      filename,
      mode: "extension-preflight"
    };
  }
  if (expectedSize >= PARALLEL_RANGE_MIN_BYTES) {
    const parallelResult = await fetchMediaInExtensionRanges(url, filename, saveToDisk, progressContext, expectedSize, safety);
    if (parallelResult?.ok && parallelResult.responseOk) {
      return parallelResult;
    }
    if (parallelResult?.limitReached) {
      return parallelResult;
    }

    const singleResult = await fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext, safety);
    if (singleResult) {
      singleResult.fallback = {
        from: "extension-range",
        error: parallelResult?.error || "Parallel range download failed."
      };
    }
    return singleResult;
  }

  return fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext, safety);
}

async function fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext, safety = null) {
  const maxBytes = normalizeMediaLimitBytes(safety?.maxBytes);
  const limitMessage = String(safety?.limitMessage || "媒体大小超过安全上限，已停止且未保存文件。");
  try {
    await waitForDownloadControl();
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "video/*,*/*;q=0.8"
      },
      cache: "no-store",
      signal: getDownloadAbortSignal()
    });
    const contentLength = Number(response.headers.get("content-length")) ||
      Number(progressContext?.totalBytes) ||
      0;

    if (maxBytes > 0 && contentLength > maxBytes) {
      throw createMediaSafetyLimitError(limitMessage);
    }

    if (!response.ok) {
      if (maxBytes > 0) {
        return {
          ok: true,
          responseOk: false,
          status: response.status,
          statusText: response.statusText,
          mime: response.headers.get("content-type") || "",
          size: 0,
          totalBytes: contentLength,
          receivedBytes: 0,
          filename
        };
      }
      const errorBody = await response.blob();
      return {
        ok: true,
        responseOk: false,
        status: response.status,
        statusText: response.statusText,
        mime: errorBody.type || response.headers.get("content-type") || "",
        size: errorBody.size,
        totalBytes: contentLength,
        receivedBytes: 0,
        filename
      };
    }

    const reader = response.body?.getReader();
    const chunks = [];
    let receivedBytes = 0;
    let lastProgressAt = 0;

    if (!reader) {
      // A response without a readable stream cannot be capped while it is
      // materialized. DASH always supplies maxBytes, so fail safely instead
      // of allowing a malformed response to bypass the memory guard.
      if (maxBytes > 0) {
        throw createMediaSafetyLimitError(limitMessage);
      }
      const body = await response.blob();
      receivedBytes = body.size;
      await waitForDownloadControl();
      updateProgress({
        ...progressContext,
        receivedBytes,
        totalBytes: body.size || contentLength,
        done: true
      });
      chunks.push(body);
    } else {
      while (true) {
        await waitForDownloadControl();
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await waitForDownloadControl();

        if (maxBytes > 0 && receivedBytes + value.byteLength > maxBytes) {
          reader.cancel?.();
          throw createMediaSafetyLimitError(limitMessage);
        }
        chunks.push(value);
        receivedBytes += value.byteLength;
        const now = Date.now();
        if (now - lastProgressAt > 180) {
          lastProgressAt = now;
          updateProgress({
            ...progressContext,
            receivedBytes,
            totalBytes: contentLength,
            done: false
          });
        }
      }
    }

    await waitForDownloadControl();
    updateProgress({
      ...progressContext,
      receivedBytes,
      totalBytes: contentLength || receivedBytes,
      done: true
    });

    const mime = response.headers.get("content-type") || "video/mp4";
    const body = new Blob(chunks, {
      type: mime
    });

    if (saveToDisk !== false) {
      saveBlob(body, filename);
    }

    return {
      ok: true,
      responseOk: true,
      status: response.status,
      statusText: response.statusText,
      mime: body.type || response.headers.get("content-type") || "",
      size: body.size,
      totalBytes: contentLength || body.size,
      receivedBytes,
      filename,
      mode: "extension-single",
      savedToDisk: saveToDisk !== false,
      blob: saveToDisk === false ? body : null
    };
  } catch (error) {
    if (isMediaSafetyLimitError(error)) {
      return {
        ok: false,
        error: error.message,
        limitReached: true,
        filename,
        mode: "extension-single"
      };
    }
    if (state.downloadControl?.canceled || error.name === "AbortError" || error.name === "DownloadCanceledError") {
      throw downloadCanceledError();
    }
    return {
      ok: false,
      error: error.message,
      filename,
      mode: "extension-single"
    };
  }
}

async function fetchMediaInExtensionRanges(url, filename, saveToDisk, progressContext, totalBytes, safety = null) {
  const maxBytes = normalizeMediaLimitBytes(safety?.maxBytes);
  if (maxBytes > 0 && totalBytes > maxBytes) {
    return {
      ok: false,
      error: String(safety?.limitMessage || "媒体大小超过安全上限，已停止且未保存文件。"),
      limitReached: true,
      filename,
      mode: "extension-range"
    };
  }
  const ranges = buildRanges(totalBytes, PARALLEL_RANGE_CHUNK_BYTES);
  const chunks = new Array(ranges.length);
  const rangeProgress = new Array(ranges.length).fill(0);
  const attemptController = typeof AbortController !== "undefined"
    ? new AbortController()
    : { signal: undefined, abort() {} };
  const downloadControl = state.downloadControl;
  downloadControl?.abortControllers?.add(attemptController);
  let lastProgressAt = 0;
  let attemptError = null;

  const emitRangeProgress = () => {
    const now = Date.now();
    if (now - lastProgressAt <= 180) {
      return;
    }
    lastProgressAt = now;
    updateProgress({
      ...progressContext,
      receivedBytes: rangeProgress.reduce((sum, value) => sum + value, 0),
      totalBytes,
      done: false
    });
  };

  try {
    let nextIndex = 0;
    const worker = async () => {
      try {
        while (!attemptError && nextIndex < ranges.length) {
          await waitForDownloadControl();
          throwIfDownloadCanceled();
          if (attemptError) {
            return;
          }
          const rangeIndex = nextIndex;
          nextIndex += 1;
          chunks[rangeIndex] = await fetchRangeChunk(
            url,
            ranges[rangeIndex],
            (loadedBytes) => {
              rangeProgress[rangeIndex] = loadedBytes;
              emitRangeProgress();
            },
            attemptController.signal
          );
          rangeProgress[rangeIndex] = ranges[rangeIndex].end - ranges[rangeIndex].start + 1;
          emitRangeProgress();
        }
      } catch (error) {
        if (!attemptError) {
          attemptError = error;
          attemptController.abort();
        }
        throw error;
      }
    };

    const workerCount = Math.min(PARALLEL_RANGE_CONCURRENCY, ranges.length);
    const results = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));
    if (attemptError) {
      throw attemptError;
    }
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected) {
      throw rejected.reason;
    }
    await waitForDownloadControl();
    updateProgress({
      ...progressContext,
      receivedBytes: totalBytes,
      totalBytes,
      done: true
    });

    const body = new Blob(chunks, {
      type: "video/mp4"
    });
    if (saveToDisk !== false) {
      saveBlob(body, filename);
    }
    return {
      ok: true,
      responseOk: true,
      status: 206,
      statusText: "Partial Content",
      mime: body.type,
      size: body.size,
      totalBytes,
      receivedBytes: totalBytes,
      filename,
      mode: "extension-range",
      chunkCount: ranges.length,
      concurrency: workerCount,
      savedToDisk: saveToDisk !== false,
      blob: saveToDisk === false ? body : null
    };
  } catch (error) {
    if (isMediaSafetyLimitError(error)) {
      return {
        ok: false,
        error: error.message,
        limitReached: true,
        filename,
        mode: "extension-range"
      };
    }
    if (state.downloadControl?.canceled || error.name === "AbortError" || error.name === "DownloadCanceledError") {
      throw downloadCanceledError();
    }
    return {
      ok: false,
      error: error.message,
      filename,
      mode: "extension-range"
    };
  } finally {
    attemptController.abort();
    downloadControl?.abortControllers?.delete(attemptController);
  }
}

async function fetchRangeChunk(url, range, onProgress, signal = undefined) {
  const expectedBytes = range.end - range.start + 1;
  await waitForDownloadControl();
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Accept": "video/*,*/*;q=0.8",
      "Range": `bytes=${range.start}-${range.end}`
    },
    cache: "no-store",
    signal: signal || getDownloadAbortSignal()
  });

  if (response.status !== 206) {
    throw new Error(`Range request returned HTTP ${response.status || "unknown"}.`);
  }

  const contentLength = Number(response.headers.get("content-length")) || 0;
  if (contentLength > expectedBytes) {
    throw createMediaSafetyLimitError(
      `Range 响应大小 ${formatBytes(contentLength)} 超过请求块上限 ${formatBytes(expectedBytes)}；已停止以保护内存。`
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Range 响应不支持安全的流式读取，已停止此分块请求。");
  }

  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    await waitForDownloadControl();
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    await waitForDownloadControl();

    const nextReceivedBytes = receivedBytes + value.byteLength;
    if (nextReceivedBytes > expectedBytes) {
      try {
        const canceled = reader.cancel?.();
        canceled?.catch?.(() => {});
      } catch (_error) {
        // The size guard still prevents this response from being retained.
      }
      throw createMediaSafetyLimitError(
        `Range 响应超过请求块上限 ${formatBytes(expectedBytes)}；已停止以保护内存。`
      );
    }
    chunks.push(value);
    receivedBytes = nextReceivedBytes;
    onProgress(receivedBytes);
  }

  if (receivedBytes !== expectedBytes) {
    throw new Error(`Range chunk size mismatch: ${receivedBytes}/${expectedBytes}.`);
  }

  return new Blob(chunks, {
    type: response.headers.get("content-type") || "video/mp4"
  });
}

function buildRanges(totalBytes, chunkBytes) {
  const ranges = [];
  for (let start = 0; start < totalBytes; start += chunkBytes) {
    ranges.push({
      start,
      end: Math.min(start + chunkBytes - 1, totalBytes - 1)
    });
  }
  return ranges;
}

function saveBlob(blob, filename) {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }
}

function resetProgress() {
  state.progress = {
    active: true,
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
    durationMs: 0,
    startedAt: Date.now(),
    lastAt: Date.now(),
    segmentIndex: 0,
    segmentCount: 0,
    candidateIndex: 0,
    candidateCount: 0
  };
  renderProgress();
}

function clearProgress() {
  state.progress = {
    active: false,
    receivedBytes: 0,
    totalBytes: 0,
    percent: 0,
    speedBytesPerSecond: 0,
    durationMs: 0,
    startedAt: 0,
    lastAt: 0,
    segmentIndex: 0,
    segmentCount: 0,
    candidateIndex: 0,
    candidateCount: 0
  };
  renderProgress();
}

function beginCandidateProgress(context) {
  state.progress.active = true;
  state.progress.receivedBytes = 0;
  state.progress.totalBytes = Number(context.totalBytes) || 0;
  state.progress.percent = 0;
  state.progress.speedBytesPerSecond = 0;
  state.progress.durationMs = 0;
  state.progress.startedAt = Date.now();
  state.progress.lastAt = Date.now();
  state.progress.segmentIndex = context.segmentIndex;
  state.progress.segmentCount = context.segmentCount;
  state.progress.candidateIndex = context.candidateIndex;
  state.progress.candidateCount = context.candidateCount;
  renderProgress();
}

function beginMuxProgress(totalBytes) {
  const size = Number(totalBytes) || 0;
  state.progress.active = true;
  state.progress.receivedBytes = size;
  state.progress.totalBytes = size;
  state.progress.percent = size ? 100 : 0;
  state.progress.speedBytesPerSecond = 0;
  state.progress.durationMs = 0;
  state.progress.startedAt = Date.now();
  state.progress.lastAt = Date.now();
  state.progress.segmentIndex = 0;
  state.progress.segmentCount = 0;
  state.progress.candidateIndex = 0;
  state.progress.candidateCount = 0;
  renderProgress();
}

function updateProgress(payload) {
  if ((!state.busy && !state.downloadControl?.liveRecording) || state.downloadControl?.canceled || !payload) {
    return;
  }

  const now = Date.now();
  const elapsedSeconds = Math.max((now - state.progress.startedAt) / 1000, 0.001);
  const receivedBytes = Number(payload.receivedBytes) || 0;
  const totalBytes = Number(payload.totalBytes) || state.progress.totalBytes || 0;
  state.progress.active = true;
  state.progress.receivedBytes = receivedBytes;
  state.progress.totalBytes = totalBytes;
  state.progress.percent = totalBytes ? Math.min((receivedBytes / totalBytes) * 100, 100) : 0;
  state.progress.speedBytesPerSecond = receivedBytes / elapsedSeconds;
  if (state.downloadControl?.liveRecording) {
    const liveStartedAt = Number(state.downloadControl.liveStartedAt) || state.progress.startedAt;
    state.progress.durationMs = Math.max(now - liveStartedAt, 0);
  }
  state.progress.lastAt = now;
  state.progress.segmentIndex = payload.segmentIndex || state.progress.segmentIndex;
  state.progress.segmentCount = payload.segmentCount || state.progress.segmentCount;
  state.progress.candidateIndex = payload.candidateIndex || state.progress.candidateIndex;
  state.progress.candidateCount = payload.candidateCount || state.progress.candidateCount;
  renderProgress();
}

function completeProgress(result = null) {
  const isLiveResult = result?.mode === "live-flv" ||
    (state.page.type === "live" && state.progress.receivedBytes && !state.progress.totalBytes);
  const totalBytes = isLiveResult
    ? 0
    : Number(result?.totalBytes || result?.size || state.progress.totalBytes) || 0;
  const receivedBytes = Number(result?.receivedBytes || result?.size || totalBytes || state.progress.receivedBytes) || 0;
  if (totalBytes || receivedBytes) {
    state.progress.receivedBytes = receivedBytes;
    state.progress.totalBytes = totalBytes || receivedBytes;
    state.progress.percent = 100;
  }
  if (isLiveResult) {
    state.progress.totalBytes = 0;
    state.progress.percent = 0;
    state.progress.durationMs = Number(result?.durationMs) || state.progress.durationMs;
  }
  if (!state.progress.totalBytes && state.progress.startedAt && state.progress.receivedBytes) {
    state.progress.durationMs = state.progress.durationMs || (Date.now() - state.progress.startedAt);
  }
  state.progress.active = false;
  renderProgress();
}

function renderProgress() {
  if (!progressPanel) {
    return;
  }

  const visible = state.progress.active || state.progress.receivedBytes || state.progress.totalBytes;
  progressPanel.hidden = !visible;
  const percent = Math.floor(state.progress.percent || 0);
  progressPercent.textContent = isLiveProgress()
    ? formatDuration(progressDurationMs())
    : state.progress.totalBytes ? `${percent}%` : "--";
  progressBar.style.width = `${Math.min(percent, 100)}%`;
  progressSize.textContent = `${formatBytes(state.progress.receivedBytes)} / ${
    state.progress.totalBytes ? formatBytes(state.progress.totalBytes) : "--"
  }`;
  progressSpeed.textContent = state.downloadControl?.paused
    ? "--/s"
    : state.progress.speedBytesPerSecond
    ? `${formatBytes(state.progress.speedBytesPerSecond)}/s`
    : "--/s";
}

function renderDownloadControls() {
  const control = state.downloadControl;
  const visible = Boolean(state.busy && control && !control.liveRecording);
  if (downloadControls) {
    downloadControls.hidden = !visible;
  }
  if (pauseButton) {
    pauseButton.disabled = !visible || control?.canceled || Boolean(control?.companionTaskId);
    pauseButton.textContent = visible && control?.companionTaskId
      ? "不支持暂停"
      : (visible && control?.paused ? "\u7ee7\u7eed" : "\u6682\u505c");
  }
  if (cancelButton) {
    cancelButton.disabled = !visible || control?.canceled || control?.cancelPending;
  }
}

function isLiveProgress() {
  return Boolean(state.downloadControl?.liveRecording) ||
    (state.page.type === "live" && state.progress.receivedBytes && !state.progress.totalBytes);
}

function progressDurationMs() {
  if (state.progress.durationMs) {
    return state.progress.durationMs;
  }
  if (state.progress.active && state.progress.startedAt) {
    return Date.now() - state.progress.startedAt;
  }
  return 0;
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(Math.floor((Number(milliseconds) || 0) / 1000), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  const units = ["KB", "MB", "GB"];
  let current = value / 1024;
  for (const unit of units) {
    if (current < 1024 || unit === units.at(-1)) {
      return `${current >= 100 ? current.toFixed(0) : current.toFixed(1)} ${unit}`;
    }
    current /= 1024;
  }

  return `${Math.round(value)} B`;
}

function updateControls() {
  const hasVideoId = hasSupportedPageId(state.page);
  const isLive = state.page.type === "live";
  const isLiveRecording = Boolean(state.downloadControl?.liveRecording);
  const hasQuality = Boolean(currentQualitySource()?.qualities?.length);
  const hasAvailableQuality = Boolean(availableQualityOptions().length);
  const hasMultiplePages = videoHasMultiplePages(state.video);
  const hasSelectedPages = Boolean(selectedPages().length);
  copyButton.disabled = state.busy || !hasVideoId;
  downloadButton.disabled = state.busy || isLive || !hasVideoId || !hasAvailableQuality || !selectedQualityAvailable();
  if (downloadAudioButton) {
    downloadAudioButton.disabled = state.busy || isLive || !hasVideoId || !state.video?.page?.cid;
  }
  if (liveRecordButton) {
    liveRecordButton.disabled = !isLive ||
      (!isLiveRecording && state.live?.liveStatus !== 1) ||
      (!isLiveRecording && (!hasAvailableQuality || !selectedQualityAvailable()));
    liveRecordButton.textContent = isLiveRecording ? "\u7ed3\u675f\u5f55\u5236" : "\u5f00\u59cb\u5f55\u5236";
  }
  qualitySelect.disabled = state.busy || isLiveRecording || !hasQuality;
  if (pagePickerToggle) {
    pagePickerToggle.disabled = state.busy || isLive || !hasMultiplePages;
  }
  if (pageSelectAllButton) {
    pageSelectAllButton.disabled = state.busy || isLive || !hasMultiplePages;
  }
  if (downloadSelectedPagesButton) {
    downloadSelectedPagesButton.disabled = state.busy ||
      isLive ||
      !hasVideoId ||
      !hasMultiplePages ||
      !hasAvailableQuality ||
      !selectedQualityAvailable() ||
      !hasSelectedPages;
  }
  if (downloadSelectedPageAudioButton) {
    downloadSelectedPageAudioButton.disabled = state.busy ||
      isLive ||
      !hasVideoId ||
      !hasMultiplePages ||
      !hasSelectedPages;
  }
  const safetyLocked = Boolean(state.downloadControl);
  for (const input of [dashMaxFileInput, dashMaxMemoryInput, liveMaxDurationInput, liveMaxFileInput, liveMaxMemoryInput]) {
    if (input) {
      input.disabled = safetyLocked;
      input.title = safetyLocked ? "下载或录制进行中；保护设置仅可在下一项任务开始前调整。" : "";
    }
  }
  if (safetySaveButton) {
    safetySaveButton.disabled = safetyLocked;
    safetySaveButton.title = safetyLocked ? "下载或录制进行中；保护设置仅可在下一项任务开始前调整。" : "";
  }
  updatePageSelectionAction();
  diagnosticButton.disabled = state.busy || !state.lastDiagnostic;
  renderDownloadControls();
}

function availableQualityOptions() {
  return Array.from(qualitySelect.children).filter((option) => !option.disabled);
}

function videoHasAvailableQuality(video) {
  return qualityDataHasAvailable(video);
}

function qualityDataHasAvailable(data) {
  return Boolean(data?.qualities?.some((quality) => quality.available !== false));
}

function selectedQualityOption() {
  return Array.from(qualitySelect.children).find((option) => option.value === qualitySelect.value) || null;
}

function selectedQualityAvailable() {
  const option = selectedQualityOption();
  return Boolean(option && !option.disabled);
}

function videoHasMultiplePages(video) {
  return Boolean(video?.pages?.length > 1);
}

function pageDownloadTitle(videoTitle, page) {
  const pageIndex = Number(page?.index || page?.page) || 1;
  const partTitle = page?.title ? `_${page.title}` : "";
  return `${videoTitle}_P${String(pageIndex).padStart(2, "0")}${partTitle}`;
}

function audioDownloadTitle(videoTitle, page) {
  const hasMultiplePages = videoHasMultiplePages(state.video);
  if (!hasMultiplePages) {
    return `${videoTitle}_audio`;
  }
  return `${pageDownloadTitle(videoTitle, page)}_audio`;
}

function setBusy(value) {
  state.busy = value;
  updateControls();
}

function setStatus(text) {
  statusElement.textContent = text;
}

function isSupportedBilibiliUrl(value) {
  return isBilibiliVideoUrl(value) || isBangumiUrl(value) || isLiveUrl(value);
}

function isBilibiliVideoUrl(value) {
  return /^https:\/\/(www|m)\.bilibili\.com\/video\//.test(String(value));
}

function isBangumiUrl(value) {
  return /^https:\/\/www\.bilibili\.com\/bangumi\/play\//.test(String(value));
}

function isLiveUrl(value) {
  return /^https:\/\/live\.bilibili\.com\/(?:blanc\/)?\d+/.test(String(value));
}

function pageTypeFromUrl(value) {
  if (isLiveUrl(value)) {
    return "live";
  }
  return isBangumiUrl(value) ? "bangumi" : isBilibiliVideoUrl(value) ? "video" : "";
}

function hasSupportedPageId(page) {
  return Boolean(page?.bvid || page?.epId || page?.seasonId || page?.roomId);
}

function displayPageId(page) {
  if (page?.bvid) {
    return page.bvid;
  }
  if (page?.epId) {
    return `ep${page.epId}`;
  }
  if (page?.seasonId) {
    return `ss${page.seasonId}`;
  }
  if (page?.roomId) {
    return `live ${page.roomId}`;
  }
  return "";
}

function extractBvid(value) {
  const match = String(value).match(/BV[0-9A-Za-z]{10}/);
  return match ? match[0] : "";
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
