"""Optional native streaming companion for the Bili Download extension.

The companion deliberately does *not* know how to log in to Bilibili, read a
browser profile, call Bilibili APIs, or accept cookies / arbitrary request
headers.  It only streams already-authorized, short-lived CDN URLs supplied by
the extension over Chrome Native Messaging.  Those URLs remain in process
memory and are never copied into events, manifests, error messages, or logs.

Run without arguments as a Chrome Native Messaging host.  ``--help`` is safe
to use for local development, but stdout is reserved for native messages while
the host is running.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time


PROTOCOL_VERSION = 1
NATIVE_HOST_NAME = "com.bili_download.stream_companion"
MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024
CHUNK_SIZE = 512 * 1024
DEFAULT_MAX_DISK_BYTES = 128 * 1024 * 1024 * 1024
# A task's configured byte budget covers media payloads only.  Keep a small,
# fixed amount for manifests, filesystem metadata, and muxer bookkeeping.
DISK_SPACE_HEADROOM_BYTES = 64 * 1024 * 1024
DEFAULT_DASH_REFRESH_SECONDS = 60
DEFAULT_LIVE_REFRESH_SECONDS = 60
DEFAULT_LIVE_DURATION_SECONDS = 2 * 60 * 60
DEFAULT_LIVE_SEGMENT_SECONDS = 5 * 60
MAX_LIVE_DURATION_SECONDS = 24 * 60 * 60
MAX_LIVE_SEGMENT_SECONDS = 60 * 60
MAX_SOURCE_CANDIDATES = 16
EXPIRED_SOURCE_STATUSES = {403, 404, 412}

ALLOWED_CDN_SUFFIXES = (
    "bilivideo.com",
    "bilivideo.cn",
    "hdslb.com",
    "edge.mountaintoys.cn",
)
ALLOWED_REFERER_HOSTS = {
    "www.bilibili.com",
    "m.bilibili.com",
    "live.bilibili.com",
}
FORBIDDEN_FIELD_NAMES = {
    "authorization",
    "cookie",
    "cookies",
    "header",
    "headers",
    "proxy",
    "proxies",
    "user-agent",
    "user_agent",
    "useragent",
    "browser_profile",
    "cookie_file",
}
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
NATIVE_ORIGIN_ARGUMENT_RE = re.compile(r"^chrome-extension://[a-p]{32}/$")
WINDOWS_RESERVED_NAME_RE = re.compile(r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.IGNORECASE)


class ProtocolError(ValueError):
    """The extension sent an invalid or unsafe protocol message."""


class CompanionError(RuntimeError):
    """A safe, user-facing error that intentionally contains no source URL."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class CanceledError(CompanionError):
    def __init__(self) -> None:
        super().__init__("canceled", "The local streaming task was canceled.")


class CandidateFailure(Exception):
    """A per-CDN failure; it keeps URL-bearing exception text out of events."""

    def __init__(self, *, expired: bool = False) -> None:
        super().__init__("candidate failure")
        self.expired = expired


class RefreshRequired(Exception):
    """All candidates rejected an expired signed URL."""


class SafeMediaRedirectHandler(HTTPRedirectHandler):
    """Permit only validated Bilibili CDN redirects for a media request."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _is_allowed_media_url(newurl):
            # This URL is intentionally never exposed to the caller; it becomes
            # a generic per-candidate failure at the download boundary.
            raise HTTPError(newurl, code, "unsafe redirect", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@dataclass(frozen=True)
class StreamInput:
    sources: tuple[str, ...]
    expected_bytes: int | None = None


@dataclass
class TaskContext:
    task_id: str
    kind: str
    output_name: str
    output_path: Path
    manifest_path: Path
    referer: str
    max_bytes: int
    reservation_bytes: int = 0
    cancel_event: threading.Event = field(default_factory=threading.Event)
    done_event: threading.Event = field(default_factory=threading.Event)
    source_event: threading.Event = field(default_factory=threading.Event)
    source_lock: threading.Lock = field(default_factory=threading.Lock)
    connection_lock: threading.Lock = field(default_factory=threading.Lock)
    active_responses: list[Any] = field(default_factory=list)
    live_part_paths: set[Path] = field(default_factory=set)
    source_version: int = 0
    dash_video: StreamInput | None = None
    dash_audio: StreamInput | None = None
    live_sources: tuple[str, ...] = ()
    duration_seconds: int = DEFAULT_LIVE_DURATION_SECONDS
    segment_seconds: int = DEFAULT_LIVE_SEGMENT_SECONDS
    bytes_written: int = 0
    segment_count: int = 0
    manifest: dict[str, Any] = field(default_factory=dict)
    thread: threading.Thread | None = None

    def dash_snapshot(self) -> tuple[int, StreamInput, StreamInput, str]:
        with self.source_lock:
            if self.dash_video is None or self.dash_audio is None:
                raise CompanionError("invalid_task", "DASH sources are unavailable.")
            return self.source_version, self.dash_video, self.dash_audio, self.referer

    def live_snapshot(self) -> tuple[int, tuple[str, ...], str]:
        with self.source_lock:
            return self.source_version, self.live_sources, self.referer

    def refresh_dash(self, video: StreamInput, audio: StreamInput, referer: str | None) -> None:
        with self.source_lock:
            self.dash_video = video
            self.dash_audio = audio
            if referer:
                self.referer = referer
            self.source_version += 1
            self.source_event.set()

    def refresh_live(self, sources: tuple[str, ...], referer: str | None) -> None:
        with self.source_lock:
            self.live_sources = sources
            if referer:
                self.referer = referer
            self.source_version += 1
            self.source_event.set()

    def wait_for_refresh(self, observed_version: int, timeout_seconds: int) -> bool:
        deadline = time.monotonic() + timeout_seconds
        while not self.cancel_event.is_set():
            with self.source_lock:
                if self.source_version > observed_version:
                    return True
                self.source_event.clear()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            self.source_event.wait(min(remaining, 1.0))
        raise CanceledError()

    def track_response(self, response: Any) -> None:
        with self.connection_lock:
            self.active_responses.append(response)

    def release_response(self, response: Any) -> None:
        with self.connection_lock:
            try:
                self.active_responses.remove(response)
            except ValueError:
                pass

    def close_active_responses(self) -> None:
        with self.connection_lock:
            responses = tuple(self.active_responses)
        for response in responses:
            try:
                response.close()
            except OSError:
                pass

    def track_live_part(self, path: Path) -> None:
        with self.connection_lock:
            self.live_part_paths.add(path)

    def release_live_part(self, path: Path) -> None:
        with self.connection_lock:
            self.live_part_paths.discard(path)

    def live_parts_snapshot(self) -> tuple[Path, ...]:
        with self.connection_lock:
            return tuple(self.live_part_paths)


class StreamDownloader:
    """Downloads a finite CDN object straight to disk with safe resume semantics."""

    def __init__(
        self,
        *,
        opener: Any | None = None,
        chunk_size: int = CHUNK_SIZE,
    ) -> None:
        self._opener = opener or build_safe_opener()
        self._chunk_size = chunk_size

    def download(
        self,
        source: StreamInput,
        destination: Path,
        *,
        referer: str,
        cancel_event: threading.Event,
        max_bytes: int,
        progress: Callable[[int, int | None], None],
        response_opened: Callable[[Any], None] | None = None,
        response_closed: Callable[[Any], None] | None = None,
    ) -> int:
        destination.parent.mkdir(parents=True, exist_ok=True)
        written = _existing_size(destination)
        expected = source.expected_bytes
        if expected is not None and written == expected:
            return written
        if written > max_bytes:
            raise CompanionError("disk_limit", "The local task reached its configured disk limit.")
        if expected is not None and expected > max_bytes:
            raise CompanionError("disk_limit", "The requested media exceeds the configured local disk limit.")

        if expected is not None and written > expected:
            raise CompanionError("local_io", "The existing local media part has an invalid size.")

        # Retry a transient CDN round before giving up, but request fresh URLs
        # immediately when *every* candidate explicitly rejects its signature.
        for round_index in range(3):
            failures: list[CandidateFailure] = []
            for candidate in source.sources:
                if cancel_event.is_set():
                    raise CanceledError()
                try:
                    return self._download_candidate(
                        candidate,
                        destination,
                        offset=_existing_size(destination),
                        expected_bytes=expected,
                        referer=referer,
                        cancel_event=cancel_event,
                        max_bytes=max_bytes,
                        progress=progress,
                        response_opened=response_opened,
                        response_closed=response_closed,
                    )
                except CandidateFailure as error:
                    failures.append(error)
            if failures and all(error.expired for error in failures):
                raise RefreshRequired()
            if round_index < 2 and cancel_event.wait(2 ** round_index):
                raise CanceledError()
        raise CompanionError("source_failed", "All currently available media servers failed.")

    def _download_candidate(
        self,
        url: str,
        destination: Path,
        *,
        offset: int,
        expected_bytes: int | None,
        referer: str,
        cancel_event: threading.Event,
        max_bytes: int,
        progress: Callable[[int, int | None], None],
        response_opened: Callable[[Any], None] | None,
        response_closed: Callable[[Any], None] | None,
    ) -> int:
        request_headers = _media_request_headers(referer)
        if offset > 0:
            request_headers["Range"] = f"bytes={offset}-"
        request = Request(url, headers=request_headers)
        response = None
        try:
            response = self._opener.open(request, timeout=20)
            if response_opened:
                response_opened(response)
            status = _response_status(response)
            if status in EXPIRED_SOURCE_STATUSES:
                raise CandidateFailure(expired=True)
            if status not in {200, 206}:
                raise CandidateFailure()

            content_range = _parse_content_range(_header(response, "Content-Range"))
            if offset > 0 and status == 206:
                if content_range is None or content_range[0] != offset:
                    raise CandidateFailure()
            if offset > 0 and status == 200:
                # The server ignored Range.  Start from zero instead of appending a
                # duplicate prefix; the already-open 200 response is usable.
                offset = 0
                mode = "wb"
            else:
                mode = "ab" if offset > 0 else "wb"

            response_total = content_range[2] if content_range else None
            content_length = _positive_int(_header(response, "Content-Length"))
            total = expected_bytes or response_total
            if total is None and content_length is not None:
                total = offset + content_length
            if total is not None and total > max_bytes:
                raise CompanionError("disk_limit", "The requested media exceeds the configured local disk limit.")

            written = offset
            try:
                with destination.open(mode) as handle:
                    while True:
                        if cancel_event.is_set():
                            raise CanceledError()
                        try:
                            chunk = response.read(self._chunk_size)
                        except (HTTPError, URLError, OSError, TimeoutError) as error:
                            raise CandidateFailure() from error
                        if not chunk:
                            break
                        next_written = written + len(chunk)
                        if total is not None and next_written > total:
                            raise CandidateFailure()
                        if next_written > max_bytes:
                            raise CompanionError("disk_limit", "The local task reached its configured disk limit.")
                        try:
                            handle.write(chunk)
                        except OSError as error:
                            raise CompanionError("local_io", "The companion could not write the local media file.") from error
                        written = next_written
                        progress(written, total)
            except OSError as error:
                raise CompanionError("local_io", "The companion could not write the local media file.") from error

            if total is not None and written < total:
                raise CandidateFailure()
            return written
        except HTTPError as error:
            raise CandidateFailure(expired=error.code in EXPIRED_SOURCE_STATUSES) from error
        except URLError as error:
            raise CandidateFailure() from error
        finally:
            if response is not None:
                if response_closed:
                    response_closed(response)
                try:
                    response.close()
                except OSError:
                    pass


class CompanionHost:
    """In-memory native-host task manager.

    All task source URLs live only inside ``TaskContext`` while a worker is
    active.  Completion removes the task from the host map and releases those
    references.
    """

    def __init__(
        self,
        *,
        output_dir: Path,
        max_disk_bytes: int = DEFAULT_MAX_DISK_BYTES,
        emit: Callable[[dict[str, Any]], None] | None = None,
        opener: Any | None = None,
        muxer: Callable[[Path, Path, Path], None] | None = None,
        disk_usage: Callable[[Path], Any] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.output_dir = output_dir.expanduser().resolve()
        self.max_disk_bytes = max_disk_bytes
        self._emit_callback = emit or (lambda _event: None)
        self._opener = opener or build_safe_opener()
        self._muxer = muxer or mux_with_ffmpeg
        self._disk_usage_callback = disk_usage or shutil.disk_usage
        self._clock = clock
        self._tasks: dict[str, TaskContext] = {}
        # Reservations cover future writes by active tasks.  They are kept in
        # memory because native-host task state must not become recovery data.
        self._reservations: dict[str, int] = {}
        self._output_reservations: set[Path] = set()
        self._tasks_lock = threading.Lock()
        self._emit_enabled = True

    def handle(self, message: Mapping[str, Any]) -> TaskContext | None:
        if not isinstance(message, Mapping):
            raise ProtocolError("The native message must be an object.")
        _reject_forbidden_fields(message)
        version = message.get("version")
        if version != PROTOCOL_VERSION:
            raise ProtocolError("Unsupported companion protocol version.")
        message_type = str(message.get("type") or "")
        request_id = _request_id(message.get("requestId"))

        if message_type == "ping":
            self.emit({
                "type": "pong",
                "requestId": request_id,
                "nativeHost": NATIVE_HOST_NAME,
                "protocolVersion": PROTOCOL_VERSION,
            })
            return None
        if message_type == "start_dash":
            return self._start_dash(message, request_id)
        if message_type == "start_live":
            return self._start_live(message, request_id)
        if message_type == "cancel":
            self._cancel(message, request_id)
            return None
        if message_type == "refresh_dash_sources":
            self._refresh_dash_sources(message, request_id)
            return None
        if message_type == "refresh_live_sources":
            self._refresh_live_sources(message, request_id)
            return None
        raise ProtocolError("Unknown companion message type.")

    def emit(self, event: Mapping[str, Any]) -> None:
        # Callers only pass protocol primitives deliberately constructed in this
        # module.  Source URLs and raw exceptions never enter this boundary.
        if self._emit_enabled:
            payload = {"version": PROTOCOL_VERSION, **event}
            self._emit_callback(payload)

    def shutdown(self, timeout_seconds: float = 5.0) -> None:
        """Cancel active work and give workers a bounded cleanup window."""
        self._emit_enabled = False
        with self._tasks_lock:
            contexts = tuple(self._tasks.values())
        for context in contexts:
            context.cancel_event.set()
            context.source_event.set()
            context.close_active_responses()
        deadline = time.monotonic() + max(float(timeout_seconds), 0.0)
        for context in contexts:
            thread = context.thread
            if thread is None or thread is threading.current_thread():
                continue
            thread.join(max(deadline - time.monotonic(), 0.0))

    def _start_dash(self, message: Mapping[str, Any], request_id: str) -> TaskContext:
        task_id = _task_id(message.get("taskId"))
        payload = _payload(message)
        output_name = _safe_output_name(payload.get("outputName"), suffix=".mp4")
        referer = _safe_referer(payload.get("referer"), default="https://www.bilibili.com/")
        max_bytes = _task_max_bytes(payload.get("maxBytes"), self.max_disk_bytes)
        video = _stream_input(payload.get("video"))
        audio = _stream_input(payload.get("audio"))
        _assert_expected_total_within_limit(video, audio, max_bytes)
        reservation_bytes = _dash_storage_requirement(video, audio, max_bytes)
        output_path = self._claim_output_path(output_name)
        context = TaskContext(
            task_id=task_id,
            kind="dash",
            output_name=output_path.name,
            output_path=output_path,
            manifest_path=output_path.with_suffix(".manifest.json"),
            referer=referer,
            max_bytes=max_bytes,
            reservation_bytes=reservation_bytes,
            dash_video=video,
            dash_audio=audio,
        )
        context.manifest = _base_manifest(context)
        context.manifest["inputs"] = {
            "video": {"partFile": _dash_part_path(output_path, "video").name, "expectedBytes": video.expected_bytes},
            "audio": {"partFile": _dash_part_path(output_path, "audio").name, "expectedBytes": audio.expected_bytes},
        }
        self._register_and_start(context, request_id, self._run_dash)
        return context

    def _start_live(self, message: Mapping[str, Any], request_id: str) -> TaskContext:
        task_id = _task_id(message.get("taskId"))
        payload = _payload(message)
        output_name = _safe_output_name(payload.get("outputName"), suffix=None)
        referer = _safe_referer(payload.get("referer"), default="https://live.bilibili.com/")
        sources = _source_list(payload.get("sources"))
        max_bytes = _task_max_bytes(payload.get("maxBytes"), self.max_disk_bytes)
        duration_seconds = _bounded_int(
            payload.get("maxDurationSeconds", DEFAULT_LIVE_DURATION_SECONDS),
            minimum=1,
            maximum=MAX_LIVE_DURATION_SECONDS,
            label="maxDurationSeconds",
        )
        segment_seconds = _bounded_int(
            payload.get("segmentDurationSeconds", DEFAULT_LIVE_SEGMENT_SECONDS),
            minimum=1,
            maximum=MAX_LIVE_SEGMENT_SECONDS,
            label="segmentDurationSeconds",
        )
        reservation_bytes = _live_storage_requirement(max_bytes)
        output_path = self._claim_output_path(output_name, reserve_suffix=".live.manifest.json")
        context = TaskContext(
            task_id=task_id,
            kind="live",
            output_name=output_path.name,
            output_path=output_path,
            manifest_path=output_path.with_name(f"{output_path.name}.live.manifest.json"),
            referer=referer,
            max_bytes=max_bytes,
            reservation_bytes=reservation_bytes,
            live_sources=sources,
            duration_seconds=duration_seconds,
            segment_seconds=segment_seconds,
        )
        context.manifest = _base_manifest(context)
        context.manifest.update({
            "maxDurationSeconds": duration_seconds,
            "segmentDurationSeconds": segment_seconds,
            "segments": [],
        })
        self._register_and_start(context, request_id, self._run_live)
        return context

    def _register_and_start(
        self,
        context: TaskContext,
        request_id: str,
        worker: Callable[[TaskContext], None],
    ) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        with self._tasks_lock:
            if context.task_id in self._tasks:
                self._release_output_path_locked(context.output_path)
                raise ProtocolError("The task id is already running.")
            try:
                self._reserve_storage_locked(context.task_id, context.reservation_bytes)
            except Exception:
                self._release_output_path_locked(context.output_path)
                raise
            self._tasks[context.task_id] = context
        try:
            _write_manifest(context)
        except Exception:
            with self._tasks_lock:
                self._tasks.pop(context.task_id, None)
                self._release_storage_locked(context.task_id)
                self._release_output_path_locked(context.output_path)
            raise
        try:
            self.emit({
                "type": "accepted",
                "requestId": request_id,
                "taskId": context.task_id,
                "kind": context.kind,
                "outputName": context.output_name,
            })
            context.thread = threading.Thread(
                target=worker,
                args=(context,),
                name=f"bili-companion-{context.kind}-{context.task_id[:8]}",
                daemon=True,
            )
            context.thread.start()
        except Exception:
            with self._tasks_lock:
                self._tasks.pop(context.task_id, None)
                self._release_storage_locked(context.task_id)
                self._release_output_path_locked(context.output_path)
            _cleanup_dash_artifacts(context.output_path, context.task_id)
            _cleanup_live_part_files(context)
            raise

    def _claim_output_path(self, output_name: str, *, reserve_suffix: str = "") -> Path:
        with self._tasks_lock:
            index = 0
            while True:
                candidate = _unique_output_path(self.output_dir, output_name, reserve_suffix=reserve_suffix)
                if candidate not in self._output_reservations:
                    self._output_reservations.add(candidate)
                    return candidate
                # The filesystem helper cannot see another in-process task's
                # reservation, so probe a deterministic alternate name.
                original = Path(output_name)
                index += 1
                output_name = f"{original.stem}_{index}{original.suffix}"

    def _release_output_path_locked(self, output_path: Path) -> None:
        self._output_reservations.discard(output_path)

    def _cancel(self, message: Mapping[str, Any], request_id: str) -> None:
        context = self._active_task(_task_id(message.get("taskId")))
        context.cancel_event.set()
        context.source_event.set()
        context.close_active_responses()
        self.emit({
            "type": "cancel_requested",
            "requestId": request_id,
            "taskId": context.task_id,
            "kind": context.kind,
        })

    def _refresh_dash_sources(self, message: Mapping[str, Any], request_id: str) -> None:
        context = self._active_task(_task_id(message.get("taskId")), expected_kind="dash")
        payload = _payload(message)
        video = _stream_input(payload.get("video"))
        audio = _stream_input(payload.get("audio"))
        _assert_expected_total_within_limit(video, audio, context.max_bytes)
        referer = _safe_referer(payload.get("referer"), default=context.referer)
        current_raw = _existing_size(_dash_part_path(context.output_path, "video")) + _existing_size(
            _dash_part_path(context.output_path, "audio")
        )
        requested_raw = _dash_raw_budget(video, audio, context.max_bytes)
        required_reservation = max(current_raw, requested_raw) + max(current_raw, requested_raw) + DISK_SPACE_HEADROOM_BYTES
        self._resize_storage_reservation(context, required_reservation)
        context.refresh_dash(video, audio, referer)
        self.emit({
            "type": "sources_refreshed",
            "requestId": request_id,
            "taskId": context.task_id,
            "kind": context.kind,
        })

    def _refresh_live_sources(self, message: Mapping[str, Any], request_id: str) -> None:
        context = self._active_task(_task_id(message.get("taskId")), expected_kind="live")
        payload = _payload(message)
        sources = _source_list(payload.get("sources"))
        referer = _safe_referer(payload.get("referer"), default=context.referer)
        context.refresh_live(sources, referer)
        self.emit({
            "type": "sources_refreshed",
            "requestId": request_id,
            "taskId": context.task_id,
            "kind": context.kind,
        })

    def _active_task(self, task_id: str, *, expected_kind: str | None = None) -> TaskContext:
        with self._tasks_lock:
            context = self._tasks.get(task_id)
        if context is None:
            raise ProtocolError("The task id is not running.")
        if expected_kind and context.kind != expected_kind:
            raise ProtocolError("The task type does not accept this request.")
        return context

    def _disk_free_bytes(self) -> int:
        try:
            usage = self._disk_usage_callback(self.output_dir)
            return max(int(getattr(usage, "free")), 0)
        except (AttributeError, OSError, TypeError, ValueError, OverflowError) as error:
            raise CompanionError(
                "disk_unavailable",
                "The companion could not inspect local disk space.",
            ) from error

    def _reserve_storage_locked(self, task_id: str, required_bytes: int) -> None:
        required = _positive_budget(required_bytes)
        if task_id in self._reservations:
            raise ProtocolError("The task already has a local storage reservation.")
        already_reserved = sum(self._reservations.values())
        if self._disk_free_bytes() < already_reserved + required:
            raise CompanionError(
                "disk_space",
                "Not enough free disk space for this local task.",
            )
        self._reservations[task_id] = required

    def _resize_storage_reservation(self, context: TaskContext, required_bytes: int) -> None:
        required = _positive_budget(required_bytes)
        with self._tasks_lock:
            current = self._reservations.get(context.task_id, context.reservation_bytes)
            if required > current:
                other_reserved = sum(self._reservations.values()) - current
                if self._disk_free_bytes() < other_reserved + (required - current):
                    raise CompanionError(
                        "disk_space",
                        "Not enough free disk space for the refreshed local task.",
                    )
            self._reservations[context.task_id] = required
            context.reservation_bytes = required

    def _release_storage_locked(self, task_id: str) -> None:
        self._reservations.pop(task_id, None)

    def _ensure_mux_space(self, context: TaskContext, raw_bytes: int) -> None:
        """Recheck the remaining mux footprint after both input streams exist."""
        mux_required = max(int(raw_bytes), 1) + DISK_SPACE_HEADROOM_BYTES
        with self._tasks_lock:
            own_reservation = self._reservations.get(context.task_id, context.reservation_bytes)
            other_reserved = max(sum(self._reservations.values()) - own_reservation, 0)
            if self._disk_free_bytes() < other_reserved + mux_required:
                raise CompanionError(
                    "disk_space",
                    "Not enough free disk space to merge the local DASH streams.",
                )

    def _ensure_live_space(self, context: TaskContext) -> None:
        remaining = max(context.max_bytes - context.bytes_written, 0)
        with self._tasks_lock:
            own_reservation = self._reservations.get(context.task_id, context.reservation_bytes)
            other_reserved = max(sum(self._reservations.values()) - own_reservation, 0)
            if self._disk_free_bytes() < other_reserved + remaining + DISK_SPACE_HEADROOM_BYTES:
                raise CompanionError(
                    "disk_space",
                    "Not enough free disk space to continue the local recording.",
                )

    def _run_dash(self, context: TaskContext) -> None:
        video_done = False
        audio_done = False
        refresh_rounds = 0
        video_part = _dash_part_path(context.output_path, "video")
        audio_part = _dash_part_path(context.output_path, "audio")
        downloader = StreamDownloader(opener=self._opener)
        try:
            while not (video_done and audio_done):
                source_version, video, audio, referer = context.dash_snapshot()
                try:
                    if not video_done:
                        video_size = downloader.download(
                            video,
                            video_part,
                            referer=referer,
                            cancel_event=context.cancel_event,
                            max_bytes=context.max_bytes,
                            progress=self._progress_callback(context, "download_video", extra={"totalBytes": video.expected_bytes}),
                            response_opened=context.track_response,
                            response_closed=context.release_response,
                        )
                        context.manifest["inputs"]["video"]["bytes"] = video_size
                        context.bytes_written = video_size
                        _write_manifest(context)
                        video_done = True
                    if not audio_done:
                        video_size = _existing_size(video_part)
                        remaining = context.max_bytes - video_size
                        if remaining <= 0:
                            raise CompanionError("disk_limit", "The local task reached its configured disk limit.")
                        audio_size = downloader.download(
                            audio,
                            audio_part,
                            referer=referer,
                            cancel_event=context.cancel_event,
                            max_bytes=remaining,
                            progress=self._progress_callback(context, "download_audio", extra={"totalBytes": audio.expected_bytes}),
                            response_opened=context.track_response,
                            response_closed=context.release_response,
                        )
                        context.manifest["inputs"]["audio"]["bytes"] = audio_size
                        context.bytes_written = video_size + audio_size
                        _write_manifest(context)
                        audio_done = True
                except RefreshRequired:
                    refresh_rounds += 1
                    if refresh_rounds > 3:
                        raise CompanionError("refresh_limit", "Fresh media URLs were rejected repeatedly.")
                    self.emit({
                        "type": "refresh_required",
                        "taskId": context.task_id,
                        "kind": context.kind,
                        "reason": "source_expired",
                    })
                    if not context.wait_for_refresh(source_version, DEFAULT_DASH_REFRESH_SECONDS):
                        raise CompanionError("refresh_timeout", "Fresh media URLs were not provided in time.")
                    continue

            context.bytes_written = _existing_size(video_part) + _existing_size(audio_part)
            context.manifest["status"] = "muxing"
            _write_manifest(context)
            self.emit({
                "type": "progress",
                "taskId": context.task_id,
                "kind": context.kind,
                "phase": "muxing",
                "receivedBytes": context.bytes_written,
            })
            if context.cancel_event.is_set():
                raise CanceledError()
            self._ensure_mux_space(context, context.bytes_written)
            mux_temp = _dash_mux_temp_path(context.output_path, context.task_id)
            mux_temp.unlink(missing_ok=True)
            if self._muxer is mux_with_ffmpeg:
                mux_with_ffmpeg(
                    video_part,
                    audio_part,
                    mux_temp,
                    cancel_event=context.cancel_event,
                )
            else:
                self._muxer(video_part, audio_part, mux_temp)
            if context.cancel_event.is_set():
                raise CanceledError()
            try:
                mux_temp.replace(context.output_path)
            except OSError as error:
                raise CompanionError("local_io", "The companion could not finalize the local media file.") from error
            video_part.unlink(missing_ok=True)
            audio_part.unlink(missing_ok=True)
            context.manifest.update({
                "status": "completed",
                "bytesWritten": context.bytes_written,
                "completedAt": _utc_timestamp(),
            })
            manifest_updated = self._write_terminal_manifest(context)
            self.emit({
                "type": "completed",
                "taskId": context.task_id,
                "kind": context.kind,
                "outputName": context.output_name,
                "bytesWritten": context.bytes_written,
                "manifest": context.manifest_path.name,
                "manifestUpdated": manifest_updated,
            })
        except CanceledError:
            context.bytes_written = _existing_size(video_part) + _existing_size(audio_part)
            self._finish_canceled(context)
        except CompanionError as error:
            context.bytes_written = _existing_size(video_part) + _existing_size(audio_part)
            self._finish_failed(context, error)
        except Exception:
            context.bytes_written = _existing_size(video_part) + _existing_size(audio_part)
            self._finish_failed(context, CompanionError("internal_error", "The local DASH task stopped unexpectedly."))
        finally:
            _cleanup_dash_artifacts(context.output_path, context.task_id)
            self._release_task(context)

    def _run_live(self, context: TaskContext) -> None:
        started = self._clock()
        deadline = started + context.duration_seconds
        candidate_index = 0
        observed_version = -1
        failed_candidates: list[CandidateFailure] = []
        refresh_rounds = 0
        try:
            while self._clock() < deadline:
                if context.cancel_event.is_set():
                    raise CanceledError()
                version, sources, referer = context.live_snapshot()
                if version != observed_version:
                    observed_version = version
                    candidate_index = 0
                    failed_candidates.clear()
                if not sources:
                    raise CompanionError("source_failed", "No live media source is available.")

                source = sources[candidate_index % len(sources)]
                candidate_index += 1
                context.segment_count += 1
                segment_index = context.segment_count
                segment_path = _live_segment_path(context.output_path, segment_index)
                part_path = segment_path.with_name(f"{segment_path.name}.part")
                context.track_live_part(part_path)
                segment_started = self._clock()
                segment_deadline = min(deadline, segment_started + context.segment_seconds)
                remaining = context.max_bytes - context.bytes_written
                if remaining <= 0:
                    self._finish_live_stop(context, "disk_limit")
                    return
                self._ensure_live_space(context)

                result: LiveConnectionResult | None = None
                failure: CandidateFailure | None = None
                try:
                    result = self._record_live_connection(
                        source,
                        part_path,
                        referer=referer,
                        cancel_event=context.cancel_event,
                        segment_deadline=segment_deadline,
                        recording_deadline=deadline,
                        max_bytes=remaining,
                        context=context,
                        segment_index=segment_index,
                    )
                except CandidateFailure as error:
                    failure = error
                except CanceledError:
                    raise

                bytes_in_segment = _existing_size(part_path)
                if bytes_in_segment > 0:
                    segment_path.parent.mkdir(parents=True, exist_ok=True)
                    part_path.replace(segment_path)
                    context.release_live_part(part_path)
                    context.bytes_written += bytes_in_segment
                    reason = result.reason if result else "source_error"
                    context.manifest["segments"].append({
                        "file": segment_path.name,
                        "bytes": bytes_in_segment,
                        "startedAt": _utc_timestamp(),
                        "endedAt": _utc_timestamp(),
                        "reason": reason,
                    })
                    context.manifest["bytesWritten"] = context.bytes_written
                    _write_manifest(context)
                else:
                    part_path.unlink(missing_ok=True)
                    context.release_live_part(part_path)

                if result is not None and result.reason in {"duration", "disk_limit"}:
                    self._finish_live_stop(context, result.reason)
                    return
                if context.cancel_event.is_set():
                    raise CanceledError()

                # A planned segment rollover is not a reconnect failure.  EOF or
                # a transport error starts a fresh FLV file so headers are never
                # blindly concatenated across independent live connections.
                if result is not None and result.reason == "segment_duration":
                    failed_candidates.clear()
                    continue
                if failure is None:
                    failure = CandidateFailure()
                failed_candidates.append(failure)

                if len(failed_candidates) >= len(sources):
                    latest_round = failed_candidates[-len(sources):]
                    if latest_round and all(item.expired for item in latest_round):
                        refresh_rounds += 1
                        if refresh_rounds > 3:
                            raise CompanionError("refresh_limit", "Fresh live media URLs were rejected repeatedly.")
                        self.emit({
                            "type": "refresh_required",
                            "taskId": context.task_id,
                            "kind": context.kind,
                            "reason": "source_expired",
                        })
                        if not context.wait_for_refresh(observed_version, DEFAULT_LIVE_REFRESH_SECONDS):
                            raise CompanionError("refresh_timeout", "Fresh live media URLs were not provided in time.")
                        continue

                reconnect_attempt = len(failed_candidates)
                self.emit({
                    "type": "progress",
                    "taskId": context.task_id,
                    "kind": context.kind,
                    "phase": "reconnecting",
                    "receivedBytes": context.bytes_written,
                    "segmentIndex": segment_index,
                    "durationMs": int(max(self._clock() - started, 0) * 1000),
                    "reconnectAttempt": reconnect_attempt,
                })
                delay = min(2 ** min(reconnect_attempt - 1, 3), 8)
                if context.cancel_event.wait(delay):
                    raise CanceledError()

            self._finish_live_stop(context, "duration")
        except CanceledError:
            self._finish_canceled(context)
        except CompanionError as error:
            self._finish_failed(context, error)
        except Exception:
            self._finish_failed(context, CompanionError("internal_error", "The local live task stopped unexpectedly."))
        finally:
            _cleanup_live_part_files(context)
            self._release_task(context)

    def _record_live_connection(
        self,
        url: str,
        destination: Path,
        *,
        referer: str,
        cancel_event: threading.Event,
        segment_deadline: float,
        recording_deadline: float,
        max_bytes: int,
        context: TaskContext,
        segment_index: int,
    ) -> "LiveConnectionResult":
        request = Request(url, headers=_media_request_headers(referer))
        response = None
        try:
            response = self._opener.open(request, timeout=20)
            context.track_response(response)
            status = _response_status(response)
            if status in EXPIRED_SOURCE_STATUSES:
                raise CandidateFailure(expired=True)
            if status != 200:
                raise CandidateFailure()
            destination.parent.mkdir(parents=True, exist_ok=True)
            written = 0
            with destination.open("wb") as handle:
                while True:
                    if cancel_event.is_set():
                        raise CanceledError()
                    now = self._clock()
                    if now >= recording_deadline:
                        return LiveConnectionResult("duration", written)
                    if now >= segment_deadline:
                        return LiveConnectionResult("segment_duration", written)
                    try:
                        chunk = response.read(CHUNK_SIZE)
                    except (HTTPError, URLError, OSError, TimeoutError) as error:
                        raise CandidateFailure() from error
                    if not chunk:
                        return LiveConnectionResult("source_ended", written)
                    if written + len(chunk) > max_bytes:
                        return LiveConnectionResult("disk_limit", written)
                    try:
                        handle.write(chunk)
                    except OSError as error:
                        raise CompanionError("local_io", "The companion could not write the local live segment.") from error
                    written += len(chunk)
                    self.emit({
                        "type": "progress",
                        "taskId": context.task_id,
                        "kind": context.kind,
                        "phase": "recording",
                        "receivedBytes": context.bytes_written + written,
                        "segmentIndex": segment_index,
                        "durationMs": int(max(self._clock() - (recording_deadline - context.duration_seconds), 0) * 1000),
                    })
                    now = self._clock()
                    if now >= recording_deadline:
                        return LiveConnectionResult("duration", written)
                    if now >= segment_deadline:
                        return LiveConnectionResult("segment_duration", written)
        except HTTPError as error:
            raise CandidateFailure(expired=error.code in EXPIRED_SOURCE_STATUSES) from error
        except URLError as error:
            raise CandidateFailure() from error
        finally:
            if response is not None:
                context.release_response(response)
                try:
                    response.close()
                except OSError:
                    pass

    def _progress_callback(
        self,
        context: TaskContext,
        phase: str,
        *,
        extra: Mapping[str, Any] | None = None,
    ) -> Callable[[int, int | None], None]:
        last_at = 0.0

        def callback(received: int, total: int | None) -> None:
            nonlocal last_at
            now = time.monotonic()
            if received != total and now - last_at < 0.25:
                return
            last_at = now
            event: dict[str, Any] = {
                "type": "progress",
                "taskId": context.task_id,
                "kind": context.kind,
                "phase": phase,
                "receivedBytes": received,
            }
            if total is not None:
                event["totalBytes"] = total
            if extra:
                for key, value in extra.items():
                    if value is not None and key not in event:
                        event[key] = value
            self.emit(event)

        return callback

    def _finish_live_stop(self, context: TaskContext, reason: str) -> None:
        context.manifest.update({
            "status": "completed",
            "stopReason": reason,
            "bytesWritten": context.bytes_written,
            "segmentCount": len(context.manifest.get("segments", [])),
            "completedAt": _utc_timestamp(),
        })
        manifest_updated = self._write_terminal_manifest(context)
        self.emit({
            "type": "completed",
            "taskId": context.task_id,
            "kind": context.kind,
            "outputName": context.output_name,
            "bytesWritten": context.bytes_written,
            "segmentCount": len(context.manifest.get("segments", [])),
            "manifest": context.manifest_path.name,
            "manifestUpdated": manifest_updated,
        })

    def _finish_canceled(self, context: TaskContext) -> None:
        context.manifest.update({
            "status": "canceled",
            "bytesWritten": context.bytes_written,
            "completedAt": _utc_timestamp(),
        })
        manifest_updated = self._write_terminal_manifest(context)
        self.emit({
            "type": "canceled",
            "taskId": context.task_id,
            "kind": context.kind,
            "outputName": context.output_name,
            "bytesWritten": context.bytes_written,
            "manifest": context.manifest_path.name,
            "manifestUpdated": manifest_updated,
        })

    def _finish_failed(self, context: TaskContext, error: CompanionError) -> None:
        context.manifest.update({
            "status": "failed",
            "failureCode": error.code,
            "bytesWritten": context.bytes_written,
            "completedAt": _utc_timestamp(),
        })
        manifest_updated = self._write_terminal_manifest(context)
        self.emit({
            "type": "failed",
            "taskId": context.task_id,
            "kind": context.kind,
            "outputName": context.output_name,
            "bytesWritten": context.bytes_written,
            "manifest": context.manifest_path.name,
            "manifestUpdated": manifest_updated,
            "code": error.code,
            "message": error.message,
        })

    @staticmethod
    def _write_terminal_manifest(context: TaskContext) -> bool:
        try:
            _write_manifest(context)
        except CompanionError:
            return False
        return True

    def _release_task(self, context: TaskContext) -> None:
        context.done_event.set()
        with self._tasks_lock:
            self._tasks.pop(context.task_id, None)
            self._release_storage_locked(context.task_id)
            self._release_output_path_locked(context.output_path)
        # Release sensitive URLs immediately after terminal state.  The manifest
        # only contains local filenames and counters, never this source state.
        with context.source_lock:
            context.dash_video = None
            context.dash_audio = None
            context.live_sources = ()
        context.close_active_responses()


@dataclass(frozen=True)
class LiveConnectionResult:
    reason: str
    bytes_written: int


def mux_with_ffmpeg(
    video_part: Path,
    audio_part: Path,
    output_path: Path,
    *,
    cancel_event: threading.Event | None = None,
) -> None:
    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise CompanionError("ffmpeg_missing", "FFmpeg is required to merge the local DASH streams.")
    command = [
        ffmpeg,
        "-hide_banner",
        "-nostdin",
        "-y",
        "-i", str(video_part),
        "-i", str(audio_part),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c", "copy",
        "-movflags", "+faststart",
        str(output_path),
    ]
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as error:
        raise CompanionError("ffmpeg_start_failed", "FFmpeg could not be started.") from error
    while process.poll() is None:
        if cancel_event is not None and cancel_event.wait(0.1):
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
            output_path.unlink(missing_ok=True)
            raise CanceledError()
        if cancel_event is None:
            time.sleep(0.1)
    if process.returncode != 0:
        raise CompanionError("mux_failed", "FFmpeg could not merge the local DASH streams.")


def find_ffmpeg() -> str | None:
    installed = shutil.which("ffmpeg")
    if installed:
        return installed
    try:
        import imageio_ffmpeg
    except ImportError:
        return None
    try:
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def run_native_host(
    stdin: BinaryIO,
    stdout: BinaryIO,
    *,
    output_dir: Path,
    max_disk_bytes: int,
) -> int:
    output_lock = threading.Lock()

    def emit(event: dict[str, Any]) -> None:
        with output_lock:
            write_native_message(stdout, event)

    host = CompanionHost(output_dir=output_dir, max_disk_bytes=max_disk_bytes, emit=emit)
    while True:
        try:
            message = read_native_message(stdin)
        except ProtocolError:
            # Do not echo malformed input: it could contain a signed URL or
            # cookie.  A generic event keeps the protocol observable safely.
            emit({"version": PROTOCOL_VERSION, "type": "error", "code": "invalid_request", "message": "Invalid companion request."})
            continue
        if message is None:
            host.shutdown()
            return 0
        try:
            host.handle(message)
        except ProtocolError as error:
            request_id = _safe_request_id_from_message(message)
            event: dict[str, Any] = {
                "version": PROTOCOL_VERSION,
                "type": "error",
                "code": "invalid_request",
                "message": str(error),
            }
            if request_id:
                event["requestId"] = request_id
            emit(event)
        except CompanionError as error:
            request_id = _safe_request_id_from_message(message)
            event = {
                "version": PROTOCOL_VERSION,
                "type": "error",
                "code": error.code,
                "message": error.message,
            }
            if request_id:
                event["requestId"] = request_id
            emit(event)
        except Exception:
            request_id = _safe_request_id_from_message(message)
            event = {
                "version": PROTOCOL_VERSION,
                "type": "error",
                "code": "internal_error",
                "message": "The companion could not start the request.",
            }
            if request_id:
                event["requestId"] = request_id
            emit(event)


def read_native_message(stream: BinaryIO) -> dict[str, Any] | None:
    header = _read_exact(stream, 4)
    if header is None:
        return None
    length = struct.unpack("<I", header)[0]
    if length <= 0 or length > MAX_NATIVE_MESSAGE_BYTES:
        raise ProtocolError("Invalid native message length.")
    body = _read_exact(stream, length)
    if body is None:
        raise ProtocolError("Truncated native message.")
    try:
        value = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError("Invalid native message JSON.") from error
    if not isinstance(value, dict):
        raise ProtocolError("The native message must be an object.")
    return value


def write_native_message(stream: BinaryIO, message: Mapping[str, Any]) -> None:
    encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_NATIVE_MESSAGE_BYTES:
        raise ProtocolError("Native response exceeds the message limit.")
    stream.write(struct.pack("<I", len(encoded)))
    stream.write(encoded)
    stream.flush()


def _read_exact(stream: BinaryIO, size: int) -> bytes | None:
    chunks = bytearray()
    while len(chunks) < size:
        data = stream.read(size - len(chunks))
        if not data:
            return None if not chunks else None
        chunks.extend(data)
    return bytes(chunks)


def _payload(message: Mapping[str, Any]) -> Mapping[str, Any]:
    payload = message.get("payload")
    if not isinstance(payload, Mapping):
        raise ProtocolError("The request payload must be an object.")
    return payload


def _request_id(value: Any) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        raise ProtocolError("requestId must be a short identifier.")
    return value


def _task_id(value: Any) -> str:
    if not isinstance(value, str) or not IDENTIFIER_RE.fullmatch(value):
        raise ProtocolError("taskId must be a short identifier.")
    return value


def _safe_request_id_from_message(message: Mapping[str, Any]) -> str | None:
    value = message.get("requestId")
    return value if isinstance(value, str) and IDENTIFIER_RE.fullmatch(value) else None


def _reject_forbidden_fields(value: Any) -> None:
    if isinstance(value, Mapping):
        for key, child in value.items():
            normalized = str(key).replace("-", "_").lower()
            if (
                normalized in {name.replace("-", "_") for name in FORBIDDEN_FIELD_NAMES}
                or any(fragment in normalized for fragment in ("header", "cookie", "authorization", "proxy"))
            ):
                raise ProtocolError("Cookies, authorization, and custom request headers are not accepted.")
            _reject_forbidden_fields(child)
    elif isinstance(value, (list, tuple)):
        for child in value:
            _reject_forbidden_fields(child)


def _safe_output_name(value: Any, *, suffix: str | None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ProtocolError("outputName is required.")
    if "/" in value or "\\" in value or "://" in value or "?" in value or "&" in value:
        raise ProtocolError("outputName must be a plain filename.")
    cleaned = re.sub(r"[<>:\"|*\x00-\x1f]", "_", value).strip(" ._")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned or cleaned in {".", ".."}:
        raise ProtocolError("outputName is invalid.")
    if WINDOWS_RESERVED_NAME_RE.fullmatch(cleaned):
        raise ProtocolError("outputName uses a reserved filename.")
    if suffix:
        normalized_suffix = suffix.lower()
        if cleaned.lower().endswith(normalized_suffix):
            stem = cleaned[:-len(suffix)]
            extension = cleaned[-len(suffix):]
        else:
            stem = cleaned
            extension = suffix
        stem = stem[:max(1, 180 - len(extension))].rstrip(" ._")
        cleaned = f"{stem or 'bili_download'}{extension}"
    else:
        cleaned = cleaned[:180]
    if WINDOWS_RESERVED_NAME_RE.fullmatch(cleaned):
        raise ProtocolError("outputName uses a reserved filename.")
    return cleaned


def _safe_referer(value: Any, *, default: str) -> str:
    candidate = default if value in {None, ""} else value
    if not isinstance(candidate, str):
        raise ProtocolError("referer must be a URL.")
    parsed = urlparse(candidate)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or host not in ALLOWED_REFERER_HOSTS:
        raise ProtocolError("referer must be a Bilibili page origin.")
    return f"https://{host}/"


def _source_list(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ProtocolError("sources must be a non-empty list.")
    if len(value) > MAX_SOURCE_CANDIDATES:
        raise ProtocolError("Too many media source candidates.")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ProtocolError("Each media source must be a URL string.")
        if not _is_allowed_media_url(item):
            raise ProtocolError("Media sources must be HTTPS Bilibili CDN URLs.")
        if item not in seen:
            seen.add(item)
            result.append(item)
    if not result:
        raise ProtocolError("No usable media source was provided.")
    return tuple(result)


def _stream_input(value: Any) -> StreamInput:
    if not isinstance(value, Mapping):
        raise ProtocolError("A DASH stream object is required.")
    sources = _source_list(value.get("sources"))
    expected = _optional_positive_int(value.get("expectedBytes"), label="expectedBytes")
    return StreamInput(sources=sources, expected_bytes=expected)


def _task_max_bytes(value: Any, configured_max: int) -> int:
    if configured_max <= 0:
        raise ValueError("configured max disk bytes must be positive")
    if value is None:
        return configured_max
    requested = _bounded_int(value, minimum=1, maximum=configured_max, label="maxBytes")
    return requested


def _positive_budget(value: Any) -> int:
    try:
        numeric = int(value)
    except (TypeError, ValueError) as error:
        raise CompanionError("disk_space", "The local storage budget is invalid.") from error
    if numeric <= 0:
        raise CompanionError("disk_space", "The local storage budget is invalid.")
    return numeric


def _dash_raw_budget(video: StreamInput, audio: StreamInput, max_bytes: int) -> int:
    # If either response size is unknown, reserve the configured raw cap.  A
    # partial size estimate must not under-admit a stream whose Content-Length
    # is unavailable or changes after URL refresh.
    if video.expected_bytes is None or audio.expected_bytes is None:
        return max_bytes
    return min(max_bytes, max(video.expected_bytes + audio.expected_bytes, 1))


def _dash_mux_requirement(
    video: StreamInput | None,
    audio: StreamInput | None,
    max_bytes: int,
) -> int:
    if video is None or audio is None:
        raw_budget = max_bytes
    else:
        raw_budget = _dash_raw_budget(video, audio, max_bytes)
    # FFmpeg reads both parts while writing the final container.  Reserve an
    # output-sized copy plus fixed metadata/scratch headroom.
    return raw_budget + DISK_SPACE_HEADROOM_BYTES


def _dash_storage_requirement(video: StreamInput, audio: StreamInput, max_bytes: int) -> int:
    raw_budget = _dash_raw_budget(video, audio, max_bytes)
    return raw_budget + _dash_mux_requirement(video, audio, max_bytes)


def _live_storage_requirement(max_bytes: int) -> int:
    return max_bytes + DISK_SPACE_HEADROOM_BYTES


def _optional_positive_int(value: Any, *, label: str) -> int | None:
    if value in {None, ""}:
        return None
    return _bounded_int(value, minimum=1, maximum=DEFAULT_MAX_DISK_BYTES, label=label)


def _bounded_int(value: Any, *, minimum: int, maximum: int, label: str) -> int:
    if isinstance(value, bool):
        raise ProtocolError(f"{label} must be a number.")
    try:
        numeric = int(value)
    except (TypeError, ValueError) as error:
        raise ProtocolError(f"{label} must be a number.") from error
    if numeric < minimum or numeric > maximum:
        raise ProtocolError(f"{label} is outside the allowed range.")
    return numeric


def _assert_expected_total_within_limit(video: StreamInput, audio: StreamInput, max_bytes: int) -> None:
    known_total = (video.expected_bytes or 0) + (audio.expected_bytes or 0)
    if known_total > max_bytes:
        raise ProtocolError("Known DASH input sizes exceed maxBytes.")


def _allowed_cdn_host(host: str) -> bool:
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in ALLOWED_CDN_SUFFIXES)


def _is_allowed_media_url(value: str) -> bool:
    parsed = urlparse(value)
    host = (parsed.hostname or "").lower()
    return (
        parsed.scheme == "https"
        and bool(host)
        and parsed.username is None
        and parsed.password is None
        and _allowed_cdn_host(host)
    )


def build_safe_opener():
    return build_opener(SafeMediaRedirectHandler())


def _media_request_headers(referer: str) -> dict[str, str]:
    # Keep the Origin aligned with the extension's narrow DNR rules.  The
    # referer still identifies the allowed video or live page origin, while the
    # host never accepts a caller-provided header object.
    origin = "https://www.bilibili.com"
    return {
        "Accept": "*/*",
        "Origin": origin,
        "Referer": referer,
        "User-Agent": "BiliDownloadStreamCompanion/1.0",
    }


def _response_status(response: Any) -> int:
    value = getattr(response, "status", None)
    if value is None and hasattr(response, "getcode"):
        value = response.getcode()
    try:
        return int(value)
    except (TypeError, ValueError):
        return 200


def _header(response: Any, name: str) -> str:
    headers = getattr(response, "headers", None)
    if headers is None:
        return ""
    try:
        value = headers.get(name)
    except AttributeError:
        return ""
    return str(value or "")


def _parse_content_range(value: str) -> tuple[int, int, int | None] | None:
    match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+|\*)", value.strip(), re.IGNORECASE)
    if not match:
        return None
    start, end = int(match.group(1)), int(match.group(2))
    total = None if match.group(3) == "*" else int(match.group(3))
    if end < start:
        return None
    return start, end, total


def _positive_int(value: str) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _existing_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def _unique_output_path(output_dir: Path, output_name: str, *, reserve_suffix: str = "") -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    original = Path(output_name)
    stem = original.stem
    suffix = original.suffix
    index = 0
    while True:
        candidate_name = output_name if index == 0 else f"{stem}_{index}{suffix}"
        candidate = (output_dir / candidate_name).resolve()
        try:
            candidate.relative_to(output_dir)
        except ValueError as error:
            raise ProtocolError("outputName escapes the companion output directory.") from error
        manifest = candidate.with_name(f"{candidate.name}{reserve_suffix}") if reserve_suffix else candidate.with_suffix(".manifest.json")
        dash_parts_exist = _dash_part_path(candidate, "video").exists() or _dash_part_path(candidate, "audio").exists()
        live_prefix = f"{candidate.name}.segment-"
        try:
            live_parts_exist = any(path.name.startswith(live_prefix) for path in output_dir.iterdir())
        except OSError:
            live_parts_exist = True
        if not candidate.exists() and not manifest.exists() and not dash_parts_exist and not live_parts_exist:
            return candidate
        index += 1


def _dash_part_path(output_path: Path, role: str) -> Path:
    return output_path.with_name(f"{output_path.stem}.{role}.part.m4s")


def _dash_mux_temp_path(output_path: Path, task_id: str) -> Path:
    return output_path.with_name(f".{output_path.name}.{task_id}.mux.tmp")


def _live_segment_path(output_path: Path, segment_index: int) -> Path:
    return output_path.with_name(f"{output_path.name}.segment-{segment_index:04d}.flv")


def _cleanup_dash_artifacts(output_path: Path, task_id: str) -> None:
    paths = (
        _dash_part_path(output_path, "video"),
        _dash_part_path(output_path, "audio"),
        _dash_mux_temp_path(output_path, task_id),
    )
    for path in paths:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            # Cleanup must not replace the terminal task result with a raw
            # filesystem exception or expose a local path to the protocol.
            pass


def _cleanup_live_part_files(context: TaskContext) -> None:
    for path in context.live_parts_snapshot():
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        finally:
            context.release_live_part(path)


def _base_manifest(context: TaskContext) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": context.kind,
        "taskId": context.task_id,
        "status": "running",
        "outputName": context.output_name,
        "startedAt": _utc_timestamp(),
        "maxBytes": context.max_bytes,
    }


def _write_manifest(context: TaskContext) -> None:
    # Manifest content is constructed solely from safe filenames, counters, and
    # fixed status values.  In particular, TaskContext source URLs are omitted.
    context.manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = context.manifest_path.with_name(f"{context.manifest_path.name}.tmp")
    try:
        temporary.write_text(
            json.dumps(context.manifest, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        temporary.replace(context.manifest_path)
    except OSError as error:
        raise CompanionError("local_io", "The companion could not update its local manifest.") from error


def _utc_timestamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def default_output_dir() -> Path:
    configured = os.environ.get("BILI_STREAM_COMPANION_OUTPUT_DIR", "").strip()
    if configured:
        return Path(configured)
    return Path.home() / "Videos" / "BiliDownload"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bili Download local streaming companion")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=default_output_dir(),
        help="local output directory; Chrome native-host registration normally uses the default",
    )
    parser.add_argument(
        "--max-disk-gib",
        type=int,
        default=128,
        help="hard per-task raw-input disk cap (1-1024 GiB, default: 128)",
    )
    args, native_launch_arguments = parser.parse_known_args(argv)
    if any(not _is_native_launch_argument(value) for value in native_launch_arguments):
        parser.error("unexpected command-line argument")
    return args


def _is_native_launch_argument(value: str) -> bool:
    # Chromium may append the invoking extension origin and a parent-window
    # handle when it launches a native host.  They are not protocol data and
    # must be ignored rather than interpreted as a media URL or configuration.
    return bool(NATIVE_ORIGIN_ARGUMENT_RE.fullmatch(value)) or value.startswith("--parent-window=")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.max_disk_gib < 1 or args.max_disk_gib > 1024:
        raise SystemExit("--max-disk-gib must be between 1 and 1024")
    return run_native_host(
        sys.stdin.buffer,
        sys.stdout.buffer,
        output_dir=args.output_dir,
        max_disk_bytes=args.max_disk_gib * 1024 * 1024 * 1024,
    )


if __name__ == "__main__":
    raise SystemExit(main())
