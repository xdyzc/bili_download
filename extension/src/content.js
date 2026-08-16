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
  const site = siteFromUrl(location.href);
  if (isLivePage(location.href)) {
    const roomKey = extractLiveRoomKey(location.href, site);
    return {
      type: "live",
      site,
      roomKey,
      roomId: /^\d+$/.test(roomKey) ? Number(roomKey) : null,
      title: readTitle(),
      url: location.href
    };
  }

  return {
    type: isBangumiPage(location.href) ? "bangumi" : "video",
    site: "bilibili",
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
  return title
    .replace(/\s*[-_].*bilibili.*$/i, "")
    .replace(/\s*[-_].*斗鱼直播.*$/i, "")
    .replace(/\s*[-_].*虎牙直播.*$/i, "")
    .trim();
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

function isBangumiPage(value) {
  return /:\/\/www\.bilibili\.com\/bangumi\/play\//.test(String(value || ""));
}

function isLivePage(value) {
  const site = siteFromUrl(value);
  return Boolean(extractLiveRoomKey(value, site));
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
