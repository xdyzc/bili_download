const LOCAL_API = "http://127.0.0.1:8765/api/downloads";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "BILI_DOWNLOAD_SEND_TO_LOCAL") {
    return false;
  }

  sendToLocalDownloader(message.payload)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function sendToLocalDownloader(payload) {
  if (!payload?.bvid) {
    throw new Error("No BV id was found on this page.");
  }

  const response = await fetch(LOCAL_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      bvid: payload.bvid,
      title: payload.title || "",
      pageUrl: payload.url || ""
    })
  });

  if (!response.ok) {
    throw new Error(`Local downloader returned HTTP ${response.status}.`);
  }

  return response.json();
}
