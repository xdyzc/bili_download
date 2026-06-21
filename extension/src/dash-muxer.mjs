import * as MP4Box from "../vendor/mp4box/mp4box.all.mjs";
import { ArrayBufferTarget, Muxer } from "../vendor/mp4-muxer/mp4-muxer.mjs";

const MICROSECONDS_PER_SECOND = 1_000_000;
const FRAME_RATE_INTEGER_EPSILON = 0.01;

export async function muxDashToMp4({ videoBlob, audioBlob, outputName = "bili_video.mp4" }) {
  const [videoTrack, audioTrack] = await Promise.all([
    parseSingleTrack(videoBlob, "video"),
    parseSingleTrack(audioBlob, "audio")
  ]);

  const videoCodec = muxerVideoCodec(videoTrack.info.codec);
  const audioCodec = muxerAudioCodec(audioTrack.info.codec);
  const target = new ArrayBufferTarget();
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
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });

  const videoMeta = {
    decoderConfig: {
      codec: videoTrack.info.codec,
      description: extractVideoDecoderDescription(videoTrack.samples[0], videoCodec)
    }
  };
  const audioMeta = {
    decoderConfig: {
      codec: audioTrack.info.codec,
      description: extractAudioDecoderDescription(audioTrack.samples[0], audioTrack.info)
    }
  };

  for (const sample of videoTrack.samples) {
    muxer.addVideoChunkRaw(
      sampleBytes(sample),
      sample.is_sync ? "key" : "delta",
      sampleTimeUs(sample.cts, sample.timescale),
      sampleDurationUs(sample.duration, sample.timescale),
      videoMeta,
      sampleTimeUs(sample.cts - sample.dts, sample.timescale)
    );
  }

  for (const sample of audioTrack.samples) {
    muxer.addAudioChunkRaw(
      sampleBytes(sample),
      "key",
      sampleTimeUs(sample.cts, sample.timescale),
      sampleDurationUs(sample.duration, sample.timescale),
      audioMeta
    );
  }

  muxer.finalize();
  const blob = new Blob([target.buffer], { type: "video/mp4" });
  return {
    blob,
    filename: outputName.endsWith(".mp4") ? outputName : `${outputName}.mp4`,
    video: summarizeTrack(videoTrack),
    audio: summarizeTrack(audioTrack)
  };
}

async function parseSingleTrack(blob, expectedType) {
  const buffer = await blob.arrayBuffer();
  const parsed = await parseMp4Samples(buffer);
  const track = parsed.info.tracks.find((item) => Boolean(item[expectedType])) || parsed.info.tracks[0];
  if (!track) {
    throw new Error(`DASH ${expectedType} file did not contain a track.`);
  }

  const samples = parsed.samplesByTrack.get(track.id) || [];
  if (!samples.length) {
    throw new Error(`DASH ${expectedType} track did not contain samples.`);
  }

  return { info: track, samples };
}

function parseMp4Samples(buffer) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    const samplesByTrack = new Map();
    let infoPayload = null;

    mp4boxFile.onError = (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    mp4boxFile.onReady = (info) => {
      infoPayload = info;
      for (const track of info.tracks || []) {
        samplesByTrack.set(track.id, []);
        mp4boxFile.setExtractionOptions(track.id, null, {
          nbSamples: 1000,
          rapAlignement: false
        });
      }
      mp4boxFile.start();
    };
    mp4boxFile.onSamples = (trackId, _user, samples) => {
      const current = samplesByTrack.get(trackId) || [];
      current.push(...samples);
      samplesByTrack.set(trackId, current);
    };

    buffer.fileStart = 0;
    mp4boxFile.appendBuffer(buffer);
    mp4boxFile.flush();

    if (!infoPayload) {
      reject(new Error("Could not parse DASH MP4 metadata."));
      return;
    }
    resolve({ info: infoPayload, samplesByTrack });
  });
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
  const durations = track.samples
    .map((sample) => Number(sample.duration) || 0)
    .filter(Boolean);
  if (!durations.length || !track.samples[0]?.timescale) {
    return undefined;
  }

  const averageDuration = durations.reduce((sum, value) => sum + value, 0) / durations.length;
  return normalizeVideoFrameRate(track.samples[0].timescale / averageDuration);
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
    samples: track.samples.length,
    duration: track.samples.reduce((sum, sample) => sum + (Number(sample.duration) || 0), 0),
    timescale: track.samples[0]?.timescale || track.info.timescale || 0
  };
}

function copyBytes(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return new Uint8Array(bytes);
}
