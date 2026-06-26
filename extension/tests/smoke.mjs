import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const { Muxer, ArrayBufferTarget } = await import("../vendor/mp4-muxer/mp4-muxer.mjs");
const MP4Box = await import("../vendor/mp4box/mp4box.all.mjs");


test("manifest declares a pure browser side panel extension", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "src/popup.html");
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
  assert.ok(manifest.permissions.includes("declarativeNetRequestFeedback"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https://api.bilibili.com/*"));
  assert.ok(manifest.host_permissions.includes("https://*.edge.mountaintoys.cn/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://www.bilibili.com/bangumi/play/*"));
  assert.equal(
    manifest.declarative_net_request.rule_resources[0].path,
    "rules/bili-media-headers.json"
  );
  assert.ok(!manifest.host_permissions.some((item) => item.includes("127.0.0.1")));
});


test("background opens the side panel from the toolbar action", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const panelBehaviors = [];
  const openedPanels = [];
  let installedListener = null;
  let actionListener = null;

  const sandbox = {
    Array,
    Date,
    Error,
    Number,
    Promise,
    String,
    URL,
    URLSearchParams,
    chrome: {
      runtime: {
        lastError: null,
        onInstalled: {
          addListener(listener) {
            installedListener = listener;
          }
        },
        onMessage: {
          addListener() {}
        },
        onConnect: {
          addListener() {}
        }
      },
      action: {
        onClicked: {
          addListener(listener) {
            actionListener = listener;
          }
        }
      },
      sidePanel: {
        async setPanelBehavior(options) {
          panelBehaviors.push(options);
        },
        async open(options) {
          openedPanels.push(options);
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

  assert.equal(typeof installedListener, "function");
  assert.equal(typeof actionListener, "function");
  assert.deepEqual(toPlain(panelBehaviors), [{ openPanelOnActionClick: true }]);
  await installedListener();
  await actionListener({ windowId: 7 });

  assert.deepEqual(toPlain(panelBehaviors), [
    { openPanelOnActionClick: true },
    { openPanelOnActionClick: true }
  ]);
  assert.deepEqual(toPlain(openedPanels), [{ windowId: 7 }]);
});


test("media header rules use declarative request modification", async () => {
  const rules = JSON.parse(await readFile("extension/rules/bili-media-headers.json", "utf8"));
  const rule = rules[0];

  assert.deepEqual(
    rules.map((item) => item.condition.urlFilter),
    ["||bilivideo.com/", "||bilivideo.cn/", "||hdslb.com/", "||edge.mountaintoys.cn/"]
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
    "account",
    "bvid",
    "copy",
    "title",
    "quality",
    "download",
    "download-audio",
    "page-picker-toggle",
    "page-picker",
    "page-list",
    "page-select-all",
    "download-selected-pages",
    "download-selected-page-audio",
    "diagnostic",
    "progress",
    "progress-percent",
    "progress-bar",
    "progress-size",
    "progress-speed",
    "download-controls",
    "pause",
    "cancel"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});


test("DASH muxer combines video and audio into a parseable MP4", async () => {
  const { muxDashToMp4 } = await import("../src/dash-muxer.mjs");
  const videoBlob = new Blob([makeFragmentedVideoTrack()], { type: "video/mp4" });
  const audioBlob = new Blob([makeFragmentedAudioTrack()], { type: "audio/mp4" });

  const result = await muxDashToMp4({
    videoBlob,
    audioBlob,
    outputName: "Merged Smoke.mp4"
  });
  const info = await parseMp4Info(await result.blob.arrayBuffer());

  assert.equal(result.filename, "Merged Smoke.mp4");
  assert.equal(result.blob.type, "video/mp4");
  assert.ok(result.blob.size > videoBlob.size);
  assert.equal(info.tracks.length, 2);
  assert.ok(info.tracks.some((track) => track.video && track.codec.startsWith("avc1")));
  assert.ok(info.tracks.some((track) => track.audio && track.codec.startsWith("mp4a")));
});


test("DASH muxer reads input blobs in slices", async () => {
  const { muxDashToMp4 } = await import("../src/dash-muxer.mjs");
  const videoBlob = trackingBlob(new Blob([makeFragmentedVideoTrack()], { type: "video/mp4" }));
  const audioBlob = trackingBlob(new Blob([makeFragmentedAudioTrack()], { type: "audio/mp4" }));

  const result = await muxDashToMp4({
    videoBlob,
    audioBlob,
    outputName: "Sliced Smoke.mp4"
  });

  assert.equal(result.filename, "Sliced Smoke.mp4");
  assert.ok(result.blob.size > 0);
  assert.equal(videoBlob.fullArrayBufferCalls, 0);
  assert.equal(audioBlob.fullArrayBufferCalls, 0);
  assert.ok(videoBlob.sliceCalls > 0);
  assert.ok(audioBlob.sliceCalls > 0);
});


test("DASH muxer composes rewritten output chunks", async () => {
  const { composeOutputChunksForTest } = await import("../src/dash-muxer.mjs");
  const prefix = new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1]);
  const rewrite = new Uint8Array([9, 9]);
  const suffix = new Uint8Array([2, 2, 2, 2]);

  const chunks = composeOutputChunksForTest([
    { position: 0, size: prefix.byteLength, blob: new Blob([prefix]) },
    { position: 3, size: rewrite.byteLength, blob: new Blob([rewrite]) },
    { position: 8, size: suffix.byteLength, blob: new Blob([suffix]) }
  ]);
  const bytes = new Uint8Array(await new Blob(chunks.map((chunk) => chunk.blob)).arrayBuffer());

  assert.deepEqual([...bytes], [1, 1, 1, 9, 9, 1, 1, 1, 2, 2, 2, 2]);
});


test("DASH muxer normalizes near-integer video frame rates", async () => {
  const { normalizeVideoFrameRate } = await import("../src/dash-muxer.mjs");

  assert.equal(normalizeVideoFrameRate(59.99999518984133), 60);
  assert.equal(normalizeVideoFrameRate(30.0000004), 30);
  assert.equal(normalizeVideoFrameRate(59.94), undefined);
  assert.equal(normalizeVideoFrameRate(0), undefined);
});


test("content script forwards page progress events", async () => {
  const code = await readFile("extension/src/content.js", "utf8");
  const runtimeMessages = [];
  const listeners = {};
  let messageListener = null;

  const sandbox = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
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

  assert.deepEqual(toPlain(sandbox.readPage()), {
    type: "video",
    bvid: "BV1KGj36QEG3",
    seasonId: null,
    epId: null,
    title: "Smoke Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
  });

  sandbox.location.href = "https://www.bilibili.com/bangumi/play/ss1512";
  sandbox.document.title = "Bangumi Season_bilibili";
  assert.deepEqual(toPlain(sandbox.readPage()), {
    type: "bangumi",
    bvid: "",
    seasonId: 1512,
    epId: null,
    title: "Bangumi Season",
    url: "https://www.bilibili.com/bangumi/play/ss1512"
  });

  sandbox.location.href = "https://www.bilibili.com/bangumi/play/ep28160";
  let pageMessageResponse = null;
  const pageMessageResult = messageListener({
    type: "BILI_DOWNLOAD_GET_PAGE"
  }, {}, (payload) => {
    pageMessageResponse = payload;
  });
  assert.equal(pageMessageResult, false);
  assert.equal(pageMessageResponse.type, "bangumi");
  assert.equal(pageMessageResponse.epId, 28160);

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


test("background loads Bangumi episodes and prepares PGC DASH downloads", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];
  let messageListener = null;

  const pgcPlayUrl = {
    code: 0,
    message: "Success",
    quality: 64,
    format: "dash",
    accept_quality: [80, 64, 32],
    accept_description: ["1080P", "720P", "480P"],
    support_formats: [
      { quality: 80, description: "1080P", need_login: true, need_vip: false },
      { quality: 64, description: "720P", need_login: false, need_vip: false },
      { quality: 32, description: "480P", need_login: false, need_vip: false }
    ],
    durls: [],
    dash: {
      video: [
        {
          id: 64,
          base_url: "https://video-primary.bilivideo.com/pgc-64.m4s",
          backup_url: ["https://video-backup.bilivideo.com/pgc-64.m4s"],
          bandwidth: 1200000,
          codecs: "avc1.640028",
          mime_type: "video/mp4",
          width: 1280,
          height: 720,
          frame_rate: "30.000",
          size: 8 * 1024 * 1024
        },
        {
          id: 32,
          base_url: "https://video-primary.bilivideo.com/pgc-32.m4s",
          bandwidth: 800000,
          codecs: "avc1.64001F",
          mime_type: "video/mp4",
          width: 852,
          height: 480,
          frame_rate: "30.000",
          size: 4 * 1024 * 1024
        }
      ],
      audio: [{
        id: 30280,
        base_url: "https://audio-primary.bilivideo.com/pgc-audio.m4s",
        backup_url: ["https://audio-backup.bilivideo.com/pgc-audio.m4s"],
        bandwidth: 192000,
        codecs: "mp4a.40.2",
        mime_type: "audio/mp4",
        size: 1024 * 1024
      }]
    },
    is_drm: false,
    is_preview: 0,
    can_watch_reason: 0
  };

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
    },
    fetch: async (url) => {
      const value = String(url);
      fetchUrls.push(value);
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: false,
            uname: "",
            mid: 0,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/pgc/view/web/season")) {
        return jsonResponse({
          code: 0,
          result: {
            season_id: 1512,
            season_title: "Bangumi Season",
            episodes: [
              {
                aid: 1871363,
                bvid: "BV1dx411w7kp",
                cid: 49052509,
                ep_id: 28160,
                title: "0",
                show_title: "Episode Zero",
                long_title: "Zero"
              },
              {
                aid: 1871364,
                bvid: "BV1dx411w7kq",
                cid: 49052510,
                ep_id: 28161,
                title: "1",
                show_title: "Episode One",
                long_title: "One"
              }
            ]
          }
        });
      }
      if (value.includes("/pgc/player/web/playurl")) {
        return jsonResponse({
          code: 0,
          result: pgcPlayUrl
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const video = await sandbox.loadVideo({
    type: "bangumi",
    seasonId: 1512,
    title: "Bangumi Season",
    url: "https://www.bilibili.com/bangumi/play/ss1512"
  });

  assert.equal(video.source, "bangumi");
  assert.equal(video.seasonId, 1512);
  assert.equal(video.epId, 28160);
  assert.equal(video.page.cid, 49052509);
  assert.equal(video.page.title, "Episode Zero");
  assert.deepEqual(video.pages.map((page) => [page.index, page.cid, page.epId, page.title]), [
    [1, 49052509, 28160, "Episode Zero"],
    [2, 49052510, 28161, "Episode One"]
  ]);
  assert.deepEqual(video.qualities.map((quality) => [quality.code, quality.available, quality.reason]), [
    [80, false, "login-required"],
    [64, true, ""],
    [32, true, ""]
  ]);
  assert.ok(fetchUrls.some((url) => url.includes("/pgc/view/web/season?season_id=1512")));
  assert.ok(fetchUrls.some((url) => url.includes("/pgc/player/web/playurl") && url.includes("ep_id=28160")));

  const preparedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1dx411w7kp",
      epId: 28160,
      cid: 49052509,
      quality: 64,
      title: "Bangumi Season_Episode Zero"
    }
  });

  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.mode, "dash");
  assert.equal(preparedResponse.payload.count, 2);
  assert.equal(preparedResponse.payload.segments[0].context.source, "bangumi");
  assert.equal(preparedResponse.payload.segments[0].context.epId, 28160);
  assert.equal(preparedResponse.payload.segments[0].filename, "BiliDownload/Bangumi Season_Episode Zero_64_video.m4s");

  const audioResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_AUDIO",
    payload: {
      bvid: "BV1dx411w7kp",
      epId: 28161,
      cid: 49052510,
      title: "Bangumi Season_Episode One_audio"
    }
  });

  assert.equal(audioResponse.ok, true);
  assert.equal(audioResponse.payload.mode, "audio");
  assert.equal(audioResponse.payload.segments[0].context.source, "bangumi");
  assert.equal(audioResponse.payload.segments[0].context.epId, 28161);
  assert.equal(audioResponse.payload.segments[0].filename, "BiliDownload/Bangumi Season_Episode One_audio.m4a");
  assert.ok(fetchUrls.some((url) => url.includes("ep_id=28161")));
});


test("background unlocks Bangumi high qualities by probing PGC DASH per quality", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];

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
        },
        onConnect: {
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
    },
    fetch: async (url) => {
      const value = String(url);
      fetchUrls.push(value);
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "vip-user",
            mid: 42,
            vipInfo: {
              label: {
                text: "大会员"
              }
            }
          }
        });
      }
      if (value.includes("/pgc/view/web/season")) {
        return jsonResponse({
          code: 0,
          result: {
            season_id: 1512,
            season_title: "Bangumi Season",
            episodes: [{
              aid: 1871363,
              bvid: "BV1dx411w7kp",
              cid: 49052509,
              ep_id: 28160,
              title: "1",
              show_title: "Episode One"
            }]
          }
        });
      }
      if (value.includes("/pgc/player/web/playurl")) {
        const qn = new URL(value).searchParams.get("qn");
        const dashVideos = qn === "80"
          ? [{
            id: 80,
            base_url: "https://video-primary.bilivideo.com/pgc-80.m4s",
            bandwidth: 2200000,
            codecs: "avc1.640028",
            mime_type: "video/mp4",
            width: 1920,
            height: 1080,
            frame_rate: "30.000",
            size: 16 * 1024 * 1024
          }, {
            id: 32,
            base_url: "https://video-primary.bilivideo.com/pgc-32.m4s",
            bandwidth: 800000,
            codecs: "avc1.64001F",
            mime_type: "video/mp4",
            width: 852,
            height: 480,
            frame_rate: "30.000",
            size: 4 * 1024 * 1024
          }]
          : [{
            id: 32,
            base_url: "https://video-primary.bilivideo.com/pgc-32.m4s",
            bandwidth: 800000,
            codecs: "avc1.64001F",
            mime_type: "video/mp4",
            width: 852,
            height: 480,
            frame_rate: "30.000",
            size: 4 * 1024 * 1024
          }];
        return jsonResponse({
          code: 0,
          result: {
            code: 0,
            message: "Success",
            quality: qn === "80" ? 80 : 32,
            format: "dash",
            accept_quality: [80, 32],
            accept_description: ["1080P", "480P"],
            support_formats: [
              { quality: 80, description: "1080P", need_login: true, need_vip: false },
              { quality: 32, description: "480P", need_login: false, need_vip: false }
            ],
            durls: [],
            dash: {
              video: dashVideos,
              audio: [{
                id: 30280,
                base_url: "https://audio-primary.bilivideo.com/pgc-audio.m4s",
                bandwidth: 192000,
                codecs: "mp4a.40.2",
                mime_type: "audio/mp4",
                size: 1024 * 1024
              }]
            },
            is_drm: false,
            is_preview: 0,
            can_watch_reason: 0
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const video = await sandbox.loadVideo({
    type: "bangumi",
    seasonId: 1512,
    title: "Bangumi Season",
    url: "https://www.bilibili.com/bangumi/play/ss1512"
  });

  const quality80 = video.qualities.find((quality) => quality.code === 80);
  assert.equal(quality80.available, true);
  assert.equal(quality80.mode, "dash");
  assert.equal(video.currentQuality, 80);
  assert.ok(fetchUrls.some((url) => url.includes("/pgc/player/web/playurl") && url.includes("qn=80") && url.includes("fnval=4048")));
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
      if (String(url).includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "cookie-user",
            mid: 11701066,
            vipInfo: {
              label: {
                text: "年度大会员"
              }
            }
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
  assert.equal(video.account.isLogin, true);
  assert.equal(video.account.username, "cookie-user");
  assert.equal(video.account.vipLabel, "年度大会员");
  assert.deepEqual(video.qualities.map((item) => item.label), ["1080P", "720P"]);
  assert.deepEqual(video.qualities.map((item) => item.estimatedSize), [10 * 1024 * 1024, 0]);

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
  assert.ok(fetchUrls.some((url) => url.includes("/x/web-interface/nav")));
  assert.ok(fetchUrls.some((url) => url.includes("fnval=4048")));

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
      quality: 80,
      title: "Smoke Video"
    }
  });
  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.count, 1);
  assert.equal(preparedResponse.payload.mode, "durl");
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


test("background returns normalized multi-page metadata for the current URL page", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];

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
        },
        onConnect: {
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
    },
    fetch: async (url) => {
      const value = String(url);
      fetchUrls.push(value);
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "multi-user",
            mid: 42,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1KGj36QEG3",
            title: "Multi Page Video",
            owner: { name: "tester" },
            pages: [
              { page: 1, cid: 101, part: "Opening" },
              { page: 2, cid: 202, part: "Middle" },
              { page: 3, cid: 303, part: "Ending" }
            ]
          }
        });
      }
      if (value.includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 64,
            format: "mp4",
            accept_quality: [64],
            accept_description: ["720P"],
            durl: [{
              url: "https://primary.hdslb.test/page.mp4",
              size: 1024
            }]
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
    title: "Multi Page Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/?p=2"
  });

  assert.equal(video.page.index, 2);
  assert.equal(video.page.cid, 202);
  assert.equal(video.page.title, "Middle");
  assert.deepEqual(video.pages.map((page) => [page.index, page.cid, page.title]), [
    [1, 101, "Opening"],
    [2, 202, "Middle"],
    [3, 303, "Ending"]
  ]);
  assert.ok(fetchUrls.some((url) => url.includes("cid=202")));
});


test("background reads browser cookie account and prepares DASH streams", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];
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
    },
    fetch: async (url) => {
      fetchUrls.push(String(url));
      if (String(url).includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "dash-user",
            mid: 42,
            vipInfo: {
              label: {
                text: "大会员"
              }
            }
          }
        });
      }
      if (String(url).includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1KGj36QEG3",
            title: "Dash Video",
            owner: { name: "tester" },
            pages: [{ page: 1, cid: 456, part: "P1" }]
          }
        });
      }
      if (String(url).includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 116,
            format: "flv",
            accept_quality: [116, 80, 64],
            accept_description: ["1080P60", "1080P", "720P"],
            durl: [],
            dash: {
              video: [
                {
                  id: 116,
                  base_url: "https://video-primary.bilivideo.com/116.m4s",
                  backup_url: ["https://video-backup.bilivideo.com/116.m4s"],
                  bandwidth: 2600000,
                  codecs: "avc1.640032",
                  mime_type: "video/mp4",
                  width: 1920,
                  height: 1080,
                  frame_rate: "60.000",
                  size: 20 * 1024 * 1024
                },
                {
                  id: 80,
                  base_url: "https://video-primary.bilivideo.com/80.m4s",
                  bandwidth: 1500000,
                  codecs: "avc1.640028",
                  mime_type: "video/mp4",
                  width: 1920,
                  height: 1080,
                  frame_rate: "30.000",
                  size: 12 * 1024 * 1024
                }
              ],
              audio: [
                {
                  id: 30216,
                  baseUrl: "https://audio-primary.bilivideo.com/audio-low.m4s",
                  bandwidth: 64000,
                  codecs: "mp4a.40.2",
                  mimeType: "audio/mp4",
                  size: 1024 * 1024
                },
                {
                  id: 30280,
                  baseUrl: "https://audio-primary.bilivideo.com/audio-high.m4s",
                  backupUrl: ["https://audio-backup.bilivideo.com/audio-high.m4s"],
                  bandwidth: 192000,
                  codecs: "mp4a.40.2",
                  mimeType: "audio/mp4",
                  size: 2 * 1024 * 1024
                }
              ]
            }
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const accountResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_GET_ACCOUNT"
  });
  assert.equal(accountResponse.ok, true);
  assert.equal(accountResponse.payload.username, "dash-user");
  assert.equal(accountResponse.payload.vipLabel, "大会员");

  const video = await sandbox.loadVideo({
    bvid: "BV1KGj36QEG3",
    title: "Dash Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
  });
  assert.equal(video.dashAvailable, true);
  assert.equal(video.directAvailable, false);
  assert.deepEqual(video.qualities.map((item) => item.label), [
    "1080P60 · 1920x1080 · 60fps · AVC",
    "1080P · 1920x1080 · 30fps · AVC",
    "720P"
  ]);
  assert.deepEqual(video.qualities.map((item) => item.estimatedSize), [
    22 * 1024 * 1024,
    14 * 1024 * 1024,
    0
  ]);

  const preparedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1KGj36QEG3",
      cid: 456,
      quality: 116,
      title: "Dash Video"
    }
  });

  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.mode, "dash");
  assert.equal(preparedResponse.payload.count, 2);
  assert.equal(preparedResponse.payload.segments[0].filename, "BiliDownload/Dash Video_116_video.m4s");
  assert.equal(preparedResponse.payload.segments[1].filename, "BiliDownload/Dash Video_116_audio.m4s");
  assert.equal(preparedResponse.payload.segments[0].context.role, "video");
  assert.equal(preparedResponse.payload.segments[1].context.role, "audio");
  assert.equal(preparedResponse.payload.segments[0].size, 20 * 1024 * 1024);
  assert.equal(preparedResponse.payload.segments[1].size, 2 * 1024 * 1024);
  assert.deepEqual(
    toPlain(preparedResponse.payload.segments[1].candidates),
    [
      { url: "https://audio-primary.bilivideo.com/audio-high.m4s", kind: "primary", size: 2 * 1024 * 1024 },
      { url: "https://audio-backup.bilivideo.com/audio-high.m4s", kind: "backup", size: 2 * 1024 * 1024 }
    ]
  );
  assert.ok(fetchUrls.some((url) => url.includes("fnval=0")));
  assert.ok(fetchUrls.some((url) => url.includes("fnval=4048")));
});


test("background probes missing DASH media sizes from response headers", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchCalls = [];

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
        },
        onConnect: {
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
    },
    fetch: async (url, options = {}) => {
      const value = String(url);
      fetchCalls.push({
        url: value,
        method: options.method || "GET",
        range: options.headers?.Range || options.headers?.range || ""
      });
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "size-user",
            mid: 42,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1SIZEPROBE1",
            title: "Size Probe Video",
            owner: { name: "tester" },
            pages: [{ page: 1, cid: 456, part: "P1" }]
          }
        });
      }
      if (value.includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 80,
            format: "dash",
            timelength: 60000,
            accept_quality: [80],
            accept_description: ["1080P"],
            durl: [],
            dash: {
              video: [{
                id: 80,
                base_url: "https://video-primary.bilivideo.com/no-size-video.m4s",
                bandwidth: 1500000,
                codecs: "avc1.640028",
                mime_type: "video/mp4",
                width: 1920,
                height: 1080,
                frame_rate: "30.000"
              }],
              audio: [{
                id: 30280,
                base_url: "https://audio-primary.bilivideo.com/no-size-audio.m4s",
                bandwidth: 192000,
                codecs: "mp4a.40.2",
                mime_type: "audio/mp4"
              }]
            }
          }
        });
      }
      if (value.includes("no-size-video.m4s") && options.method === "HEAD") {
        return headersOnlyResponse(30 * 1024 * 1024);
      }
      if (value.includes("no-size-audio.m4s") && options.method === "HEAD") {
        return headersOnlyResponse(2 * 1024 * 1024);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const video = await sandbox.loadVideo({
    bvid: "BV1SIZEPROBE1",
    title: "Size Probe Video",
    url: "https://www.bilibili.com/video/BV1SIZEPROBE1/"
  });
  assert.equal(video.qualities[0].estimatedSize, 32 * 1024 * 1024);
  assert.equal(video.qualities[0].estimatedSizeSource, "headers");
  assert.equal(video.qualities[0].estimatedSizeApproximate, false);
  assert.ok(fetchCalls.some((call) => call.method === "HEAD" && call.url.includes("no-size-video.m4s")));
  assert.ok(fetchCalls.some((call) => call.method === "HEAD" && call.url.includes("no-size-audio.m4s")));
});


test("background estimates missing DASH media sizes from bandwidth when header probing fails", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const expectedSize = Math.round(((8_000_000 + 192_000) * 60) / 8);

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
        },
        onConnect: {
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
    },
    fetch: async (url) => {
      const value = String(url);
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "size-user",
            mid: 42,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1BANDWIDTH1",
            title: "Bandwidth Estimate Video",
            owner: { name: "tester" },
            pages: [{ page: 1, cid: 456, part: "P1" }]
          }
        });
      }
      if (value.includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 120,
            format: "dash",
            timelength: 60000,
            accept_quality: [120],
            accept_description: ["4K"],
            durl: [],
            dash: {
              video: [{
                id: 120,
                base_url: "https://video-primary.bilivideo.com/bandwidth-video.m4s",
                bandwidth: 8_000_000,
                codecs: "avc1.640033",
                mime_type: "video/mp4",
                width: 3840,
                height: 2160,
                frame_rate: "30.000"
              }],
              audio: [{
                id: 30280,
                base_url: "https://audio-primary.bilivideo.com/bandwidth-audio.m4s",
                bandwidth: 192_000,
                codecs: "mp4a.40.2",
                mime_type: "audio/mp4"
              }]
            }
          }
        });
      }
      throw new Error(`media size probe failed: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const video = await sandbox.loadVideo({
    bvid: "BV1BANDWIDTH1",
    title: "Bandwidth Estimate Video",
    url: "https://www.bilibili.com/video/BV1BANDWIDTH1/"
  });
  assert.equal(video.qualities[0].label, "4K · 3840x2160 · 30fps · AVC");
  assert.equal(video.qualities[0].estimatedSize, expectedSize);
  assert.equal(video.qualities[0].estimatedSizeSource, "bandwidth");
  assert.equal(video.qualities[0].estimatedSizeApproximate, true);
});


test("background prepares standalone DASH audio streams", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
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
    },
    fetch: async (url) => {
      if (String(url).includes("/x/player/playurl")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 80,
            format: "dash",
            accept_quality: [80, 64],
            accept_description: ["1080P", "720P"],
            durl: [],
            dash: {
              video: [{
                id: 80,
                base_url: "https://video-primary.bilivideo.com/80.m4s",
                bandwidth: 1500000,
                codecs: "avc1.640028",
                mime_type: "video/mp4",
                size: 12 * 1024 * 1024
              }],
              audio: [
                {
                  id: 30216,
                  base_url: "https://audio-primary.bilivideo.com/audio-low.m4s",
                  bandwidth: 64000,
                  codecs: "mp4a.40.2",
                  mime_type: "audio/mp4",
                  size: 1024 * 1024
                },
                {
                  id: 30280,
                  base_url: "https://audio-primary.bilivideo.com/audio-high.m4s",
                  backup_url: ["https://audio-backup.bilivideo.com/audio-high.m4s"],
                  bandwidth: 192000,
                  codecs: "mp4a.40.2",
                  mime_type: "audio/mp4",
                  size: 2 * 1024 * 1024
                }
              ]
            }
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const response = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_AUDIO",
    payload: {
      bvid: "BV1KGj36QEG3",
      cid: 456,
      title: "Dash Video_audio"
    }
  });

  assert.equal(response.ok, true);
  assert.equal(response.payload.mode, "audio");
  assert.equal(response.payload.count, 1);
  assert.equal(response.payload.segments[0].filename, "BiliDownload/Dash Video_audio.m4a");
  assert.equal(response.payload.segments[0].url, "https://audio-primary.bilivideo.com/audio-high.m4s");
  assert.equal(response.payload.segments[0].context.role, "audio");
  assert.equal(response.payload.segments[0].context.quality, 30280);
  assert.equal(response.payload.audio.bandwidth, 192000);
  assert.deepEqual(toPlain(response.payload.segments[0].candidates), [
    { url: "https://audio-primary.bilivideo.com/audio-high.m4s", kind: "primary", size: 2 * 1024 * 1024 },
    { url: "https://audio-backup.bilivideo.com/audio-high.m4s", kind: "backup", size: 2 * 1024 * 1024 }
  ]);
});


test("background falls back to legacy direct streams when DASH lacks selected quality", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];
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
    },
    fetch: async (url) => {
      const value = String(url);
      fetchUrls.push(value);
      if (value.includes("/x/player/playurl") && value.includes("fnval=4048")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 64,
            format: "mp4",
            accept_quality: [64, 32, 16],
            accept_description: ["高清 720P", "清晰 480P", "流畅 360P"],
            durl: [],
            dash: {
              video: [
                {
                  id: 32,
                  base_url: "https://video-primary.bilivideo.com/32.m4s",
                  bandwidth: 800000,
                  codecs: "avc1.64001f",
                  mime_type: "video/mp4",
                  width: 852,
                  height: 480,
                  frame_rate: "30.000",
                  size: 4 * 1024 * 1024
                },
                {
                  id: 16,
                  base_url: "https://video-primary.bilivideo.com/16.m4s",
                  bandwidth: 400000,
                  codecs: "avc1.64001e",
                  mime_type: "video/mp4",
                  width: 640,
                  height: 360,
                  frame_rate: "30.000",
                  size: 2 * 1024 * 1024
                }
              ],
              audio: [{
                id: 30216,
                base_url: "https://audio-primary.bilivideo.com/audio.m4s",
                bandwidth: 64000,
                codecs: "mp4a.40.2",
                mime_type: "audio/mp4",
                size: 1024 * 1024
              }]
            }
          }
        });
      }
      if (value.includes("/x/player/playurl") && value.includes("fnval=0")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 64,
            format: "mp4",
            accept_quality: [64, 32, 16],
            accept_description: ["高清 720P", "清晰 480P", "流畅 360P"],
            durl: [{
              url: "https://legacy.hdslb.test/video-720.mp4",
              size: 7 * 1024 * 1024,
              backup_url: ["https://legacy-backup.hdslb.test/video-720.mp4"]
            }]
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const preparedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1MqL96rEGB",
      cid: 123,
      quality: 64,
      title: "No Cookie Video"
    }
  });

  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.mode, "durl");
  assert.equal(preparedResponse.payload.segments[0].filename, "BiliDownload/No Cookie Video_64.mp4");
  assert.equal(preparedResponse.payload.segments[0].context.quality, 64);
  assert.deepEqual(
    toPlain(preparedResponse.payload.segments[0].candidates),
    [
      { url: "https://legacy.hdslb.test/video-720.mp4", kind: "primary", size: 7 * 1024 * 1024 },
      { url: "https://legacy-backup.hdslb.test/video-720.mp4", kind: "backup", size: 7 * 1024 * 1024 }
    ]
  );
  assert.ok(fetchUrls.some((url) => url.includes("fnval=4048")));
  assert.ok(fetchUrls.some((url) => url.includes("fnval=0")));
});


test("background marks login-only qualities unavailable without downgrading", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const fetchUrls = [];
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
    },
    fetch: async (url) => {
      const value = String(url);
      fetchUrls.push(value);
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: false,
            uname: "",
            mid: 0,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/x/web-interface/view")) {
        return jsonResponse({
          code: 0,
          data: {
            aid: 100,
            bvid: "BV1KGj36QEG3",
            title: "No Cookie Video",
            owner: { name: "tester" },
            pages: [{ page: 1, cid: 789, part: "P1" }]
          }
        });
      }
      if (value.includes("/x/player/playurl") && value.includes("fnval=4048")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 64,
            format: "mp4",
            accept_quality: [80, 64, 32],
            accept_description: ["1080P", "720P", "480P"],
            durl: [],
            dash: {
              video: [{
                id: 32,
                base_url: "https://video-primary.bilivideo.com/32.m4s",
                bandwidth: 800000,
                codecs: "avc1.64001f",
                mime_type: "video/mp4",
                width: 852,
                height: 480,
                frame_rate: "30.000",
                size: 4 * 1024 * 1024
              }],
              audio: [{
                id: 30216,
                base_url: "https://audio-primary.bilivideo.com/audio.m4s",
                bandwidth: 64000,
                codecs: "mp4a.40.2",
                mime_type: "audio/mp4",
                size: 1024 * 1024
              }]
            }
          }
        });
      }
      if (value.includes("/x/player/playurl") && value.includes("fnval=0")) {
        return jsonResponse({
          code: 0,
          data: {
            quality: 64,
            format: "mp4",
            accept_quality: [80, 64, 32],
            accept_description: ["1080P", "720P", "480P"],
            durl: [{
              url: "https://legacy.hdslb.test/video-720.mp4",
              size: 7 * 1024 * 1024
            }]
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
    title: "No Cookie Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/"
  });
  assert.equal(video.account.isLogin, false);
  assert.equal(video.currentQuality, 64);
  assert.deepEqual(video.qualities.map((item) => [item.code, item.available, item.mode, item.reason]), [
    [80, false, "", "login-required"],
    [64, true, "direct", ""],
    [32, true, "dash", ""]
  ]);

  const lockedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1KGj36QEG3",
      cid: 789,
      quality: 80,
      title: "No Cookie Video"
    }
  });
  assert.equal(lockedResponse.ok, false);
  assert.match(lockedResponse.error, /Quality 80 is not downloadable/);

  const availableResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_DIRECT",
    payload: {
      bvid: "BV1KGj36QEG3",
      cid: 789,
      quality: 64,
      title: "No Cookie Video"
    }
  });
  assert.equal(availableResponse.ok, true);
  assert.equal(availableResponse.payload.mode, "durl");
  assert.equal(availableResponse.payload.segments[0].context.quality, 64);
  assert.equal(availableResponse.payload.segments[0].url, "https://legacy.hdslb.test/video-720.mp4");
  assert.ok(fetchUrls.some((url) => url.includes("qn=80") && url.includes("fnval=0")));
});


test("popup disables login-only quality options", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const statusElement = textElement();
  const accountElement = textElement();
  const qualitySelect = selectElement();
  const qualitySizeElement = textElement();
  const downloadButton = buttonElement();
  let prepareMessages = 0;

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
    setTimeout(callback) {
      callback();
      return 1;
    },
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement() {
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#account": accountElement,
          "#bvid": textElement(),
          "#title": textElement(),
          "#quality": qualitySelect,
          "#quality-size": qualitySizeElement,
          "#copy": buttonElement(),
          "#download": downloadButton,
          "#diagnostic": buttonElement(),
          "#progress": panelElement(),
          "#progress-percent": textElement(),
          "#progress-bar": styleElement(),
          "#progress-size": textElement(),
          "#progress-speed": textElement(),
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
        }[selector];
      }
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/",
            title: "No Cookie Video"
          }];
        },
        async sendMessage() {
          return {
            bvid: "BV1KGj36QEG3",
            title: "No Cookie Video",
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
        async sendMessage(message) {
          if (message.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
            return { ok: true, payload: null };
          }
          if (message.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
            return {
              ok: true,
              payload: {
                bvid: "BV1KGj36QEG3",
                title: "No Cookie Video",
                page: { cid: 789 },
                account: { isLogin: false },
                currentQuality: 64,
                qualities: [
                  { code: 80, label: "1080P", estimatedSize: 0, available: false, reason: "login-required", mode: "" },
                  { code: 64, label: "720P", estimatedSize: 10 * 1024 * 1024, available: true, reason: "", mode: "direct" }
                ]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            prepareMessages += 1;
            return { ok: false, error: "unexpected prepare" };
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      },
      scripting: {
        async executeScript() {
          throw new Error("should not download unavailable quality");
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();

  assert.equal(qualitySelect.children.length, 2);
  assert.equal(qualitySelect.children[0].value, "80");
  assert.equal(qualitySelect.children[0].disabled, true);
  assert.match(qualitySelect.children[0].textContent, /Cookie/);
  assert.equal(qualitySelect.children[1].value, "64");
  assert.equal(qualitySelect.children[1].disabled, false);
  assert.doesNotMatch(qualitySelect.children[1].textContent, /10\.0 MB/);
  assert.equal(qualitySelect.value, "64");
  assert.match(qualitySizeElement.textContent, /10\.0 MB/);
  assert.equal(downloadButton.disabled, false);

  qualitySelect.value = "80";
  sandbox.updateControls();
  assert.equal(downloadButton.disabled, true);
  await sandbox.downloadSelectedQuality();
  assert.match(statusElement.textContent, /Cookie/);
  assert.equal(prepareMessages, 0);
});


test("popup lets users choose specific multi-page videos to download", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const statusElement = textElement();
  const accountElement = textElement();
  const qualitySelect = selectElement();
  const pagePickerToggle = buttonElement();
  const pagePicker = panelElement();
  const pageList = containerElement();
  const pageSelectAllButton = buttonElement();
  const downloadSelectedPagesButton = buttonElement();
  const downloadSelectedPageAudioButton = buttonElement();

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
    setTimeout(callback) {
      callback();
      return 1;
    },
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement(tagName) {
        if (tagName === "label") {
          return containerElement();
        }
        if (tagName === "input") {
          return inputElement();
        }
        if (tagName === "span") {
          return textElement();
        }
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#account": accountElement,
          "#bvid": textElement(),
          "#title": textElement(),
          "#quality": qualitySelect,
          "#copy": buttonElement(),
          "#download": buttonElement(),
          "#page-picker-toggle": pagePickerToggle,
          "#page-picker": pagePicker,
          "#page-list": pageList,
          "#page-select-all": pageSelectAllButton,
          "#download-selected-pages": downloadSelectedPagesButton,
          "#download-selected-page-audio": downloadSelectedPageAudioButton,
          "#diagnostic": buttonElement(),
          "#progress": panelElement(),
          "#progress-percent": textElement(),
          "#progress-bar": styleElement(),
          "#progress-size": textElement(),
          "#progress-speed": textElement(),
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
        }[selector];
      }
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/?p=2",
            title: "Multi Page Video"
          }];
        },
        async sendMessage() {
          return {
            bvid: "BV1KGj36QEG3",
            title: "Multi Page Video",
            url: "https://www.bilibili.com/video/BV1KGj36QEG3/?p=2"
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
                title: "Multi Page Video",
                page: { index: 2, cid: 202, title: "Middle" },
                currentQuality: 64,
                qualities: [{ code: 64, label: "64 - 720P", available: true, mode: "direct" }],
                pages: [
                  { index: 1, page: 1, cid: 101, title: "Opening", part: "Opening" },
                  { index: 2, page: 2, cid: 202, title: "Middle", part: "Middle" },
                  { index: 3, page: 3, cid: 303, title: "Ending", part: "Ending" }
                ]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            return {
              ok: true,
              payload: {
                count: 1,
                mode: "durl",
                segments: [{
                  url: `https://primary.hdslb.test/${message.payload.cid}.mp4`,
                  filename: `BiliDownload/${message.payload.title}_64.mp4`,
                  size: 1024,
                  candidates: [{ url: `https://primary.hdslb.test/${message.payload.cid}.mp4`, kind: "primary", size: 1024 }],
                  context: {
                    bvid: message.payload.bvid,
                    cid: message.payload.cid,
                    quality: message.payload.quality,
                    title: message.payload.title,
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "page-blob"
                  }
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_AUDIO") {
            return {
              ok: true,
              payload: {
                count: 1,
                mode: "audio",
                segments: [{
                  url: `https://audio.hdslb.test/${message.payload.cid}.m4s`,
                  filename: `BiliDownload/${message.payload.title}.m4a`,
                  size: 512,
                  candidates: [{ url: `https://audio.hdslb.test/${message.payload.cid}.m4s`, kind: "primary", size: 512 }],
                  context: {
                    bvid: message.payload.bvid,
                    cid: message.payload.cid,
                    quality: 30280,
                    title: message.payload.title,
                    segmentIndex: 1,
                    segmentCount: 1,
                    role: "audio",
                    roleLabel: "audio",
                    format: "audio",
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
          return [{
            result: {
              ok: true,
              responseOk: true,
              status: 200,
              statusText: "OK",
              mime: "video/mp4",
              size: 1024,
              totalBytes: 1024,
              receivedBytes: 1024,
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
  assert.equal(pagePickerToggle.hidden, false);
  assert.equal(pagePicker.hidden, true);
  assert.match(statusElement.textContent, /\u5206 P/);

  sandbox.togglePagePicker();
  assert.equal(pagePicker.hidden, false);
  assert.equal(pageList.children.length, 3);
  let checkboxes = pageList.querySelectorAll("input[type=\"checkbox\"]");
  assert.deepEqual(checkboxes.map((checkbox) => checkbox.checked), [false, true, false]);
  assert.equal(downloadSelectedPagesButton.disabled, false);
  assert.equal(downloadSelectedPageAudioButton.disabled, false);

  sandbox.toggleAllPages();
  checkboxes = pageList.querySelectorAll("input[type=\"checkbox\"]");
  assert.deepEqual(checkboxes.map((checkbox) => checkbox.checked), [true, true, true]);
  assert.equal(pageSelectAllButton.textContent, "\u6e05\u7a7a");

  checkboxes[1].checked = false;
  checkboxes[1].dispatchEvent("change");
  assert.deepEqual(pageList.querySelectorAll("input[type=\"checkbox\"]").map((checkbox) => checkbox.checked), [true, false, true]);

  qualitySelect.value = "64";
  await sandbox.downloadSelectedPages();

  const preparePayloads = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_PREPARE_DIRECT")
    .map((message) => message.payload);
  assert.deepEqual(preparePayloads.map((payload) => payload.cid), [101, 303]);
  assert.deepEqual(preparePayloads.map((payload) => payload.title), [
    "Multi Page Video_P01_Opening",
    "Multi Page Video_P03_Ending"
  ]);
  assert.equal(scriptCalls.length, 2);
  assert.equal(scriptCalls[0].args[1], "Multi Page Video_P01_Opening_64.mp4");
  assert.equal(scriptCalls[1].args[1], "Multi Page Video_P03_Ending_64.mp4");
  assert.match(statusElement.textContent, /2$/);

  scriptCalls.length = 0;
  runtimeMessages.length = 0;
  await sandbox.downloadSelectedPageAudio();

  const audioPayloads = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_PREPARE_AUDIO")
    .map((message) => message.payload);
  assert.deepEqual(audioPayloads.map((payload) => payload.cid), [101, 303]);
  assert.deepEqual(audioPayloads.map((payload) => payload.title), [
    "Multi Page Video_P01_Opening_audio",
    "Multi Page Video_P03_Ending_audio"
  ]);
  assert.equal(scriptCalls.length, 2);
  assert.equal(scriptCalls[0].args[1], "Multi Page Video_P01_Opening_audio.m4a");
  assert.equal(scriptCalls[1].args[1], "Multi Page Video_P03_Ending_audio.m4a");
  assert.match(statusElement.textContent, /2$/);
});


test("popup sends Bangumi episode ids for selected episode downloads", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const bvidInput = textElement();
  const pagePickerToggle = buttonElement();
  const pagePicker = panelElement();
  const pageList = containerElement();
  const pageSelectAllButton = buttonElement();

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
    setTimeout(callback) {
      callback();
      return 1;
    },
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement(tagName) {
        if (tagName === "label") {
          return containerElement();
        }
        if (tagName === "input") {
          return inputElement();
        }
        if (tagName === "span") {
          return textElement();
        }
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#account": textElement(),
          "#bvid": bvidInput,
          "#title": textElement(),
          "#quality": qualitySelect,
          "#copy": buttonElement(),
          "#download": buttonElement(),
          "#download-audio": buttonElement(),
          "#page-picker-toggle": pagePickerToggle,
          "#page-picker": pagePicker,
          "#page-list": pageList,
          "#page-select-all": pageSelectAllButton,
          "#download-selected-pages": buttonElement(),
          "#download-selected-page-audio": buttonElement(),
          "#diagnostic": buttonElement(),
          "#progress": panelElement(),
          "#progress-percent": textElement(),
          "#progress-bar": styleElement(),
          "#progress-size": textElement(),
          "#progress-speed": textElement(),
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
        }[selector];
      }
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://www.bilibili.com/bangumi/play/ss1512",
            title: "Bangumi Season"
          }];
        },
        async sendMessage() {
          return {
            type: "bangumi",
            seasonId: 1512,
            title: "Bangumi Season",
            url: "https://www.bilibili.com/bangumi/play/ss1512"
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
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
            return { ok: true, payload: null };
          }
          if (message.type === "BILI_DOWNLOAD_LOAD_VIDEO") {
            return {
              ok: true,
              payload: {
                source: "bangumi",
                bvid: "BV1dx411w7kp",
                seasonId: 1512,
                epId: 28160,
                title: "Bangumi Season",
                page: { index: 1, cid: 49052509, epId: 28160, title: "Episode Zero" },
                currentQuality: 64,
                qualities: [{ code: 64, label: "64 - 720P", available: true, mode: "dash" }],
                pages: [
                  { index: 1, page: 1, cid: 49052509, epId: 28160, title: "Episode Zero", part: "Episode Zero" },
                  { index: 2, page: 2, cid: 49052510, epId: 28161, title: "Episode One", part: "Episode One" }
                ]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            return {
              ok: true,
              payload: {
                count: 1,
                mode: "durl",
                segments: [{
                  url: `https://primary.hdslb.test/${message.payload.epId}.mp4`,
                  filename: `BiliDownload/${message.payload.title}_64.mp4`,
                  size: 1024,
                  candidates: [{ url: `https://primary.hdslb.test/${message.payload.epId}.mp4`, kind: "primary", size: 1024 }],
                  context: {
                    bvid: message.payload.bvid,
                    epId: message.payload.epId,
                    cid: message.payload.cid,
                    quality: message.payload.quality,
                    title: message.payload.title,
                    source: "bangumi",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "page-blob"
                  }
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_AUDIO") {
            return {
              ok: true,
              payload: {
                count: 1,
                mode: "audio",
                segments: [{
                  url: `https://audio.hdslb.test/${message.payload.epId}.m4s`,
                  filename: `BiliDownload/${message.payload.title}.m4a`,
                  size: 512,
                  candidates: [{ url: `https://audio.hdslb.test/${message.payload.epId}.m4s`, kind: "primary", size: 512 }],
                  context: {
                    bvid: message.payload.bvid,
                    epId: message.payload.epId,
                    cid: message.payload.cid,
                    quality: 30280,
                    title: message.payload.title,
                    source: "bangumi",
                    segmentIndex: 1,
                    segmentCount: 1,
                    role: "audio",
                    roleLabel: "audio",
                    format: "audio",
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
          return [{
            result: {
              ok: true,
              responseOk: true,
              status: 200,
              statusText: "OK",
              mime: "video/mp4",
              size: 1024,
              totalBytes: 1024,
              receivedBytes: 1024,
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
  assert.equal(bvidInput.value, "BV1dx411w7kp");
  assert.equal(pagePickerToggle.hidden, false);

  sandbox.togglePagePicker();
  const checkboxes = pageList.querySelectorAll("input[type=\"checkbox\"]");
  checkboxes[0].checked = false;
  checkboxes[1].checked = true;
  checkboxes[1].dispatchEvent("change");

  qualitySelect.value = "64";
  await sandbox.downloadSelectedPages();
  await sandbox.downloadSelectedPageAudio();

  const videoPayload = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_PREPARE_DIRECT").payload;
  const audioPayload = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_PREPARE_AUDIO").payload;
  assert.equal(videoPayload.epId, 28161);
  assert.equal(videoPayload.cid, 49052510);
  assert.equal(videoPayload.title, "Bangumi Season_P02_Episode One");
  assert.equal(audioPayload.epId, 28161);
  assert.equal(audioPayload.cid, 49052510);
  assert.equal(audioPayload.title, "Bangumi Season_P02_Episode One_audio");
  assert.equal(scriptCalls[0].args[1], "Bangumi Season_P02_Episode One_64.mp4");
  assert.equal(scriptCalls[1].args[1], "Bangumi Season_P02_Episode One_audio.m4a");
});


test("popup downloads current page audio as a standalone file", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const downloadAudioButton = buttonElement();

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
    setTimeout(callback) {
      callback();
      return 1;
    },
    document: {
      addEventListener() {},
      body: {
        append() {}
      },
      createElement() {
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
          "#download-audio": downloadAudioButton,
          "#diagnostic": buttonElement(),
          "#progress": panelElement(),
          "#progress-percent": textElement(),
          "#progress-bar": styleElement(),
          "#progress-size": textElement(),
          "#progress-speed": textElement(),
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
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
                qualities: [{ code: 64, label: "64 - 720P", available: true, mode: "direct" }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_AUDIO") {
            return {
              ok: true,
              payload: {
                count: 1,
                mode: "audio",
                segments: [{
                  url: "https://audio.hdslb.test/123.m4s",
                  filename: `BiliDownload/${message.payload.title}.m4a`,
                  size: 512,
                  candidates: [{ url: "https://audio.hdslb.test/123.m4s", kind: "primary", size: 512 }],
                  context: {
                    bvid: message.payload.bvid,
                    cid: message.payload.cid,
                    quality: 30280,
                    title: message.payload.title,
                    segmentIndex: 1,
                    segmentCount: 1,
                    role: "audio",
                    roleLabel: "audio",
                    format: "audio",
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
          return [{
            result: {
              ok: true,
              responseOk: true,
              status: 200,
              statusText: "OK",
              mime: "audio/mp4",
              size: 512,
              totalBytes: 512,
              receivedBytes: 512,
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
  assert.equal(downloadAudioButton.disabled, false);
  await sandbox.downloadCurrentAudio();

  const audioPayload = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_PREPARE_AUDIO").payload;
  assert.equal(audioPayload.cid, 123);
  assert.equal(audioPayload.title, "Smoke Video_audio");
  assert.equal(scriptCalls.length, 1);
  assert.equal(scriptCalls[0].args[1], "Smoke Video_audio.m4a");
  assert.match(statusElement.textContent, /1$/);
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
    setTimeout(callback) {
      callback();
      return 1;
    },
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
          "#progress-speed": progressSpeed,
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
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
  assert.equal(scriptCalls[1].args[3].candidateIndex, 2);
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


test("popup falls back to extension blob without navigating when page fetch fails", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const extensionFetchCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  const savedAnchors = [];
  const objectUrls = [];
  class TestURL extends URL {
    static createObjectURL(blob) {
      const value = `blob:extension-test/${objectUrls.length + 1}`;
      objectUrls.push({ value, blob });
      return value;
    }

    static revokeObjectURL() {}
  }

  const sandbox = {
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL: TestURL,
    console,
    async fetch(url) {
      extensionFetchCalls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get(name) {
            if (name.toLowerCase() === "content-length") {
              return String(1024 * 1024);
            }
            if (name.toLowerCase() === "content-type") {
              return "video/mp4";
            }
            return null;
          }
        },
        async blob() {
          return new Blob([new Uint8Array(1024 * 1024)], { type: "video/mp4" });
        }
      };
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
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
              savedAnchors.push({
                href: this.href,
                download: this.download,
                rel: this.rel
              });
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
          "#progress-speed": progressSpeed,
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
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
                  size: 1024 * 1024,
                  candidates: [
                    { url: "https://primary.hdslb.test/video.mp4", kind: "primary", size: 1024 * 1024 },
                    { url: "https://backup.hdslb.test/video.mp4", kind: "backup", size: 1024 * 1024 }
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

  assert.match(statusElement.textContent, /1$/);
  assert.equal(
    runtimeMessages.some((message) => message.type === "BILI_DOWNLOAD_START_DIRECT"),
    false
  );
  assert.equal(scriptCalls.length, 2);
  assert.equal(scriptCalls[0].func.name, "downloadMediaInPage");
  assert.equal(scriptCalls[1].func.name, "downloadMediaInPage");
  assert.equal(scriptCalls[0].args[0], "https://primary.hdslb.test/video.mp4");
  assert.equal(scriptCalls[1].args[0], "https://backup.hdslb.test/video.mp4");
  assert.deepEqual(extensionFetchCalls, ["https://primary.hdslb.test/video.mp4"]);
  assert.equal(savedAnchors.length, 1);
  assert.match(savedAnchors[0].href, /^blob:extension-test\//);
  assert.equal(savedAnchors[0].download, "Smoke Video_64.mp4");
  assert.equal(progressPanel.hidden, false);
  assert.equal(progressPercent.textContent, "100%");
  assert.equal(progressBar.style.width, "100%");
  assert.match(progressSize.textContent, /1\.0 MB \/ 1\.0 MB/);
  assert.match(progressSpeed.textContent, /\/s$/);
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "complete");
  assert.equal(savedDiagnostic.candidateAttempts.length, 2);
  assert.equal(savedDiagnostic.candidateAttempts[0].fetch.error, "Failed to fetch https://primary.hdslb.test/video.mp4");
  assert.equal(savedDiagnostic.candidateAttempts[1].fetch.error, "Failed to fetch https://backup.hdslb.test/video.mp4");
  assert.equal(savedDiagnostic.extensionCandidateAttempts.length, 1);
  assert.equal(savedDiagnostic.extensionCandidateAttempts[0].fetch.responseOk, true);
  assert.equal(savedDiagnostic.saved.method, "extension-blob");
  assert.equal(savedDiagnostic.saved.mode, "extension-single");
});


test("popup uses parallel extension range download for bilivideo media", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const fetchCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  const savedAnchors = [];
  const objectUrls = [];
  const totalSize = 12 * 1024 * 1024;
  class TestURL extends URL {
    static createObjectURL(blob) {
      const value = `blob:range-test/${objectUrls.length + 1}`;
      objectUrls.push({ value, blob });
      return value;
    }

    static revokeObjectURL() {}
  }

  const sandbox = {
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL: TestURL,
    console,
    async fetch(url, options = {}) {
      fetchCalls.push({ url, headers: options.headers || {} });
      const rangeHeader = options.headers?.Range || options.headers?.range;
      assert.ok(rangeHeader, "parallel download should use Range requests");
      const match = String(rangeHeader).match(/bytes=(\d+)-(\d+)/);
      assert.ok(match, `invalid range header: ${rangeHeader}`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const length = end - start + 1;
      return {
        ok: true,
        status: 206,
        statusText: "Partial Content",
        headers: {
          get(name) {
            if (name.toLowerCase() === "content-type") {
              return "video/mp4";
            }
            if (name.toLowerCase() === "content-length") {
              return String(length);
            }
            return null;
          }
        },
        async blob() {
          return new Blob([new Uint8Array(length)], { type: "video/mp4" });
        }
      };
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
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
              savedAnchors.push({
                href: this.href,
                download: this.download,
                rel: this.rel
              });
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
          "#progress-speed": progressSpeed,
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
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
                  url: "https://b-baaa4h67d1y5abm4cgw1bs90ek6ss.edge.mountaintoys.cn:4483/video.mp4",
                  filename: "BiliDownload/Smoke Video_64.mp4",
                  size: totalSize,
                  candidates: [
                    {
                      url: "https://b-baaa4h67d1y5abm4cgw1bs90ek6ss.edge.mountaintoys.cn:4483/video.mp4",
                      kind: "primary",
                      size: totalSize
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
          return [{ result: { ok: false, error: "page path should not run" } }];
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "64";
  await sandbox.downloadSelectedQuality();

  assert.equal(scriptCalls.length, 0);
  assert.equal(fetchCalls.length, 3);
  assert.deepEqual(
    fetchCalls.map((call) => call.headers.Range),
    [
      "bytes=0-4194303",
      "bytes=4194304-8388607",
      "bytes=8388608-12582911"
    ]
  );
  assert.equal(savedAnchors.length, 1);
  assert.match(savedAnchors[0].href, /^blob:range-test\//);
  assert.equal(savedAnchors[0].download, "Smoke Video_64.mp4");
  assert.equal(progressPanel.hidden, false);
  assert.equal(progressPercent.textContent, "100%");
  assert.equal(progressBar.style.width, "100%");
  assert.match(progressSize.textContent, /12\.0 MB \/ 12\.0 MB/);
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "complete");
  assert.equal(savedDiagnostic.candidateAttempts.length, 0);
  assert.equal(savedDiagnostic.extensionCandidateAttempts.length, 1);
  assert.equal(savedDiagnostic.extensionCandidateAttempts[0].fetch.mode, "extension-range");
  assert.equal(savedDiagnostic.extensionCandidateAttempts[0].fetch.chunkCount, 3);
  assert.equal(savedDiagnostic.extensionCandidateAttempts[0].fetch.concurrency, 3);
  assert.equal(savedDiagnostic.saved.method, "extension-blob");
  assert.equal(savedDiagnostic.saved.mode, "extension-range");
});


test("popup cancels an active extension download without saving", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const fetchCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  const downloadControls = panelElement();
  const pauseButton = buttonElement();
  const cancelButton = buttonElement();
  const savedAnchors = [];
  let resolveSecondReadReady;
  const secondReadReady = new Promise((resolve) => {
    resolveSecondReadReady = resolve;
  });
  class TestURL extends URL {
    static createObjectURL(blob) {
      return `blob:cancel-test/${blob.size}`;
    }

    static revokeObjectURL() {}
  }

  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL: TestURL,
    Uint8Array,
    console,
    async fetch(url, options = {}) {
      fetchCalls.push({ url, signal: options.signal });
      let readCount = 0;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get(name) {
            if (name.toLowerCase() === "content-length") {
              return String(1024 * 1024);
            }
            if (name.toLowerCase() === "content-type") {
              return "video/mp4";
            }
            return null;
          }
        },
        body: {
          getReader() {
            return {
              read() {
                readCount += 1;
                if (readCount === 1) {
                  return Promise.resolve({
                    done: false,
                    value: new Uint8Array(256 * 1024)
                  });
                }
                resolveSecondReadReady();
                return new Promise((_resolve, reject) => {
                  options.signal.addEventListener("abort", () => {
                    const error = new Error("The operation was aborted.");
                    error.name = "AbortError";
                    reject(error);
                  });
                });
              }
            };
          }
        }
      };
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
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
              savedAnchors.push({
                href: this.href,
                download: this.download,
                rel: this.rel
              });
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
          "#progress-speed": progressSpeed,
          "#download-controls": downloadControls,
          "#pause": pauseButton,
          "#cancel": cancelButton
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
                  url: "https://primary.bilivideo.com/video.mp4",
                  filename: "BiliDownload/Smoke Video_64.mp4",
                  size: 1024 * 1024,
                  candidates: [{ url: "https://primary.bilivideo.com/video.mp4", kind: "primary", size: 1024 * 1024 }],
                  context: {
                    bvid: "BV1KGj36QEG3",
                    cid: 123,
                    quality: 64,
                    title: "Smoke Video",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "extension-blob"
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
        async executeScript() {
          return [];
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "64";
  const downloadPromise = sandbox.downloadSelectedQuality();
  await secondReadReady;

  assert.equal(downloadControls.hidden, false);
  sandbox.cancelDownload();
  await downloadPromise;

  assert.equal(statusElement.textContent, "\u5df2\u53d6\u6d88\u4e0b\u8f7d");
  assert.equal(downloadControls.hidden, true);
  assert.equal(progressPanel.hidden, true);
  assert.equal(progressPercent.textContent, "--");
  assert.equal(progressBar.style.width, "0%");
  assert.equal(progressSize.textContent, "0 B / --");
  assert.equal(savedAnchors.length, 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].signal.aborted, true);
});


test("popup pauses and resumes an active extension download", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  const downloadControls = panelElement();
  const pauseButton = buttonElement();
  const cancelButton = buttonElement();
  const savedAnchors = [];
  let readCount = 0;
  let resolveFirstReadRequested;
  let resolveFirstChunk;
  const firstReadRequested = new Promise((resolve) => {
    resolveFirstReadRequested = resolve;
  });
  const firstChunk = new Promise((resolve) => {
    resolveFirstChunk = resolve;
  });
  class TestURL extends URL {
    static createObjectURL(blob) {
      return `blob:pause-test/${blob.size}`;
    }

    static revokeObjectURL() {}
  }

  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL: TestURL,
    Uint8Array,
    console,
    async fetch() {
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get(name) {
            if (name.toLowerCase() === "content-length") {
              return String(256 * 1024);
            }
            if (name.toLowerCase() === "content-type") {
              return "video/mp4";
            }
            return null;
          }
        },
        body: {
          getReader() {
            return {
              async read() {
                readCount += 1;
                if (readCount === 1) {
                  resolveFirstReadRequested();
                  await firstChunk;
                  return {
                    done: false,
                    value: new Uint8Array(256 * 1024)
                  };
                }
                return { done: true };
              }
            };
          }
        }
      };
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
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
              savedAnchors.push({
                href: this.href,
                download: this.download,
                rel: this.rel
              });
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
          "#progress-speed": progressSpeed,
          "#download-controls": downloadControls,
          "#pause": pauseButton,
          "#cancel": cancelButton
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
                  url: "https://primary.bilivideo.com/video.mp4",
                  filename: "BiliDownload/Smoke Video_64.mp4",
                  size: 256 * 1024,
                  candidates: [{ url: "https://primary.bilivideo.com/video.mp4", kind: "primary", size: 256 * 1024 }],
                  context: {
                    bvid: "BV1KGj36QEG3",
                    cid: 123,
                    quality: 64,
                    title: "Smoke Video",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "mp4",
                    downloadMethod: "extension-blob"
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
        async executeScript() {
          return [];
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "64";
  const downloadPromise = sandbox.downloadSelectedQuality();
  await firstReadRequested;

  sandbox.togglePauseDownload();
  assert.equal(statusElement.textContent, "\u5df2\u6682\u505c\u4e0b\u8f7d");
  assert.equal(pauseButton.textContent, "\u7ee7\u7eed");
  resolveFirstChunk();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(readCount, 1);

  sandbox.togglePauseDownload();
  await downloadPromise;

  assert.equal(savedAnchors.length, 1);
  assert.equal(savedAnchors[0].download, "Smoke Video_64.mp4");
  assert.equal(progressPercent.textContent, "100%");
  assert.equal(downloadControls.hidden, true);
});


test("popup muxes DASH segments into one MP4 download", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const fetchCalls = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  const progressSpeed = textElement();
  const savedAnchors = [];
  const objectUrls = [];
  const muxCalls = [];
  class TestURL extends URL {
    static createObjectURL(blob) {
      const value = `blob:dash-mux-test/${objectUrls.length + 1}`;
      objectUrls.push({ value, blob });
      return value;
    }

    static revokeObjectURL() {}
  }

  const sandbox = {
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL: TestURL,
    console,
    globalThis: null,
    async fetch(url, options = {}) {
      fetchCalls.push({ url, headers: options.headers || {} });
      const body = String(url).includes("video")
        ? new Blob([makeFragmentedVideoTrack()], { type: "video/mp4" })
        : new Blob([makeFragmentedAudioTrack()], { type: "audio/mp4" });
      return {
        ok: true,
        status: options.headers?.Range ? 206 : 200,
        statusText: "OK",
        headers: {
          get(name) {
            if (name.toLowerCase() === "content-length") {
              return String(body.size);
            }
            if (name.toLowerCase() === "content-type") {
              return body.type;
            }
            return null;
          }
        },
        async blob() {
          return body;
        }
      };
    },
    navigator: {
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback) {
      callback();
      return 1;
    },
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
              savedAnchors.push({
                href: this.href,
                download: this.download,
                rel: this.rel
              });
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
          "#progress-speed": progressSpeed,
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement()
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
                currentQuality: 116,
                qualities: [{ code: 116, label: "116 - 1080P60" }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_DIRECT") {
            return {
              ok: true,
              payload: {
                count: 2,
                mode: "dash",
                segments: [
                  {
                    url: "https://primary.bilivideo.com/video.m4s",
                    filename: "BiliDownload/Smoke Video_116_video.m4s",
                    size: 1024 * 1024,
                    candidates: [{ url: "https://primary.bilivideo.com/video.m4s", kind: "primary", size: 1024 * 1024 }],
                    context: {
                      bvid: "BV1KGj36QEG3",
                      cid: 123,
                      quality: 116,
                      title: "Smoke Video",
                      segmentIndex: 1,
                      segmentCount: 2,
                      role: "video",
                      roleLabel: "video",
                      format: "dash",
                      downloadMethod: "page-blob"
                    }
                  },
                  {
                    url: "https://primary.bilivideo.com/audio.m4s",
                    filename: "BiliDownload/Smoke Video_116_audio.m4s",
                    size: 512 * 1024,
                    candidates: [{ url: "https://primary.bilivideo.com/audio.m4s", kind: "primary", size: 512 * 1024 }],
                    context: {
                      bvid: "BV1KGj36QEG3",
                      cid: 123,
                      quality: 116,
                      title: "Smoke Video",
                      segmentIndex: 2,
                      segmentCount: 2,
                      role: "audio",
                      roleLabel: "audio",
                      format: "dash",
                      downloadMethod: "page-blob"
                    }
                  }
                ]
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
        async executeScript() {
          throw new Error("bilivideo DASH should use extension fetch path");
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  sandbox.__biliDownloadMuxer = {
    async muxDashToMp4({ videoBlob, audioBlob, outputName }) {
      muxCalls.push({ videoSize: videoBlob.size, audioSize: audioBlob.size, outputName });
      return {
        blob: new Blob([new Uint8Array(200)], { type: "video/mp4" }),
        filename: outputName,
        video: { codec: "avc1.640032", samples: 3 },
        audio: { codec: "mp4a.40.2", samples: 4 }
      };
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  await sandbox.initialize();
  qualitySelect.value = "116";
  await sandbox.downloadSelectedQuality();

  assert.equal(fetchCalls.length, 2);
  assert.equal(savedAnchors.length, 1);
  assert.equal(savedAnchors[0].download, "Smoke Video_116.mp4");
  assert.equal(muxCalls.length, 1);
  assert.equal(muxCalls[0].outputName, "BiliDownload/Smoke Video_116.mp4");
  assert.match(statusElement.textContent, /MP4/);
  assert.equal(progressPanel.hidden, false);
  assert.equal(progressPercent.textContent, "100%");
  assert.equal(progressBar.style.width, "100%");
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "complete");
  assert.equal(savedDiagnostic.saved.mode, "dash-muxed-mp4");
  assert.equal(savedDiagnostic.saved.filename, "BiliDownload/Smoke Video_116.mp4");
  assert.equal(savedDiagnostic.mux.ok, true);
  assert.equal(savedDiagnostic.segmentDiagnostics.length, 2);
  assert.equal(savedDiagnostic.segmentDiagnostics[0].blob, undefined);
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
    className: "",
    title: "",
    addEventListener() {}
  };
}


function buttonElement() {
  return {
    disabled: false,
    hidden: false,
    textContent: "",
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
    disabled: false,
    selected: false,
    className: "",
    title: ""
  };
}


function panelElement() {
  return {
    hidden: true,
    disabled: false
  };
}


function inputElement() {
  const listeners = {};
  return {
    type: "",
    value: "",
    checked: false,
    disabled: false,
    className: "",
    title: "",
    dataset: {},
    addEventListener(type, listener) {
      listeners[type] = listener;
    },
    dispatchEvent(type) {
      listeners[type]?.({ target: this });
    }
  };
}


function containerElement() {
  return {
    children: [],
    hidden: false,
    disabled: false,
    className: "",
    title: "",
    dataset: {},
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = [...items];
    },
    querySelectorAll(selector) {
      if (selector !== "input[type=\"checkbox\"]") {
        return [];
      }
      const results = [];
      const visit = (node) => {
        if (!node) {
          return;
        }
        if (node.type === "checkbox") {
          results.push(node);
        }
        for (const child of node.children || []) {
          visit(child);
        }
      };
      for (const child of this.children) {
        visit(child);
      }
      return results;
    },
    addEventListener() {}
  };
}


function styleElement() {
  return {
    style: {
      width: ""
    }
  };
}


function trackingBlob(blob) {
  return {
    get size() {
      return blob.size;
    },
    get type() {
      return blob.type;
    },
    fullArrayBufferCalls: 0,
    sliceCalls: 0,
    async arrayBuffer() {
      this.fullArrayBufferCalls += 1;
      return blob.arrayBuffer();
    },
    slice(start, end) {
      this.sliceCalls += 1;
      return blob.slice(start, end);
    }
  };
}


function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}


function headersOnlyResponse(contentLength, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-length"
          ? String(contentLength)
          : "";
      }
    }
  };
}


function makeFragmentedVideoTrack() {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width: 16,
      height: 16,
      frameRate: 30
    },
    fastStart: "fragmented"
  });
  const meta = {
    decoderConfig: {
      codec: "avc1.42001e",
      description: new Uint8Array([1, 66, 0, 30, 255, 225, 0, 0, 1, 0, 0])
    }
  };
  for (let index = 0; index < 3; index += 1) {
    muxer.addVideoChunkRaw(
      new Uint8Array([0, 0, 0, 1, 0x65, index]),
      index === 0 ? "key" : "delta",
      index * 33333,
      33333,
      meta
    );
  }
  muxer.finalize();
  return target.buffer;
}


function makeFragmentedAudioTrack() {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    audio: {
      codec: "aac",
      sampleRate: 48000,
      numberOfChannels: 2
    },
    fastStart: "fragmented"
  });
  for (let index = 0; index < 4; index += 1) {
    muxer.addAudioChunkRaw(
      new Uint8Array([0x21, 0x10, index]),
      "key",
      index * 21333,
      21333
    );
  }
  muxer.finalize();
  return target.buffer;
}


function parseMp4Info(buffer) {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    file.onError = (error) => reject(error instanceof Error ? error : new Error(String(error)));
    file.onReady = (info) => resolve(info);
    buffer.fileStart = 0;
    file.appendBuffer(buffer);
    file.flush();
  });
}
