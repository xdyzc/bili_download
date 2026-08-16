import assert from "node:assert/strict";

if (process.env.BILI_ENABLE_LIVE_PROBE !== "1") {
  console.log("Live-site probe skipped. Set BILI_ENABLE_LIVE_PROBE=1 to opt in.");
  process.exit(0);
}

const douyuRoom = process.env.BILI_DOUYU_PROBE_ROOM || "100";
const huyaRoom = process.env.BILI_HUYA_PROBE_ROOM || "660000";
assert.match(douyuRoom, /^\d+$/, "BILI_DOUYU_PROBE_ROOM must be numeric");
assert.match(huyaRoom, /^[A-Za-z0-9_-]+$/, "BILI_HUYA_PROBE_ROOM must be a room number or alias");

const headers = {
  "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
};

const douyuResponse = await fetch(`https://www.douyu.com/betard/${encodeURIComponent(douyuRoom)}`, {
  headers,
  signal: AbortSignal.timeout(15_000)
});
assert.equal(douyuResponse.ok, true, `Douyu betard returned HTTP ${douyuResponse.status}`);
const douyu = await douyuResponse.json();
assert.ok(douyu?.room && Number(douyu.room.room_id) > 0, "Douyu betard did not include a canonical room id");
assert.ok(Array.isArray(douyu.room.multirates), "Douyu betard did not include multirates");

const huyaResponse = await fetch(`https://www.huya.com/${encodeURIComponent(huyaRoom)}`, {
  headers,
  signal: AbortSignal.timeout(15_000)
});
assert.equal(huyaResponse.ok, true, `Huya room page returned HTTP ${huyaResponse.status}`);
const huyaHtml = await huyaResponse.text();
const streamMarker = huyaHtml.indexOf("stream:", huyaHtml.indexOf("hyPlayerConfig"));
assert.ok(streamMarker >= 0, "Huya page did not expose hyPlayerConfig.stream");
const streamStart = huyaHtml.indexOf("{", streamMarker);
const huyaStream = JSON.parse(readJsonObject(huyaHtml, streamStart));
assert.ok(Array.isArray(huyaStream.data), "Huya player stream did not include data");

const huyaGroup = huyaStream.data.find((item) => Number(item?.gameLiveInfo?.codecType) === 0);
const huyaQualities = Array.isArray(huyaStream.vMultiStreamInfo)
  ? huyaStream.vMultiStreamInfo
  : (huyaGroup?.vMultiStreamInfo || []);
console.log(JSON.stringify({
  douyu: {
    roomId: Number(douyu.room.room_id),
    live: Number(douyu.room.show_status) === 1,
    qualityCount: douyu.room.multirates.length
  },
  huya: {
    roomId: Number(huyaGroup?.gameLiveInfo?.profileRoom) || null,
    live: Boolean(huyaGroup?.gameStreamInfoList?.length),
    qualityCount: huyaQualities.length,
    avcQualityCount: huyaQualities.filter((item) => Number(item?.iCodecType) === 0).length,
    cdnCount: Array.isArray(huyaGroup?.gameStreamInfoList) ? huyaGroup.gameStreamInfoList.length : 0
  }
}, null, 2));

function readJsonObject(source, start) {
  assert.ok(start >= 0 && source[start] === "{", "JSON object start was not found");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        quoted = false;
      }
      continue;
    }
    if (character === "\"") {
      quoted = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  throw new Error("Huya player stream JSON was incomplete");
}
