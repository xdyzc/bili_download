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

  for (const id of ["status", "bvid", "copy", "title", "quality", "download"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});


test("background loads qualities and starts direct browser downloads", async () => {
  const code = await readFile("extension/src/background.js", "utf8");
  const downloadOptions = [];
  const fetchUrls = [];

  const sandbox = {
    Array,
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
      downloads: {
        download(options, callback) {
          downloadOptions.push(options);
          callback(downloadOptions.length);
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
  assert.ok(fetchUrls.some((url) => url.includes("fnval=0")));
});


function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload
  };
}
