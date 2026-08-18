import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const { Muxer, ArrayBufferTarget } = await import("../vendor/mp4-muxer/mp4-muxer.mjs");
const MP4Box = await import("../vendor/mp4box/mp4box.all.mjs");


test("manifest declares the MV3 side panel extension and optional native companion permission", async () => {
  const manifest = JSON.parse(await readFile("extension/manifest.json", "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "src/popup.html");
  assert.ok(!manifest.permissions.includes("activeTab"));
  assert.ok(manifest.permissions.includes("downloads"));
  assert.ok(manifest.permissions.includes("declarativeNetRequest"));
  assert.ok(manifest.permissions.includes("declarativeNetRequestFeedback"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.deepEqual(manifest.host_permissions, [
    "https://api.bilibili.com/*",
    "https://api.live.bilibili.com/*",
    "https://www.bilibili.com/*",
    "https://m.bilibili.com/*",
    "https://live.bilibili.com/*",
    "https://www.douyu.com/*",
    "https://www.huya.com/*",
    "https://*.douyucdn.cn/*",
    "https://*.flv.huya.com/*",
    "https://hls.huya.com/*",
    "https://*.hls.huya.com/*",
    "https://alhls.huya.com/*",
    "https://*.mobgslb.tbcache.com/*",
    "https://*.bilivideo.com/*",
    "https://*.bilivideo.cn/*",
    "https://*.hdslb.com/*",
    "https://*.edge.mountaintoys.cn/*"
  ]);
  assert.ok(manifest.content_scripts[0].matches.includes("https://www.bilibili.com/bangumi/play/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://live.bilibili.com/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://www.douyu.com/*"));
  assert.ok(manifest.content_scripts[0].matches.includes("https://www.huya.com/*"));
  assert.equal(
    manifest.declarative_net_request.rule_resources[0].path,
    "rules/bili-media-headers.json"
  );
  assert.equal(
    manifest.declarative_net_request.rule_resources[1].path,
    "rules/live-media-headers.json"
  );
  assert.ok(!manifest.host_permissions.some((item) => /127\.0\.0\.1|localhost|<all_urls>|^\*:\/\//.test(item)));
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
  const liveRules = JSON.parse(await readFile("extension/rules/live-media-headers.json", "utf8"));
  const rule = rules[0];

  assert.deepEqual(
    rules.map((item) => item.condition.urlFilter),
    ["||bilivideo.com/", "||bilivideo.cn/", "||hdslb.com/", "||edge.mountaintoys.cn/"]
  );
  assert.equal(rule.action.type, "modifyHeaders");
  for (const item of rules) {
    assert.deepEqual(item.condition.resourceTypes, ["xmlhttprequest", "media", "other"]);
    assert.ok(!item.condition.resourceTypes.some((type) => (
      ["main_frame", "sub_frame", "image", "object"].includes(type)
    )));
  }
  assert.deepEqual(
    rule.action.requestHeaders.map((item) => [item.header, item.operation]),
    [
      ["Referer", "set"],
      ["Origin", "set"]
    ]
  );
  assert.deepEqual(
    liveRules.map((item) => item.condition.urlFilter),
    ["||douyucdn.cn/", "||flv.huya.com/", "||mobgslb.tbcache.com/", "||hls.huya.com/", "||alhls.huya.com/"]
  );
  assert.deepEqual(
    liveRules.map((item) => item.action.requestHeaders.map((header) => header.value)),
    [
      ["https://www.douyu.com/", "https://www.douyu.com"],
      ["https://www.huya.com/", "https://www.huya.com"],
      ["https://www.huya.com/", "https://www.huya.com"],
      ["https://www.huya.com/", "https://www.huya.com"],
      ["https://www.huya.com/", "https://www.huya.com"]
    ]
  );
  for (const item of liveRules) {
    assert.deepEqual(item.condition.resourceTypes, ["xmlhttprequest", "media", "other"]);
  }
});


test("popup contains MVP controls", async () => {
  const html = await readFile("extension/src/popup.html", "utf8");

  for (const id of [
    "main-view",
    "settings-view",
    "view-title",
    "settings-open",
    "settings-back",
    "status",
    "account",
    "bvid",
    "copy",
    "title",
    "quality",
    "download",
    "download-audio",
    "live-record",
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
    "cancel",
    "companion-status",
    "companion-check",
    "companion-prefer-dash",
    "companion-prefer-live",
    "companion-save"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});


test("popup keeps advanced controls in a secondary settings view", async () => {
  const html = await readFile("extension/src/popup.html", "utf8");
  const code = await readFile("extension/src/popup.js", "utf8");
  const mainStart = html.indexOf('id="main-view"');
  const settingsStart = html.indexOf('id="settings-view"');
  const taskCenterStart = html.indexOf('id="task-center"');
  const companionStart = html.indexOf('class="companion-settings settings-section"');
  assert.ok(mainStart > 0);
  assert.ok(settingsStart > mainStart);
  assert.ok(taskCenterStart > settingsStart);
  assert.ok(companionStart > settingsStart);
  assert.equal(html.includes("下载保护"), false);

  const elements = {
    "#main-view": { hidden: false },
    "#settings-view": { hidden: true },
    "#view-title": textElement(),
    "#settings-open": buttonElement(),
    "#settings-back": buttonElement(),
    "#status": textElement(),
    "#quality": selectElement()
  };
  const sandbox = {
    Array,
    Date,
    Error,
    Map,
    Number,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    clearTimeout,
    setTimeout,
    document: {
      addEventListener() {},
      querySelector(selector) {
        return elements[selector];
      }
    },
    chrome: {
      runtime: {
        connect() {
          return { onMessage: { addListener() {} } };
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.showSettingsView();
  assert.equal(elements["#main-view"].hidden, true);
  assert.equal(elements["#settings-view"].hidden, false);
  assert.equal(elements["#settings-open"].hidden, true);
  assert.equal(elements["#settings-back"].hidden, false);
  assert.equal(elements["#view-title"].textContent, "任务与设置");

  sandbox.showMainView();
  assert.equal(elements["#main-view"].hidden, false);
  assert.equal(elements["#settings-view"].hidden, true);
  assert.equal(elements["#view-title"].textContent, "Bili Download");
});


test("popup calculates download capacity from device memory and known video size", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const elements = {
    "#main-view": { hidden: false },
    "#settings-view": { hidden: true },
    "#view-title": textElement(),
    "#settings-open": buttonElement(),
    "#settings-back": buttonElement(),
    "#status": textElement(),
    "#quality": selectElement()
  };
  const testNavigator = { deviceMemory: 2 };
  const sandbox = {
    Array,
    Date,
    Error,
    Map,
    Number,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    URL,
    clearTimeout,
    setTimeout,
    navigator: testNavigator,
    document: {
      addEventListener() {},
      querySelector(selector) {
        return elements[selector];
      }
    },
    chrome: {
      runtime: {
        connect() {
          return { onMessage: { addListener() {} } };
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const lowMemoryDash = sandbox.getDashSafetyLimits();
  const lowMemoryLive = sandbox.getLiveSafetyLimits();
  testNavigator.deviceMemory = 16;
  const highMemoryDash = sandbox.getDashSafetyLimits();
  const highMemoryLive = sandbox.getLiveSafetyLimits();
  assert.ok(highMemoryDash.maxInputBytes > lowMemoryDash.maxInputBytes);
  assert.ok(highMemoryLive.maxBytes > lowMemoryLive.maxBytes);

  const smallVideo = {
    segments: [{ size: lowMemoryDash.maxInputBytes - 1024 }]
  };
  const largeVideo = {
    segments: [{ size: highMemoryDash.maxInputBytes }, { size: 1024 }]
  };
  assert.equal(sandbox.dashRequiresStreamingCompanion(smallVideo), false);
  assert.equal(sandbox.dashRequiresStreamingCompanion(largeVideo), true);
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
    site: "bilibili",
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
    site: "bilibili",
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

  sandbox.location.href = "https://www.douyu.com/999001";
  sandbox.document.title = "Fixture Douyu Room - 斗鱼直播";
  assert.deepEqual(toPlain(sandbox.readPage()), {
    type: "live",
    site: "douyu",
    roomKey: "999001",
    roomId: 999001,
    title: "Fixture Douyu Room",
    url: "https://www.douyu.com/999001"
  });

  sandbox.location.href = "https://www.huya.com/fixture-anchor";
  sandbox.document.title = "Fixture Huya Room - 虎牙直播";
  assert.deepEqual(toPlain(sandbox.readPage()), {
    type: "live",
    site: "huya",
    roomKey: "fixture-anchor",
    roomId: null,
    title: "Fixture Huya Room",
    url: "https://www.huya.com/fixture-anchor"
  });

  sandbox.location.href = "https://www.huya.com/search";
  assert.equal(sandbox.readPage().type, "video");

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
    setTimeout(callback, delay) {
      if (delay) {
        callback();
        return 1;
      }
      return setTimeout(callback, delay);
    },
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


test("background defers Bangumi high-quality validation until download preparation", async () => {
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
  assert.equal(quality80.mode, "");
  assert.equal(video.currentQuality, 80);
  const playUrlRequests = fetchUrls.filter((url) => url.includes("/pgc/player/web/playurl"));
  assert.equal(playUrlRequests.length, 1);
  assert.ok(playUrlRequests[0].includes("qn=127"));
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
  assert.match(result.taskId, /^direct-/);
  assert.equal(result.mode, "durl");
  assert.equal(result.state, "in_progress");
  assert.deepEqual(toPlain(result.downloadIds), [1]);
  assert.equal(downloadOptions.length, 1);
  assert.equal(downloadOptions[0].filename, "BiliDownload/Smoke Video_80.mp4");
  assert.equal(downloadOptions[0].url, "https://primary.hdslb.test/video.mp4");
  assert.equal(downloadOptions[0].headers, undefined);
  assert.equal(result.segments[0].context.downloadMethod, "native-download");
  assert.equal(JSON.stringify(storage.directDownloadTasks[0]).includes("primary.hdslb.test"), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const completedTask = await sandbox.getDirectDownloadTask(result.taskId);
  assert.equal(completedTask.state, "complete");
  assert.equal(completedTask.completedCount, 1);
  assert.equal(completedTask.segments[0].state, "complete");
  assert.equal(completedTask.segments[0].receivedBytes, 10);
  assert.ok(fetchUrls.some((url) => url.includes("/x/web-interface/nav")));
  assert.ok(fetchUrls.some((url) => url.includes("fnval=4048")));
  assert.equal(fetchUrls.filter((url) => url.includes("/x/player/playurl")).length, 1);

  const diagnosticResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_GET_DIAGNOSTIC"
  });
  assert.equal(diagnosticResponse.ok, true);
  assert.equal(diagnosticResponse.payload.phase, "complete");
  assert.equal(diagnosticResponse.payload.initialItem.referrer, undefined);
  assert.deepEqual(toPlain(diagnosticResponse.payload.dnr.checks[0].matchedRules), [
    { ruleId: 3, rulesetId: "bili_media_headers" }
  ]);

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
  assert.equal(preparedResponse.payload.segments[0].context.downloadMethod, "native-download");
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
  const manualProgress = portMessages.at(-1);
  assert.deepEqual(toPlain(manualProgress), {
    type: "BILI_DOWNLOAD_PAGE_PROGRESS",
    payload: {
      receivedBytes: 1024,
      totalBytes: 2048,
      segmentIndex: 1,
      segmentCount: 1,
      candidateIndex: 1,
      candidateCount: 2,
      done: false,
      taskId: "",
      taskState: "",
      nativeDownload: false,
      downloadIds: [],
      error: "",
      tabId: 0
    }
  });
  assert.ok(portMessages.some((message) => (
    message.payload.nativeDownload && message.payload.taskId === result.taskId && message.payload.taskState === "complete"
  )));

  const canceledTask = await sandbox.startDirectDownload({
    prepared: {
      mode: "durl",
      format: "mp4",
      count: 1,
      segments: [{
        filename: "BiliDownload/Canceled.mp4",
        size: 10,
        candidates: [
          { url: "https://primary.hdslb.test/canceled.mp4?token=primary-secret", kind: "primary", size: 10 },
          { url: "https://backup.hdslb.test/canceled.mp4?token=backup-secret", kind: "backup", size: 10 }
        ],
        context: { bvid: "BV1KGj36QEG3", cid: 123, segmentIndex: 1, segmentCount: 1 }
      }]
    }
  });
  const canceledItem = downloadItems.get(2);
  canceledItem.state = "interrupted";
  canceledItem.error = "USER_CANCELED";
  for (const listener of changeListeners) {
    listener({
      id: 2,
      state: { previous: "in_progress", current: "interrupted" },
      error: { current: "USER_CANCELED" }
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  const canceledSnapshot = await sandbox.getDirectDownloadTask(canceledTask.taskId);
  assert.equal(canceledSnapshot.state, "canceled");
  assert.equal(canceledSnapshot.segments[0].state, "canceled");
  assert.equal(downloadOptions.length, 2, "a browser-side cancel must not retry a backup CDN");
  assert.doesNotMatch(JSON.stringify(storage.directDownloadTasks), /primary-secret|backup-secret/);

  const restoredTask = sandbox.restoreDirectDownloadTask({
    taskId: "restored-direct-task",
    state: "in_progress",
    segments: [
      {
        index: 1,
        state: "in_progress",
        downloadId: 99,
        filename: "BiliDownload/current.mp4",
        context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Smoke Video" }
      },
      {
        index: 2,
        state: "queued",
        filename: "BiliDownload/next.mp4",
        context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Smoke Video" }
      }
    ]
  });
  assert.equal(restoredTask.segments[1].candidates.length, 0);
  restoredTask.segments[0].state = "complete";
  sandbox.restoredTask = restoredTask;
  sandbox.recoveryPrepared = {
    mode: "durl",
    format: "mp4",
    segments: [
      {
        filename: "BiliDownload/current.mp4",
        size: 10,
        candidates: [{ url: "https://recovered-primary.hdslb.test/current.mp4?token=current-secret", kind: "primary", size: 10 }],
        context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Smoke Video" }
      },
      {
        filename: "BiliDownload/next.mp4",
        size: 10,
        candidates: [{ url: "https://recovered-primary.hdslb.test/next.mp4?token=next-secret", kind: "primary", size: 10 }],
        context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Smoke Video" }
      }
    ]
  };
  vm.runInContext("directDownloadTasks.set(restoredTask.id, restoredTask)", sandbox);
  vm.runInContext("rebuildDirectDownloadTaskPayload = async () => recoveryPrepared", sandbox);
  await sandbox.advanceDirectDownloadTask(restoredTask);
  assert.equal(restoredTask.state, "in_progress");
  assert.equal(restoredTask.segments[1].state, "in_progress");
  assert.equal(downloadOptions.length, 3);
  assert.equal(downloadOptions[2].url, "https://recovered-primary.hdslb.test/next.mp4?token=next-secret");
  assert.doesNotMatch(JSON.stringify(storage.directDownloadTasks), /current-secret|next-secret/);
});


test("background evicts failed playurl requests and deduplicates retries", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  let playUrlAttempts = 0;
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
        onMessage: { addListener() {} },
        onConnect: { addListener() {} }
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener() {} }
      },
      storage: {
        local: {
          async get() { return {}; },
          async set() {}
        }
      }
    },
    fetch: async (url) => {
      if (!String(url).includes("/x/player/playurl")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      playUrlAttempts += 1;
      if (playUrlAttempts === 1) {
        throw new Error("temporary playurl failure");
      }
      return jsonResponse({
        code: 0,
        data: {
          quality: 80,
          format: "dash",
          accept_quality: [80],
          accept_description: ["1080P"],
          durl: [],
          dash: {
            video: [{ id: 80, base_url: "https://video.bilivideo.com/80.m4s" }],
            audio: [{ id: 30280, base_url: "https://audio.bilivideo.com/audio.m4s" }]
          }
        }
      });
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const request = { bvid: "BV1CACHEFAIL1", cid: 123, quality: 80 };
  await assert.rejects(sandbox.fetchMediaPlayUrlCached(request), /temporary playurl failure/);
  const [first, second] = await Promise.all([
    sandbox.fetchMediaPlayUrlCached(request),
    sandbox.fetchMediaPlayUrlCached(request)
  ]);
  assert.equal(playUrlAttempts, 2);
  assert.equal(first, second);

  await sandbox.fetchMediaPlayUrlCached({ ...request, cid: 456 });
  assert.equal(playUrlAttempts, 3);
});


test("background starts native downloads before slow task persistence completes", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  let releaseStorage;
  const storageGate = new Promise((resolve) => {
    releaseStorage = resolve;
  });
  const downloadOptions = [];
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
        onMessage: { addListener() {} },
        onConnect: { addListener() {} }
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener() {} }
      },
      downloads: {
        download(options, callback) {
          downloadOptions.push(options);
          callback(1);
        },
        search(_query, callback) {
          callback([{
            id: 1,
            state: "in_progress",
            bytesReceived: 0,
            totalBytes: 1024,
            paused: false
          }]);
        },
        onChanged: { addListener() {} }
      },
      storage: {
        local: {
          async get() { return {}; },
          async set() { await storageGate; }
        }
      }
    },
    fetch: async () => {
      throw new Error("media should be handed directly to Chrome");
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const startPromise = sandbox.startDirectDownload({
    prepared: {
      mode: "durl",
      format: "mp4",
      segments: [{
        url: "https://primary.hdslb.test/video.mp4",
        filename: "BiliDownload/Fast Start.mp4",
        size: 1024,
        candidates: [{ url: "https://primary.hdslb.test/video.mp4", kind: "primary", size: 1024 }],
        context: {
          bvid: "BV1FASTSTART1",
          cid: 123,
          quality: 80,
          title: "Fast Start",
          source: "video",
          segmentIndex: 1,
          segmentCount: 1,
          format: "mp4"
        }
      }]
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(downloadOptions.length, 1);
  releaseStorage();
  const task = await startPromise;
  assert.equal(task.state, "in_progress");
});


test("background honors a queued native cancellation before starting a media request", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const storage = {};
  let downloadCalls = 0;

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
        onMessage: {
          addListener() {}
        },
        onConnect: {
          addListener() {}
        }
      },
      downloads: {
        download() {
          downloadCalls += 1;
        },
        onChanged: {
          addListener() {}
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
  const task = sandbox.createDirectDownloadTask({
    mode: "durl",
    format: "mp4",
    segments: [{
      filename: "BiliDownload/canceled.mp4",
      size: 1024,
      candidates: [{
        url: "https://primary.hdslb.test/canceled.mp4?token=should-not-persist",
        kind: "primary",
        size: 1024
      }],
      context: { bvid: "BV1KGj36QEG3", cid: 123, title: "Canceled" }
    }]
  });
  sandbox.taskForNativeCancelTest = task;
  vm.runInContext("directDownloadTasks.set(taskForNativeCancelTest.id, taskForNativeCancelTest)", sandbox);
  task.requestedAction = "cancel";

  await sandbox.startDirectDownloadSegment(task, task.segments[0]);

  assert.equal(downloadCalls, 0);
  assert.equal(task.state, "canceled");
  assert.equal(task.segments[0].state, "canceled");
  assert.equal(task.segments[0].candidates.length, 0);
  assert.equal(JSON.stringify(storage.directDownloadTasks[0]).includes("token=should-not-persist"), false);
  assert.equal(JSON.stringify(storage.directDownloadTasks[0]).includes("primary.hdslb.test"), false);
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
  assert.equal(fetchUrls.filter((url) => url.includes("/x/player/playurl")).length, 1);
  assert.ok(fetchUrls.some((url) => url.includes("fnval=4048")));
});


test("background loads live rooms and prepares FLV recording streams", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  let messageListener = null;

  const sandbox = {
    Array,
    Date,
    Error,
    Number,
    Promise,
    Set,
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
      if (value.includes("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            isLogin: true,
            uname: "live-user",
            mid: 42,
            vipInfo: {}
          }
        });
      }
      if (value.includes("/room/v1/Room/room_init")) {
        return jsonResponse({
          code: 0,
          data: {
            room_id: 7734200,
            short_id: 6,
            live_status: 1
          }
        });
      }
      if (value.includes("/room/v1/Room/get_info")) {
        return jsonResponse({
          code: 0,
          data: {
            room_id: 7734200,
            short_id: 6,
            live_status: 1,
            title: "Live Test Room"
          }
        });
      }
      if (value.includes("/xlive/web-room/v2/index/getRoomPlayInfo")) {
        const qn = new URL(value).searchParams.get("qn");
        assert.ok(["10000", "250"].includes(qn));
        return jsonResponse({
          code: 0,
          data: {
            room_id: 7734200,
            playurl_info: {
              playurl: {
                cid: 7734200,
                g_qn_desc: [
                  { qn: 10000, desc: "原画" },
                  { qn: 250, desc: "超清" }
                ],
                stream: [{
                  protocol_name: "http_stream",
                  format: [{
                    format_name: "flv",
                    codec: [{
                      codec_name: "avc",
                      current_qn: 250,
                      base_url: "/live/test.flv?",
                      is_pushing: true,
                      url_info: [{
                        host: "https://live-primary.bilivideo.com",
                        extra: "token=1"
                      }, {
                        host: "https://live-backup.bilivideo.com",
                        extra: "token=2"
                      }]
                    }]
                  }]
                }]
              }
            }
          }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const live = await sandbox.loadLive({
    type: "live",
    roomId: 6,
    title: "Live Page",
    url: "https://live.bilibili.com/6"
  });
  assert.equal(live.source, "live");
  assert.equal(live.roomId, 7734200);
  assert.equal(live.shortId, 6);
  assert.equal(live.liveStatus, 1);
  assert.equal(live.account.username, "live-user");
  assert.equal(live.currentQuality, 250);
  assert.equal(live.qualities.length, 2);
  assert.equal(live.qualities[0].code, 10000);
  assert.equal(live.qualities[0].available, false);
  assert.equal(live.qualities[0].reason, "unavailable");
  assert.equal(live.qualities[1].code, 250);
  assert.equal(live.qualities[1].available, true);
  const noCookieQualities = await sandbox.buildLiveQualityOptions({
    roomId: 7734200,
    playInfo: sandbox.normalizeLivePlayInfo({
      playurl_info: {
        playurl: {
          cid: 7734200,
          g_qn_desc: [
            { qn: 10000, desc: "原画" },
            { qn: 250, desc: "超清" }
          ],
          stream: [{
            protocol_name: "http_stream",
            format: [{
              format_name: "flv",
              codec: [{
                codec_name: "avc",
                current_qn: 250,
                base_url: "/live/test.flv?",
                is_pushing: true,
                url_info: [{
                  host: "https://live-primary.bilivideo.com",
                  extra: "token=1"
                }]
              }]
            }]
          }]
        }
      }
    }),
    account: { isLogin: false }
  });
  assert.equal(noCookieQualities[0].code, 10000);
  assert.equal(noCookieQualities[0].available, false);
  assert.equal(noCookieQualities[0].reason, "login-required");

  const preparedResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING",
    payload: {
      roomId: 6,
      title: "Live Page",
      quality: 250
    }
  });
  assert.equal(preparedResponse.ok, true);
  assert.equal(preparedResponse.payload.mode, "live");
  assert.equal(preparedResponse.payload.format, "flv");
  assert.equal(preparedResponse.payload.live.roomId, 7734200);
  assert.equal(preparedResponse.payload.live.qualityLabel, "超清");
  assert.match(preparedResponse.payload.segments[0].url, /^https:\/\/live-primary\.bilivideo\.com\/live\/test\.flv\?token=1$/);
  assert.equal(preparedResponse.payload.segments[0].candidates.length, 2);
  assert.match(preparedResponse.payload.segments[0].filename, /^BiliDownload\/Live Page_\d{8}_\d{6}\.flv$/);
});


test("background normalizes Douyu rooms and uses only HTTPS FLV CDN streams", async () => {
  const fixture = JSON.parse(await readFile("extension/tests/fixtures/douyu-betard.json", "utf8"));
  const streamFixture = JSON.parse(await readFile("extension/tests/fixtures/douyu-stream.json", "utf8"));
  const sandbox = await backgroundUnitSandbox();

  const room = sandbox.normalizeDouyuRoom(fixture, "999001");
  assert.deepEqual(toPlain(room), {
    roomId: 999001,
    ownerUid: 88001,
    title: "Fixture Douyu Room",
    anchorName: "Fixture Anchor",
    liveStatus: 1,
    multirates: fixture.room.multirates
  });
  assert.deepEqual(
    toPlain(sandbox.normalizeDouyuQualities(room.multirates).map(({ code, siteCode, label }) => ({ code, siteCode, label }))),
    [
      { code: 10000, siteCode: 0, label: "蓝光10M" },
      { code: 4, siteCode: 4, label: "蓝光4M" },
      { code: 2, siteCode: 2, label: "高清" },
      { code: 1, siteCode: 1, label: "流畅" }
    ]
  );
  assert.equal(
    sandbox.buildDouyuFlvUrl(streamFixture),
    "https://fixture.douyucdn.cn/live/fixture-stream.flv?token=redacted"
  );
  assert.equal(sandbox.buildDouyuFlvUrl({ ...streamFixture, rtmpUrl: "https://evil.example/live" }), "");
  assert.equal(sandbox.buildDouyuFlvUrl({ ...streamFixture, rtmpLive: "fixture.m3u8" }), "");
  assert.equal(sandbox.buildDouyuFlvUrl({ ...streamFixture, rtcUrl: "https://rtc.example/stream" }), "");
  assert.equal(sandbox.buildDouyuFlvUrl({ ...streamFixture, isMixed: true }), "");

  const offline = sandbox.normalizeDouyuRoom({
    room: { ...fixture.room, show_status: 2 }
  }, "999001");
  assert.equal(offline.liveStatus, 0);
});


test("Douyu page stream resolver scopes and restores its temporary fetch wrapper", async () => {
  const streamFixture = JSON.parse(await readFile("extension/tests/fixtures/douyu-stream.json", "utf8"));
  const fetchCalls = [];
  const originalFetch = async (input, init = {}) => {
    fetchCalls.push({ input: String(input), body: String(init.body || "") });
    return { json: async () => ({ error: 0, data: streamFixture }) };
  };
  const sandbox = await backgroundUnitSandbox({ fetch: originalFetch });
  sandbox.douyuStreamFixture = streamFixture;
  vm.runInContext(`
    getLegacyFirstStream = async () => {
      await fetch("/lapi/live/getH5PlayV1/other", { method: "POST", body: "rate=9&hevc=1&fa=1" });
      await fetch("/lapi/live/getH5PlayV1/999001", { method: "POST", body: "rate=9&hevc=1&fa=1" });
      return douyuStreamFixture;
    };
  `, sandbox);

  const resolved = await sandbox.resolveDouyuStreamInPage(999001, 88001, 4);
  assert.equal(resolved.ok, true);
  assert.equal(sandbox.fetch, originalFetch);
  assert.equal(new URLSearchParams(fetchCalls[0].body).get("rate"), "9");
  const targetBody = new URLSearchParams(fetchCalls[1].body);
  assert.equal(targetBody.get("rate"), "4");
  assert.equal(targetBody.get("hevc"), "0");
  assert.equal(targetBody.get("fa"), "0");

  vm.runInContext(`getLegacyFirstStream = async () => { throw new Error("fixture failure"); };`, sandbox);
  const failed = await sandbox.resolveDouyuStreamInPage(999001, 88001, 4);
  assert.equal(failed.ok, false);
  assert.equal(sandbox.fetch, originalFetch);

  delete sandbox.getLegacyFirstStream;
  sandbox.setTimeout = (callback) => {
    callback();
    return 1;
  };
  const timedOut = await sandbox.resolveDouyuStreamInPage(999001, 88001, 4);
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.error, /刷新直播页/);
  assert.equal(sandbox.fetch, originalFetch);
});


test("Huya page adapter filters AVC qualities and builds three HTTPS CDN candidates", async () => {
  const fixture = JSON.parse(await readFile("extension/tests/fixtures/huya-player.json", "utf8"));
  const sandbox = await backgroundUnitSandbox();
  sandbox.hyPlayerConfig = { stream: fixture };
  sandbox.TT_ROOM_PLAYER = {
    initComplete(callback) {
      callback({
        getCurrentSeiDts() {
          return 345678;
        },
        vcore: {
          h5player: {
            player: {
              anticode: {
                getAnticode() {
                  return "wsSecret=official-redacted&wsTime=12345678&seqid=1";
                },
                isInvalid() {
                  return false;
                }
              }
            }
          }
        }
      });
    }
  };
  sandbox.location.pathname = "/fixture-anchor";

  const result = await sandbox.readHuyaLiveStateInPage(2000, true);
  assert.equal(result.ok, true);
  assert.equal(result.payload.roomKey, "999002");
  assert.equal(result.payload.liveStatus, 1);
  const qualities = sandbox.normalizeHuyaQualities(result.payload.qualities);
  assert.deepEqual(
    toPlain(qualities.map(({ code, siteCode, label }) => ({ code, siteCode, label }))),
    [
      { code: 10000, siteCode: 0, label: "蓝光10M" },
      { code: 4000, siteCode: 4000, label: "蓝光4M" },
      { code: 2000, siteCode: 2000, label: "超清" }
    ]
  );
  assert.equal(result.payload.candidates.length, 3);
  for (const candidate of result.payload.candidates) {
    const url = new URL(candidate.url);
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname.endsWith(".flv.huya.com"));
    assert.equal(url.searchParams.get("ratio"), "2000");
    assert.equal(url.searchParams.getAll("ratio").length, 1);
    assert.equal(url.searchParams.get("wsSecret"), "official-redacted");
    assert.equal(url.searchParams.has("timeStamp"), true);
    assert.equal(url.searchParams.get("startPts"), "343678");
    assert.equal(url.searchParams.has("codec"), false);
  }

  fixture.data[0].gameStreamInfoList[1].sHlsUrl = "https://alhls.huya.com/src";
  fixture.data[0].gameStreamInfoList[1].sHlsUrlSuffix = "m3u8";
  fixture.data[0].gameStreamInfoList[1].sHlsAntiCode = "hlsSecret=official-hls-redacted";
  sandbox.hyPlayerConfig = { stream: fixture };
  const hlsResult = await sandbox.readHuyaLiveStateInPage(2000, true);
  const hlsCandidate = hlsResult.payload.candidates.find((candidate) => candidate.protocol === "hls");
  assert.ok(hlsCandidate);
  assert.equal(new URL(hlsCandidate.url).hostname, "alhls.huya.com");
  assert.equal(new URL(hlsCandidate.url).pathname.endsWith(".m3u8"), true);
  assert.equal(new URL(hlsCandidate.url).searchParams.get("hlsSecret"), "official-hls-redacted");

  const sourceResult = await sandbox.readHuyaLiveStateInPage(10000, true);
  assert.equal(new URL(sourceResult.payload.candidates[0].url).searchParams.has("ratio"), false);

  delete sandbox.TT_ROOM_PLAYER;
  sandbox.setTimeout = (callback) => {
    callback();
    return 1;
  };
  const missingOfficialPlayer = await sandbox.readHuyaLiveStateInPage(2000, true);
  assert.equal(missingOfficialPlayer.ok, false);
  assert.match(missingOfficialPlayer.error, /官方播放器尚未准备好/);
  sandbox.TT_ROOM_PLAYER = {
    initComplete() {}
  };
  const timedOutOfficialPlayer = await sandbox.readHuyaLiveStateInPage(2000, true);
  assert.equal(timedOutOfficialPlayer.ok, false);
  assert.match(timedOutOfficialPlayer.error, /录制授权/);

  sandbox.hyPlayerConfig = { stream: { data: [] } };
  const offline = await sandbox.readHuyaLiveStateInPage(0, false);
  assert.equal(offline.ok, true);
  assert.equal(offline.payload.liveStatus, 0);
  assert.equal(offline.payload.roomKey, "fixture-anchor");

  delete sandbox.hyPlayerConfig;
  sandbox.setTimeout = (callback) => {
    callback();
    return 1;
  };
  const missing = await sandbox.readHuyaLiveStateInPage(0, false);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /播放器尚未准备好/);
});


test("multi-site live registry loads and prepares Douyu and Huya recordings", async () => {
  const douyuFixture = JSON.parse(await readFile("extension/tests/fixtures/douyu-betard.json", "utf8"));
  const douyuStream = JSON.parse(await readFile("extension/tests/fixtures/douyu-stream.json", "utf8"));
  const huyaFixture = JSON.parse(await readFile("extension/tests/fixtures/huya-player.json", "utf8"));
  const sandbox = await backgroundUnitSandbox({
    fetch: async (url) => {
      if (String(url).includes("/betard/999001")) {
        return jsonResponse(douyuFixture);
      }
      throw new Error(`unexpected fixture fetch: ${url}`);
    }
  });
  sandbox.hyPlayerConfig = { stream: huyaFixture };
  sandbox.TT_ROOM_PLAYER = {
    initComplete(callback) {
      callback({
        vcore: {
          h5player: {
            player: {
              anticode: {
                getAnticode() {
                  return "wsSecret=official-redacted&wsTime=12345678&seqid=1";
                },
                isInvalid() {
                  return false;
                }
              }
            }
          }
        }
      });
    }
  };
  sandbox.chrome.scripting = {
    async executeScript(details) {
      if (details.func.name === "fetchJsonInPage") {
        return [{ result: { ok: true, responseOk: true, status: 200, payload: douyuFixture } }];
      }
      if (details.func.name === "resolveDouyuStreamInPage") {
        return [{
          result: {
            ok: true,
            payload: {
              roomId: douyuStream.room_id,
              rate: douyuStream.rate,
              rtmpUrl: douyuStream.rtmp_url,
              rtmpLive: douyuStream.rtmp_live,
              isMixed: douyuStream.is_mixed,
              rtcUrl: douyuStream.rtc_stream_url
            }
          }
        }];
      }
      if (details.func.name === "readHuyaLiveStateInPage") {
        return [{ result: await sandbox.readHuyaLiveStateInPage(...details.args) }];
      }
      throw new Error(`unexpected script injection: ${details.func.name}`);
    }
  };

  const douyu = await sandbox.loadLive({
    site: "douyu",
    roomKey: "999001",
    tabId: 11,
    url: "https://www.douyu.com/999001"
  });
  assert.equal(douyu.site, "douyu");
  assert.equal(douyu.qualities.length, 4);
  const preparedDouyu = await sandbox.prepareLiveRecording({
    site: "douyu",
    roomKey: "999001",
    quality: 4,
    tabId: 11
  });
  assert.equal(preparedDouyu.live.site, "douyu");
  assert.match(preparedDouyu.segments[0].filename, /^BiliDownload\/斗鱼_Fixture Anchor_Fixture Douyu Room_\d{8}_\d{6}\.flv$/);
  assert.match(
    sandbox.describeCompanionLivePreparation(preparedDouyu).outputName,
    /^斗鱼_Fixture Anchor_Fixture Douyu Room_\d{8}_\d{6}\.flv$/
  );

  sandbox.location.origin = "https://www.huya.com";
  sandbox.location.href = "https://www.huya.com/fixture-anchor";
  sandbox.location.pathname = "/fixture-anchor";
  const huya = await sandbox.loadLive({
    site: "huya",
    roomKey: "fixture-anchor",
    tabId: 12,
    url: "https://www.huya.com/fixture-anchor"
  });
  assert.equal(huya.site, "huya");
  assert.equal(huya.roomKey, "999002");
  assert.equal(huya.qualities.length, 3);
  const preparedHuya = await sandbox.prepareLiveRecording({
    site: "huya",
    roomKey: "fixture-anchor",
    quality: 2000,
    tabId: 12
  });
  assert.equal(preparedHuya.live.site, "huya");
  assert.equal(preparedHuya.segments[0].candidates.length, 3);
  assert.match(preparedHuya.segments[0].filename, /^BiliDownload\/虎牙_Fixture Anchor_Fixture Huya Room_\d{8}_\d{6}\.flv$/);
  assert.match(
    sandbox.describeCompanionLivePreparation(preparedHuya).outputName,
    /^虎牙_Fixture Anchor_Fixture Huya Room_\d{8}_\d{6}\.flv$/
  );
  await assert.rejects(
    sandbox.prepareLiveRecording({
      site: "huya",
      roomKey: "fixture-anchor",
      quality: 9999,
      tabId: 12
    }),
    /Quality 9999/
  );
});


test("Huya companion selects page-provided HLS candidates and keeps signed URLs out of metadata", async () => {
  const sandbox = await backgroundUnitSandbox();
  const prepared = {
    mode: "live",
    live: {
      site: "huya",
      roomKey: "999002",
      roomId: 999002,
      quality: 2000,
      title: "虎牙 Fixture"
    },
    segments: [{
      filename: "BiliDownload/虎牙 Fixture.flv",
      candidates: [
        { url: "https://tx.flv.huya.com/src/live.flv?token=flv-secret", protocol: "flv" },
        { url: "https://alhls.huya.com/src/live.m3u8?token=hls-secret", protocol: "hls" }
      ],
      context: { site: "huya", roomKey: "999002", roomId: 999002, quality: 2000, title: "虎牙 Fixture" }
    }]
  };
  const descriptor = sandbox.describeCompanionLivePreparation(prepared);
  assert.equal(descriptor.metadata.format, "hls");
  assert.equal(descriptor.liveFormat, "hls");
  assert.match(descriptor.outputName, /\.mkv$/);
  assert.equal(descriptor.liveSources.length, 1);
  assert.equal(JSON.stringify(descriptor).includes("hls-secret"), true);
  const task = {
    id: "task_hls",
    kind: "live",
    outputName: descriptor.outputName,
    title: descriptor.metadata.title,
    metadata: descriptor.metadata,
    maxBytes: 1024 * 1024,
    maxDurationSeconds: 60,
    segmentDurationSeconds: 5
  };
  const start = sandbox.buildCompanionStartMessage(task, descriptor);
  assert.equal(start.message.payload.format, "hls");
  assert.equal(start.message.payload.sources[0].includes("hls-secret"), true);
});


test("background estimates missing DASH media sizes without probing media URLs", async () => {
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
  assert.equal(video.qualities[0].estimatedSize, Math.round(((1_500_000 + 192_000) * 60) / 8));
  assert.equal(video.qualities[0].estimatedSizeSource, "bandwidth");
  assert.equal(video.qualities[0].estimatedSizeApproximate, true);
  assert.equal(fetchCalls.some((call) => call.url.includes("no-size-video.m4s")), false);
  assert.equal(fetchCalls.some((call) => call.url.includes("no-size-audio.m4s")), false);
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
    [64, true, "", ""],
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
    AbortController,
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
  const mockBatchResponse = createMockBatchJobHandler();
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
    AbortController,
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
          const batchResponse = mockBatchResponse(message);
          if (batchResponse) {
            return batchResponse;
          }
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
          if (message.type === "BILI_DOWNLOAD_START_DIRECT") {
            const segment = message.payload.prepared.segments[0];
            return {
              ok: true,
              payload: {
                taskId: `native-${segment.context.cid}`,
                state: "complete",
                count: 1,
                receivedBytes: segment.size,
                totalBytes: segment.size,
                segments: [{
                  index: 1,
                  state: "complete",
                  filename: segment.filename,
                  receivedBytes: segment.size,
                  totalBytes: segment.size,
                  candidateIndex: 1,
                  candidateCount: 1
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
  const directStartPayloads = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_START_DIRECT")
    .map((message) => message.payload.prepared);
  assert.deepEqual(directStartPayloads.map((prepared) => prepared.segments[0].filename), [
    "BiliDownload/Multi Page Video_P01_Opening_64.mp4",
    "BiliDownload/Multi Page Video_P03_Ending_64.mp4"
  ]);
  assert.equal(scriptCalls.length, 0);
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
  const audioStartPayloads = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_START_DIRECT")
    .map((message) => message.payload.prepared);
  assert.deepEqual(audioStartPayloads.map((prepared) => prepared.segments[0].filename), [
    "BiliDownload/Multi Page Video_P01_Opening_audio.m4a",
    "BiliDownload/Multi Page Video_P03_Ending_audio.m4a"
  ]);
  assert.equal(scriptCalls.length, 0);
  assert.match(statusElement.textContent, /2$/);
});


test("popup sends Bangumi episode ids for selected episode downloads", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const scriptCalls = [];
  const mockBatchResponse = createMockBatchJobHandler();
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const bvidInput = textElement();
  const pagePickerToggle = buttonElement();
  const pagePicker = panelElement();
  const pageList = containerElement();
  const pageSelectAllButton = buttonElement();

  const sandbox = {
    AbortController,
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
          const batchResponse = mockBatchResponse(message);
          if (batchResponse) {
            return batchResponse;
          }
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
          if (message.type === "BILI_DOWNLOAD_START_DIRECT") {
            const segment = message.payload.prepared.segments[0];
            return {
              ok: true,
              payload: {
                taskId: `native-${segment.context.epId}`,
                state: "complete",
                count: 1,
                receivedBytes: segment.size,
                totalBytes: segment.size,
                segments: [{
                  index: 1,
                  state: "complete",
                  filename: segment.filename,
                  receivedBytes: segment.size,
                  totalBytes: segment.size,
                  candidateIndex: 1,
                  candidateCount: 1
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
  const directStarts = runtimeMessages.filter((message) => message.type === "BILI_DOWNLOAD_START_DIRECT");
  assert.equal(
    directStarts[0].payload.prepared.segments[0].filename,
    "BiliDownload/Bangumi Season_P02_Episode One_64.mp4"
  );
  assert.equal(
    directStarts[1].payload.prepared.segments[0].filename,
    "BiliDownload/Bangumi Season_P02_Episode One_audio.m4a"
  );
  assert.equal(scriptCalls.length, 0);
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
          if (message.type === "BILI_DOWNLOAD_START_DIRECT") {
            const segment = message.payload.prepared.segments[0];
            return {
              ok: true,
              payload: {
                taskId: "native-audio-123",
                state: "complete",
                count: 1,
                receivedBytes: segment.size,
                totalBytes: segment.size,
                segments: [{
                  index: 1,
                  state: "complete",
                  filename: segment.filename,
                  receivedBytes: segment.size,
                  totalBytes: segment.size,
                  candidateIndex: 1,
                  candidateCount: 1
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
  const directStart = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_START_DIRECT");
  assert.equal(directStart.payload.prepared.segments[0].filename, "BiliDownload/Smoke Video_audio.m4a");
  assert.equal(scriptCalls.length, 0);
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
  let rangeResponseMode = "normal";
  let rangeCancelCalls = 0;
  let rangeBlobCalls = 0;
  let singleBlobCalls = 0;
  let rangeAbortCalls = 0;
  class TestURL extends URL {
    static createObjectURL(blob) {
      const value = `blob:range-test/${objectUrls.length + 1}`;
      objectUrls.push({ value, blob });
      return value;
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
    console,
    async fetch(url, options = {}) {
      fetchCalls.push({ url, headers: options.headers || {} });
      const rangeHeader = options.headers?.Range || options.headers?.range;
      if (!rangeHeader) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          headers: {
            get(name) {
              return String(name).toLowerCase() === "content-length" ? "4" : "video/mp4";
            }
          },
          async blob() {
            singleBlobCalls += 1;
            return new Blob([new Uint8Array(4)], { type: "video/mp4" });
          }
        };
      }
      assert.ok(rangeHeader, "parallel download should use Range requests");
      const match = String(rangeHeader).match(/bytes=(\d+)-(\d+)/);
      assert.ok(match, `invalid range header: ${rangeHeader}`);
      const start = Number(match[1]);
      const end = Number(match[2]);
      const length = end - start + 1;
      const headers = {
        get(name) {
          if (name.toLowerCase() === "content-type") {
            return "video/mp4";
          }
          if (name.toLowerCase() === "content-length") {
            return String(length);
          }
          return null;
        }
      };
      if (rangeResponseMode === "no-reader") {
        return {
          ok: true,
          status: 206,
          statusText: "Partial Content",
          headers,
          async blob() {
            rangeBlobCalls += 1;
            return new Blob([new Uint8Array(length)], { type: "video/mp4" });
          }
        };
      }
      if (rangeResponseMode === "fail-one") {
        if (start === 0) {
          return { ok: false, status: 500, statusText: "Failure", headers };
        }
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener?.("abort", () => {
            rangeAbortCalls += 1;
            const error = new Error("range aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return {
        ok: true,
        status: 206,
        statusText: "Partial Content",
        headers,
        body: {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) {
                  return { done: true };
                }
                sent = true;
                return {
                  done: false,
                  value: new Uint8Array(rangeResponseMode === "oversized" ? length + 1 : length)
                };
              },
              cancel() {
                rangeCancelCalls += 1;
                return Promise.resolve();
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

  vm.runInContext("state.downloadControl = createDownloadControl();", sandbox);
  rangeResponseMode = "fail-one";
  const failedRange = await sandbox.fetchMediaInExtensionRanges(
    "https://range.test/media",
    "BiliDownload/fallback.mp4",
    false,
    { totalBytes: totalSize },
    totalSize
  );
  assert.equal(failedRange.ok, false);
  assert.ok(rangeAbortCalls >= 1, "a failed worker should abort the other in-flight ranges");

  rangeResponseMode = "oversized";
  await assert.rejects(
    sandbox.fetchRangeChunk("https://range.test/media", { start: 0, end: 3 }, () => {}),
    (error) => error?.name === "MediaSafetyLimitError"
  );
  assert.equal(rangeCancelCalls, 1);

  rangeResponseMode = "no-reader";
  await assert.rejects(
    sandbox.fetchRangeChunk("https://range.test/media", { start: 0, end: 3 }, () => {}),
    /不支持安全的流式读取/
  );
  assert.equal(rangeBlobCalls, 0);

  const singleNoReader = await sandbox.fetchMediaInExtensionSingle(
    "https://range.test/media",
    "BiliDownload/safe.mp4",
    false,
    { totalBytes: 4 },
    { maxBytes: 4, limitMessage: "stream required" }
  );
  assert.equal(singleNoReader.limitReached, true);
  assert.equal(singleBlobCalls, 0);
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
      const bodyBytes = new Uint8Array(await body.arrayBuffer());
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
        body: {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) {
                  return { done: true };
                }
                sent = true;
                return { done: false, value: bodyBytes };
              }
            };
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


test("popup explains how to download oversized DASH media when enhanced download is unavailable", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const elements = {
    "#status": textElement(),
    "#account": textElement(),
    "#bvid": textElement(),
    "#title": textElement(),
    "#quality": selectElement(),
    "#quality-size": textElement(),
    "#copy": buttonElement(),
    "#download": buttonElement(),
    "#download-audio": buttonElement(),
    "#live-record": buttonElement(),
    "#page-picker-toggle": buttonElement(),
    "#page-picker": panelElement(),
    "#page-list": containerElement(),
    "#page-select-all": buttonElement(),
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
  };
  let fetchCalls = 0;
  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    navigator: { deviceMemory: 0.25 },
    setTimeout,
    document: {
      addEventListener() {},
      querySelector(selector) {
        return elements[selector];
      }
    },
    fetch() {
      fetchCalls += 1;
      throw new Error("oversized DASH must be rejected before fetching");
    },
    chrome: {
      runtime: {
        connect() {
          return {
            onMessage: {
              addListener() {}
            }
          };
        },
        async sendMessage(message) {
          if (message.type === "BILI_DOWNLOAD_COMPANION_PING") {
            return { ok: false, error: "companion unavailable" };
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      },
      tabs: {
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const oversized = sandbox.getDashSafetyLimits().maxInputBytes + 1;
  await assert.rejects(
    sandbox.downloadPreparedPayload({
      mode: "dash",
      count: 2,
      segments: [{ size: oversized }, { size: 1024 }]
    }),
    /安装增强下载.*较低清晰度/
  );
  assert.equal(fetchCalls, 0);
});


test("popup labels Huya alias rooms and Douyu numeric rooms with site-aware fields", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const accountLabel = textElement();
  const account = textElement();
  const pageIdLabel = textElement();
  const pageId = textElement();
  const elements = {
    "#status": textElement(),
    "#account-label": accountLabel,
    "#account": account,
    "#page-id-label": pageIdLabel,
    "#bvid": pageId,
    "#title": textElement(),
    "#quality": selectElement(),
    "#quality-size": textElement(),
    "#download": buttonElement(),
    "#download-audio": buttonElement(),
    "#live-record": buttonElement(),
    "#page-picker-toggle": buttonElement(),
    "#page-picker": panelElement(),
    "#download-selected-page-audio": buttonElement(),
    "label[for=\"quality\"]": textElement()
  };
  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    navigator: { deviceMemory: 4 },
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      querySelector(selector) { return elements[selector]; }
    },
    chrome: {
      runtime: {
        connect() {
          return { onMessage: { addListener() {} } };
        }
      },
      tabs: {
        onActivated: { addListener() {} },
        onUpdated: { addListener() {} }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  vm.runInContext(`
    state.page = {
      type: "live",
      site: "huya",
      roomKey: "fixture-anchor",
      roomId: null,
      title: "Fixture Huya Room",
      url: "https://www.huya.com/fixture-anchor"
    };
    state.account = null;
  `, sandbox);
  sandbox.renderMode();
  sandbox.renderAccount();
  assert.equal(accountLabel.textContent, "站点");
  assert.equal(account.textContent, "虎牙");
  assert.equal(pageIdLabel.textContent, "房间标识");
  assert.equal(sandbox.displayPageId(vm.runInContext("state.page", sandbox)), "fixture-anchor");

  vm.runInContext(`state.page.site = "douyu"; state.page.roomKey = "999001"; state.page.roomId = 999001;`, sandbox);
  sandbox.renderMode();
  sandbox.renderAccount();
  assert.equal(account.textContent, "斗鱼");
  assert.equal(pageIdLabel.textContent, "房间号");
  assert.equal(sandbox.siteFromUrl("https://www.douyu.com/999001"), "douyu");
  assert.equal(sandbox.extractLiveRoomKey("https://www.huya.com/fixture-anchor", "huya"), "fixture-anchor");
  assert.equal(sandbox.extractLiveRoomKey("https://www.huya.com/search", "huya"), "");
  const task = sandbox.rememberCompanionTask({
    taskId: "fixture-live-task",
    tabId: 1,
    kind: "live",
    title: "同名直播",
    metadata: { site: "huya" },
    state: "in_progress"
  });
  assert.equal(task.site, "huya");
  assert.equal(sandbox.taskCenterTitle("companion", task), "虎牙直播录制 · 同名直播");
});


test("popup records a live FLV stream until the user stops it", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const savedAnchors = [];
  const statusElement = textElement();
  const accountElement = textElement();
  const bvidInput = textElement();
  const titleInput = textElement();
  const qualitySelect = selectElement();
  const qualitySizeElement = textElement();
  const downloadButton = buttonElement();
  const downloadAudioButton = buttonElement();
  const liveRecordButton = buttonElement();
  const progressPanel = panelElement();
  const progressPercent = textElement();
  const progressBar = styleElement();
  const progressSize = textElement();
  let pendingRead = null;
  let rejectPendingRead = null;
  let abortListener = null;
  let livePacket = new Uint8Array([1, 2, 3, 4]);
  let blockFirstLivePacket = false;
  let abortLiveReadWithNetworkError = false;
  let liveLimitTimer = null;
  let liveLimitDelay = 0;
  let liveProgressTimer = null;
  let liveProgressDelay = 0;
  let liveCandidates = [{
    url: "https://live-primary.bilivideo.com/live/test.flv?token=1",
    kind: "primary",
    size: 0
  }];
  let failingLiveCandidate = "";
  const liveFetchUrls = [];
  let fakeNow = Date.now();
  class TestDate extends Date {
    static now() {
      return fakeNow;
    }
  }

  const sandbox = {
    AbortController,
    Blob,
    Date: TestDate,
    Error,
    RegExp,
    String,
    URL: class extends URL {
      static createObjectURL(blob) {
        return `blob:live/${blob.size}`;
      }
      static revokeObjectURL() {}
    },
    console,
    navigator: {
      deviceMemory: 4,
      clipboard: {
        async writeText() {}
      }
    },
    setTimeout(callback, delay) {
      if (delay === 30000) {
        callback();
      } else if (delay > 0) {
        liveLimitTimer = callback;
        liveLimitDelay = delay;
      }
      return 1;
    },
    clearTimeout() {},
    setInterval(callback, delay) {
      liveProgressTimer = callback;
      liveProgressDelay = delay;
      return 2;
    },
    clearInterval() {
      liveProgressTimer = null;
    },
    document: {
      addEventListener() {},
      body: {
        append(anchor) {
          savedAnchors.push(anchor);
        }
      },
      createElement(tagName) {
        if (tagName === "a") {
          return {
            href: "",
            download: "",
            rel: "",
            click() {},
            remove() {}
          };
        }
        return optionElement();
      },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#account": accountElement,
          "#bvid": bvidInput,
          "#title": titleInput,
          "#quality": qualitySelect,
          "#quality-size": qualitySizeElement,
          "#copy": buttonElement(),
          "#download": downloadButton,
          "#download-audio": downloadAudioButton,
          "#live-record": liveRecordButton,
          "#page-picker-toggle": buttonElement(),
          "#page-picker": panelElement(),
          "#page-list": containerElement(),
          "#page-select-all": buttonElement(),
          "#download-selected-pages": buttonElement(),
          "#download-selected-page-audio": buttonElement(),
          "#diagnostic": buttonElement(),
          "#progress": progressPanel,
          "#progress-percent": progressPercent,
          "#progress-bar": progressBar,
          "#progress-size": progressSize,
          "#progress-speed": textElement(),
          "#download-controls": panelElement(),
          "#pause": buttonElement(),
          "#cancel": buttonElement(),
          "label[for=\"quality\"]": textElement()
        }[selector];
      }
    },
    fetch: async (url, options = {}) => {
      liveFetchUrls.push(url);
      if (url === failingLiveCandidate) {
        fakeNow += 55 * 1000;
        throw new Error("primary live candidate failed");
      }
      abortListener = () => {
        if (abortLiveReadWithNetworkError) {
          rejectPendingRead?.(new Error("live stream disconnected after abort"));
        } else {
          pendingRead?.({ done: true });
        }
        pendingRead = null;
        rejectPendingRead = null;
      };
      options.signal?.addEventListener?.("abort", abortListener);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
          get(name) {
            return String(name).toLowerCase() === "content-type" ? "video/x-flv" : "";
          }
        },
        body: {
          getReader() {
            let count = 0;
            return {
              async read() {
                count += 1;
                if (count === 1) {
                  if (blockFirstLivePacket) {
                    return new Promise((resolve, reject) => {
                      pendingRead = resolve;
                      rejectPendingRead = reject;
                    });
                  }
                  return { done: false, value: livePacket };
                }
                return new Promise((resolve, reject) => {
                  pendingRead = resolve;
                  rejectPendingRead = reject;
                });
              }
            };
          }
        }
      };
    },
    chrome: {
      tabs: {
        async query() {
          return [{
            id: 99,
            url: "https://live.bilibili.com/6",
            title: "Live Test"
          }];
        },
        async sendMessage() {
          return {
            type: "live",
            site: "bilibili",
            roomKey: "6",
            roomId: 6,
            title: "Live Test",
            url: "https://live.bilibili.com/6"
          };
        },
        onActivated: {
          addListener() {}
        },
        onUpdated: {
          addListener() {}
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
          if (message.type === "BILI_DOWNLOAD_LOAD_LIVE") {
            return {
              ok: true,
              payload: {
                source: "live",
                site: "bilibili",
                roomKey: "7734200",
                roomId: 7734200,
                shortId: 6,
                title: "Live Test",
                liveStatus: 1,
                liveStatusText: "直播中",
                account: { isLogin: true, username: "live-user" },
                currentQuality: 250,
                qualities: [{
                  code: 10000,
                  label: "原画",
                  available: false,
                  mode: "",
                  reason: "unavailable"
                }, {
                  code: 250,
                  label: "超清 · AVC",
                  available: true,
                  mode: "live",
                  reason: ""
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING") {
            return {
              ok: true,
              payload: {
                mode: "live",
                count: 1,
                format: "flv",
                live: { site: "bilibili", roomKey: "7734200", roomId: 7734200, title: "Live Test" },
                segments: [{
                  url: liveCandidates[0].url,
                  filename: "BiliDownload/Live Test_20260628_120000.flv",
                  size: liveCandidates[0].size,
                  candidates: liveCandidates,
                  context: {
                    roomId: 7734200,
                    source: "live",
                    segmentIndex: 1,
                    segmentCount: 1,
                    format: "flv",
                    downloadMethod: "live-recording"
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
        async executeScript() {}
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const PopupUint8Array = vm.runInContext("Uint8Array", sandbox);
  const flvTag = (type, timestamp, value) => {
    const tag = new Uint8Array(16);
    tag[0] = type;
    tag[3] = 1;
    tag[4] = (timestamp >>> 16) & 0xff;
    tag[5] = (timestamp >>> 8) & 0xff;
    tag[6] = timestamp & 0xff;
    tag[7] = (timestamp >>> 24) & 0xff;
    tag[11] = value;
    tag[15] = 12;
    return tag;
  };
  const flvFragment = (tags) => {
    const header = new Uint8Array([0x46, 0x4c, 0x56, 0x01, 0x05, 0, 0, 0, 9, 0, 0, 0, 0]);
    const total = header.byteLength + tags.reduce((sum, tag) => sum + tag.byteLength, 0);
    const bytes = new Uint8Array(total);
    bytes.set(header, 0);
    let offset = header.byteLength;
    for (const tag of tags) {
      bytes.set(tag, offset);
      offset += tag.byteLength;
    }
    return new PopupUint8Array(bytes);
  };
  const flvAvcTag = (timestamp, keyframe, value) => {
    const tag = new Uint8Array(18);
    tag[0] = 9;
    tag[3] = 3;
    tag[4] = (timestamp >>> 16) & 0xff;
    tag[5] = (timestamp >>> 8) & 0xff;
    tag[6] = timestamp & 0xff;
    tag[7] = (timestamp >>> 24) & 0xff;
    tag[11] = keyframe ? 0x17 : 0x27;
    tag[12] = 1;
    tag[13] = value;
    tag[17] = 14;
    return tag;
  };
  const firstFragment = flvFragment([
    flvTag(18, 100, 1),
    flvTag(9, 100, 2),
    flvTag(8, 110, 3),
    flvTag(9, 200, 4)
  ]);
  const firstMerged = sandbox.mergeHuyaFlvFragment(firstFragment, -1, true);
  assert.equal(firstMerged.lastTimestamp, 200);
  assert.equal(firstMerged.bytes.byteLength, firstFragment.byteLength);
  const secondFragment = flvFragment([
    flvTag(18, 150, 5),
    flvTag(9, 190, 6),
    flvTag(8, 210, 7),
    flvTag(9, 240, 8)
  ]);
  const secondMerged = sandbox.mergeHuyaFlvFragment(secondFragment, 200, false);
  assert.equal(secondMerged.lastTimestamp, 240);
  assert.equal(secondMerged.bytes.byteLength, 32);
  assert.deepEqual(Array.from(secondMerged.bytes), [
    ...Array.from(flvTag(8, 210, 7)),
    ...Array.from(flvTag(9, 240, 8))
  ]);
  const interruptedFragment = new PopupUint8Array(firstFragment.byteLength + 3);
  interruptedFragment.set(firstFragment, 0);
  interruptedFragment.set([9, 0, 1], firstFragment.byteLength);
  const interruptedMerged = sandbox.mergeHuyaFlvFragment(interruptedFragment, -1, true, true);
  assert.equal(interruptedMerged.bytes.byteLength, firstFragment.byteLength);
  assert.throws(
    () => sandbox.mergeHuyaFlvFragment(interruptedFragment, -1, true),
    /截断/
  );
  const initialUrl = new URL(sandbox.huyaRecordingRequestUrl(
    "https://tx.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&codec=265&startPts=3456",
    -1,
    1
  ));
  assert.equal(initialUrl.searchParams.get("startPts"), "3456");
  const invalidInitialUrl = new URL(sandbox.huyaRecordingRequestUrl(
    "https://tx.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&startPts=invalid",
    -1,
    1
  ));
  assert.equal(invalidInitialUrl.searchParams.has("startPts"), false);
  const reconnectUrl = new URL(sandbox.huyaRecordingRequestUrl(
    "https://tx.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&codec=265",
    5000,
    2
  ));
  assert.equal(reconnectUrl.searchParams.get("startPts"), "3000");
  assert.match(reconnectUrl.searchParams.get("timeStamp"), /^\d+-2$/);
  assert.equal(reconnectUrl.searchParams.has("codec"), false);

  const gapFragment = flvFragment([
    flvAvcTag(1000, true, 1),
    flvTag(8, 1010, 2),
    flvAvcTag(1050, false, 3)
  ]);
  const normalizedGap = sandbox.mergeHuyaFlvFragment(gapFragment, 200, false);
  assert.equal(normalizedGap.timestampAdjustmentMs, 799);
  assert.equal(normalizedGap.lastTimestamp, 251);
  assert.equal(normalizedGap.sourceLastTimestamp, 1050);
  assert.equal(normalizedGap.timestampOffsetMs, 799);
  assert.deepEqual(Array.from(normalizedGap.bytes.slice(4, 8)), [0, 0, 201, 0]);
  const laterGapFragment = flvFragment([
    flvAvcTag(2000, true, 4),
    flvTag(8, 2010, 5),
    flvAvcTag(2050, false, 6)
  ]);
  const normalizedLaterGap = sandbox.mergeHuyaFlvFragment(
    laterGapFragment,
    normalizedGap.lastTimestamp,
    false,
    false,
    {
      lastSourceTimestamp: normalizedGap.sourceLastTimestamp,
      timestampOffsetMs: normalizedGap.timestampOffsetMs
    }
  );
  assert.equal(normalizedLaterGap.timestampAdjustmentMs, 949);
  assert.equal(normalizedLaterGap.timestampOffsetMs, 1748);
  assert.equal(normalizedLaterGap.lastTimestamp, 302);
  assert.equal(normalizedLaterGap.sourceLastTimestamp, 2050);

  await sandbox.initialize();
  assert.equal(bvidInput.value, "7734200");
  assert.equal(downloadButton.hidden, true);
  assert.equal(downloadAudioButton.hidden, true);
  assert.equal(liveRecordButton.hidden, false);
  assert.equal(liveRecordButton.textContent, "开始录制");
  assert.equal(qualitySelect.hidden, false);
  assert.equal(qualitySelect.value, "250");
  assert.equal(qualitySelect.children.length, 2);
  assert.equal(qualitySelect.children[0].value, "10000");
  assert.equal(qualitySelect.children[0].disabled, true);
  assert.match(qualitySelect.children[0].textContent, /当前不可用/);
  assert.equal(qualitySelect.children[1].value, "250");
  assert.equal(qualitySelect.children[1].disabled, false);

  const recording = sandbox.startLiveRecording();
  for (let index = 0; index < 20 && !pendingRead; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(liveRecordButton.textContent, "结束录制");
  assert.equal(Boolean(pendingRead), true);
  assert.equal(liveProgressDelay, 250);
  fakeNow += 1000;
  liveProgressTimer();
  assert.equal(progressPercent.textContent, "00:01");
  assert.match(progressSize.textContent, /4 B \/ --/);
  assert.match(progressPercent.textContent, /^\d{2}:\d{2}$/);
  assert.notEqual(progressPercent.textContent, "--");
  sandbox.stopLiveRecording();
  await recording;

  assert.equal(savedAnchors.length, 1);
  assert.match(progressPercent.textContent, /^\d{2}:\d{2}$/);
  assert.equal(savedAnchors[0].download, "Live Test_20260628_120000.flv");
  assert.match(statusElement.textContent, /直播录制已保存/);
  const prepareMessage = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING");
  assert.equal(prepareMessage.payload.quality, 250);
  assert.equal(prepareMessage.payload.site, "bilibili");
  assert.equal(prepareMessage.payload.roomKey, "7734200");
  assert.equal(prepareMessage.payload.tabId, 99);
  const savedDiagnostic = runtimeMessages
    .filter((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC")
    .at(-1).payload;
  assert.equal(savedDiagnostic.phase, "complete");
  assert.equal(savedDiagnostic.saved.mode, "live-flv");
  assert.equal(savedDiagnostic.saved.size, 4);

  const savedCountBeforeImmediateStop = savedAnchors.length;
  const immediateStop = sandbox.startLiveRecording();
  sandbox.stopLiveRecording();
  await immediateStop;

  assert.equal(savedAnchors.length, savedCountBeforeImmediateStop);
  assert.match(statusElement.textContent, /未保存文件/);

  vm.runInContext("navigator.deviceMemory = 0.25", sandbox);
  livePacket = new Uint8Array(sandbox.getLiveSafetyLimits().maxBytes + 1);
  const savedCountBeforeLimit = savedAnchors.length;
  await sandbox.startLiveRecording();

  assert.equal(savedAnchors.length, savedCountBeforeLimit);
  assert.match(statusElement.textContent, /自动停止/);

  vm.runInContext("navigator.deviceMemory = 4", sandbox);
  blockFirstLivePacket = true;
  pendingRead = null;
  const savedCountBeforeDurationLimit = savedAnchors.length;
  const durationLimited = sandbox.startLiveRecording();
  for (let index = 0; index < 20 && !pendingRead; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(typeof liveLimitTimer, "function");
  liveLimitTimer();
  await durationLimited;

  assert.equal(savedAnchors.length, savedCountBeforeDurationLimit);
  assert.match(statusElement.textContent, /自动停止/);

  liveCandidates = [{
    url: "https://live-primary.bilivideo.com/live/test.flv?token=1",
    kind: "primary",
    size: 0
  }, {
    url: "https://live-backup.bilivideo.com/live/test.flv?token=2",
    kind: "backup",
    size: 0
  }];
  failingLiveCandidate = liveCandidates[0].url;
  blockFirstLivePacket = true;
  pendingRead = null;
  liveLimitTimer = null;
  liveLimitDelay = 0;
  abortLiveReadWithNetworkError = true;
  fakeNow = Date.now();
  const savedCountBeforeCandidateDeadline = savedAnchors.length;
  const candidateDeadline = sandbox.startLiveRecording();
  for (let index = 0; index < 20 && !pendingRead; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(liveFetchUrls.slice(-2), liveCandidates.map((candidate) => candidate.url));
  assert.equal(typeof liveLimitTimer, "function");
  assert.equal(liveLimitDelay, sandbox.getLiveSafetyLimits().maxDurationMs - (55 * 1000));
  liveLimitTimer();
  await candidateDeadline;

  assert.equal(savedAnchors.length, savedCountBeforeCandidateDeadline);
  assert.match(statusElement.textContent, /自动停止/);
  abortLiveReadWithNetworkError = false;

  const huyaCandidates = [{
    url: "https://primary.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&startPts=1000",
    kind: "primary",
    size: 0
  }, {
    url: "https://backup.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&startPts=1000",
    kind: "backup",
    size: 0
  }];
  const huyaFetchHosts = [];
  const huyaControl = {
    canceled: false,
    paused: false,
    waiters: [],
    abortControllers: new Set(),
    liveStartedAt: Date.now(),
    liveDeadlineAt: Date.now() + 60_000,
    liveRecording: true
  };
  sandbox.setTimeout = (callback, delay) => {
    if (delay === 500 || delay === 30000) {
      callback();
    }
    return 1;
  };
  sandbox.fetch = async (url) => {
    const parsed = new URL(url);
    huyaFetchHosts.push(parsed.hostname);
    if (parsed.hostname === "primary.flv.huya.com") {
      return {
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: { get() { return "video/x-flv"; } }
      };
    }
    const backupConnection = huyaFetchHosts.filter((host) => host === "backup.flv.huya.com").length;
    let reads = 0;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get() { return "video/x-flv"; } },
      body: {
        getReader() {
          return {
            async read() {
              reads += 1;
              if (reads === 1) {
                return {
                  done: false,
                  value: backupConnection === 1 ? interruptedFragment : gapFragment
                };
              }
              if (backupConnection >= 2) {
                huyaControl.canceled = true;
              }
              return { done: true };
            }
          };
        }
      }
    };
  };
  const savedCountBeforeHuyaFallback = savedAnchors.length;
  const huyaResult = await sandbox.fetchHuyaLiveRecording(
    huyaCandidates,
    "Huya fallback.flv",
    huyaControl,
    {
      site: "huya",
      segmentIndex: 1,
      segmentCount: 1,
      candidateIndex: 1,
      candidateCount: 2
    }
  );
  assert.deepEqual(huyaFetchHosts, [
    "primary.flv.huya.com",
    "backup.flv.huya.com",
    "backup.flv.huya.com"
  ]);
  assert.equal(huyaResult.savedToDisk, true);
  assert.ok(huyaResult.receivedBytes > firstFragment.byteLength);
  assert.equal(savedAnchors.length, savedCountBeforeHuyaFallback + 1);
  assert.equal(savedAnchors.at(-1).download, "Huya fallback.flv");
});


test("background redacts signed download URLs and local paths before persisting diagnostics", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const storage = {};
  const signedUrl = "https://cdn.hdslb.test/media/video.mp4?token=secret-token&deadline=123456";
  const redirectedUrl = "https://backup.hdslb.test/media/video.mp4?sign=private-signature";
  const localPath = "C:\\Users\\Alice\\Downloads\\private-video.mp4";
  const unixPath = "/home/alice/Videos/private-unix-video.mp4";
  const fileUrl = "file:///C:/Users/Alice/Documents/private-file-video.mp4";
  const sensitiveValue = "diagnostic-token-value";

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

  const delta = sandbox.pickDownloadDelta({
    id: 42,
    url: { previous: signedUrl, current: redirectedUrl },
    finalUrl: { current: redirectedUrl },
    filename: { previous: localPath, current: "C:\\Users\\Alice\\Downloads\\renamed-video.mp4" }
  });
  assert.equal(delta.url.previous.sample, "https://cdn.hdslb.test/media/video.mp4?...");
  assert.equal(delta.url.current.sample, "https://backup.hdslb.test/media/video.mp4?...");
  assert.equal(delta.finalUrl.current.sample, "https://backup.hdslb.test/media/video.mp4?...");
  assert.equal(delta.filename.previous, "private-video.mp4");
  assert.equal(delta.filename.current, "renamed-video.mp4");

  const item = sandbox.pickDownloadItem({
    id: 42,
    url: signedUrl,
    finalUrl: redirectedUrl,
    filename: localPath,
    state: "interrupted"
  });
  assert.equal(item.filename, "private-video.mp4");

  await sandbox.setLastDiagnostic({
    phase: "interrupted",
    request: {
      media: signedUrl,
      filename: localPath,
      unixPath,
      fileUrl
    },
    latestItem: item,
    events: [{ delta }],
    accessToken: sensitiveValue,
    requestSignature: "diagnostic-signature-value",
    accessKey: "diagnostic-access-key-value",
    nested: {
      cookie: "SESSDATA=diagnostic-cookie-value",
      authorization: "Bearer diagnostic-authorization-value",
      sessionCredential: "diagnostic-session-value"
    },
    error: `Failed to fetch ${signedUrl}; token=${sensitiveValue}; signature=diagnostic-signature-text-value; Authorization: Bearer diagnostic-authorization-value; ` +
      `paths: ${localPath}, ${unixPath}, ${fileUrl}`
  });

  const persisted = JSON.stringify(storage.lastDiagnostic);
  assert.doesNotMatch(
    persisted,
    /secret-token|private-signature|diagnostic-token-value|diagnostic-signature-value|diagnostic-signature-text-value|diagnostic-access-key-value|diagnostic-cookie-value|diagnostic-authorization-value|diagnostic-session-value|Alice|\/home\/alice|file:\/\//
  );
  assert.equal(storage.lastDiagnostic.request.filename, "private-video.mp4");
  assert.equal(storage.lastDiagnostic.latestItem.filename, "private-video.mp4");
  assert.equal(storage.lastDiagnostic.accessToken, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.requestSignature, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.accessKey, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.nested.cookie, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.nested.authorization, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.nested.sessionCredential, "[Sensitive value redacted]");
  assert.equal(storage.lastDiagnostic.request.unixPath, "[local path private-unix-video.mp4]");
  assert.equal(storage.lastDiagnostic.request.fileUrl.sample, "[local path private-file-video.mp4]");

  // Reading an older diagnostic also rewrites it through the same safe boundary.
  storage.lastDiagnostic = {
    request: { media: signedUrl, filename: localPath },
    secret: "legacy-secret-value",
    error: `Failed to fetch ${redirectedUrl} at ${unixPath}`
  };
  vm.runInContext("lastDiagnostic = null", sandbox);
  const recovered = await sandbox.getLastDiagnostic();
  assert.doesNotMatch(JSON.stringify(recovered), /secret-token|private-signature|legacy-secret-value|Alice|\/home\/alice/);
  assert.doesNotMatch(JSON.stringify(storage.lastDiagnostic), /secret-token|private-signature|legacy-secret-value|Alice|\/home\/alice/);
});


test("background task snapshots redact error credentials and local paths before storage", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const storage = {};
  const windowsPath = "C:\\Users\\Alice\\Downloads\\snapshot-video.mp4";
  const unixPath = "/Users/alice/Movies/snapshot-unix-video.mp4";
  const fileUrl = "file:///C:/Users/Alice/Documents/snapshot-file-video.mp4";
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

  sandbox.rawTask = {
    id: "direct-privacy-smoke",
    state: "interrupted",
    mode: "durl",
    format: "flv",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    error: `token=task-token-value at ${unixPath}`,
    segments: [{
      index: 1,
      downloadId: 42,
      state: "interrupted",
      filename: windowsPath,
      size: 10,
      receivedBytes: 0,
      totalBytes: 10,
      candidateIndex: 1,
      candidateCount: 1,
      error: `Authorization: Bearer task-authorization-value from ${fileUrl}`,
      context: {
        bvid: "BV1KGj36QEG3",
        title: `Failed output ${windowsPath}`
      }
    }]
  };

  await vm.runInContext(
    "(async () => { directDownloadTasks.set(rawTask.id, rawTask); await persistDirectDownloadTasks(); })()",
    sandbox
  );

  const snapshot = storage.directDownloadTasks?.[0];
  assert.ok(snapshot);
  assert.equal(snapshot.error, "token=[Sensitive value redacted] at [local path snapshot-unix-video.mp4]");
  assert.equal(snapshot.segments[0].filename, "snapshot-video.mp4");
  assert.doesNotMatch(
    JSON.stringify(snapshot),
    /task-token-value|task-authorization-value|Alice|\/Users\/alice|file:\/\//
  );
});


test("popup redacts signed diagnostics before sending them or copying them", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const clipboardWrites = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  qualitySelect.value = "80";
  const signedUrl = "https://cdn.hdslb.test/media/video.mp4?token=popup-secret&deadline=123456";
  const redirectedUrl = "https://backup.hdslb.test/media/video.mp4?sign=popup-signature";
  const localPath = "C:\\Users\\Alice\\Downloads\\private-video.mp4";
  const unixPath = "/home/alice/Videos/popup-unix-video.mp4";
  const fileUrl = "file:///C:/Users/Alice/Documents/popup-file-video.mp4";
  const elements = {
    "#status": statusElement,
    "#account": textElement(),
    "#bvid": textElement(),
    "#title": textElement(),
    "#quality": qualitySelect,
    "#quality-size": textElement(),
    "#copy": buttonElement(),
    "#download": buttonElement(),
    "#download-audio": buttonElement(),
    "#live-record": buttonElement(),
    "#page-picker-toggle": buttonElement(),
    "#page-picker": panelElement(),
    "#page-list": containerElement(),
    "#page-select-all": buttonElement(),
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
  };

  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardWrites.push(value);
        }
      }
    },
    document: {
      addEventListener() {},
      querySelector(selector) {
        return elements[selector];
      }
    },
    chrome: {
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
          return { ok: true };
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const rawDiagnostic = {
    phase: "interrupted",
    request: {
      media: signedUrl,
      filename: localPath
    },
    events: [{
      delta: {
        url: { current: signedUrl },
        finalUrl: { current: redirectedUrl },
        filename: { current: localPath }
      }
    }],
    saved: {
      filename: localPath
    },
    accessToken: "popup-access-token",
    requestSignature: "popup-signature-value",
    accessKey: "popup-access-key-value",
    headers: {
      cookie: "SESSDATA=popup-cookie-value",
      authorization: "Bearer popup-authorization-value"
    },
    sessionCredential: "popup-session-value",
    outputPath: unixPath,
    localFileUrl: fileUrl,
    error: `Failed to fetch ${signedUrl}; secret=popup-error-secret; sign=popup-signature-text-value; Credential: popup-credential-value; ` +
      `paths: ${localPath}, ${unixPath}, ${fileUrl}`
  };

  const exported = sandbox.sanitizeDiagnosticForExport(rawDiagnostic);
  assert.equal(exported.accessToken, "[Sensitive value redacted]");
  assert.equal(exported.requestSignature, "[Sensitive value redacted]");
  assert.equal(exported.accessKey, "[Sensitive value redacted]");
  assert.equal(exported.headers.cookie, "[Sensitive value redacted]");
  assert.equal(exported.headers.authorization, "[Sensitive value redacted]");
  assert.equal(exported.sessionCredential, "[Sensitive value redacted]");
  assert.equal(exported.outputPath, "[local path popup-unix-video.mp4]");
  assert.equal(exported.localFileUrl.sample, "[local path popup-file-video.mp4]");
  assert.doesNotMatch(
    JSON.stringify(exported),
    /popup-access-token|popup-signature-value|popup-access-key-value|popup-cookie-value|popup-authorization-value|popup-session-value|popup-error-secret|popup-signature-text-value|popup-credential-value|Alice|\/home\/alice|file:\/\//
  );

  await sandbox.saveDiagnostic(rawDiagnostic);
  const outbound = runtimeMessages.find((message) => message.type === "BILI_DOWNLOAD_SAVE_DIAGNOSTIC");
  assert.ok(outbound);
  assert.equal(outbound.payload.request.filename, "private-video.mp4");
  assert.doesNotMatch(
    JSON.stringify(outbound.payload),
    /popup-secret|popup-signature|popup-access-token|popup-access-key-value|popup-cookie-value|popup-authorization-value|popup-session-value|popup-error-secret|popup-credential-value|Alice|\/home\/alice|file:\/\//
  );

  sandbox.rawDiagnostic = rawDiagnostic;
  sandbox.rawPage = {
    type: "video",
    bvid: "BV1KGj36QEG3",
    title: "Smoke Video",
    url: "https://www.bilibili.com/video/BV1KGj36QEG3/?token=page-secret",
    secret: "page-secret-value",
    filePath: "file:///home/alice/private-page-file.txt"
  };
  vm.runInContext("state.lastDiagnostic = rawDiagnostic; state.page = rawPage", sandbox);
  await sandbox.copyDiagnostic();

  assert.equal(clipboardWrites.length, 1);
  assert.doesNotMatch(
    clipboardWrites[0],
    /popup-secret|popup-signature|page-secret|popup-access-token|popup-access-key-value|popup-cookie-value|popup-authorization-value|popup-session-value|popup-error-secret|popup-credential-value|Alice|\/home\/alice|file:\/\//
  );
  const copied = JSON.parse(clipboardWrites[0]);
  assert.equal(copied.page.url.host, "www.bilibili.com");
  assert.equal(copied.diagnostic.saved.filename, "private-video.mp4");
  assert.equal(copied.page.filePath, "[local path private-page-file.txt]");
});


test("background error responses are message-serializable and redact diagnostics safely", async () => {
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
    context: {
      bvid: "BV1KGj36QEG3",
      sessionToken: "response-session-value",
      localPath: "/home/alice/Downloads/response-diagnostic.mp4"
    }
  };
  diagnostic.allCandidateDiagnostics = [diagnostic];
  const signedUrl = "https://cdn.hdslb.test/media/video.mp4?token=response-secret&deadline=123456";
  const localPath = "C:\\Users\\Alice\\Downloads\\response-error.mp4";
  const fileUrl = "file:///home/alice/Downloads/response-file.mp4";
  const error = new Error(
    `Download failed: SERVER_FORBIDDEN ${signedUrl}; token=response-token-value; ` +
      `Authorization: Bearer response-authorization-value; paths: ${localPath}, ${fileUrl}`
  );
  error.diagnostic = diagnostic;

  const response = sandbox.errorResponse(error);

  assert.equal(response.ok, false);
  assert.match(response.error, /Download failed: SERVER_FORBIDDEN/);
  assert.doesNotMatch(
    JSON.stringify(response),
    /response-secret|deadline=123456|response-token-value|response-authorization-value|response-session-value|Alice|\/home\/alice|file:\/\//
  );
  assert.equal(response.diagnostic.phase, "interrupted");
  assert.equal(response.diagnostic.context.sessionToken, "[Sensitive value redacted]");
  assert.equal(response.diagnostic.context.localPath, "[local path response-diagnostic.mp4]");
  assert.doesNotThrow(() => JSON.stringify(response));
});


test("background reconciles native tasks, routes progress by tab, and persists safe batch metadata", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const storage = {
    directDownloadTasks: [
      {
        taskId: "direct-complete",
        state: "in_progress",
        mode: "durl",
        tabId: 77,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        segments: [{
          index: 1,
          state: "in_progress",
          downloadId: 41,
          filename: "BiliDownload/complete.mp4",
          size: 100,
          totalBytes: 100,
          candidateIndex: 1,
          candidateCount: 2,
          context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Complete" }
        }]
      },
      {
        taskId: "direct-active",
        state: "in_progress",
        mode: "durl",
        tabId: 77,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
        segments: [{
          index: 1,
          state: "in_progress",
          downloadId: 42,
          filename: "BiliDownload/active.mp4",
          size: 200,
          totalBytes: 200,
          candidateIndex: 1,
          candidateCount: 2,
          context: { bvid: "BV1KGj36QEG3", cid: 123, quality: 80, title: "Active" }
        }]
      }
    ]
  };
  const downloadItems = new Map([
    [41, {
      id: 41,
      state: "complete",
      bytesReceived: 100,
      totalBytes: 100,
      fileSize: 100,
      filename: "C:\\Users\\Alice\\Downloads\\complete.mp4",
      url: "https://cdn.hdslb.test/complete.mp4?token=complete-secret",
      finalUrl: "https://cdn.hdslb.test/complete.mp4?token=complete-secret",
      paused: false
    }],
    [42, {
      id: 42,
      state: "in_progress",
      bytesReceived: 50,
      totalBytes: 200,
      filename: "C:\\Users\\Alice\\Downloads\\active.mp4",
      url: "https://cdn.hdslb.test/active.mp4?token=active-secret",
      finalUrl: "https://cdn.hdslb.test/active.mp4?token=active-secret",
      paused: false
    }]
  ]);
  const portMessages = [];
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
            listener({
              name: "BILI_DOWNLOAD_PROGRESS_PORT",
              postMessage(message) {
                portMessages.push(message);
              },
              onDisconnect: { addListener() {} }
            });
          }
        }
      },
      downloads: {
        search(query, callback) {
          callback([downloadItems.get(query.id)].filter(Boolean));
        },
        onChanged: { addListener() {} }
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
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener() {} }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  await sandbox.restoreDirectDownloadTasks();

  const completed = await sandbox.getDirectDownloadTask("direct-complete");
  assert.equal(completed.state, "complete");
  const active = await sandbox.listDirectDownloadTasks({ tabId: 77, activeOnly: true });
  assert.deepEqual(toPlain(active.map((task) => task.taskId)), ["direct-active"]);
  assert.ok(portMessages.some((message) => (
    message.payload.tabId === 77 && message.payload.taskId === "direct-complete" && message.payload.taskState === "complete"
  )));

  const listResponse = await sendRuntimeMessage(messageListener, {
    type: "BILI_DOWNLOAD_LIST_DIRECT_TASKS",
    payload: { tabId: 77, activeOnly: true }
  });
  assert.equal(listResponse.ok, true);
  assert.deepEqual(toPlain(listResponse.payload.map((task) => task.taskId)), ["direct-active"]);

  const batch = await sandbox.createBatchDownloadJob({
    tabId: 77,
    title: "Batch https://cdn.hdslb.test/list?token=batch-secret",
    items: [{
      bvid: "BV1KGj36QEG3",
      cid: 123,
      quality: 80,
      title: "Page https://cdn.hdslb.test/page?token=page-secret",
      candidates: [{ url: "https://cdn.hdslb.test/page?token=candidate-secret" }]
    }]
  });
  const updated = await sandbox.updateBatchDownloadJob({
    batchJobId: batch.batchJobId,
    patch: {
      state: "in_progress",
      currentIndex: 1,
      itemUpdates: [{ index: 1, state: "in_progress", directTaskId: "direct-active", attempt: 1 }]
    }
  });
  assert.equal(updated.items[0].directTaskId, "direct-active");
  const batchList = await sandbox.listBatchDownloadJobs({ tabId: 77, activeOnly: true });
  assert.equal(batchList.length, 1);
  assert.doesNotMatch(
    JSON.stringify(storage),
    /complete-secret|active-secret|batch-secret|page-secret|candidate-secret|Alice/
  );
});


test("popup automatically uses the companion for oversized DASH and explicitly enabled live recording", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const copyButton = buttonElement();
  const downloadButton = buttonElement();
  const liveRecordButton = buttonElement();
  const diagnosticButton = buttonElement();
  qualitySelect.value = "80";
  qualitySelect.children.push({ value: "80", disabled: false });
  let startSequence = 0;
  const sandbox = {
    AbortController,
    Blob,
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    navigator: { deviceMemory: 0.25, clipboard: { async writeText() {} } },
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      body: { append() {} },
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#quality": qualitySelect,
          "#copy": copyButton,
          "#download": downloadButton,
          "#live-record": liveRecordButton,
          "#diagnostic": diagnosticButton
        }[selector];
      }
    },
    chrome: {
      runtime: {
        connect() {
          return { onMessage: { addListener() {} } };
        },
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "BILI_DOWNLOAD_COMPANION_PING") {
            return { ok: true, payload: { nativeHost: "com.bili_download.stream_companion", protocolVersion: 1 } };
          }
          if (message.type === "BILI_DOWNLOAD_START_COMPANION") {
            startSequence += 1;
            return {
              ok: true,
              payload: {
                taskId: `companion-popup-${startSequence}`,
                tabId: 71,
                kind: message.payload.prepared.mode,
                title: message.payload.prepared.segments[0].context.title,
                outputName: startSequence === 1 ? "Popup Dash.mp4" : "Popup Live.flv",
                state: "complete",
                receivedBytes: 168,
                totalBytes: message.payload.prepared.mode === "dash" ? 168 : 0,
                segmentIndex: 1,
                segmentCount: 1
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_PREPARE_LIVE_RECORDING") {
            return {
              ok: true,
              payload: {
                mode: "live",
                count: 1,
                live: { roomId: "100", quality: 80, title: "Popup Live" },
                segments: [{
                  url: "https://live.example.hdslb.com/live.flv?token=popup-live-secret",
                  candidates: [{ url: "https://live.example.hdslb.com/live.flv?token=popup-live-secret" }],
                  filename: "BiliDownload/Popup Live.flv",
                  context: { roomId: "100", quality: 80, title: "Popup Live", role: "live" }
                }]
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_GET_DIAGNOSTIC") {
            return { ok: true, payload: null };
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      }
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  vm.runInContext(`
    state.tabId = 71;
    state.companionSettings = { preferDash: false, preferLive: true };
    state.live = {
      roomId: "100",
      title: "Popup Live",
      liveStatus: 1,
      qualities: [{ code: 80, available: true, mode: "live" }]
    };
    state.page = { type: "live", roomId: "100", title: "Popup Live", url: "https://live.bilibili.com/100" };
  `, sandbox);

  const automaticDashLimit = sandbox.getDashSafetyLimits().maxInputBytes;
  const dashPrepared = {
    mode: "dash",
    count: 2,
    segments: [
      {
        url: "https://video.example.hdslb.com/video.m4s?token=popup-dash-secret",
        candidates: [{ url: "https://video.example.hdslb.com/video.m4s?token=popup-dash-secret" }],
        size: automaticDashLimit,
        context: { role: "video", title: "Popup Dash" }
      },
      {
        url: "https://audio.example.hdslb.com/audio.m4s?token=popup-dash-secret",
        candidates: [{ url: "https://audio.example.hdslb.com/audio.m4s?token=popup-dash-secret" }],
        size: 1,
        context: { role: "audio", title: "Popup Dash" }
      }
    ]
  };
  const dashResult = await sandbox.downloadPreparedPayload(dashPrepared);
  assert.equal(dashResult.state, "complete");
  await sandbox.startLiveRecording();

  const starts = runtimeMessages.filter((message) => message.type === "BILI_DOWNLOAD_START_COMPANION");
  assert.equal(starts.length, 2, statusElement.textContent);
  assert.equal(starts[0].payload.prepared.mode, "dash");
  assert.equal(starts[1].payload.prepared.mode, "live");
  assert.equal(runtimeMessages.some((message) => message.type === "BILI_DOWNLOAD_COMPANION_PING"), true);
  const popupTaskState = vm.runInContext("JSON.stringify(Array.from(state.companionTasks.values()))", sandbox);
  assert.equal(popupTaskState.includes("popup-dash-secret"), false);
  assert.equal(popupTaskState.includes("popup-live-secret"), false);
  assert.match(statusElement.textContent, /增强下载/);
});


test("popup keeps task recovery tab-scoped and confirms restored batch downloads before cancellation", async () => {
  const code = await readFile("extension/src/popup.js", "utf8");
  const runtimeMessages = [];
  const statusElement = textElement();
  const qualitySelect = selectElement();
  const sandbox = {
    Date,
    Error,
    RegExp,
    String,
    URL,
    console,
    setTimeout,
    clearTimeout,
    document: {
      addEventListener() {},
      querySelector(selector) {
        return {
          "#status": statusElement,
          "#quality": qualitySelect
        }[selector];
      }
    },
    chrome: {
      runtime: {
        connect() {
          return { onMessage: { addListener() {} } };
        },
        async sendMessage(message) {
          runtimeMessages.push(message);
          if (message.type === "BILI_DOWNLOAD_CONTROL_DIRECT") {
            setImmediate(() => {
              sandbox.receiveNativeDirectTaskProgress({
                nativeDownload: true,
                taskId: message.payload.taskId,
                taskState: "canceled",
                receivedBytes: 0,
                totalBytes: 100
              });
            });
            return {
              ok: true,
              payload: {
                taskId: message.payload.taskId,
                tabId: 1,
                state: "canceling",
                receivedBytes: 0,
                totalBytes: 100
              }
            };
          }
          if (message.type === "BILI_DOWNLOAD_UPDATE_BATCH_JOB") {
            const patch = message.payload.patch;
            return {
              ok: true,
              payload: {
                batchJobId: message.payload.batchJobId,
                tabId: 1,
                title: "Recovered batch",
                state: patch.state,
                error: patch.error || "",
                currentIndex: patch.currentIndex || 1,
                count: 2,
                completedCount: 0,
                items: (patch.itemUpdates || []).map((item) => ({ ...item }))
              }
            };
          }
          throw new Error(`unexpected runtime message: ${message.type}`);
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  vm.runInContext(`
    state.tabId = 1;
    state.batchJobs.set("batch-paused", { jobId: "batch-paused", tabId: 1, state: "paused", updatedAt: "2026-08-09T00:00:00.000Z" });
    state.nativeDirectTasks.set("direct-tab-1", { taskId: "direct-tab-1", tabId: 1, state: "in_progress" });
    state.nativeDirectTasks.set("direct-tab-2", { taskId: "direct-tab-2", tabId: 2, state: "in_progress" });
    state.nativeDirectTasks.set("direct-tab-unknown", { taskId: "direct-tab-unknown", tabId: 0, state: "in_progress" });
  `, sandbox);

  await sandbox.resumeVisibleBatchJobs();
  assert.equal(runtimeMessages.length, 0, "a paused batch must not auto-resume after reopening the panel");
  const visibleDirectIds = vm.runInContext(
    "JSON.stringify(visibleTaskCenterItems().filter((entry) => entry.kind === 'direct').map((entry) => entry.item.taskId))",
    sandbox
  );
  assert.deepEqual(JSON.parse(visibleDirectIds), ["direct-tab-1"]);

  vm.runInContext(`
    state.batchJobs.set("batch-restored", {
      jobId: "batch-restored",
      tabId: 1,
      title: "Recovered batch",
      state: "in_progress",
      currentIndex: 1,
      items: [
        { index: 1, state: "in_progress", directTaskId: "direct-restored-a" },
        { index: 2, state: "in_progress", directTaskId: "direct-restored-b" }
      ]
    });
    state.nativeDirectTasks.set("direct-restored-a", { taskId: "direct-restored-a", tabId: 1, state: "in_progress" });
    state.nativeDirectTasks.set("direct-restored-b", { taskId: "direct-restored-b", tabId: 1, state: "in_progress" });
  `, sandbox);
  await sandbox.cancelBatchJob("batch-restored");

  const controlIndexes = runtimeMessages
    .map((message, index) => ({ type: message.type, index }))
    .filter((entry) => entry.type === "BILI_DOWNLOAD_CONTROL_DIRECT")
    .map((entry) => entry.index);
  const updateIndex = runtimeMessages.findIndex((message) => message.type === "BILI_DOWNLOAD_UPDATE_BATCH_JOB");
  assert.equal(controlIndexes.length, 2);
  assert.ok(controlIndexes.every((index) => index < updateIndex));
  const finalUpdate = runtimeMessages[updateIndex];
  assert.equal(finalUpdate.payload.patch.state, "canceled");
  assert.deepEqual(
    JSON.parse(JSON.stringify(finalUpdate.payload.patch.itemUpdates.map((item) => item.state))),
    ["canceled", "canceled"]
  );
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


function createMockBatchJobHandler() {
  const jobs = new Map();
  let sequence = 0;
  const snapshot = (job) => ({
    batchJobId: job.batchJobId,
    tabId: job.tabId,
    title: job.title,
    state: job.state,
    error: job.error || "",
    currentIndex: job.currentIndex,
    count: job.items.length,
    completedCount: job.items.filter((item) => item.state === "complete").length,
    items: job.items.map((item) => ({ ...item }))
  });

  return (message) => {
    if (message.type === "BILI_DOWNLOAD_LIST_DIRECT_TASKS") {
      return { ok: true, payload: [] };
    }
    if (message.type === "BILI_DOWNLOAD_LIST_BATCH_JOBS") {
      const tabId = Number(message.payload?.tabId) || 0;
      return {
        ok: true,
        payload: Array.from(jobs.values())
          .filter((job) => !tabId || job.tabId === tabId)
          .map(snapshot)
      };
    }
    if (message.type === "BILI_DOWNLOAD_CREATE_BATCH_JOB") {
      sequence += 1;
      const job = {
        batchJobId: `batch-test-${sequence}`,
        tabId: Number(message.payload?.tabId) || 0,
        title: String(message.payload?.title || ""),
        state: "queued",
        error: "",
        currentIndex: 1,
        items: (message.payload?.items || []).map((item, index) => ({
          ...item,
          index: index + 1,
          state: "queued",
          error: "",
          directTaskId: "",
          attempt: 0
        }))
      };
      jobs.set(job.batchJobId, job);
      return { ok: true, payload: snapshot(job) };
    }
    if (message.type === "BILI_DOWNLOAD_GET_BATCH_JOB") {
      const job = jobs.get(String(message.payload?.batchJobId || ""));
      return { ok: true, payload: job ? snapshot(job) : null };
    }
    if (message.type === "BILI_DOWNLOAD_UPDATE_BATCH_JOB") {
      const job = jobs.get(String(message.payload?.batchJobId || ""));
      if (!job) {
        return { ok: false, error: "mock batch job was not found" };
      }
      const patch = message.payload?.patch || {};
      for (const key of ["state", "error", "currentIndex"]) {
        if (Object.hasOwn(patch, key)) {
          job[key] = patch[key];
        }
      }
      for (const itemPatch of patch.itemUpdates || []) {
        const item = job.items[Number(itemPatch.index) - 1];
        if (item) {
          Object.assign(item, itemPatch);
        }
      }
      return { ok: true, payload: snapshot(job) };
    }
    return null;
  };
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


async function backgroundUnitSandbox(overrides = {}) {
  const code = await readFile("extension/src/background.js", "utf8");
  const sandbox = {
    Array,
    Date,
    Error,
    Number,
    Promise,
    Set,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    setTimeout,
    location: {
      href: "https://www.douyu.com/999001",
      origin: "https://www.douyu.com",
      pathname: "/999001"
    },
    fetch: overrides.fetch || (async () => {
      throw new Error("unexpected fixture fetch");
    }),
    chrome: {
      runtime: {
        lastError: null,
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
        onInstalled: { addListener() {} }
      },
      declarativeNetRequest: {
        onRuleMatchedDebug: { addListener() {} }
      },
      storage: {
        local: {
          async get() { return {}; },
          async set() {}
        }
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}


function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
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

