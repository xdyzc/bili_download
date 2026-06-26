const TEXT = {
  checking: "\u68c0\u67e5\u5f53\u524d\u9875\u9762...",
  loading: "\u6b63\u5728\u8bfb\u53d6\u89c6\u9891\u4fe1\u606f...",
  ready: "\u53ef\u9009\u62e9\u6e05\u6670\u5ea6\u4e0b\u8f7d",
  collectionReady: "\u68c0\u6d4b\u5230\u591a\u4e2a\u5206 P\uff0c\u53ef\u9009\u62e9\u8981\u4e0b\u8f7d\u7684\u5206 P",
  copied: "\u89c6\u9891 ID \u5df2\u590d\u5236",
  noVideo: "\u5f53\u524d\u9875\u9762\u4e0d\u662f\u652f\u6301\u7684 Bilibili \u89c6\u9891\u6216\u756a\u5267\u9875",
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

const state = {
  tabId: null,
  page: {
    type: "",
    bvid: "",
    seasonId: null,
    epId: null,
    title: "",
    url: ""
  },
  video: null,
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
  pagePickerOpen: false,
  selectedPageCids: null
};

const statusElement = document.querySelector("#status");
const accountElement = document.querySelector("#account");
const bvidInput = document.querySelector("#bvid");
const titleInput = document.querySelector("#title");
const qualitySelect = document.querySelector("#quality");
const qualitySizeElement = document.querySelector("#quality-size");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const downloadAudioButton = document.querySelector("#download-audio");
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

document.addEventListener("DOMContentLoaded", initialize);
copyButton.addEventListener("click", copyBvid);
downloadButton.addEventListener("click", downloadSelectedQuality);
downloadAudioButton?.addEventListener("click", downloadCurrentAudio);
pagePickerToggle?.addEventListener("click", togglePagePicker);
pageSelectAllButton?.addEventListener("click", toggleAllPages);
downloadSelectedPagesButton?.addEventListener("click", downloadSelectedPages);
downloadSelectedPageAudioButton?.addEventListener("click", downloadSelectedPageAudio);
diagnosticButton.addEventListener("click", copyDiagnostic);
qualitySelect.addEventListener?.("change", () => {
  updateQualitySize();
  updateControls();
});
pauseButton?.addEventListener("click", togglePauseDownload);
cancelButton?.addEventListener("click", cancelDownload);
const progressPort = chrome.runtime.connect({ name: PROGRESS_PORT_NAME });
progressPort.onMessage.addListener((message) => {
  if (message?.type !== PROGRESS_MESSAGE_TYPE) {
    return;
  }

  if (message.payload?.tabId && state.tabId && message.payload.tabId !== state.tabId) {
    return;
  }

  updateProgress(message.payload);
});
chrome.tabs?.onActivated?.addListener(() => {
  refreshFromActiveTab();
});
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
  if (tabId !== state.tabId || !changeInfo.url) {
    return;
  }
  refreshFromActiveTab();
});

async function initialize() {
  await refreshFromActiveTab({ force: true });
}

async function refreshFromActiveTab(options = {}) {
  if (state.busy && !options.force) {
    return;
  }

  setBusy(true);
  setStatus(TEXT.checking);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id || null;
    state.page = await readPage(tab);
    state.page.tabId = state.tabId;
    await loadLastDiagnostic();

    if (!hasSupportedPageId(state.page)) {
      setStatus(TEXT.noVideo);
      render();
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

    state.video = response.payload;
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
    setStatus(error.message);
    render();
  } finally {
    setBusy(false);
  }
}

async function readPage(tab) {
  const fromUrl = {
    type: pageTypeFromUrl(tab?.url || ""),
    bvid: extractBvid(tab?.url || ""),
    seasonId: extractSeasonId(tab?.url || ""),
    epId: extractEpId(tab?.url || ""),
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
  updateControls();
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
  const qualities = state.video?.qualities || [];
  const selectedCode = Number(qualitySelect.value) || state.video?.currentQuality;

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
  return (state.video?.qualities || []).find((quality) => Number(quality.code) === selectedCode) || null;
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
    await downloadPreparedPayload(prepared);
    if (prepared.mode !== "dash") {
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
    for (const [index, page] of pages.entries()) {
      await waitForDownloadControl();
      throwIfDownloadCanceled();
      const pageIndex = Number(page.index || page.page) || index + 1;
      setStatus(`${TEXT.downloadingPages} ${index + 1}/${pages.length} P${String(pageIndex).padStart(2, "0")}`);
      const prepared = await preparePageDownload(page, quality, pageDownloadTitle(state.video.title, page));
      await downloadPreparedPayload(prepared);
    }
    setStatus(`${TEXT.pagesDownloaded}: ${pages.length}`);
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
    for (const [index, page] of pages.entries()) {
      await waitForDownloadControl();
      throwIfDownloadCanceled();
      const pageIndex = Number(page.index || page.page) || index + 1;
      setStatus(`${TEXT.downloadingPageAudio} ${index + 1}/${pages.length} P${String(pageIndex).padStart(2, "0")}`);
      const prepared = await prepareAudioDownload(page, audioDownloadTitle(state.video.title, page));
      await downloadPreparedPayload(prepared, TEXT.downloadingAudio);
    }
    setStatus(`${TEXT.pageAudioDownloaded}: ${pages.length}`);
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

async function downloadPreparedPayload(prepared, statusText = TEXT.downloading) {
  if (prepared.mode === "dash") {
    await downloadDashAsMp4(prepared);
    return;
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

async function downloadDashAsMp4(prepared) {
  const downloads = [];
  for (const [index, segment] of prepared.segments.entries()) {
    await waitForDownloadControl();
    throwIfDownloadCanceled();
    const role = segment.context?.roleLabel || segment.context?.role || "";
    const suffix = role ? ` ${index + 1}/${prepared.count} ${role}` : ` ${index + 1}/${prepared.count}`;
    setStatus(`${TEXT.downloading}${suffix}`);
    const diagnostic = await downloadSegment(segment, { save: false });
    downloads.push({
      segment,
      diagnostic,
      blob: diagnostic.blob
    });
    delete diagnostic.blob;
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
    save: options.save !== false
  };
  if (isExtensionFetchPreferred(segment.url)) {
    try {
      return await downloadViaExtensionBlob(segment, diagnostic, null, downloadOptions);
    } catch (error) {
      if (isDownloadCanceledError(error)) {
        throw error;
      }
      return downloadViaPageBlob(segment, diagnostic, error, downloadOptions);
    }
  }

  try {
    return await downloadViaPageBlob(segment, diagnostic, null, downloadOptions);
  } catch (error) {
    if (isDownloadCanceledError(error)) {
      throw error;
    }
    return downloadViaExtensionBlob(segment, diagnostic, error, downloadOptions);
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
          currentDownloadControlState()
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

  await navigator.clipboard.writeText(
    JSON.stringify(
      {
        page: state.page,
        selectedQuality: qualitySelect.value,
        diagnostic: state.lastDiagnostic
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
      state.lastDiagnostic = response.payload;
    }
  } catch (_error) {
    state.lastDiagnostic = null;
  }
}

async function saveDiagnostic(diagnostic) {
  if (!diagnostic) {
    return;
  }

  state.lastDiagnostic = diagnostic;
  try {
    await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_SAVE_DIAGNOSTIC",
      payload: diagnostic
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
  const copy = { ...diagnostic };
  delete copy.blob;
  return copy;
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
    abortControllers: new Set(),
    waiters: []
  };
}

function togglePauseDownload() {
  const control = state.downloadControl;
  if (!control || control.canceled) {
    return;
  }

  control.paused = !control.paused;
  if (control.paused) {
    setStatus(TEXT.paused);
  } else {
    setStatus(TEXT.resumed);
    resumeDownloadWaiters(control);
  }
  notifyPageDownloadControl();
  renderDownloadControls();
}

function cancelDownload() {
  const control = state.downloadControl;
  if (!control || control.canceled) {
    return;
  }

  control.canceled = true;
  control.paused = false;
  for (const abortController of control.abortControllers) {
    abortController.abort();
  }
  resumeDownloadWaiters(control);
  notifyPageDownloadControl();
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

  while (control.paused && !control.canceled) {
    await new Promise((resolve) => control.waiters.push(resolve));
  }
  throwIfDownloadCanceled();
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

async function downloadMediaInPage(url, filename, saveToDisk, progressContext, controlEventName, initialControlState = null) {
  const control = {
    paused: Boolean(initialControlState?.paused),
    canceled: Boolean(initialControlState?.canceled),
    waiters: [],
    abortController: new AbortController()
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

    if (!response.ok) {
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

async function fetchMediaInExtension(url, filename, saveToDisk, progressContext) {
  const expectedSize = Number(progressContext?.totalBytes) || 0;
  if (expectedSize >= PARALLEL_RANGE_MIN_BYTES) {
    const parallelResult = await fetchMediaInExtensionRanges(url, filename, saveToDisk, progressContext, expectedSize);
    if (parallelResult?.ok && parallelResult.responseOk) {
      return parallelResult;
    }

    const singleResult = await fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext);
    if (singleResult) {
      singleResult.fallback = {
        from: "extension-range",
        error: parallelResult?.error || "Parallel range download failed."
      };
    }
    return singleResult;
  }

  return fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext);
}

async function fetchMediaInExtensionSingle(url, filename, saveToDisk, progressContext) {
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

    if (!response.ok) {
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

async function fetchMediaInExtensionRanges(url, filename, saveToDisk, progressContext, totalBytes) {
  const ranges = buildRanges(totalBytes, PARALLEL_RANGE_CHUNK_BYTES);
  const chunks = new Array(ranges.length);
  const rangeProgress = new Array(ranges.length).fill(0);
  let lastProgressAt = 0;

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
      while (nextIndex < ranges.length) {
        await waitForDownloadControl();
        throwIfDownloadCanceled();
        const rangeIndex = nextIndex;
        nextIndex += 1;
        chunks[rangeIndex] = await fetchRangeChunk(url, ranges[rangeIndex], (loadedBytes) => {
          rangeProgress[rangeIndex] = loadedBytes;
          emitRangeProgress();
        });
        rangeProgress[rangeIndex] = ranges[rangeIndex].end - ranges[rangeIndex].start + 1;
        emitRangeProgress();
      }
    };

    const workerCount = Math.min(PARALLEL_RANGE_CONCURRENCY, ranges.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
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
    if (state.downloadControl?.canceled || error.name === "AbortError" || error.name === "DownloadCanceledError") {
      throw downloadCanceledError();
    }
    return {
      ok: false,
      error: error.message,
      filename,
      mode: "extension-range"
    };
  }
}

async function fetchRangeChunk(url, range, onProgress) {
  await waitForDownloadControl();
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "Accept": "video/*,*/*;q=0.8",
      "Range": `bytes=${range.start}-${range.end}`
    },
    cache: "no-store",
    signal: getDownloadAbortSignal()
  });

  if (response.status !== 206) {
    throw new Error(`Range request returned HTTP ${response.status || "unknown"}.`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const body = await response.blob();
    await waitForDownloadControl();
    onProgress(body.size);
    return body;
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

    chunks.push(value);
    receivedBytes += value.byteLength;
    onProgress(receivedBytes);
  }

  const expectedBytes = range.end - range.start + 1;
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
  state.progress.startedAt = Date.now();
  state.progress.lastAt = Date.now();
  state.progress.segmentIndex = 0;
  state.progress.segmentCount = 0;
  state.progress.candidateIndex = 0;
  state.progress.candidateCount = 0;
  renderProgress();
}

function updateProgress(payload) {
  if (!state.busy || state.downloadControl?.canceled || !payload) {
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
  state.progress.lastAt = now;
  state.progress.segmentIndex = payload.segmentIndex || state.progress.segmentIndex;
  state.progress.segmentCount = payload.segmentCount || state.progress.segmentCount;
  state.progress.candidateIndex = payload.candidateIndex || state.progress.candidateIndex;
  state.progress.candidateCount = payload.candidateCount || state.progress.candidateCount;
  renderProgress();
}

function completeProgress(result = null) {
  const totalBytes = Number(result?.totalBytes || result?.size || state.progress.totalBytes) || 0;
  const receivedBytes = Number(result?.receivedBytes || result?.size || totalBytes || state.progress.receivedBytes) || 0;
  if (totalBytes || receivedBytes) {
    state.progress.receivedBytes = receivedBytes;
    state.progress.totalBytes = totalBytes || receivedBytes;
    state.progress.percent = 100;
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
  progressPercent.textContent = state.progress.totalBytes ? `${percent}%` : "--";
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
  const visible = Boolean(state.busy && control);
  if (downloadControls) {
    downloadControls.hidden = !visible;
  }
  if (pauseButton) {
    pauseButton.disabled = !visible || control?.canceled;
    pauseButton.textContent = visible && control?.paused ? "\u7ee7\u7eed" : "\u6682\u505c";
  }
  if (cancelButton) {
    cancelButton.disabled = !visible || control?.canceled;
  }
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
  const hasQuality = Boolean(state.video?.qualities?.length);
  const hasAvailableQuality = Boolean(availableQualityOptions().length);
  const hasMultiplePages = videoHasMultiplePages(state.video);
  const hasSelectedPages = Boolean(selectedPages().length);
  copyButton.disabled = state.busy || !hasVideoId;
  downloadButton.disabled = state.busy || !hasVideoId || !hasAvailableQuality || !selectedQualityAvailable();
  if (downloadAudioButton) {
    downloadAudioButton.disabled = state.busy || !hasVideoId || !state.video?.page?.cid;
  }
  qualitySelect.disabled = state.busy || !hasQuality;
  if (pagePickerToggle) {
    pagePickerToggle.disabled = state.busy || !hasMultiplePages;
  }
  if (pageSelectAllButton) {
    pageSelectAllButton.disabled = state.busy || !hasMultiplePages;
  }
  if (downloadSelectedPagesButton) {
    downloadSelectedPagesButton.disabled = state.busy ||
      !hasVideoId ||
      !hasMultiplePages ||
      !hasAvailableQuality ||
      !selectedQualityAvailable() ||
      !hasSelectedPages;
  }
  if (downloadSelectedPageAudioButton) {
    downloadSelectedPageAudioButton.disabled = state.busy ||
      !hasVideoId ||
      !hasMultiplePages ||
      !hasSelectedPages;
  }
  updatePageSelectionAction();
  diagnosticButton.disabled = state.busy || !state.lastDiagnostic;
  renderDownloadControls();
}

function availableQualityOptions() {
  return Array.from(qualitySelect.children).filter((option) => !option.disabled);
}

function videoHasAvailableQuality(video) {
  return Boolean(video?.qualities?.some((quality) => quality.available !== false));
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
  return isBilibiliVideoUrl(value) || isBangumiUrl(value);
}

function isBilibiliVideoUrl(value) {
  return /^https:\/\/(www|m)\.bilibili\.com\/video\//.test(String(value));
}

function isBangumiUrl(value) {
  return /^https:\/\/www\.bilibili\.com\/bangumi\/play\//.test(String(value));
}

function pageTypeFromUrl(value) {
  return isBangumiUrl(value) ? "bangumi" : isBilibiliVideoUrl(value) ? "video" : "";
}

function hasSupportedPageId(page) {
  return Boolean(page?.bvid || page?.epId || page?.seasonId);
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
