const TEXT = {
  checking: "\u68c0\u67e5\u5f53\u524d\u9875\u9762...",
  loading: "\u6b63\u5728\u8bfb\u53d6\u89c6\u9891\u4fe1\u606f...",
  ready: "\u53ef\u9009\u62e9\u6e05\u6670\u5ea6\u4e0b\u8f7d",
  copied: "BV \u53f7\u5df2\u590d\u5236",
  noVideo: "\u5f53\u524d\u9875\u9762\u4e0d\u662f Bilibili \u89c6\u9891\u9875",
  noQuality: "\u6ca1\u6709\u53ef\u7528\u6e05\u6670\u5ea6",
  downloading: "\u5df2\u4ea4\u7ed9\u6d4f\u89c8\u5668\u4e0b\u8f7d...",
  downloadStarted: "\u4e0b\u8f7d\u5df2\u5f00\u59cb",
  dashOnly: "\u8fd9\u4e2a\u6e05\u6670\u5ea6\u9700\u8981 DASH\uff0c\u4e0b\u4e00\u6b65\u652f\u6301",
  diagnosticCopied: "\u8bca\u65ad\u4fe1\u606f\u5df2\u590d\u5236",
  noDiagnostic: "\u6682\u65e0\u8bca\u65ad\u4fe1\u606f"
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
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_START_DIRECT",
      payload: {
        bvid: state.video.bvid,
        cid: state.video.page.cid,
        quality: Number(qualitySelect.value),
        title: state.video.title
      }
    });

    if (!response?.ok) {
      state.lastDiagnostic = response?.diagnostic || state.lastDiagnostic;
      throw new Error(response?.error || TEXT.dashOnly);
    }

    state.lastDiagnostic = response.payload.diagnostics?.at(-1) || state.lastDiagnostic;
    setStatus(`${TEXT.downloadStarted}: ${response.payload.count}`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    setBusy(false);
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
