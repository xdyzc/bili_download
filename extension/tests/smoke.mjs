import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";


test("manifest declares a pure browser extension MVP", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, "src/popup.html");
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
  assert.ok(manifest.permissions.includes("declarativeNetRequestFeedback"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https://api.bilibili.com/*"));
  assert.equal(
    manifest.declarative_net_request.rule_resources[0].path,
    "rules/bili-media-headers.json"
  );
  assert.ok(!manifest.host_permissions.some((item) => item.includes("127.0.0.1")));
});


test("media header rules use declarative request modification", async () => {
  const rules = JSON.parse(await readFile("extension/rules/bili-media-headers.json", "utf8"));
  const rule = rules[0];

  assert.deepEqual(
    rules.map((item) => item.condition.urlFilter),
    ["||bilivideo.com/", "||bilivideo.cn/", "||hdslb.com/"]
  );
  assert.equal(rule.action.type, "modifyHeaders");
  assert.ok(rule.condition.resourceTypes.includes("main_frame"));
  assert.ok(rule.condition.resourceTypes.includes("image"));
  assert.ok(rule.condition.resourceTypes.includes("other"));
  assert.deepEqual(
    rule.action.requestHeaders.map((item) => [item.header, item.operation]),
    [
      ["Referer", "set"],
      ["Origin", "set"]
    ]
  );
});


test("popup contains MVP controls", async () => {
  const html = await readFile("extension/src/popup.html", "utf8");

  for (const id of ["status", "bvid", "copy", "title", "quality", "download", "diagnostic"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});


test("background loads qualities and starts direct browser downloads", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const downloadOptions = [];
  const fetchUrls = [];
  const storage = {};
  const downloadItems = new Map();
  const changeListeners = new Set();
  let messageListener = null;

  const sandbox = {
    Array,
    Date,
    Error,
    Number,
    Promise,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    setTimeout,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: {
          addListener() {}
        },
        async testMatchOutcome(request) {
          return {
            matchedRules: request.url.includes("hdslb.test")
              ? [{ ruleId: 3, rulesetId: "bili_media_headers" }]
              : []
          };
        }
      },
      downloads: {
        download(options, callback) {
          downloadOptions.push(options);
          const id = downloadOptions.length;
          downloadItems.set(id, {
            id,
            url: options.url,
            finalUrl: options.url,
            filename: options.filename,
            mime: "video/mp4",
            state: "in_progress",
            error: null,
            danger: "safe",
            fileSize: 10,
            totalBytes: 10,
            bytesReceived: 0,
            canResume: false,
            paused: false,
            exists: true,
            byExtensionName: "Bili Download",
            startTime: "2026-06-20T00:00:00.000Z"
          });
          callback(id);
          setTimeout(() => {
            const item = downloadItems.get(id);
            Object.assign(item, {
              state: "complete",
              bytesReceived: 10,
              endTime: "2026-06-20T00:00:01.000Z"
            });
            for (const listener of changeListeners) {
              listener({
                id,
                state: { previous: "in_progress", current: "complete" }
              });
            }
          }, 0);
        },
        search(query, callback) {
          callback([downloadItems.get(query.id)].filter(Boolean));
        },
        onChanged: {
          addListener(listener) {
            changeListeners.add(listener);
          },
          removeListener(listener) {
            changeListeners.delete(listener);
          }
        }
      },
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(values) {
            Object.assign(storage, values);
          }
        }
      }
    },
    fetch: async (url) => {
      fetchUrls.push(String(url));
      if (String(url).includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1KGj36QEG3",
            title: "Smoke Video",
            owner: { name: "tester" },
            pages: [{ page: 1, cid: 123, part: "P1" }]
          }
        });
      }
      if (String(url).includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 80,
            format: "mp4",
            accept_quality: [80, 64],
            accept_description: ["1080P", "720P"],
            durl: [{ url: "https://example.hdslb.test/video.mp4" }]
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const video = await sandbox.loadVideo({
    bvid: "BV1KGj36QEG3",
    title: "Smoke Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
  });
  assert.equal(video.bvid, "BV1KGj36QEG3");
  assert.equal(video.page.cid, 123);
  assert.deepEqual(video.qualities.map((item) => item.label), ["80 - 1080P", "64 - 720P"]);

  const result = await sandbox.startDirectDownload({
    bvid: "BV1KGj36QEG3",
    cid: 123,
    quality: 80,
    title: "Smoke Video"
  });
  assert.equal(result.count, 1);
  assert.equal(downloadOptions.length, 1);
  assert.equal(downloadOptions[0].filename, "BiliDownload/Smoke Video_80.mp4");
  assert.equal(downloadOptions[0].headers, undefined);
  assert.equal(result.diagnostics[0].phase, "complete");
  assert.equal(result.diagnostics[0].latestItem.state, "complete");
  assert.deepEqual(toPlain(result.diagnostics[0].dnr.checks[0].matchedRules), [
    { ruleId: 3, rulesetId: "bili_media_headers" }
  ]);
  assert.ok(fetchUrls.some((url) => url.includes("fnval=0")));

  const diagnosticResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_GET_DIAGNOSTIC"
  });
  assert.equal(diagnosticResponse.ok, true);
  assert.equal(diagnosticResponse.payload.phase, "complete");
});


test("background captures interrupted download diagnostics", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const downloadItems = new Map();
  const changeListeners = new Set();
  const storage = {};

  const sandbox = {
    Array,
    Date,
    Error,
    Number,
    Promise,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    setTimeout,
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener() {}
        }
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: {
          addListener() {}
        },
        async testMatchOutcome() {
          return { matchedRules: [] };
        }
      },
      downloads: {
        download(options, callback) {
          const id = 8;
          downloadItems.set(id, {
            id,
            url: options.url,
            finalUrl: options.url,
            filename: options.filename,
            mime: "video/mp4",
            state: "in_progress",
            danger: "safe",
            error: null,
            totalBytes: 0,
            bytesReceived: 0
          });
          callback(id);
          setTimeout(() => {
            const item = downloadItems.get(id);
            Object.assign(item, {
              state: "interrupted",
              error: "SERVER_FORBIDDEN",
              danger: "file"
            });
            for (const listener of changeListeners) {
              listener({
                id,
                state: { previous: "in_progress", current: "interrupted" },
                error: { current: "SERVER_FORBIDDEN" },
                danger: { previous: "safe", current: "file" }
              });
            }
          }, 0);
        },
        search(query, callback) {
          callback([downloadItems.get(query.id)].filter(Boolean));
        },
        onChanged: {
          addListener(listener) {
            changeListeners.add(listener);
          },
          removeListener(listener) {
            changeListeners.delete(listener);
          }
        }
      },
      storage: {
        local: {
          async get(key) {
            return { [key]: storage[key] };
          },
          async set(values) {
            Object.assign(storage, values);
          }
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  let error = null;
  try {
    await sandbox.downloadFileWithDiagnostics({
      options: {
        url: "https://example.hdslb.test/forbidden.mp4",
        filename: "BiliDownload/forbidden.mp4",
        conflictAction: "uniquify",
        saveAs: false
      },
      context: { bvid: "BV1KGj36QEG3" }
    });
  } catch (caught) {
    error = caught;
  }

  assert.ok(error);
  assert.match(error.message, /SERVER_FORBIDDEN/);
  assert.equal(error.diagnostic.phase, "interrupted");
  assert.equal(error.diagnostic.latestItem.error, "SERVER_FORBIDDEN");
  assert.equal(error.diagnostic.events[0].delta.error.current, "SERVER_FORBIDDEN");
  assert.equal(storage.lastDiagnostic.latestItem.error, "SERVER_FORBIDDEN");
});


function sendRuntimeMessage(listener, message) {
  return new Promise((resolve) => {
    const asyncResponse = listener(message, {}, resolve);
    assert.equal(asyncResponse, true);
  });
}


function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}


function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}
