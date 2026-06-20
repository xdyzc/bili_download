const TEXT = {
  checking: "\u68c0\u67e5\u5f53\u524d\u9875\u9762...",
  loading: "\u6b63\u5728\u8bfb\u53d6\u89c6\u9891\u4fe1\u606f...",
  ready: "\u53ef\u9009\u62e9\u6e05\u6670\u5ea6\u4e0b\u8f7d",
  copied: "BV \u53f7\u5df2\u590d\u5236",
  noVideo: "\u5f53\u524d\u9875\u9762\u4e0d\u662f Bilibili \u89c6\u9891\u9875",
  noQuality: "\u6ca1\u6709\u53ef\u7528\u6e05\u6670\u5ea6",
  downloading: "\u6b63\u5728\u8bf7\u6c42\u89c6\u9891\u6587\u4ef6...",
  downloadStarted: "\u4e0b\u8f7d\u5df2\u5f00\u59cb",
  dashOnly: "\u8fd9\u4e2a\u6e05\u6670\u5ea6\u9700\u8981 DASH\uff0c\u4e0b\u4e00\u6b65\u652f\u6301",
  diagnosticCopied: "\u8bca\u65ad\u4fe1\u606f\u5df2\u590d\u5236",
  noDiagnostic: "\u6682\u65e0\u8bca\u65ad\u4fe1\u606f"
};

const PROGRESS_MESSAGE_TYPE = "BILI_DOWNLOAD_PAGE_PROGRESS";
const PROGRESS_PORT_NAME = "BILI_DOWNLOAD_PROGRESS_PORT";

const state = {
  tabId: null,
  page: {
    bvid: "",
    title: "",
    url: ""
  },
  video: null,
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
  busy: false
};

const statusElement = document.querySelector("#status");
const bvidInput = document.querySelector("#bvid");
const titleInput = document.querySelector("#title");
const qualitySelect = document.querySelector("#quality");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const diagnosticButton = document.querySelector("#diagnostic");
const progressPanel = document.querySelector("#progress");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressSize = document.querySelector("#progress-size");
const progressSpeed = document.querySelector("#progress-speed");

document.addEventListener("DOMContentLoaded", initialize);
copyButton.addEventListener("click", copyBvid);
downloadButton.addEventListener("click", downloadSelectedQuality);
diagnosticButton.addEventListener("click", copyDiagnostic);
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

async function initialize() {
  setBusy(true);
  setStatus(TEXT.checking);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id || null;
    state.page = await readPage(tab);
    await loadLastDiagnostic();

    if (!state.page.bvid) {
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
    state.page.bvid = state.video.bvid;
    state.page.title = state.video.title;
    render();
    setStatus(state.video.qualities.length ? TEXT.ready : TEXT.noQuality);
  } catch (error) {
    setStatus(error.message);
    render();
  } finally {
    setBusy(false);
  }
}

async function readPage(tab) {
  const fromUrl = {
    bvid: extractBvid(tab?.url || ""),
    title: tab?.title || "",
    url: tab?.url || ""
  };

  if (!tab?.id || !isBilibiliVideoUrl(tab.url)) {
    return fromUrl;
  }

  try {
    const page = await chrome.tabs.sendMessage(tab.id, {
      type: "BILI_DOWNLOAD_GET_PAGE"
    });
    return {
      bvid: page?.bvid || fromUrl.bvid,
      title: page?.title || fromUrl.title,
      url: page?.url || fromUrl.url
    };
  } catch (_error) {
    return fromUrl;
  }
}

function render() {
  bvidInput.value = state.page.bvid;
  titleInput.value = state.page.title;
  renderQualities();
  updateControls();
}

function renderQualities() {
  qualitySelect.replaceChildren();
  const qualities = state.video?.qualities || [];

  for (const quality of qualities) {
    const option = document.createElement("option");
    option.value = String(quality.code);
    option.textContent = quality.label;
    if (quality.code === state.video.currentQuality) {
      option.selected = true;
    }
    qualitySelect.append(option);
  }
}

async function copyBvid() {
  if (!state.page.bvid) {
    return;
  }

  await navigator.clipboard.writeText(state.page.bvid);
  setStatus(TEXT.copied);
}

async function downloadSelectedQuality() {
  if (!state.video || !qualitySelect.value) {
    return;
  }

  setBusy(true);
  resetProgress();
  setStatus(TEXT.downloading);

  try {
    const prepared = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_PREPARE_DIRECT",
      payload: {
        bvid: state.video.bvid,
        cid: state.video.page.cid,
        quality: Number(qualitySelect.value),
        title: state.video.title
      }
    });

    if (!prepared?.ok) {
      state.lastDiagnostic = prepared?.diagnostic || state.lastDiagnostic;
      throw new Error(prepared?.error || TEXT.dashOnly);
    }

    const diagnostics = [];
    for (const [index, segment] of prepared.payload.segments.entries()) {
      setStatus(`${TEXT.downloading} ${index + 1}/${prepared.payload.count}`);
      const diagnostic = await downloadViaPageBlob(segment);
      diagnostics.push(diagnostic);
      state.lastDiagnostic = diagnostic;
    }
    setStatus(`${TEXT.downloadStarted}: ${prepared.payload.count}`);
    await saveDiagnostic(state.lastDiagnostic);
  } catch (error) {
    if (error.diagnostic) {
      state.lastDiagnostic = error.diagnostic;
      await saveDiagnostic(error.diagnostic);
    }
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function downloadViaPageBlob(segment) {
  const diagnostic = createPageDiagnostic(segment);
  const candidates = readCandidates(segment);
  let lastError = null;

  for (const [index, candidate] of candidates.entries()) {
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
          {
            segmentIndex: segment.context?.segmentIndex || 1,
            segmentCount: segment.context?.segmentCount || 1,
            candidateIndex: index + 1,
            candidateCount: candidates.length
          }
        ]
      });

      const result = injection?.result;
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
        size: result.size
      };
      await saveDiagnostic(diagnostic);
      return diagnostic;
    } catch (error) {
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

  throw lastError || diagnosticError("All page media candidates failed.", diagnostic);
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
    candidateAttempts: []
  };
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
    receivedBytes: response.receivedBytes
  };
}

function diagnosticError(message, diagnostic) {
  const error = new Error(message);
  error.diagnostic = diagnostic;
  return error;
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

function readCandidates(segment) {
  const candidates = Array.isArray(segment?.candidates)
    ? segment.candidates.filter((candidate) => candidate?.url)
    : [];
  if (candidates.length) {
    return candidates;
  }
  return segment?.url ? [{ url: segment.url, kind: "primary" }] : [];
}

async function downloadMediaInPage(url, filename, progressContext) {
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
    const response = await fetch(url, {
      credentials: "include",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      cache: "no-store"
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
      sendProgress({
        ...progressContext,
        receivedBytes,
        totalBytes: body.size || contentLength,
        done: true
      });
      chunks.push(body);
    } else {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
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

    return {
      ok: true,
      responseOk: true,
      status: response.status,
      statusText: response.statusText,
      mime: body.type || response.headers.get("content-type") || "",
      size: body.size,
      totalBytes: contentLength || body.size,
      receivedBytes,
      filename
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      filename
    };
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

function updateProgress(payload) {
  if (!state.busy || !payload) {
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
  progressSpeed.textContent = state.progress.speedBytesPerSecond
    ? `${formatBytes(state.progress.speedBytesPerSecond)}/s`
    : "--/s";
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
  const hasBvid = Boolean(state.page.bvid);
  const hasQuality = Boolean(state.video?.qualities?.length);
  copyButton.disabled = state.busy || !hasBvid;
  downloadButton.disabled = state.busy || !hasBvid || !hasQuality;
  qualitySelect.disabled = state.busy || !hasQuality;
  diagnosticButton.disabled = state.busy || !state.lastDiagnostic;
}

function setBusy(value) {
  state.busy = value;
  updateControls();
}

function setStatus(text) {
  statusElement.textContent = text;
}

function isBilibiliVideoUrl(value) {
  return /^https:\/\/(www|m)\.bilibili\.com\/video\//.test(String(value));
}

function extractBvid(value) {
  const match = String(value).match(/BV[0-9A-Za-z]{10}/);
  return match ? match[0] : "";
}
