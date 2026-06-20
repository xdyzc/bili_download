const state = {
  tabId: null,
  page: {
    bvid: "",
    title: "",
    url: ""
  }
};

const statusElement = document.querySelector("#status");
const bvidInput = document.querySelector("#bvid");
const titleInput = document.querySelector("#title");
const copyButton = document.querySelector("#copy");
const sendButton = document.querySelector("#send");

document.addEventListener("DOMContentLoaded", initialize);
copyButton.addEventListener("click", copyBvid);
sendButton.addEventListener("click", sendToLocalDownloader);

async function initialize() {
  setBusy(true);
  setStatus("检查当前页面...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id || null;
    state.page = await readPage(tab);
    render();
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

  const hasBvid = Boolean(state.page.bvid);
  copyButton.disabled = !hasBvid;
  sendButton.disabled = !hasBvid;
  setStatus(hasBvid ? "已识别当前视频" : "当前页面不是 Bilibili 视频页");
}

async function copyBvid() {
  if (!state.page.bvid) {
    return;
  }

  await navigator.clipboard.writeText(state.page.bvid);
  setStatus("BV 号已复制");
}

async function sendToLocalDownloader() {
  if (!state.page.bvid) {
    return;
  }

  setBusy(true);
  setStatus("正在发送...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BILI_DOWNLOAD_SEND_TO_LOCAL",
      payload: state.page
    });
    if (!response?.ok) {
      throw new Error(response?.error || "本地下载器没有响应");
    }
    setStatus("已发送到本地下载器");
  } catch (error) {
    setStatus(`本地下载器未连接: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

function setBusy(value) {
  copyButton.disabled = value || !state.page.bvid;
  sendButton.disabled = value || !state.page.bvid;
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
