import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const EXTENSION_DIRECTORY = resolve(import.meta.dirname, "..");
const CDP_CONNECT_TIMEOUT_MS = 15_000;
const TARGET_TIMEOUT_MS = 12_000;
const COMMAND_TIMEOUT_MS = 8_000;
const PROCESS_OUTPUT_LIMIT = 8_000;
const ALLOWED_MEDIA_RESOURCE_TYPES = ["xmlhttprequest", "media", "other"];
const DISALLOWED_MEDIA_RESOURCE_TYPES = ["main_frame", "sub_frame", "image", "object"];

test("unpacked Chromium loads the extension, compiles narrowed DNR rules, and renders the side panel", { timeout: 60_000 }, async (t) => {
  const browser = findChromiumExecutable();
  if (!browser.path) {
    t.skip(browser.skipReason);
    return;
  }

  if (typeof WebSocket !== "function") {
    throw new Error("The unpacked Chromium smoke test requires Node.js with a global WebSocket implementation (Node.js 22 or newer).");
  }

  const profileDirectory = await mkdtemp(join(tmpdir(), "bili-download-unpacked-smoke-"));
  const debuggingPort = await reserveLoopbackPort();
  let browserProcess = null;
  let cdp = null;
  let readOutput = () => "";

  try {
    const launched = launchChromium({
      executable: browser.path,
      profileDirectory,
      debuggingPort
    });
    browserProcess = launched.process;
    readOutput = launched.output;

    const endpoint = await waitForDebugEndpoint({
      port: debuggingPort,
      browserProcess,
      output: readOutput
    });
    cdp = await CdpConnection.open(endpoint.webSocketDebuggerUrl);

    const loadedExtension = await loadUnpackedExtension(cdp, browser);
    if (!loadedExtension.id) {
      t.skip(loadedExtension.skipReason);
      return;
    }
    const extensionId = loadedExtension.id;
    // An MV3 service worker is intentionally short-lived. Loading the side
    // panel first gives the extension a real runtime client and lets a
    // harmless runtime message prove that background.js can wake up, without
    // reaching Bilibili or starting a media download.
    const popupTarget = await cdp.send("Target.createTarget", {
      url: `chrome-extension://${extensionId}/src/popup.html`
    });
    assert.match(extensionId, /^[a-z]{32}$/i, "the unpacked extension should expose a Chrome extension id");

    const popupSession = await attachToTarget(cdp, popupTarget.targetId);
    let popupState;
    let extensionState;
    let responsiveStates;
    try {
      popupState = await waitForCondition(async () => {
        const value = await evaluateInSession(cdp, popupSession, `
          (() => {
            const requiredIds = [
              "status",
              "account-label",
              "page-id-label",
              "quality",
              "download",
              "download-audio",
              "live-record",
              "progress",
              "diagnostic"
            ];
            return {
              readyState: document.readyState,
              extensionId: globalThis.chrome?.runtime?.id || "",
              chromeType: typeof globalThis.chrome,
              title: document.title,
              text: document.body?.innerText?.slice(0, 300) || "",
              missing: requiredIds.filter((id) => !document.getElementById(id))
            };
          })()
        `);
        return value.readyState === "complete" ? value : null;
      }, TARGET_TIMEOUT_MS, "the side-panel document to finish loading");

      if (popupState.extensionId !== extensionId) {
        const reason = `The detected browser opened chrome-extension:// content without the extension runtime (${JSON.stringify(popupState)}).`;
        if (!browser.explicit && isBrowserBlockedExtensionPage(popupState)) {
          t.skip(`${reason} Set BILI_CHROMIUM_EXECUTABLE to a Chrome for Testing or compatible Chromium build to require this smoke test.`);
          return;
        }
        throw new Error(reason);
      }

      extensionState = await evaluateInSession(cdp, popupSession, `
        (async () => {
          const manifest = chrome.runtime.getManifest();
          let backgroundPing;
          try {
            backgroundPing = await chrome.runtime.sendMessage({ type: "BILI_DOWNLOAD_GET_DIAGNOSTIC" });
          } catch (error) {
            backgroundPing = { ok: false, error: String(error && error.message || error) };
          }
          const types = ${JSON.stringify([...ALLOWED_MEDIA_RESOURCE_TYPES, ...DISALLOWED_MEDIA_RESOURCE_TYPES])};
          const scenarios = [
            { name: "bilibili", url: "https://smoke.hdslb.com/media/unpacked-check.mp4", initiator: "https://www.bilibili.com" },
            { name: "douyu", url: "https://smoke.douyucdn.cn/live/unpacked-check.flv", initiator: "https://www.douyu.com" },
            { name: "huya", url: "https://smoke.flv.huya.com/src/unpacked-check.flv", initiator: "https://www.huya.com" },
            { name: "huya-redirect", url: "https://smoke.mobgslb.tbcache.com/src/unpacked-check.flv", initiator: "https://www.huya.com" }
          ];
          const matchResults = await Promise.all(scenarios.flatMap((scenario) => types.map(async (type) => {
            try {
              const result = await chrome.declarativeNetRequest.testMatchOutcome({
                url: scenario.url,
                type,
                initiator: scenario.initiator,
                tabId: -1
              });
              return {
                name: scenario.name,
                type,
                matchedRules: (result.matchedRules || []).map((rule) => ({
                  ruleId: rule.ruleId,
                  rulesetId: rule.rulesetId
                }))
              };
            } catch (error) {
              return { name: scenario.name, type, error: String(error && error.message || error) };
            }
          })));

          return {
            id: chrome.runtime.id,
            version: manifest.version,
            permissions: manifest.permissions || [],
            enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
            backgroundPing,
            matchResults
          };
        })()
      `);

      responsiveStates = [];
      await cdp.send("Page.enable", {}, popupSession);
      for (const width of [440, 320]) {
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false
        }, popupSession);
        const layout = await evaluateInSession(cdp, popupSession, `
          (() => {
            document.getElementById("status").textContent = "正在读取一个很长的直播间标题，状态文字应当自然换行且不能遮挡后续控件";
            document.getElementById("title").value = "这是一个用于检查窄侧栏布局的很长直播间标题 Fixture Long Live Room Title";
            document.getElementById("account").textContent = "一个很长的主播名称 Fixture Anchor Name";
            const ids = ["status", "account", "bvid", "title", "quality", "download", "live-record"];
            return {
              width: innerWidth,
              clientWidth: document.documentElement.clientWidth,
              scrollWidth: document.documentElement.scrollWidth,
              boxes: ids.map((id) => {
                const rect = document.getElementById(id).getBoundingClientRect();
                return { id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
              })
            };
          })()
        `);
        const screenshot = await cdp.send("Page.captureScreenshot", { format: "png" }, popupSession);
        responsiveStates.push({ ...layout, screenshotBytes: screenshot.data?.length || 0 });
      }
    } finally {
      await detachTarget(cdp, popupSession);
    }

    assert.equal(popupState.extensionId, extensionId);
    assert.deepEqual(popupState.missing, []);
    assert.equal(extensionState.id, extensionId);
    assert.equal(extensionState.permissions.includes("activeTab"), false, "fixed Bilibili host permissions make activeTab unnecessary");
    assert.deepEqual(extensionState.enabledRulesets.sort(), ["bili_media_headers", "live_media_headers"]);
    assert.equal(extensionState.backgroundPing?.ok, true, `background.js should respond to a harmless message: ${extensionState.backgroundPing?.error || "no response"}`);

    const expectedRules = {
      bilibili: { ruleId: 3, rulesetId: "bili_media_headers" },
      douyu: { ruleId: 101, rulesetId: "live_media_headers" },
      huya: { ruleId: 102, rulesetId: "live_media_headers" },
      "huya-redirect": { ruleId: 103, rulesetId: "live_media_headers" }
    };
    for (const [name, expectedRule] of Object.entries(expectedRules)) {
      for (const resourceType of ALLOWED_MEDIA_RESOURCE_TYPES) {
        const result = extensionState.matchResults.find((item) => item.name === name && item.type === resourceType);
        assert.equal(result?.error, undefined, `DNR should evaluate ${name} ${resourceType}: ${result?.error || "unknown error"}`);
        assert.deepEqual(result?.matchedRules, [expectedRule]);
      }
      for (const resourceType of DISALLOWED_MEDIA_RESOURCE_TYPES) {
        const result = extensionState.matchResults.find((item) => item.name === name && item.type === resourceType);
        assert.equal(result?.error, undefined, `DNR should evaluate ${name} ${resourceType}: ${result?.error || "unknown error"}`);
        assert.deepEqual(result?.matchedRules, [], `${name} ${resourceType} must not receive media-header overrides`);
      }
    }
    for (const responsive of responsiveStates) {
      assert.equal(responsive.scrollWidth <= responsive.clientWidth, true, `${responsive.width}px layout must not overflow horizontally`);
      assert.ok(responsive.screenshotBytes > 1000, `${responsive.width}px layout should render a non-empty screenshot`);
      for (const box of responsive.boxes) {
        assert.ok(box.left >= 0 && box.right <= responsive.clientWidth, `${box.id} must remain inside the ${responsive.width}px viewport`);
        assert.ok(box.bottom >= box.top, `${box.id} must have a stable box`);
      }
    }

  } catch (error) {
    const outputTail = readOutput();
    const details = outputTail ? `\nChromium output (tail):\n${outputTail}` : "";
    throw new Error(`Unpacked Chromium extension smoke test failed: ${error.message}${details}`, { cause: error });
  } finally {
    await closeChromium({ cdp, browserProcess });
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});

function findChromiumExecutable() {
  const explicit = process.env.BILI_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || process.env.EDGE_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`The explicitly configured Chromium executable does not exist: ${explicit}`);
    }
    return { path: explicit, explicit: true };
  }

  const candidates = [
    join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    join(process.env.ProgramFiles || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "Application", "msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  const path = candidates.find((candidate) => existsSync(candidate));
  if (path) {
    return { path, explicit: false };
  }

  return {
    path: "",
    skipReason: "No Chrome, Edge, or Chromium executable was found. Set BILI_CHROMIUM_EXECUTABLE to run this unpacked-extension smoke test."
  };
}

async function loadUnpackedExtension(cdp, browser) {
  // Modern branded Chromium builds can ignore --load-extension. CDP provides
  // an explicit test-only loading route, so prefer it when the command-line
  // launch did not create our worker target.
  const existing = await findExtensionServiceWorker(cdp);
  if (existing) {
    return { id: extensionIdFromUrl(existing.url) };
  }

  try {
    const result = await cdp.send("Extensions.loadUnpacked", { path: EXTENSION_DIRECTORY });
    if (typeof result.id === "string" && result.id) {
      return { id: result.id };
    }
    throw new Error("Chromium did not return an extension id.");
  } catch (error) {
    if (browser.explicit || !isUnsupportedUnpackedLoadingError(error)) {
      throw new Error(`Chromium could not load the unpacked extension through CDP: ${error.message}`);
    }
    return {
      id: "",
      skipReason: `The detected browser cannot load an unpacked extension in this environment (${error.message}). Set BILI_CHROMIUM_EXECUTABLE to a Chrome for Testing or compatible Chromium build to require this test.`
    };
  }
}

function isBrowserBlockedExtensionPage(popupState) {
  const text = `${popupState?.title || ""}\n${popupState?.text || ""}`;
  return /ERR_BLOCKED_BY_CLIENT|blocked by (?:Chrome|the client)|已被(?: Chrome)?阻止|已被屏蔽/i.test(text);
}

function isUnsupportedUnpackedLoadingError(error) {
  const text = String(error?.message || error || "");
  return /Unknown method|wasn't found|not supported|not implemented|extension loading (?:is )?(?:blocked|disabled|not allowed)|load-extension.*(?:blocked|disabled|not allowed)/i.test(text);
}

async function findExtensionServiceWorker(cdp) {
  const result = await cdp.send("Target.getTargets");
  return (result.targetInfos || []).find((target) => (
    target.type === "service_worker" &&
    /^chrome-extension:\/\/[a-z]{32}\/src\/background\.js$/i.test(target.url || "")
  )) || null;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });
  const address = server.address();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a loopback debugging port for Chromium.");
  }
  return address.port;
}

function launchChromium({ executable, profileDirectory, debuggingPort }) {
  const browserProcess = spawn(executable, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    // Chromium 137+ can ignore --load-extension in branded builds unless this
    // explicitly restores the command-line test hook. Chrome for Testing does
    // not need the flag, but it is harmless there and keeps Edge usable in CI.
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--enable-unsafe-extension-debugging",
    "--disable-extensions-file-access-check",
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    `--disable-extensions-except=${EXTENSION_DIRECTORY}`,
    `--load-extension=${EXTENSION_DIRECTORY}`,
    "about:blank"
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let output = "";
  const append = (chunk) => {
    output = `${output}${String(chunk)}`.slice(-PROCESS_OUTPUT_LIMIT);
  };
  browserProcess.stdout?.on("data", append);
  browserProcess.stderr?.on("data", append);

  return { process: browserProcess, output: () => output };
}

async function waitForDebugEndpoint({ port, browserProcess, output }) {
  const url = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + CDP_CONNECT_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null || browserProcess.signalCode) {
      throw new Error(`Chromium exited before opening its debugging endpoint (code ${browserProcess.exitCode}, signal ${browserProcess.signalCode || "none"}). ${output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const endpoint = await response.json();
        if (endpoint.webSocketDebuggerUrl) {
          return endpoint;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw new Error(`Timed out waiting for Chromium's debugging endpoint at ${url}. ${lastError?.message || ""}`);
}

async function waitForCondition(readValue, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await readValue();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError.message}` : ""}`);
}

async function attachToTarget(cdp, targetId) {
  const result = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  if (!result.sessionId) {
    throw new Error(`Could not attach to Chromium target ${targetId}.`);
  }
  return result.sessionId;
}

async function detachTarget(cdp, sessionId) {
  if (!cdp || !sessionId) {
    return;
  }
  try {
    await cdp.send("Target.detachFromTarget", { sessionId });
  } catch (_error) {
    // The target can disappear while Chromium is closing; nothing remains to detach.
  }
}

async function evaluateInSession(cdp, sessionId, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId);
  if (result.exceptionDetails) {
    const exception = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "unknown Runtime.evaluate error";
    throw new Error(exception);
  }
  return result.result?.value;
}

function extensionIdFromUrl(url) {
  const match = String(url || "").match(/^chrome-extension:\/\/([a-z]{32})\//i);
  return match?.[1] || "";
}

async function closeChromium({ cdp, browserProcess }) {
  if (cdp) {
    try {
      await cdp.send("Browser.close");
    } catch (_error) {
      // Closing a browser normally closes the CDP socket before it can respond.
    }
    cdp.close();
  }

  if (!browserProcess || browserProcess.exitCode !== null || browserProcess.signalCode) {
    return;
  }

  await Promise.race([once(browserProcess, "exit"), delay(3_000)]);
  if (browserProcess.exitCode === null && !browserProcess.signalCode) {
    browserProcess.kill();
    await Promise.race([once(browserProcess, "exit"), delay(3_000)]);
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

class CdpConnection {
  static async open(url) {
    const connection = new CdpConnection(url);
    await connection.connect();
    return connection;
  }

  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to CDP at ${this.url}.`)), COMMAND_TIMEOUT_MS);
      this.socket.addEventListener("open", () => {
        clearTimeout(timeout);
        resolvePromise();
      }, { once: true });
      this.socket.addEventListener("error", (event) => {
        clearTimeout(timeout);
        reject(event.error || new Error(`Could not connect to CDP at ${this.url}.`));
      }, { once: true });
    });

    this.socket.addEventListener("message", (event) => this.handleMessage(event));
    this.socket.addEventListener("close", () => this.rejectPending(new Error("CDP socket closed.")));
    this.socket.addEventListener("error", (event) => this.rejectPending(event.error || new Error("CDP socket error.")));
  }

  send(method, params = {}, sessionId = "") {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP socket is not open while sending ${method}.`));
    }
    const id = ++this.nextId;
    const payload = { id, method, params };
    if (sessionId) {
      payload.sessionId = sessionId;
    }
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for CDP command ${method}.`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve: resolvePromise, reject, timeout });
      this.socket.send(JSON.stringify(payload));
    });
  }

  close() {
    this.rejectPending(new Error("CDP connection closed."));
    try {
      this.socket?.close();
    } catch (_error) {
      // The browser may have already closed the socket.
    }
  }

  handleMessage(event) {
    let message;
    try {
      const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      message = JSON.parse(text);
    } catch (_error) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) {
      pending.reject(new Error(`${message.error.message || "CDP command failed"}${message.error.data ? `: ${message.error.data}` : ""}`));
      return;
    }
    pending.resolve(message.result || {});
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
