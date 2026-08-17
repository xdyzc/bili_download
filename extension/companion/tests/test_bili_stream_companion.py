from __future__ import annotations

import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError


MODULE_PATH = Path(__file__).parents[1] / "bili_stream_companion.py"
SPEC = importlib.util.spec_from_file_location("bili_stream_companion_test", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
companion = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = companion
SPEC.loader.exec_module(companion)


class FakeResponse:
    def __init__(self, chunks, *, status: int = 200, headers: dict[str, str] | None = None) -> None:
        self._chunks = list(chunks)
        self.status = status
        self.headers = headers or {}
        self.closed = False

    def read(self, _size: int) -> bytes:
        if not self._chunks:
            return b""
        value = self._chunks.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value

    def close(self) -> None:
        self.closed = True


class ClockedResponse(FakeResponse):
    def __init__(self, chunks, clock, *, seconds_per_chunk: int) -> None:
        super().__init__(chunks)
        self._clock = clock
        self._seconds_per_chunk = seconds_per_chunk

    def read(self, size: int) -> bytes:
        value = super().read(size)
        if value:
            self._clock.advance(self._seconds_per_chunk)
        return value


class FakeOpener:
    def __init__(self, routes) -> None:
        self.routes = {url: list(outcomes) for url, outcomes in routes.items()}
        self.requests = []

    def open(self, request, timeout: int):
        self.requests.append((request, timeout))
        outcomes = self.routes[request.full_url]
        outcome = outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


class BlockingResponse:
    def __init__(self) -> None:
        self.status = 200
        self.headers = {}
        self.started = threading.Event()
        self.released = threading.Event()
        self.closed = False

    def read(self, _size: int) -> bytes:
        self.started.set()
        self.released.wait(timeout=2)
        if self.closed:
            raise OSError("closed by cancellation")
        return b""

    def close(self) -> None:
        self.closed = True
        self.released.set()


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def __call__(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


class FakeDiskUsage:
    def __init__(self, free: int) -> None:
        self.free = free
        self.calls = 0

    def __call__(self, _path: Path):
        self.calls += 1
        return SimpleNamespace(free=self.free, total=self.free, used=0)


def expired(url: str) -> HTTPError:
    return HTTPError(url, 403, "Forbidden", {}, None)


def wait_until(predicate, *, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.005)
    raise AssertionError("timed out waiting for companion event")


def fake_mux(video_path: Path, audio_path: Path, output_path: Path) -> None:
    output_path.write_bytes(video_path.read_bytes() + b"|" + audio_path.read_bytes())


def dash_request(*, task_id: str, video_sources: list[str], audio_sources: list[str]) -> dict:
    return {
        "version": 1,
        "type": "start_dash",
        "requestId": f"request_{task_id}",
        "taskId": task_id,
        "payload": {
            "outputName": "Large video.mp4",
            "referer": "https://www.bilibili.com/video/BV-test/",
            "maxBytes": 1024,
            "video": {"sources": video_sources, "expectedBytes": 5},
            "audio": {"sources": audio_sources, "expectedBytes": 5},
        },
    }


def serialized_artifacts(events, manifest_path: Path) -> str:
    return json.dumps(events, ensure_ascii=False) + manifest_path.read_text(encoding="utf-8")


def with_tmp_path(function):
    """Keep the tests runnable with both pytest and stdlib unittest."""

    def wrapper() -> None:
        with tempfile.TemporaryDirectory() as directory:
            function(Path(directory))

    wrapper.__name__ = function.__name__
    return wrapper


def assert_raises(expected_type, callback) -> None:
    try:
        callback()
    except expected_type:
        return
    except Exception as error:
        raise AssertionError(f"expected {expected_type.__name__}, got {type(error).__name__}") from error
    raise AssertionError(f"expected {expected_type.__name__}")


@with_tmp_path
def test_dash_streams_to_disk_falls_back_and_never_persists_signed_urls(tmp_path: Path) -> None:
    primary = "https://primary.bilivideo.com/video.m4s?token=primary-secret"
    backup = "https://backup.bilivideo.com/video.m4s?token=backup-secret"
    audio = "https://audio.bilivideo.com/audio.m4s?token=audio-secret"
    opener = FakeOpener({
        primary: [FakeResponse([b"vi", OSError("connection dropped")], headers={"Content-Length": "5"})],
        backup: [FakeResponse(
            [b"deo"],
            status=206,
            headers={"Content-Length": "3", "Content-Range": "bytes 2-4/5"},
        )],
        audio: [FakeResponse([b"audio"], headers={"Content-Length": "5"})],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
    )

    task = host.handle(dash_request(task_id="dash_1", video_sources=[primary, backup], audio_sources=[audio]))
    assert task is not None and task.thread is not None
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()

    assert (tmp_path / "Large video.mp4").read_bytes() == b"video|audio"
    assert events[-1]["type"] == "completed"
    assert task.dash_video is None
    assert task.dash_audio is None
    assert dict(opener.requests[1][0].header_items())["Range"] == "bytes=2-"
    assert dict(opener.requests[0][0].header_items())["Origin"] == "https://www.bilibili.com"
    assert dict(opener.requests[0][0].header_items())["Referer"] == "https://www.bilibili.com/"
    assert all("Cookie" not in dict(request.header_items()) for request, _timeout in opener.requests)
    assert all("Authorization" not in dict(request.header_items()) for request, _timeout in opener.requests)
    artifacts = serialized_artifacts(events, task.manifest_path)
    assert "primary-secret" not in artifacts
    assert "backup-secret" not in artifacts
    assert "audio-secret" not in artifacts
    assert "https://" not in artifacts


@with_tmp_path
def test_disk_admission_rejects_before_manifest_and_releases_output_claim(tmp_path: Path) -> None:
    request = dash_request(
        task_id="disk_reject",
        video_sources=["https://video.bilivideo.com/video.m4s?token=disk-secret"],
        audio_sources=["https://audio.bilivideo.com/audio.m4s?token=disk-secret"],
    )
    required = 2 * 10 + companion.DISK_SPACE_HEADROOM_BYTES
    usage = FakeDiskUsage(required - 1)
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=1024,
        disk_usage=usage,
        emit=events.append,
    )

    try:
        host.handle(request)
    except companion.CompanionError as error:
        assert error.code == "disk_space"
    else:
        raise AssertionError("expected disk admission to reject the task")

    assert events == []
    assert host._reservations == {}
    assert host._output_reservations == set()
    assert not list(tmp_path.glob("*.manifest.json"))


@with_tmp_path
def test_unknown_dash_sizes_use_the_configured_raw_cap_for_admission(tmp_path: Path) -> None:
    video = "https://video.bilivideo.com/unknown-video.m4s?token=unknown-video"
    audio = "https://audio.bilivideo.com/unknown-audio.m4s?token=unknown-audio"
    request = dash_request(task_id="disk_unknown", video_sources=[video], audio_sources=[audio])
    request["payload"]["video"].pop("expectedBytes")
    request["payload"]["audio"].pop("expectedBytes")
    required = 2 * request["payload"]["maxBytes"] + companion.DISK_SPACE_HEADROOM_BYTES
    usage = FakeDiskUsage(required)
    opener = FakeOpener({
        video: [FakeResponse([b"video"], headers={"Content-Length": "5"})],
        audio: [FakeResponse([b"audio"], headers={"Content-Length": "5"})],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=1024,
        disk_usage=usage,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
    )

    task = host.handle(request)
    assert task is not None and task.thread is not None
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()
    assert events[-1]["type"] == "completed"


@with_tmp_path
def test_mux_rechecks_disk_space_and_does_not_call_muxer_when_space_drops(tmp_path: Path) -> None:
    video = "https://video.bilivideo.com/mux-video.m4s?token=mux-video"
    audio = "https://audio.bilivideo.com/mux-audio.m4s?token=mux-audio"
    start_required = 2 * 10 + companion.DISK_SPACE_HEADROOM_BYTES
    usage = FakeDiskUsage(start_required)
    original_usage = usage

    def dynamic_usage(path: Path):
        original_usage.calls += 1
        if original_usage.calls <= 1:
            return SimpleNamespace(free=start_required, total=start_required, used=0)
        return SimpleNamespace(
            free=10 + companion.DISK_SPACE_HEADROOM_BYTES - 1,
            total=start_required,
            used=0,
        )

    mux_calls: list[tuple[Path, Path, Path]] = []

    def recording_mux(video_path: Path, audio_path: Path, output_path: Path) -> None:
        mux_calls.append((video_path, audio_path, output_path))
        fake_mux(video_path, audio_path, output_path)

    opener = FakeOpener({
        video: [FakeResponse([b"video"], headers={"Content-Length": "5"})],
        audio: [FakeResponse([b"audio"], headers={"Content-Length": "5"})],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=1024,
        disk_usage=dynamic_usage,
        opener=opener,
        muxer=recording_mux,
        emit=events.append,
    )
    task = host.handle(dash_request(task_id="mux_space_drop", video_sources=[video], audio_sources=[audio]))
    assert task is not None and task.thread is not None
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()
    assert events[-1]["type"] == "failed"
    assert events[-1]["code"] == "disk_space"
    assert mux_calls == []
    assert not (tmp_path / "Large video.mp4").exists()
    assert not list(tmp_path.glob("*.part.m4s"))
    assert not list(tmp_path.glob("*.mux.tmp"))


def test_ffmpeg_mux_never_reads_native_protocol_stdin() -> None:
    process = SimpleNamespace(returncode=0, poll=lambda: 0)
    with patch.object(companion, "find_ffmpeg", return_value="ffmpeg") as _find, patch.object(
        companion.subprocess,
        "Popen",
        return_value=process,
    ) as popen:
        companion.mux_with_ffmpeg(Path("video.part"), Path("audio.part"), Path("output.tmp"))

    command = popen.call_args.args[0]
    assert "-nostdin" in command
    assert popen.call_args.kwargs["stdin"] is companion.subprocess.DEVNULL


@with_tmp_path
def test_live_cleanup_only_removes_parts_registered_by_the_task(tmp_path: Path) -> None:
    context = companion.TaskContext(
        task_id="cleanup_exact",
        kind="live",
        output_name="[x].flv",
        output_path=tmp_path / "[x].flv",
        manifest_path=tmp_path / "[x].flv.live.manifest.json",
        referer="https://live.bilibili.com/1",
        max_bytes=1024,
    )
    own_part = tmp_path / "[x].flv.segment-0001.flv.part"
    unrelated_part = tmp_path / "x.flv.segment-0001.flv.part"
    own_part.write_bytes(b"own")
    unrelated_part.write_bytes(b"unrelated")
    context.track_live_part(own_part)

    companion._cleanup_live_part_files(context)

    assert not own_part.exists()
    assert unrelated_part.read_bytes() == b"unrelated"


@with_tmp_path
def test_terminal_event_survives_manifest_write_failure(tmp_path: Path) -> None:
    events: list[dict] = []
    host = companion.CompanionHost(output_dir=tmp_path, max_disk_bytes=1024, emit=events.append)
    context = companion.TaskContext(
        task_id="manifest_failure",
        kind="dash",
        output_name="safe.mp4",
        output_path=tmp_path / "safe.mp4",
        manifest_path=tmp_path / "safe.manifest.json",
        referer="https://www.bilibili.com/",
        max_bytes=1024,
    )
    with patch.object(
        companion,
        "_write_manifest",
        side_effect=companion.CompanionError("local_io", "manifest failed"),
    ):
        host._finish_failed(context, companion.CompanionError("source_failed", "source failed"))

    assert events[-1]["type"] == "failed"
    assert events[-1]["code"] == "source_failed"
    assert events[-1]["manifestUpdated"] is False


def test_safe_output_names_reject_windows_devices_and_preserve_extension() -> None:
    for name in ("CON", "NUL.mp4", "COM1.flv", "lpt9"):
        assert_raises(
            companion.ProtocolError,
            lambda name=name: companion._safe_output_name(name, suffix=".mp4"),
        )
    long_name = companion._safe_output_name("a" * 196, suffix=".mp4")
    assert len(long_name) <= 180
    assert long_name.lower().endswith(".mp4")


@with_tmp_path
def test_dash_waits_for_fresh_signed_sources_then_resumes_without_url_persistence(tmp_path: Path) -> None:
    expired_video = "https://expired.bilivideo.com/video.m4s?token=old-video-token"
    expired_audio = "https://expired.bilivideo.com/audio.m4s?token=old-audio-token"
    fresh_video = "https://fresh.bilivideo.com/video.m4s?token=fresh-video-token"
    fresh_audio = "https://fresh.bilivideo.com/audio.m4s?token=fresh-audio-token"
    opener = FakeOpener({
        expired_video: [expired(expired_video)],
        fresh_video: [FakeResponse([b"video"], headers={"Content-Length": "5"})],
        fresh_audio: [FakeResponse([b"audio"], headers={"Content-Length": "5"})],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
    )

    task = host.handle(dash_request(task_id="dash_refresh", video_sources=[expired_video], audio_sources=[expired_audio]))
    assert task is not None and task.thread is not None
    wait_until(lambda: any(event["type"] == "refresh_required" for event in events))
    host.handle({
        "version": 1,
        "type": "refresh_dash_sources",
        "requestId": "refresh_request",
        "taskId": "dash_refresh",
        "payload": {
            "referer": "https://www.bilibili.com/",
            "video": {"sources": [fresh_video], "expectedBytes": 5},
            "audio": {"sources": [fresh_audio], "expectedBytes": 5},
        },
    })
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()
    assert (tmp_path / "Large video.mp4").read_bytes() == b"video|audio"
    assert [event["type"] for event in events].count("refresh_required") == 1
    assert any(event["type"] == "sources_refreshed" for event in events)
    assert events[-1]["type"] == "completed"
    artifacts = serialized_artifacts(events, task.manifest_path)
    for secret in ("old-video-token", "old-audio-token", "fresh-video-token", "fresh-audio-token"):
        assert secret not in artifacts
    assert "https://" not in artifacts


@with_tmp_path
def test_live_splits_reopened_connections_and_writes_a_url_free_manifest(tmp_path: Path) -> None:
    source = "https://live.bilivideo.com/live.flv?token=live-secret"
    clock = FakeClock()
    opener = FakeOpener({
        source: [
            ClockedResponse([b"first"], clock, seconds_per_chunk=5),
            ClockedResponse([b"second"], clock, seconds_per_chunk=5),
        ],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
        clock=clock,
    )

    task = host.handle({
        "version": 1,
        "type": "start_live",
        "requestId": "live_request",
        "taskId": "live_1",
        "payload": {
            "outputName": "Live session",
            "referer": "https://live.bilibili.com/123",
            "sources": [source],
            "maxBytes": 1024,
            "maxDurationSeconds": 10,
            "segmentDurationSeconds": 5,
        },
    })
    assert task is not None and task.thread is not None
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()

    manifest = json.loads(task.manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["segmentCount"] == 2
    assert [item["file"] for item in manifest["segments"]] == [
        "Live session.segment-0001.flv",
        "Live session.segment-0002.flv",
    ]
    assert (tmp_path / "Live session.segment-0001.flv").read_bytes() == b"first"
    assert (tmp_path / "Live session.segment-0002.flv").read_bytes() == b"second"
    assert task.live_sources == ()
    artifacts = serialized_artifacts(events, task.manifest_path)
    assert "live-secret" not in artifacts
    assert "https://" not in artifacts


@with_tmp_path
def test_huya_live_treats_short_flv_eof_as_expected_rollover(tmp_path: Path) -> None:
    source = "https://tx.flv.huya.com/src/stream.flv?wsSecret=redacted&wsTime=123&codec=265&startPts=50"
    clock = FakeClock()

    def flv_fragment(timestamp: int, value: int) -> bytes:
        tag = bytearray(16)
        tag[0] = 9
        tag[3] = 1
        tag[4:7] = timestamp.to_bytes(3, "big")
        tag[7] = (timestamp >> 24) & 0xFF
        tag[11] = value
        tag[12:16] = (12).to_bytes(4, "big")
        return b"FLV\x01\x05\x00\x00\x00\x09\x00\x00\x00\x00" + bytes(tag)

    class RollingHuyaOpener:
        def __init__(self) -> None:
            self.requests = []

        def open(self, request, timeout: int):
            self.requests.append((request, timeout))
            index = len(self.requests)
            return ClockedResponse([flv_fragment(index * 100, index)], clock, seconds_per_chunk=1)

    opener = RollingHuyaOpener()
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
        clock=clock,
    )

    task = host.handle({
        "version": 1,
        "type": "start_live",
        "requestId": "huya_live_request",
        "taskId": "huya_live",
        "payload": {
            "outputName": "Huya session",
            "referer": "https://www.huya.com/fixture-anchor",
            "sources": [source],
            "maxBytes": 1024,
            "maxDurationSeconds": 3,
            "segmentDurationSeconds": 3,
        },
    })
    assert task is not None and task.thread is not None
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()

    manifest = json.loads(task.manifest_path.read_text(encoding="utf-8"))
    assert manifest["status"] == "completed"
    assert manifest["segmentCount"] == 3
    assert not any(event.get("phase") == "reconnecting" for event in events)
    assert not any(event["type"] == "refresh_required" for event in events)
    request_urls = [request.full_url for request, _timeout in opener.requests]
    assert len(request_urls) == 3
    assert len(set(request_urls)) == 3
    assert all("timeStamp=" in url for url in request_urls)
    assert all("codec=" not in url for url in request_urls)
    assert "startPts=50" in request_urls[0]
    assert "startPts=101" in request_urls[1]
    assert "startPts=201" in request_urls[2]
    artifacts = serialized_artifacts(events, task.manifest_path)
    assert "wsSecret" not in artifacts
    assert "https://" not in artifacts


@with_tmp_path
def test_live_requests_fresh_sources_after_expiry_without_persisting_them(tmp_path: Path) -> None:
    old_source = "https://expired.bilivideo.com/live.flv?token=old-live-token"
    fresh_source = "https://fresh.bilivideo.com/live.flv?token=fresh-live-token"
    clock = FakeClock()
    opener = FakeOpener({
        old_source: [expired(old_source)],
        fresh_source: [ClockedResponse([b"fresh-live"], clock, seconds_per_chunk=3)],
    })
    events: list[dict] = []
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=opener,
        muxer=fake_mux,
        emit=events.append,
        clock=clock,
    )
    task = host.handle({
        "version": 1,
        "type": "start_live",
        "requestId": "live_refresh_request",
        "taskId": "live_refresh",
        "payload": {
            "outputName": "Refresh live",
            "sources": [old_source],
            "maxBytes": 1024,
            "maxDurationSeconds": 3,
            "segmentDurationSeconds": 3,
        },
    })
    assert task is not None and task.thread is not None
    wait_until(lambda: any(event["type"] == "refresh_required" for event in events))
    host.handle({
        "version": 1,
        "type": "refresh_live_sources",
        "requestId": "live_refresh_sources",
        "taskId": "live_refresh",
        "payload": {"sources": [fresh_source]},
    })
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()
    assert events[-1]["type"] == "completed"
    assert any(event["type"] == "sources_refreshed" for event in events)
    artifacts = serialized_artifacts(events, task.manifest_path)
    assert "old-live-token" not in artifacts
    assert "fresh-live-token" not in artifacts
    assert "https://" not in artifacts


@with_tmp_path
def test_cancel_closes_an_active_live_response_and_emits_a_safe_terminal_event(tmp_path: Path) -> None:
    source = "https://live.bilivideo.com/live.flv?token=cancel-secret"
    response = BlockingResponse()
    opener = FakeOpener({source: [response]})
    events: list[dict] = []
    host = companion.CompanionHost(output_dir=tmp_path, max_disk_bytes=4096, opener=opener, emit=events.append)
    task = host.handle({
        "version": 1,
        "type": "start_live",
        "requestId": "live_cancel_start",
        "taskId": "live_cancel",
        "payload": {
            "outputName": "Cancel live",
            "sources": [source],
            "maxBytes": 1024,
            "maxDurationSeconds": 60,
            "segmentDurationSeconds": 60,
        },
    })
    assert task is not None and task.thread is not None
    wait_until(response.started.is_set)
    host.handle({
        "version": 1,
        "type": "cancel",
        "requestId": "live_cancel_request",
        "taskId": "live_cancel",
    })
    task.thread.join(timeout=2)
    assert not task.thread.is_alive()
    assert response.closed
    assert any(event["type"] == "cancel_requested" for event in events)
    assert events[-1]["type"] == "canceled"
    assert "cancel-secret" not in json.dumps(events)


@with_tmp_path
def test_host_shutdown_cancels_workers_and_cleans_live_parts(tmp_path: Path) -> None:
    source = "https://live.bilivideo.com/live.flv?token=shutdown-secret"
    response = BlockingResponse()
    host = companion.CompanionHost(
        output_dir=tmp_path,
        max_disk_bytes=4096,
        opener=FakeOpener({source: [response]}),
    )
    task = host.handle({
        "version": 1,
        "type": "start_live",
        "requestId": "shutdown_start",
        "taskId": "shutdown_live",
        "payload": {
            "outputName": "[shutdown].flv",
            "sources": [source],
            "maxBytes": 1024,
            "maxDurationSeconds": 60,
            "segmentDurationSeconds": 60,
        },
    })
    assert task is not None and task.thread is not None
    wait_until(response.started.is_set)

    host.shutdown(timeout_seconds=2)

    assert not task.thread.is_alive()
    assert response.closed
    assert json.loads(task.manifest_path.read_text(encoding="utf-8"))["status"] == "canceled"
    assert task.live_parts_snapshot() == ()
    assert not list(tmp_path.glob("*.part"))


@with_tmp_path
def test_protocol_rejects_cookies_custom_headers_and_non_cdn_api_urls(tmp_path: Path) -> None:
    host = companion.CompanionHost(output_dir=tmp_path)
    base = dash_request(
        task_id="invalid_1",
        video_sources=["https://video.bilivideo.com/video.m4s?token=secret"],
        audio_sources=["https://audio.bilivideo.com/audio.m4s?token=secret"],
    )
    base["payload"]["headers"] = {"Cookie": "SESSDATA=secret"}
    assert_raises(companion.ProtocolError, lambda: host.handle(base))

    request_header_alias = dash_request(
        task_id="invalid_headers_2",
        video_sources=["https://video.bilivideo.com/video.m4s?token=secret"],
        audio_sources=["https://audio.bilivideo.com/audio.m4s?token=secret"],
    )
    request_header_alias["payload"]["requestHeaders"] = {"X-Test": "not-allowed"}
    assert_raises(companion.ProtocolError, lambda: host.handle(request_header_alias))

    api_request = dash_request(
        task_id="invalid_2",
        video_sources=["https://api.bilibili.com/x/player/playurl?token=secret"],
        audio_sources=["https://audio.bilivideo.com/audio.m4s?token=secret"],
    )
    assert_raises(companion.ProtocolError, lambda: host.handle(api_request))

    redirect_handler = companion.SafeMediaRedirectHandler()
    original_request = companion.Request("https://video.bilivideo.com/video.m4s?token=secret")
    assert_raises(
        HTTPError,
        lambda: redirect_handler.redirect_request(
            original_request,
            None,
            302,
            "Found",
            {},
            "https://api.bilibili.com/x/player/playurl?token=redirect-secret",
        ),
    )


def test_live_media_policies_pair_each_referer_with_its_own_cdn_family() -> None:
    pairs = [
        (
            "https://live.bilibili.com/123",
            "https://live.bilivideo.com/live.flv?token=redacted",
            "https://www.bilibili.com",
        ),
        (
            "https://www.douyu.com/999001",
            "https://fixture.douyucdn.cn/live/stream.flv?token=redacted",
            "https://www.douyu.com",
        ),
        (
            "https://www.huya.com/fixture-anchor",
            "https://tx.flv.huya.com/src/stream.flv?token=redacted",
            "https://www.huya.com",
        ),
        (
            "https://www.huya.com/fixture-anchor",
            "https://redirect.mobgslb.tbcache.com/src/stream.flv?token=redacted",
            "https://www.huya.com",
        ),
    ]
    for referer, source, origin in pairs:
        safe_referer = companion._safe_referer(referer, default="")
        assert companion._source_list([source], referer=safe_referer) == (source,)
        headers = companion._media_request_headers(safe_referer)
        assert headers["Origin"] == origin
        assert headers["Referer"] == safe_referer

    cross_site_pairs = [
        ("https://www.douyu.com/", "https://tx.flv.huya.com/src/stream.flv"),
        ("https://www.huya.com/", "https://fixture.douyucdn.cn/live/stream.flv"),
        ("https://live.bilibili.com/", "https://redirect.mobgslb.tbcache.com/live.flv"),
        ("https://www.huya.com/", "https://api.huya.com/live/stream.flv"),
        ("https://www.douyu.com/", "http://fixture.douyucdn.cn/live/stream.flv"),
    ]
    for referer, source in cross_site_pairs:
        assert_raises(
            companion.ProtocolError,
            lambda referer=referer, source=source: companion._source_list([source], referer=referer),
        )


def test_huya_live_connection_url_only_refreshes_safe_transport_parameters() -> None:
    source = (
        "https://tx.flv.huya.com/src/stream.flv"
        "?wsSecret=redacted&wsTime=123&ratio=2000&codec=265&startPts=10&timeStamp=old"
    )
    with patch.object(companion.time, "time_ns", return_value=987654321):
        refreshed = companion._live_connection_url(
            source,
            "https://www.huya.com/fixture-anchor",
            7,
            456,
        )
    parsed = companion.urlparse(refreshed)
    query = dict(companion.parse_qsl(parsed.query, keep_blank_values=True))
    assert parsed.scheme == "https"
    assert parsed.hostname == "tx.flv.huya.com"
    assert parsed.path == "/src/stream.flv"
    assert query["wsSecret"] == "redacted"
    assert query["wsTime"] == "123"
    assert query["ratio"] == "2000"
    assert query["timeStamp"] == "987654321-7"
    assert query["startPts"] == "457"
    assert "codec" not in query
    initial = companion._live_connection_url(
        source,
        "https://www.huya.com/fixture-anchor",
        1,
    )
    initial_query = dict(companion.parse_qsl(companion.urlparse(initial).query, keep_blank_values=True))
    assert initial_query["startPts"] == "10"
    assert companion._live_connection_url(
        source,
        "https://live.bilibili.com/123",
        7,
    ) == source


def test_redirect_policy_allows_huya_cdn_failover_and_rejects_cross_site_targets() -> None:
    handler = companion.SafeMediaRedirectHandler()
    original = companion.Request(
        "https://tx.flv.huya.com/src/stream.flv?token=redacted",
        headers={"Referer": "https://www.huya.com/"},
    )
    allowed = handler.redirect_request(
        original,
        None,
        302,
        "Found",
        {},
        "https://redirect.mobgslb.tbcache.com/src/stream.flv?token=redacted",
    )
    assert allowed is not None
    assert allowed.full_url.startswith("https://redirect.mobgslb.tbcache.com/")

    for target in [
        "https://fixture.douyucdn.cn/live/stream.flv?token=redacted",
        "https://api.huya.com/live/stream.flv?token=redacted",
        "http://redirect.mobgslb.tbcache.com/src/stream.flv?token=redacted",
    ]:
        assert_raises(
            HTTPError,
            lambda target=target: handler.redirect_request(
                original,
                None,
                302,
                "Found",
                {},
                target,
            ),
        )


def test_native_message_framing_round_trips_a_single_safe_event() -> None:
    stream = io.BytesIO()
    event = {"version": 1, "type": "pong", "requestId": "ping_1"}
    companion.write_native_message(stream, event)
    stream.seek(0)
    assert companion.read_native_message(stream) == event


@with_tmp_path
def test_native_protocol_error_does_not_echo_a_signed_url_or_cookie(tmp_path: Path) -> None:
    signed_url = "https://video.bilivideo.com/video.m4s?token=protocol-secret"
    incoming = io.BytesIO()
    companion.write_native_message(incoming, {
        "version": 1,
        "type": "start_dash",
        "requestId": "unsafe_request",
        "taskId": "unsafe_task",
        "payload": {
            "outputName": "safe.mp4",
            "headers": {"Cookie": "SESSDATA=protocol-cookie"},
            "video": {"sources": [signed_url]},
            "audio": {"sources": [signed_url]},
        },
    })
    incoming.seek(0)
    outgoing = io.BytesIO()
    assert companion.run_native_host(
        incoming,
        outgoing,
        output_dir=tmp_path,
        max_disk_bytes=1024,
    ) == 0
    outgoing.seek(0)
    event = companion.read_native_message(outgoing)
    assert event == {
        "version": 1,
        "type": "error",
        "code": "invalid_request",
        "message": "Cookies, authorization, and custom request headers are not accepted.",
        "requestId": "unsafe_request",
    }
    assert companion.read_native_message(outgoing) is None
    assert "protocol-secret" not in json.dumps(event)
    assert "protocol-cookie" not in json.dumps(event)


def test_native_host_template_uses_the_documented_host_name_and_single_origin_placeholder() -> None:
    template_path = Path(__file__).parents[1] / "com.bili_download.stream_companion.json.template"
    template = json.loads(template_path.read_text(encoding="utf-8"))
    assert template["name"] == companion.NATIVE_HOST_NAME
    assert template["type"] == "stdio"
    assert template["path"] == "%HOST_PATH%"
    assert template["allowed_origins"] == ["chrome-extension://%EXTENSION_ID%/"]


def test_command_line_accepts_only_expected_chromium_native_launch_arguments() -> None:
    origin = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
    args = companion.parse_args(["--max-disk-gib", "4", origin, "--parent-window=0"])
    assert args.max_disk_gib == 4
    assert companion._is_native_launch_argument(origin)
    assert companion._is_native_launch_argument("--parent-window=123")
    assert not companion._is_native_launch_argument("--untrusted-option=value")


def load_tests(_loader, _tests, _pattern):
    tests = unittest.TestSuite()
    for name, value in sorted(globals().items()):
        if name.startswith("test_") and callable(value):
            tests.addTest(unittest.FunctionTestCase(value))
    return tests
