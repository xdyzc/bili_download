chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BILI_DOWNLOAD_GET_PAGE") {
    sendResponse(readPage());
    return false;
  }

  return false;
});

window.addEventListener("bili-download-progress", (event) => {
  const promise = chrome.runtime.sendMessage({
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: normalizeProgressPayload(event.detail)
  });
  if (promise?.catch) {
    promise.catch(() => {
      // The service worker or popup may be asleep; progress is best-effort.
    });
  }
});

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

function readPage() {
  if (isLivePage(location.href)) {
    return {
      type: "live",
      roomId: extractLiveRoomId(location.href),
      title: readTitle(),
      url: location.href
    };
  }

  return {
    type: isBangumiPage(location.href) ? "bangumi" : "video",
    bvid: extractBvid(location.href),
    seasonId: extractSeasonId(location.href),
    epId: extractEpId(location.href),
    title: readTitle(),
    url: location.href
  };
}

function readTitle() {
  const titleElement =
    document.querySelector("h1.video-title") ||
    document.querySelector("[data-title]") ||
    document.querySelector("h1");

  const title = titleElement?.textContent?.trim() || document.title;
  return title.replace(/\s*[-_].*bilibili.*$/i, "").trim();
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

function isBangumiPage(value) {
  return /:\/\/www\.bilibili\.com\/bangumi\/play\//.test(String(value || ""));
}

function isLivePage(value) {
  return /:\/\/live\.bilibili\.com\/(?:blanc\/)?\d+/.test(String(value || ""));
}
