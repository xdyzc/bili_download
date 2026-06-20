chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BILI_DOWNLOAD_GET_PAGE") {
    return false;
  }

  sendResponse(readVideoPage());
  return false;
});

function readVideoPage() {
  return {
    bvid: extractBvid(location.href),
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
  return title.replace(/_哔哩哔哩_bilibili$/, "").trim();
}

function extractBvid(value) {
  const match = String(value).match(/BV[0-9A-Za-z]{10}/);
  return match ? match[0] : "";
}
