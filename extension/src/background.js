const API_BASE = "https://api.bilibili.com";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
    loadVideo(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BILI_DOWNLOAD_START_DIRECT") {
    startDirectDownload(message.payload)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

async function loadVideo(page) {
  const bvid = normalizeBvid(page?.bvid);
  if (!bvid) {
    throw new Error("No BV id was found on this page.");
  }

  const infoPayload = await fetchJson(`${API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  const info = expectData(infoPayload);
  const pageNumber = readPageNumber(page?.url);
  const videoPage = selectVideoPage(info.pages || [], pageNumber);

  if (!videoPage?.cid) {
    throw new Error("Could not find the video cid.");
  }

  const playUrl = await fetchPlayUrl({
    bvid,
    cid: videoPage.cid
  });

  const qualities = buildQualityOptions(playUrl);
  return {
    bvid,
    aid: info.aid,
    title: page?.title || info.title || bvid,
    ownerName: info.owner?.name || "",
    page: {
      index: videoPage.page || 1,
      cid: videoPage.cid,
      title: videoPage.part || ""
    },
    currentQuality: playUrl.quality || null,
    directAvailable: Array.isArray(playUrl.durl) && playUrl.durl.length > 0,
    qualities
  };
}

async function startDirectDownload(payload) {
  const bvid = normalizeBvid(payload?.bvid);
  const cid = Number(payload?.cid);
  const quality = Number(payload?.quality);
  const title = payload?.title || bvid;

  if (!bvid || !cid || !quality) {
    throw new Error("Missing video, cid, or quality.");
  }

  const playUrl = await fetchPlayUrl({ bvid, cid, quality });
  const segments = Array.isArray(playUrl.durl) ? playUrl.durl.filter((item) => item?.url) : [];

  if (!segments.length) {
    throw new Error("This stream is DASH-only. DASH support is the next milestone.");
  }

  const extension = extensionFor(playUrl.format);
  const baseName = safeFilename(`${title}_${quality}`);
  const ids = [];

  for (const [index, segment] of segments.entries()) {
    const suffix = segments.length > 1 ? `_part${index + 1}` : "";
    const filename = `BiliDownload/${baseName}${suffix}${extension}`;
    const id = await downloadFile({
      url: segment.url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    ids.push(id);
  }

  return {
    ids,
    count: ids.length
  };
}

async function fetchPlayUrl({ bvid, cid, quality }) {
  const params = new URLSearchParams({
    bvid,
    cid: String(cid),
    qn: String(quality || 127),
    fnval: "0",
    fnver: "0",
    fourk: "0",
    otype: "json"
  });

  const payload = await fetchJson(`${API_BASE}/x/player/playurl?${params.toString()}`);
  return expectData(payload);
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

function buildQualityOptions(playUrl) {
  const qualities = Array.isArray(playUrl.accept_quality) ? playUrl.accept_quality : [];
  const descriptions = Array.isArray(playUrl.accept_description) ? playUrl.accept_description : [];

  return qualities.map((code, index) => ({
    code: Number(code),
    label: `${code} - ${descriptions[index] || "Unknown"}`
  }));
}

function selectVideoPage(pages, pageNumber) {
  return pages.find((item) => Number(item.page) === pageNumber) || pages[0] || null;
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
