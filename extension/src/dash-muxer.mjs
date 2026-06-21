import * as MP4Box from "../vendor/mp4box/mp4box.all.mjs";
import { StreamTarget, Muxer } from "../vendor/mp4-muxer/mp4-muxer.mjs";

const MICROSECONDS_PER_SECOND = 1_000_000;
const FRAME_RATE_INTEGER_EPSILON = 0.01;
const MP4BOX_PARSE_CHUNK_BYTES = 8 * 1024 * 1024;
const MUXER_STREAM_CHUNK_BYTES = 8 * 1024 * 1024;

export async function muxDashToMp4({ videoBlob, audioBlob, outputName = "bili_video.mp4" }) {
  const [videoTrack, audioTrack] = await Promise.all([
    parseSingleTrackInfo(videoBlob, "video"),
    parseSingleTrackInfo(audioBlob, "audio")
  ]);

  const videoCodec = muxerVideoCodec(videoTrack.info.codec);
  const audioCodec = muxerAudioCodec(audioTrack.info.codec);
  const outputChunks = [];
  const target = new StreamTarget({
    onData(data, position) {
      outputChunks.push({
        blob: new Blob([data]),
        position,
        size: data.byteLength
      });
    },
    chunked: true,
    chunkSize: MUXER_STREAM_CHUNK_BYTES
  });
  const muxer = new Muxer({
    target,
    video: {
      codec: videoCodec,
      width: videoTrack.info.video?.width || videoTrack.info.track_width || 1920,
      height: videoTrack.info.video?.height || videoTrack.info.track_height || 1080,
      frameRate: frameRateFromTrack(videoTrack)
    },
    audio: {
      codec: audioCodec,
      sampleRate: audioTrack.info.audio?.sample_rate || audioTrack.info.timescale || 48000,
      numberOfChannels: audioTrack.info.audio?.channel_count || 2
    },
    fastStart: false,
    firstTimestampBehavior: "offset"
  });

  const videoMeta = {
    decoderConfig: {
      codec: videoTrack.info.codec,
      description: extractVideoDecoderDescription(videoTrack.firstSample, videoCodec)
    }
  };
  const audioMeta = {
    decoderConfig: {
      codec: audioTrack.info.codec,
      description: extractAudioDecoderDescription(audioTrack.firstSample, audioTrack.info)
    }
  };

  await addSamplesFromBlob(videoBlob, videoTrack.info.id, (sample) => {
    muxer.addVideoChunkRaw(
      sampleBytes(sample),
      sample.is_sync ? "key" : "delta",
      sampleTimeUs(sample.cts, sample.timescale),
      sampleDurationUs(sample.duration, sample.timescale),
      videoMeta,
      sampleTimeUs(sample.cts - sample.dts, sample.timescale)
    );
  });

  await addSamplesFromBlob(audioBlob, audioTrack.info.id, (sample) => {
    muxer.addAudioChunkRaw(
      sampleBytes(sample),
      "key",
      sampleTimeUs(sample.cts, sample.timescale),
      sampleDurationUs(sample.duration, sample.timescale),
      audioMeta
    );
  });

  muxer.finalize();
  const blob = new Blob(composeOutputChunks(outputChunks).map((chunk) => chunk.blob), { type: "video/mp4" });
  return {
    blob,
    filename: outputName.endsWith(".mp4") ? outputName : `${outputName}.mp4`,
    video: summarizeTrack(videoTrack),
    audio: summarizeTrack(audioTrack)
  };
}

async function parseSingleTrackInfo(blob, expectedType) {
  const parsed = await parseMp4Metadata(blob);
  const track = parsed.info.tracks.find((item) => Boolean(item[expectedType])) || parsed.info.tracks[0];
  if (!track) {
    throw new Error(`DASH ${expectedType} file did not contain a track.`);
  }

  const firstSample = parsed.firstSamplesByTrack.get(track.id);
  if (!firstSample) {
    throw new Error(`DASH ${expectedType} track did not contain samples.`);
  }

  return { info: track, firstSample };
}

async function parseMp4Metadata(blob) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    const firstSamplesByTrack = new Map();
    let infoPayload = null;
    let resolved = false;

    mp4boxFile.onError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    mp4boxFile.onReady = (info) => {
      infoPayload = info;
      for (const track of info.tracks || []) {
        mp4boxFile.setExtractionOptions(track.id, null, {
          nbSamples: 1,
          rapAlignement: false
        });
      }
      mp4boxFile.start();
    };
    mp4boxFile.onSamples = (trackId, _user, samples) => {
      if (samples[0] && !firstSamplesByTrack.has(trackId)) {
        firstSamplesByTrack.set(trackId, samples[0]);
      }
      if (mp4boxFile.releaseUsedSamples) {
        mp4boxFile.releaseUsedSamples(trackId, samples.at(-1).number + 1);
      }
    };

    appendBlobToMp4Box(blob, mp4boxFile)
      .then(() => {
        if (!infoPayload) {
          reject(new Error("Could not parse DASH MP4 metadata."));
          return;
        }
        resolved = true;
        resolve({ info: infoPayload, firstSamplesByTrack });
      })
      .catch((error) => {
        if (!resolved) {
          reject(error);
        }
      });
  });
}

async function addSamplesFromBlob(blob, trackId, onSample) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    let sampleCount = 0;

    mp4boxFile.onError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    mp4boxFile.onReady = (info) => {
      const track = info.tracks.find((item) => item.id === trackId) || info.tracks[0];
      if (!track) {
        reject(new Error("DASH MP4 file did not contain a track."));
        return;
      }
      mp4boxFile.setExtractionOptions(track.id, null, {
        nbSamples: 256,
        rapAlignement: false
      });
      mp4boxFile.start();
    };
    mp4boxFile.onSamples = (id, _user, samples) => {
      for (const sample of samples) {
        onSample(sample);
        sampleCount += 1;
      }
      if (mp4boxFile.releaseUsedSamples && samples.length) {
        mp4boxFile.releaseUsedSamples(id, samples.at(-1).number + 1);
      }
    };

    appendBlobToMp4Box(blob, mp4boxFile)
      .then(() => {
        if (!sampleCount) {
          reject(new Error("DASH MP4 track did not contain samples."));
          return;
        }
        resolve();
      })
      .catch(reject);
  });
}

async function appendBlobToMp4Box(blob, mp4boxFile) {
  let offset = 0;
  while (offset < blob.size) {
    const chunk = await blob
      .slice(offset, Math.min(offset + MP4BOX_PARSE_CHUNK_BYTES, blob.size))
      .arrayBuffer();
    chunk.fileStart = offset;
    mp4boxFile.appendBuffer(chunk, offset + chunk.byteLength >= blob.size);
    offset += chunk.byteLength;
  }
  mp4boxFile.flush();
}

function muxerVideoCodec(codec) {
  const normalized = String(codec || "").toLowerCase();
  if (normalized.startsWith("avc")) {
    return "avc";
  }
  if (normalized.startsWith("hev") || normalized.startsWith("hvc")) {
    return "hevc";
  }
  if (normalized.startsWith("av01")) {
    return "av1";
  }
  throw new Error(`Unsupported DASH video codec for browser muxing: ${codec || "unknown"}`);
}

function muxerAudioCodec(codec) {
  const normalized = String(codec || "").toLowerCase();
  if (normalized.startsWith("mp4a")) {
    return "aac";
  }
  if (normalized.startsWith("opus")) {
    return "opus";
  }
  throw new Error(`Unsupported DASH audio codec for browser muxing: ${codec || "unknown"}`);
}

function extractVideoDecoderDescription(sample, muxerCodec) {
  const description = sample?.description;
  if (muxerCodec === "avc" && description?.avcC) {
    return writeBoxPayload(description.avcC);
  }
  if (muxerCodec === "hevc" && description?.hvcC) {
    return writeBoxPayload(description.hvcC);
  }
  if (muxerCodec === "av1" && description?.av1C) {
    return writeBoxPayload(description.av1C);
  }
  if (muxerCodec === "av1") {
    return undefined;
  }
  throw new Error(`DASH video track is missing ${muxerCodec} decoder configuration.`);
}

function extractAudioDecoderDescription(sample, trackInfo) {
  const specificInfo = sample?.description?.esds?.esd
    ?.findDescriptor?.(4)
    ?.findDescriptor?.(5)
    ?.data;
  if (specificInfo?.byteLength) {
    return copyBytes(specificInfo);
  }

  return buildAacLcConfig(
    trackInfo.audio?.sample_rate || trackInfo.timescale || 48000,
    trackInfo.audio?.channel_count || 2
  );
}

function writeBox(box) {
  const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 0, stream.position);
}

function writeBoxPayload(box) {
  const fullBox = writeBox(box);
  return fullBox.slice(Number(box.hdr_size) || 8);
}

function buildAacLcConfig(sampleRate, channels) {
  const frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const frequencyIndex = frequencies.indexOf(Number(sampleRate));
  if (frequencyIndex < 0) {
    throw new Error(`Unsupported AAC sample rate for browser muxing: ${sampleRate}`);
  }
  const audioObjectType = 2;
  const value = (audioObjectType << 11) | (frequencyIndex << 7) | ((Number(channels) || 2) << 3);
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function frameRateFromTrack(track) {
  const sampleDuration = Number(track.firstSample?.duration) || 0;
  if (!sampleDuration || !track.firstSample?.timescale) {
    return undefined;
  }

  return normalizeVideoFrameRate(track.firstSample.timescale / sampleDuration);
}

export function normalizeVideoFrameRate(value) {
  const frameRate = Number(value);
  if (!Number.isFinite(frameRate) || frameRate <= 0) {
    return undefined;
  }

  const rounded = Math.round(frameRate);
  if (Math.abs(frameRate - rounded) <= FRAME_RATE_INTEGER_EPSILON) {
    return rounded;
  }

  return undefined;
}

function sampleBytes(sample) {
  return sample.data instanceof Uint8Array ? sample.data : new Uint8Array(sample.data);
}

function sampleTimeUs(value, timescale) {
  return Math.max(0, Math.round((Number(value) || 0) * MICROSECONDS_PER_SECOND / (Number(timescale) || 1)));
}

function sampleDurationUs(value, timescale) {
  return Math.max(1, Math.round((Number(value) || 0) * MICROSECONDS_PER_SECOND / (Number(timescale) || 1)));
}

function summarizeTrack(track) {
  return {
    id: track.info.id,
    codec: track.info.codec,
    samples: Number(track.info.nb_samples) || 0,
    duration: Number(track.info.duration) || 0,
    timescale: track.firstSample?.timescale || track.info.timescale || 0
  };
}

function copyBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new Uint8Array(bytes);
}

export function composeOutputChunksForTest(chunks) {
  return composeOutputChunks(chunks);
}

function composeOutputChunks(chunks) {
  const segments = [];
  for (const chunk of chunks) {
    writeOutputSegment(segments, {
      start: chunk.position,
      end: chunk.position + chunk.size,
      blob: chunk.blob
    });
  }

  const sorted = segments.sort((left, right) => left.start - right.start);
  let expectedPosition = 0;
  for (const segment of sorted) {
    if (segment.start !== expectedPosition) {
      throw new Error(`MP4 muxer output has a gap at ${expectedPosition}; next chunk starts at ${segment.start}.`);
    }
    expectedPosition = segment.end;
  }
  return sorted;
}

function writeOutputSegment(segments, incoming) {
  if (incoming.end <= incoming.start) {
    return;
  }

  const nextSegments = [];
  for (const segment of segments) {
    if (segment.end <= incoming.start || segment.start >= incoming.end) {
      nextSegments.push(segment);
      continue;
    }

    if (segment.start < incoming.start) {
      nextSegments.push({
        start: segment.start,
        end: incoming.start,
        blob: segment.blob.slice(0, incoming.start - segment.start)
      });
    }

    if (segment.end > incoming.end) {
      nextSegments.push({
        start: incoming.end,
        end: segment.end,
        blob: segment.blob.slice(incoming.end - segment.start)
      });
    }
  }

  nextSegments.push(incoming);
  segments.splice(0, segments.length, ...nextSegments);
}
