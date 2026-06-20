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
  assert.ok(manifest.permissions.includes("scripting"));
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

  for (const id of [
    "status",
    "bvid",
    "copy",
    "title",
    "quality",
    "download",
    "diagnostic",
    "progress",
    "progress-percent",
    "progress-bar",
    "progress-size",
    "progress-speed"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});


test("content script forwards page progress events", async () => {
  const code = await readFile("extension/src/content.js", "utf8");
  const runtimeMessages = [];
  const listeners = {};

  const sandbox = {
    chrome: {
      runtime: {
        onMessage: {
          addListener() {}
        },
        async sendMessage(message) {
          runtimeMessages.push(message);
        }
      }
    },
    document: {
      querySelector() {
        return null;
      },
      title: "Smoke Video"
    },
    location: {
      href: "https://www.bilibili.com/video/BV1KGj36QEG3/"
    },
    window: {
      addEventListener(type, listener) {
        listeners[type] = listener;
      }
    },
    String
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  listeners["bili-download-progress"]({
    detail: {
      receivedBytes: 5,
      totalBytes: 10,
      extra: {
        notSerializable: true
      }
    }
  });

  assert.deepEqual(toPlain(runtimeMessages), [{
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: {
      receivedBytes: 5,
      totalBytes: 10,
      segmentIndex: 0,
      segmentCount: 0,
      candidateIndex: 0,
      candidateCount: 0,
      done: false
    }
  }]);
});


test("background loads qualities and starts direct browser downloads", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const downloadOptions = [];
  const fetchUrls = [];
  const storage = {};
  const downloadItems = new Map();
  const changeListeners = new Set();
  const connectedPorts = [];
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
        },
        onConnect: {
          addListener(listener) {
            connectedPorts.push(listener);
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
            durl: [{
              url: "https://primary.hdslb.test/video.mp4",
              size: 10 * 1024 * 1024,
              backup_url: [
                "https://backup.hdslb.test/video.mp4",
                "https://primary.hdslb.test/video.mp4"
              ]
            }]
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const portMessages = [];
  connectedPorts[0]({
    name: "BILI_DOWNLOAD_PROGRESS_PORT",
    postMessage(message) {
      portMessages.push(message);
    },
    onDisconnect: {
      addListener() {}
    }
  });

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
  assert.equal(result.method, "background-download");
  assert.equal(downloadOptions.length, 1);
  assert.equal(downloadOptions[0].filename, "BiliDownload/Smoke Video_80.mp4");
  assert.equal(downloadOptions[0].url, "https://primary.hdslb.test/video.mp4");
  assert.equal(downloadOptions[0].headers, undefined);
  assert.equal(result.diagnostics[0].initialItem.url.sample, "https://primary.hdslb.test/video.mp4");
  assert.equal(result.diagnostics[0].initialItem.referrer, undefined);
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

  const preparedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1KGj36QEG3",
      cid: 123,
      quality: 64,
      title: "Smoke Video"
    }
  });
  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.count, 1);
  assert.equal(preparedResponse.payload.segments[0].context.downloadMethod, "page-blob");
  assert.deepEqual(
    toPlain(preparedResponse.payload.segments[0].candidates),
    [
      { url: "https://primary.hdslb.test/video.mp4", kind: "primary", size: 10 * 1024 * 1024 },
      { url: "https://backup.hdslb.test/video.mp4", kind: "backup", size: 10 * 1024 * 1024 }
    ]
  );
  assert.equal(preparedResponse.payload.segments[0].size, 10 * 1024 * 1024);

  sandbox.chrome.runtime.onMessage.addListener;
  await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: {
      receivedBytes: 1024,
      totalBytes: 2048,
      segmentIndex: 1,
      segmentCount: 1,
      candidateIndex: 1,
      candidateCount: 2
    }
  });
  assert.deepEqual(toPlain(portMessages), [{
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: {
      receivedBytes: 1024,
      totalBytes: 2048,
      segmentIndex: 1,
      segmentCount: 1,
      candidateIndex: 1,
      candidateCount: 2,
      done: false,
      tabId: 0
    }
  }]);
});


test("popup uses page context blob download before fallback", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const scriptCalls = [];
  const runtimeMessages = [];
  const clipboardWrites = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  let clickCount = 0;
  let portListener = null;

  const sandbox = {
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        }
      }
    },
    setTimeout,
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement(tagName) {
        if (tagName === "a") {
          return {
            href: "",
            download: "",
            rel: "",
            click() {
              clickCount += 1;
            },
            remove() {}
          };
        }
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#bvid": textElement(),
          "#title": textElement(),
          "#quality": qualitySelect,
          "#copy": buttonElement(),
          "#download": buttonElement(),
          "#diagnostic": buttonElement(),
          "#progress": progressPanel,
          "#progress-percent": progressPercent,
          "#progress-bar": progressBar,
          "#progress-size": progressSize,
          "#progress-speed": progressSpeed
        }[selector];
      }
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/",
            title: "Smoke Video"
          }];
        },
        async sendMessage() {
          return {
            bvid: "BV1KGj36QEG3",
            title: "Smoke Video",
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
          };
        }
      },
      runtime: {
        id: "extension-id",
        connect() {
          return {
            onMessage: {
              addListener(listener) {
                portListener = listener;
              }
            }
          };
        },
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
            return { ok: true, payload: null };
          }
          if (message.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
            return {
              ok: true,
              payload: {
                bvid: "BV1KGj36QEG3",
                title: "Smoke Video",
                page: { cid: 123 },
                currentQuality: 64,
                qualities: [{ code: 64, label: "64 - 720P" }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            return {
              ok: true,
              payload: {
                count: 1,
                segments: [{
                  url: "https://primary.hdslb.test/video.mp4?token=hidden",
                  filename: "BiliDownload/Smoke Video_64.mp4",
                  size: 10 * 1024 * 1024,
                  candidates: [
                    {
                      url: "https://primary.hdslb.test/video.mp4?token=hidden",
                      kind: "primary",
                      size: 10 * 1024 * 1024
                    },
                    {
                      url: "https://backup.hdslb.test/video.mp4?token=hidden",
                      kind: "backup",
                      size: 10 * 1024 * 1024
                    }
                  ],
                  context: {
                    bvid: "BV1KGj36QEG3",
                    cid: 123,
                    quality: 64,
                    title: "Smoke Video",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "page-blob"
                  }
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC") {
            return { ok: true };
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      },
      scripting: {
        async executeScript(call) {
          scriptCalls.push(call);
          if (call.args[0].includes("primary")) {
            return [{
              result: {
                ok: false,
                error: "Failed to fetch",
                filename: call.args[1]
              }
            }];
          }
          return [{
            result: {
              ok: true,
              responseOk: true,
              status: 200,
              statusText: "OK",
              mime: "video/mp4",
              size: 10 * 1024 * 1024,
              totalBytes: 10 * 1024 * 1024,
              receivedBytes: 10 * 1024 * 1024,
              filename: call.args[1]
            }
          }];
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "64";
  const downloadPromise = sandbox.downloadSelectedQuality();
  portListener({
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: {
      receivedBytes: 5 * 1024 * 1024,
      totalBytes: 10 * 1024 * 1024,
      segmentIndex: 1,
      segmentCount: 1,
      candidateIndex: 2,
      candidateCount: 2
    }
  });
  await downloadPromise;

  assert.equal(scriptCalls.length, 2);
  assert.equal(scriptCalls[0].target.tabId, 99);
  assert.equal(scriptCalls[0].world, "MAIN");
  assert.equal(scriptCalls[0].args[1], "Smoke Video_64.mp4");
  assert.equal(scriptCalls[0].args[0], "https://primary.hdslb.test/video.mp4?token=hidden");
  assert.equal(scriptCalls[1].args[0], "https://backup.hdslb.test/video.mp4?token=hidden");
  assert.equal(scriptCalls[1].args[2].candidateIndex, 2);
  assert.match(statusElement.textContent, /1$/);
  assert.equal(progressPanel.hidden, false);
  assert.equal(progressPercent.textContent, "100%");
  assert.equal(progressBar.style.width, "100%");
  assert.match(progressSize.textContent, /10\.0 MB \/ 10\.0 MB/);
  assert.match(progressSpeed.textContent, /\/s$/);
  assert.equal(
    runtimeMessages.some((message) => message.type === "BILI_DOWNLOAD_START_DIRECT"),
    false
  );
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "complete");
  assert.equal(savedDiagnostic.candidateAttempts.length, 2);
  assert.equal(savedDiagnostic.candidateAttempts[0].candidateKind, "primary");
  assert.equal(savedDiagnostic.candidateAttempts[0].fetch.error, "Failed to fetch");
  assert.equal(savedDiagnostic.candidateAttempts[1].candidateKind, "backup");
  assert.equal(savedDiagnostic.candidateAttempts[1].fetch.responseOk, true);
  assert.equal(clipboardWrites.length, 0);
  assert.equal(clickCount, 0);
});


test("popup reports failure without navigating when all fetch candidates fail", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  let nativeClickCount = 0;

  const sandbox = {
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout,
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement(tagName) {
        if (tagName === "a") {
          return {
            href: "",
            download: "",
            rel: "",
            click() {
              nativeClickCount += 1;
            },
            remove() {}
          };
        }
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#bvid": textElement(),
          "#title": textElement(),
          "#quality": qualitySelect,
          "#copy": buttonElement(),
          "#download": buttonElement(),
          "#diagnostic": buttonElement(),
          "#progress": progressPanel,
          "#progress-percent": textElement(),
          "#progress-bar": styleElement(),
          "#progress-size": textElement(),
          "#progress-speed": textElement()
        }[selector];
      }
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/",
            title: "Smoke Video"
          }];
        },
        async sendMessage() {
          return {
            bvid: "BV1KGj36QEG3",
            title: "Smoke Video",
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
          };
        }
      },
      runtime: {
        connect() {
          return {
            onMessage: {
              addListener() {}
            }
          };
        },
        onMessage: {
          addListener() {}
        },
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
            return { ok: true, payload: null };
          }
          if (message.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
            return {
              ok: true,
              payload: {
                bvid: "BV1KGj36QEG3",
                title: "Smoke Video",
                page: { cid: 123 },
                currentQuality: 64,
                qualities: [{ code: 64, label: "64 - 720P" }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            return {
              ok: true,
              payload: {
                count: 1,
                segments: [{
                  url: "https://primary.hdslb.test/video.mp4",
                  filename: "BiliDownload/Smoke Video_64.mp4",
                  size: 10 * 1024 * 1024,
                  candidates: [
                    { url: "https://primary.hdslb.test/video.mp4", kind: "primary", size: 10 * 1024 * 1024 },
                    { url: "https://backup.hdslb.test/video.mp4", kind: "backup", size: 10 * 1024 * 1024 }
                  ],
                  context: {
                    bvid: "BV1KGj36QEG3",
                    cid: 123,
                    quality: 64,
                    title: "Smoke Video",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "page-blob"
                  }
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC") {
            return { ok: true };
          }
          if (message.type === "BILI_DOWNLOAD_START_DIRECT") {
            throw new Error("background fallback should not run");
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      },
      scripting: {
        async executeScript(call) {
          scriptCalls.push(call);
          return [{
            result: {
              ok: false,
              error: `Failed to fetch ${call.args[0]}`,
              filename: call.args[1]
            }
          }];
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "64";
  await sandbox.downloadSelectedQuality();

  assert.match(statusElement.textContent, /Failed to fetch https:\/\/backup\.hdslb\.test\/video\.mp4/);
  assert.equal(
    runtimeMessages.some((message) => message.type === "BILI_DOWNLOAD_START_DIRECT"),
    false
  );
  assert.equal(scriptCalls.length, 2);
  assert.equal(scriptCalls[0].func.name, "downloadMediaInPage");
  assert.equal(scriptCalls[1].func.name, "downloadMediaInPage");
  assert.equal(scriptCalls[0].args[0], "https://primary.hdslb.test/video.mp4");
  assert.equal(scriptCalls[1].args[0], "https://backup.hdslb.test/video.mp4");
  assert.equal(nativeClickCount, 0);
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "page-fetch-message-error");
  assert.equal(savedDiagnostic.candidateAttempts.length, 2);
  assert.equal(savedDiagnostic.candidateAttempts[0].fetch.error, "Failed to fetch https://primary.hdslb.test/video.mp4");
  assert.equal(savedDiagnostic.candidateAttempts[1].fetch.error, "Failed to fetch https://backup.hdslb.test/video.mp4");
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


test("background error responses are message-serializable", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
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
        }
      },
      storage: {
        local: {
          async get() {
            return {};
          },
          async set() {}
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const diagnostic = {
    phase: "interrupted",
    error: "SERVER_FORBIDDEN",
    context: { bvid: "BV1KGj36QEG3" }
  };
  diagnostic.allCandidateDiagnostics = [diagnostic];
  const error = new Error("Download failed: SERVER_FORBIDDEN");
  error.diagnostic = diagnostic;

  const response = sandbox.errorResponse(error);

  assert.equal(response.ok, false);
  assert.equal(response.error, "Download failed: SERVER_FORBIDDEN");
  assert.equal(response.diagnostic.phase, "interrupted");
  assert.doesNotThrow(() => JSON.stringify(response));
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


function textElement() {
  return {
    value: "",
    textContent: "",
    disabled: false,
    addEventListener() {}
  };
}


function buttonElement() {
  return {
    disabled: false,
    addEventListener() {}
  };
}


function selectElement() {
  return {
    value: "",
    disabled: false,
    children: [],
    append(option) {
      this.children.push(option);
      if (option.selected) {
        this.value = option.value;
      }
    },
    replaceChildren() {
      this.children = [];
      this.value = "";
    }
  };
}


function optionElement() {
  return {
    value: "",
    textContent: "",
    selected: false
  };
}


function panelElement() {
  return {
    hidden: true
  };
}


function styleElement() {
  return {
    style: {
      width: ""
    }
  };
}


function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}
