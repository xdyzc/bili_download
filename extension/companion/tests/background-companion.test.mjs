import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const BACKGROUND_PATH = new URL("../../src/background.js", import.meta.url);
const HOST = "com.bili_download.stream_companion";
const STORAGE_KEY = "companionDownloadTasks";

function eventHub() {
  const listeners = new Set();
  return {
    addListener(listener) {
      listeners.add(listener);
    },
    removeListener(listener) {
      listeners.delete(listener);
    },
    emit(...args) {
      for (const listener of [...listeners]) {
        listener(...args);
      }
    }
  };
}

function createNativePort() {
  const port = {
    onMessage: eventHub(),
    onDisconnect: eventHub(),
    sent: [],
    disconnected: false,
    postMessage(message) {
      this.sent.push(structuredClone(message));
    },
    disconnect() {
      if (this.disconnected) {
        return;
      }
      this.disconnected = true;
      this.onDisconnect.emit();
    },
    emit(message) {
      this.onMessage.emit(structuredClone(message));
    }
  };
  return port;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function waitFor(predicate, message = "Condition was not reached") {
  for (let index = 0; index < 50; index += 1) {
    if (await predicate()) {
      return;
    }
    await flush();
  }
  throw new Error(message);
}

async function createHarness({ connectNative, fakeTimers = false } = {}) {
  const code = await readFile(BACKGROUND_PATH, "utf8");
  const storage = {};
  const listeners = {
    message: null,
    connect: null
  };
  const nativePorts = [];
  const timers = [];
  const setTimer = fakeTimers
    ? (callback, delay) => {
      const timer = { callback, delay, cleared: false };
      timers.push(timer);
      return timer;
    }
    : setTimeout;
  const clearTimer = fakeTimers
    ? (timer) => {
      if (timer) {
        timer.cleared = true;
      }
    }
    : clearTimeout;
  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: eventHub(),
      onMessage: {
        addListener(listener) {
          listeners.message = listener;
        }
      },
      onConnect: {
        addListener(listener) {
          listeners.connect = listener;
        }
      },
      connectNative(host) {
        if (connectNative) {
          return connectNative(host, nativePorts);
        }
        const port = createNativePort();
        nativePorts.push(port);
        return port;
      }
    },
    action: {
      onClicked: eventHub()
    },
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      }
    },
    downloads: {
      onChanged: eventHub()
    },
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") {
            return { [key]: structuredClone(storage[key]) };
          }
          return structuredClone(storage);
        },
        async set(values) {
          for (const [key, value] of Object.entries(values || {})) {
            storage[key] = structuredClone(value);
          }
        }
      }
    },
    declarativeNetRequest: {
      onRuleMatchedDebug: eventHub()
    }
  };
  const sandbox = {
    chrome,
    URL,
    URLSearchParams,
    Blob,
    console,
    structuredClone,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    setImmediate,
    fetch: async () => {
      throw new Error("Unexpected fetch in this companion background test.");
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "background.js" });
  return { chrome, listeners, nativePorts, sandbox, storage, timers };
}

function sendRuntimeMessage(listener, message) {
  return new Promise((resolve, reject) => {
    try {
      const keepAlive = listener(message, {}, (response) => resolve(structuredClone(response)));
      if (keepAlive !== true) {
        resolve(null);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function dashPrepared(token = "first-token") {
  return {
    mode: "dash",
    format: "dash",
    segments: [
      {
        size: 123,
        candidates: [
          { url: `https://upgcxcode.example.hdslb.com/video.m4s?token=${token}`, kind: "primary" }
        ],
        context: {
          role: "video",
          bvid: "BV1KGj36QEG3",
          cid: 123,
          quality: 80,
          title: "Companion smoke video",
          source: "video",
          format: "dash"
        }
      },
      {
        size: 45,
        candidates: [
          { url: `https://upgcxcode.example.hdslb.com/audio.m4s?token=${token}`, kind: "primary" }
        ],
        context: {
          role: "audio",
          bvid: "BV1KGj36QEG3",
          cid: 123,
          quality: 80,
          title: "Companion smoke video",
          source: "video",
          format: "dash"
        }
      }
    ]
  };
}

function connectProgressPort(harness) {
  const messages = [];
  const port = {
    name: "BILI_DOWNLOAD_PROGRESS_PORT",
    onDisconnect: eventHub(),
    postMessage(message) {
      messages.push(structuredClone(message));
    }
  };
  harness.listeners.connect(port);
  return messages;
}

test("background companion starts DASH privately, relays progress, refreshes, cancels, and resumes", async () => {
  const harness = await createHarness();
  const progressMessages = connectProgressPort(harness);
  const startPromise = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: {
      tabId: 99,
      prepared: dashPrepared("signed-start-token"),
      maxBytes: 8 * 1024 * 1024 * 1024
    }
  });
  await waitFor(() => harness.nativePorts.length === 1 && harness.nativePorts[0].sent.length === 1);
  const native = harness.nativePorts[0];
  const startMessage = native.sent[0];
  assert.equal(startMessage.type, "start_dash");
  assert.equal(startMessage.payload.video.sources[0].includes("signed-start-token"), true);
  assert.equal(startMessage.payload.audio.sources[0].includes("signed-start-token"), true);

  native.emit({
    version: 1,
    type: "accepted",
    requestId: startMessage.requestId,
    taskId: startMessage.taskId,
    kind: "dash",
    outputName: "Companion smoke video_80.mp4"
  });
  const started = await startPromise;
  assert.equal(started.ok, true);
  assert.equal(started.payload.taskId, startMessage.taskId);
  assert.equal(started.payload.tabId, 99);
  assert.equal(started.payload.kind, "dash");
  assert.equal(started.payload.state, "in_progress");
  assert.equal(started.payload.outputName, "Companion smoke video_80.mp4");

  const storedAfterStart = JSON.stringify(harness.storage[STORAGE_KEY]);
  const returnedAfterStart = JSON.stringify(started.payload);
  assert.equal(storedAfterStart.includes("signed-start-token"), false);
  assert.equal(returnedAfterStart.includes("signed-start-token"), false);
  assert.equal(storedAfterStart.includes("https://"), false);
  assert.equal(returnedAfterStart.includes("https://"), false);

  native.emit({
    version: 1,
    type: "progress",
    taskId: startMessage.taskId,
    kind: "dash",
    phase: "download_video",
    receivedBytes: 77,
    totalBytes: 123
  });
  await waitFor(() => progressMessages.some((message) => (
    message.payload?.companionDownload && message.payload?.receivedBytes === 77
  )));
  const progress = progressMessages.findLast((message) => message.payload?.receivedBytes === 77);
  assert.equal(progress.payload.tabId, 99);
  assert.equal(progress.payload.taskId, startMessage.taskId);
  assert.equal(progress.payload.companionDownload, true);
  assert.equal(progress.payload.companionKind, "dash");
  assert.equal(progress.payload.receivedBytes, 77);
  assert.equal(JSON.stringify(progress).includes("https://"), false);

  harness.sandbox.__freshPrepared = dashPrepared("fresh-refresh-token");
  vm.runInContext("prepareDirectDownload = async () => __freshPrepared;", harness.sandbox);
  native.emit({
    version: 1,
    type: "refresh_required",
    taskId: startMessage.taskId,
    kind: "dash",
    reason: "source_expired"
  });
  await waitFor(() => native.sent.some((message) => message.type === "refresh_dash_sources"));
  const refreshMessage = native.sent.find((message) => message.type === "refresh_dash_sources");
  assert.equal(refreshMessage.taskId, startMessage.taskId);
  assert.equal(refreshMessage.payload.video.sources[0].includes("fresh-refresh-token"), true);
  assert.equal(JSON.stringify(harness.storage[STORAGE_KEY]).includes("fresh-refresh-token"), false);
  native.emit({
    version: 1,
    type: "sources_refreshed",
    requestId: refreshMessage.requestId,
    taskId: startMessage.taskId,
    kind: "dash"
  });
  await flush();

  const cancelResponse = await sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_CONTROL_COMPANION_TASK",
    payload: { taskId: startMessage.taskId, action: "cancel" }
  });
  assert.equal(cancelResponse.ok, true);
  const cancelMessage = native.sent.find((message) => message.type === "cancel");
  assert.equal(cancelMessage.taskId, startMessage.taskId);
  native.emit({
    version: 1,
    type: "canceled",
    taskId: startMessage.taskId,
    kind: "dash",
    bytesWritten: 122
  });
  await flush();
  const canceled = await sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
    payload: { taskId: startMessage.taskId }
  });
  assert.equal(canceled.payload.state, "canceled");
  assert.equal(canceled.payload.recoverable, false);

  // Start a second task to prove a service-side disconnect has no source data
  // to restore and that a resume fetches a new runtime preparation on a new port.
  const secondStart = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: { tabId: 99, prepared: dashPrepared("second-start-token") }
  });
  await waitFor(() => harness.nativePorts.length === 2 && harness.nativePorts[1].sent.length === 1);
  const secondNative = harness.nativePorts[1];
  const secondStartMessage = secondNative.sent[0];
  secondNative.emit({
    version: 1,
    type: "accepted",
    requestId: secondStartMessage.requestId,
    taskId: secondStartMessage.taskId,
    kind: "dash"
  });
  await secondStart;
  secondNative.disconnect();
  await waitFor(async () => {
    const response = await sendRuntimeMessage(harness.listeners.message, {
      type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
      payload: { taskId: secondStartMessage.taskId }
    });
    return response.payload?.state === "interrupted";
  }, "disconnect should mark the task interrupted");
  const interrupted = await sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
    payload: { taskId: secondStartMessage.taskId }
  });
  assert.equal(interrupted.payload.state, "interrupted");
  assert.equal(interrupted.payload.recoverable, true);
  assert.equal(JSON.stringify(harness.storage[STORAGE_KEY]).includes("second-start-token"), false);

  harness.sandbox.__freshPrepared = dashPrepared("resume-fresh-token");
  const resumePromise = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_CONTROL_COMPANION_TASK",
    payload: { taskId: secondStartMessage.taskId, action: "resume" }
  });
  await waitFor(() => harness.nativePorts.length === 3 && harness.nativePorts[2].sent.length === 1);
  const resumedNative = harness.nativePorts[2];
  const resumedStartMessage = resumedNative.sent[0];
  assert.equal(resumedStartMessage.taskId, secondStartMessage.taskId);
  assert.equal(resumedStartMessage.payload.video.sources[0].includes("resume-fresh-token"), true);
  resumedNative.emit({
    version: 1,
    type: "accepted",
    requestId: resumedStartMessage.requestId,
    taskId: secondStartMessage.taskId,
    kind: "dash"
  });
  const resumed = await resumePromise;
  assert.equal(resumed.ok, true);
  assert.equal(resumed.payload.taskId, secondStartMessage.taskId);
  assert.equal(JSON.stringify(harness.storage[STORAGE_KEY]).includes("resume-fresh-token"), false);
  resumedNative.emit({
    version: 1,
    type: "completed",
    taskId: secondStartMessage.taskId,
    kind: "dash",
    bytesWritten: 168
  });
  await flush();
  const completed = await sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
    payload: { taskId: secondStartMessage.taskId }
  });
  assert.equal(completed.payload.state, "complete");
});

test("background companion shares one native host across concurrent tasks", async () => {
  const harness = await createHarness();
  const firstPromise = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: { tabId: 1, prepared: dashPrepared("first-concurrent") }
  });
  const secondPromise = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: { tabId: 2, prepared: dashPrepared("second-concurrent") }
  });

  await waitFor(() => harness.nativePorts.length === 1 && harness.nativePorts[0].sent.length === 2);
  const native = harness.nativePorts[0];
  const [firstStart, secondStart] = native.sent;
  for (const message of [firstStart, secondStart]) {
    native.emit({
      version: 1,
      type: "accepted",
      requestId: message.requestId,
      taskId: message.taskId,
      kind: "dash"
    });
  }
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(harness.nativePorts.length, 1);

  native.emit({ version: 1, type: "completed", taskId: firstStart.taskId, kind: "dash" });
  await flush();
  assert.equal(native.disconnected, false, "one completed task must not stop its sibling");
  native.emit({ version: 1, type: "completed", taskId: secondStart.taskId, kind: "dash" });
  await waitFor(() => native.disconnected);
});

test("background companion ping reports the fixed host and host failures never echo native diagnostics", async () => {
  const pingHarness = await createHarness({
    connectNative(host, ports) {
      assert.equal(host, HOST);
      const port = createNativePort();
      const originalPost = port.postMessage.bind(port);
      port.postMessage = (message) => {
        originalPost(message);
        if (message.type === "ping") {
          port.emit({
            version: 1,
            type: "pong",
            requestId: message.requestId,
            nativeHost: HOST,
            protocolVersion: 1
          });
        }
      };
      ports.push(port);
      return port;
    }
  });
  const ping = await sendRuntimeMessage(pingHarness.listeners.message, {
    type: "BILI_DOWNLOAD_COMPANION_PING"
  });
  assert.deepEqual(ping, {
    ok: true,
    payload: { nativeHost: HOST, protocolVersion: 1 }
  });

  const unavailable = await createHarness({
    connectNative() {
      throw new Error("C:\\private\\host.exe?token=do-not-leak");
    }
  });
  const failure = await sendRuntimeMessage(unavailable.listeners.message, {
    type: "BILI_DOWNLOAD_COMPANION_PING"
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.includes("do-not-leak"), false);
  assert.equal(failure.error.includes("C:\\private"), false);
  assert.equal(failure.error.includes("https://"), false);
});

test("background companion start acceptance is bounded and leaves a safe resumable snapshot", async () => {
  const harness = await createHarness({ fakeTimers: true });
  const startPromise = sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_START_COMPANION",
    payload: { tabId: 13, prepared: dashPrepared("timeout-token") }
  });
  await waitFor(() => harness.nativePorts.length === 1 && harness.nativePorts[0].sent.length === 1);
  const deadline = harness.timers.find((timer) => timer.delay === 8000);
  assert.ok(deadline, "a native acceptance timeout should be scheduled");
  deadline.callback();
  const response = await startPromise;
  assert.equal(response.ok, false);
  const taskId = harness.nativePorts[0].sent[0].taskId;
  const task = await sendRuntimeMessage(harness.listeners.message, {
    type: "BILI_DOWNLOAD_GET_COMPANION_TASK",
    payload: { taskId }
  });
  assert.equal(task.payload.state, "interrupted");
  assert.equal(task.payload.recoverable, true);
  assert.equal(harness.nativePorts[0].disconnected, true);
  assert.equal(JSON.stringify(harness.storage[STORAGE_KEY]).includes("timeout-token"), false);
});
