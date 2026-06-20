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
  noDiagnostic: "\u6682\u65e0\u8bca\u65ad\u4fe1\u606f",
  fallbackDownloading: "\u9875\u9762\u4e0b\u8f7d\u5931\u8d25\uff0c\u5c1d\u8bd5\u540e\u53f0\u4e0b\u8f7d..."
};

const state = {
  tabId: null,
  page: {
    bvid: "",
    title: "",
    url: ""
  },
  video: null,
  lastDiagnostic: null,
  busy: false
};

const statusElement = document.querySelector("#status");
const bvidInput = document.querySelector("#bvid");
const titleInput = document.querySelector("#title");
const qualitySelect = document.querySelector("#quality");
const copyButton = document.querySelector("#copy");
const downloadButton = document.querySelector("#download");
const diagnosticButton = document.querySelector("#diagnostic");

document.addEventListener("DOMContentLoaded", initialize);
copyButton.addEventListener("click", copyBvid);
downloadButton.addEventListener("click", downloadSelectedQuality);
diagnosticButton.addEventListener("click", copyDiagnostic);

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

    try {
      const diagnostics = [];
      for (const [index, segment] of prepared.payload.segments.entries()) {
        setStatus(`${TEXT.downloading} ${index + 1}/${prepared.payload.count}`);
        const diagnostic = await downloadViaPageBlob(segment);
        diagnostics.push(diagnostic);
        state.lastDiagnostic = diagnostic;
      }
      setStatus(`${TEXT.downloadStarted}: ${prepared.payload.count}`);
      await saveDiagnostic(state.lastDiagnostic);
    } catch (pageError) {
      if (pageError.diagnostic) {
        state.lastDiagnostic = pageError.diagnostic;
        await saveDiagnostic(pageError.diagnostic);
      }

      setStatus(TEXT.fallbackDownloading);
      const fallback = await chrome.runtime.sendMessage({
        type: "BILI_DOWNLOAD_START_DIRECT",
        payload: {
          bvid: state.video.bvid,
          cid: state.video.page.cid,
          quality: Number(qualitySelect.value),
          title: state.video.title
        }
      });

      if (!fallback?.ok) {
        state.lastDiagnostic = mergeDiagnostics(
          pageError.diagnostic,
          fallback?.diagnostic || state.lastDiagnostic
        );
        await saveDiagnostic(state.lastDiagnostic);
        throw new Error(fallback?.error || pageError.message || TEXT.dashOnly);
      }

      state.lastDiagnostic = fallback.payload.diagnostics?.at(-1) || state.lastDiagnostic;
      setStatus(`${TEXT.downloadStarted}: ${fallback.payload.count}`);
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
  }
}

async function downloadViaPageBlob(segment) {
  const diagnostic = createPageDiagnostic(segment);
  diagnostic.phase = "fetching-page-blob";

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: {
        tabId: state.tabId
      },
      world: "MAIN",
      func: downloadMediaInPage,
      args: [segment.url, filenameForPageDownload(segment.filename)]
    });

    const result = injection?.result;
    diagnostic.fetch = pickFetchResult(result);

    if (!result?.ok) {
      diagnostic.phase = "page-fetch-message-error";
      diagnostic.error = result?.error || "Page fetch failed.";
      throw diagnosticError(diagnostic.error, diagnostic);
    }

    if (!result.responseOk) {
      diagnostic.phase = "page-fetch-http-error";
      diagnostic.error = `HTTP ${result.status || "unknown"}`;
      throw diagnosticError(diagnostic.error, diagnostic);
    }

    diagnostic.phase = "complete";
    diagnostic.saved = {
      filename: result.filename,
      mime: result.mime,
      size: result.size
    };
    await saveDiagnostic(diagnostic);
    return diagnostic;
  } catch (error) {
    if (error.diagnostic) {
      throw error;
    }

    diagnostic.phase = "page-blob-error";
    diagnostic.error = error.message;
    await saveDiagnostic(diagnostic);
    throw diagnosticError(error.message, diagnostic);
  }
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
    dnrMatchedEvents: []
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
    size: response.size
  };
}

function diagnosticError(message, diagnostic) {
  const error = new Error(message);
  error.diagnostic = diagnostic;
  return error;
}

function mergeDiagnostics(pageDiagnostic, fallbackDiagnostic) {
  if (!fallbackDiagnostic) {
    return pageDiagnostic || null;
  }

  if (!pageDiagnostic) {
    return fallbackDiagnostic;
  }

  return {
    ...fallbackDiagnostic,
    pageBlobAttempt: pageDiagnostic
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

async function downloadMediaInPage(url, filename) {
  try {
    const response = await fetch(url, {
      credentials: "include",
      referrer: location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
      cache: "no-store"
    });
    const body = await response.blob();

    if (!response.ok) {
      return {
        ok: true,
        responseOk: false,
        status: response.status,
        statusText: response.statusText,
        mime: body.type || response.headers.get("content-type") || "",
        size: body.size,
        filename
      };
    }

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
