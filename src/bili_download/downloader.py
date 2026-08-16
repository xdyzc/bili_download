"""Minimal no-cookie downloader for public Bilibili videos."""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import replace
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Callable, Iterator

from .client import BiliClient, BiliNetworkError
from .danmaku import parse_danmaku_xml, write_ass
from .models import DashMedia, DownloadResult, PlayUrl, StreamSegment, VideoInfo, VideoPage
from .video_id import parse_bili_video_ref


CHUNK_SIZE = 1024 * 256
ProgressCallback = Callable[[str, int, int | None, bool], None]


class UnsupportedStreamError(RuntimeError):
    """Raised when the first downloader version cannot handle a stream."""


class DownloadIntegrityError(RuntimeError):
    """Raised when a media response cannot be published as a complete file."""


class BiliDownloader:
    def __init__(self, client: BiliClient | None = None) -> None:
        self.client = client or BiliClient()

    def download(
        self,
        url_or_bv: str,
        *,
        output_dir: Path = Path("downloads"),
        output_file: Path | None = None,
        page: int | None = None,
        quality: int | None = None,
        progress: bool = False,
        overwrite: bool = False,
        danmaku: bool = False,
        progress_callback: ProgressCallback | None = None,
    ) -> DownloadResult:
        video_ref = parse_bili_video_ref(url_or_bv)
        video = self.client.get_video_info(video_ref)
        target_page = _select_page(video, page or video_ref.page)
        play_url = self.client.get_play_url(
            bvid=video.bvid,
            cid=target_page.cid,
            quality=quality,
        )
        path = output_file or _default_output_path(output_dir, video, target_page, play_url)
        if play_url.dash_videos:
            return self._download_dash(
                video=video,
                page=target_page,
                play_url=play_url,
                path=path,
                requested_quality=quality,
                progress=progress,
                overwrite=overwrite,
                danmaku=danmaku,
                progress_callback=progress_callback,
            )

        if not play_url.segments:
            raise UnsupportedStreamError(
                "Bilibili did not return a supported durl or DASH stream."
            )

        path.parent.mkdir(parents=True, exist_ok=True)
        with _reserve_output(path, overwrite=overwrite):
            part_path = _new_staging_path(path, suffix=".part")
            referer = f"https://www.bilibili.com/video/{video.bvid}/"
            total = sum(segment.size or 0 for segment in play_url.segments) or None
            bytes_written = 0
            with part_path.open("wb") as destination:
                for segment in play_url.segments:
                    bytes_written += self._write_stream(
                        segment,
                        referer=referer,
                        destination=destination,
                        label="video",
                        total=total,
                        initial=bytes_written,
                        progress=progress,
                        progress_callback=progress_callback,
                    )
            os.replace(part_path, path)

        result = DownloadResult(
            path=path,
            bytes_written=bytes_written,
            segments=len(play_url.segments),
            video=video,
            page=target_page,
            play_url=play_url,
            mode="durl",
        )
        if danmaku:
            result = self._add_danmaku(
                result,
                overwrite=overwrite,
                progress_callback=progress_callback,
            )
        return result

    def _download_dash(
        self,
        *,
        video: VideoInfo,
        page: VideoPage,
        play_url: PlayUrl,
        path: Path,
        requested_quality: int | None,
        progress: bool,
        overwrite: bool,
        danmaku: bool,
        progress_callback: ProgressCallback | None,
    ) -> DownloadResult:
        video_stream = _select_dash_video(play_url, requested_quality)
        audio_stream = _select_dash_audio(play_url)
        if audio_stream is None:
            raise UnsupportedStreamError("DASH response did not include an audio stream.")

        path = path.with_suffix(".mp4")
        path.parent.mkdir(parents=True, exist_ok=True)
        with _reserve_output(path, overwrite=overwrite):
            video_part = _new_staging_path(path, suffix=".video.part")
            audio_part = _new_staging_path(path, suffix=".audio.part")
            referer = f"https://www.bilibili.com/video/{video.bvid}/"
            bytes_written = 0
            with video_part.open("wb") as destination:
                bytes_written += self._write_stream(
                    video_stream,
                    referer=referer,
                    destination=destination,
                    label=f"video qn={video_stream.id}",
                    total=video_stream.size,
                    progress=progress,
                    progress_callback=progress_callback,
                )
            with audio_part.open("wb") as destination:
                bytes_written += self._write_stream(
                    audio_stream,
                    referer=referer,
                    destination=destination,
                    label="audio",
                    total=audio_stream.size,
                    progress=progress,
                    progress_callback=progress_callback,
                )

            if progress_callback:
                progress_callback("merge", 0, None, False)
            _merge_with_ffmpeg(video_part, audio_part, path, overwrite=overwrite)
            if progress_callback:
                progress_callback("merge", 1, 1, True)
            video_part.unlink(missing_ok=True)
            audio_part.unlink(missing_ok=True)

        result = DownloadResult(
            path=path,
            bytes_written=bytes_written,
            segments=2,
            video=video,
            page=page,
            play_url=play_url,
            mode="dash",
        )
        if danmaku:
            result = self._add_danmaku(
                result,
                width=video_stream.width,
                height=video_stream.height,
                overwrite=overwrite,
                progress_callback=progress_callback,
            )
        return result

    def _add_danmaku(
        self,
        result: DownloadResult,
        *,
        width: int | None = None,
        height: int | None = None,
        overwrite: bool,
        progress_callback: ProgressCallback | None = None,
    ) -> DownloadResult:
        xml_path = result.path.with_name(f"{result.path.stem}.danmaku.xml")
        ass_path = result.path.with_name(f"{result.path.stem}.danmaku.ass")
        video_path = _danmaku_output_path(result.path)
        if not overwrite:
            existing = next((path for path in (video_path, xml_path, ass_path) if path.exists()), None)
            if existing is not None:
                raise FileExistsError(f"danmaku output file already exists: {existing}")

        xml_text = self.client.get_danmaku_xml(
            cid=result.page.cid,
            bvid=result.video.bvid,
        )
        _write_text_atomic(xml_path, xml_text)
        events = parse_danmaku_xml(xml_text)
        ass_staging = _new_staging_path(ass_path, suffix=".ass")
        write_ass(
            events,
            ass_staging,
            width=width or 1920,
            height=height or 1080,
            video_duration=result.page.duration,
        )
        os.replace(ass_staging, ass_path)
        if not events:
            return replace(
                result,
                danmaku_xml_path=xml_path,
                danmaku_ass_path=ass_path,
                danmaku_count=0,
            )

        if progress_callback:
            progress_callback("danmaku", 0, None, False)
        with _reserve_output(video_path, overwrite=overwrite):
            _burn_ass_with_ffmpeg(
                result.path,
                ass_path,
                video_path,
                overwrite=overwrite,
            )
        if progress_callback:
            progress_callback("danmaku", 1, 1, True)
        return replace(
            result,
            danmaku_video_path=video_path,
            danmaku_xml_path=xml_path,
            danmaku_ass_path=ass_path,
            danmaku_count=len(events),
        )

    def _write_stream(
        self,
        stream: StreamSegment | DashMedia,
        *,
        referer: str,
        destination,
        label: str,
        total: int | None = None,
        initial: int = 0,
        progress: bool,
        progress_callback: ProgressCallback | None = None,
    ) -> int:
        start_position = destination.tell()
        last_error: Exception | None = None
        for url in stream.urls:
            destination.seek(start_position)
            destination.truncate()
            written = 0
            started = time.monotonic()
            try:
                with self.client.open_stream((url,), referer=referer) as response:
                    response_length = _content_length(response)
                    expected = stream.size if stream.size and stream.size > 0 else response_length
                    progress_total = total or expected
                    while True:
                        chunk = response.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        destination.write(chunk)
                        written += len(chunk)
                        if progress:
                            _print_progress(
                                label,
                                initial + written,
                                progress_total,
                                started,
                            )
                        if progress_callback:
                            progress_callback(
                                label,
                                initial + written,
                                progress_total,
                                False,
                            )
                if expected is not None and written != expected:
                    raise DownloadIntegrityError(
                        f"media response was truncated: expected {expected} bytes, received {written}"
                    )
            except (BiliNetworkError, OSError, TimeoutError, DownloadIntegrityError) as exc:
                last_error = exc
                continue

            if progress:
                _print_progress(
                    label,
                    initial + written,
                    progress_total,
                    started,
                    done=True,
                )
            if progress_callback:
                progress_callback(label, initial + written, progress_total, True)
            return written

        destination.seek(start_position)
        destination.truncate()
        raise DownloadIntegrityError(f"all media sources failed: {last_error}") from last_error

    def get_available_qualities(
        self,
        url_or_bv: str,
        *,
        page: int | None = None,
    ) -> tuple[VideoInfo, VideoPage, PlayUrl]:
        video_ref = parse_bili_video_ref(url_or_bv)
        video = self.client.get_video_info(video_ref)
        target_page = _select_page(video, page or video_ref.page)
        play_url = self.client.get_play_url(bvid=video.bvid, cid=target_page.cid)
        return video, target_page, play_url


def _select_page(video: VideoInfo, page: int | None) -> VideoPage:
    if page is None:
        return video.pages[0]

    for item in video.pages:
        if item.index == page:
            return item

    available = ", ".join(str(item.index) for item in video.pages)
    raise ValueError(f"page {page} was not found; available pages: {available}")


def _select_dash_video(play_url: PlayUrl, requested_quality: int | None) -> DashMedia:
    candidates = [
        stream
        for stream in play_url.dash_videos
        if requested_quality is None or stream.id == requested_quality
    ]
    if not candidates and requested_quality is not None:
        available = ", ".join(str(item.id) for item in _unique_dash_qualities(play_url))
        raise ValueError(
            f"quality {requested_quality} was not found in DASH streams; "
            f"available qualities: {available}"
        )
    if not candidates:
        candidates = list(play_url.dash_videos)
    if not candidates:
        raise UnsupportedStreamError("DASH response did not include video streams.")

    def score(stream: DashMedia) -> tuple[int, int, int, int]:
        codec_score = 0 if stream.codecs.startswith("av01") else 1
        return (
            stream.id,
            _frame_rate_number(stream.frame_rate),
            stream.bandwidth or 0,
            codec_score,
        )

    return max(candidates, key=score)


def _select_dash_audio(play_url: PlayUrl) -> DashMedia | None:
    if not play_url.dash_audios:
        return None
    return max(play_url.dash_audios, key=lambda stream: stream.bandwidth or 0)


def _unique_dash_qualities(play_url: PlayUrl) -> tuple[DashMedia, ...]:
    result: list[DashMedia] = []
    seen: set[int] = set()
    for stream in sorted(play_url.dash_videos, key=lambda item: item.id, reverse=True):
        if stream.id in seen:
            continue
        seen.add(stream.id)
        result.append(stream)
    return tuple(result)


def _default_output_path(
    output_dir: Path,
    video: VideoInfo,
    page: VideoPage,
    play_url: PlayUrl,
) -> Path:
    name = f"{_safe_filename(video.title)}_{_safe_filename(video.bvid)}"
    if len(video.pages) > 1:
        name = f"{name}_P{page.index}_{_safe_filename(page.title)}"
    return output_dir / f"{name}{_extension_for(play_url)}"


def _safe_filename(value: str, *, fallback: str = "bili_video") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" ._")
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned[:120] or fallback
    stem = cleaned.split(".", 1)[0].lower()
    if stem in {"con", "prn", "aux", "nul"} or re.fullmatch(r"(?:com|lpt)[1-9]", stem):
        cleaned = f"_{cleaned}"
    return cleaned


def _extension_for(play_url: PlayUrl) -> str:
    if play_url.dash_videos:
        return ".mp4"
    media_format = play_url.format.lower()
    if "mp4" in media_format:
        return ".mp4"
    if "flv" in media_format:
        return ".flv"
    return ".flv"


def _content_length(response) -> int | None:
    try:
        value = response.headers.get("Content-Length")
    except AttributeError:
        return None
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _print_progress(
    label: str,
    written: int,
    total: int | None,
    started: float,
    *,
    done: bool = False,
) -> None:
    elapsed = max(time.monotonic() - started, 0.001)
    speed = written / elapsed
    if total:
        percent = min(written / total * 100, 100)
        bar = _progress_bar(percent)
        line = (
            f"\r{label}: [{bar}] {percent:6.2f}% "
            f"{_format_bytes(written)}/{_format_bytes(total)} "
            f"{_format_speed(speed)}"
        )
    else:
        line = f"\r{label}: {_format_bytes(written)} {_format_speed(speed)}"
    if done:
        line += "\n"
    print(line, end="", file=sys.stderr, flush=True)


def _format_bytes(value: float) -> str:
    units = ("B", "KB", "MB", "GB")
    size = float(value)
    for unit in units:
        if size < 1024 or unit == units[-1]:
            return f"{size:.1f}{unit}"
        size /= 1024
    return f"{size:.1f}GB"


def _format_speed(bytes_per_second: float) -> str:
    return f"{_format_bytes(bytes_per_second)}/s"


def _progress_bar(percent: float, *, width: int = 28) -> str:
    filled = int(width * max(0.0, min(percent, 100.0)) / 100)
    return "#" * filled + "-" * (width - filled)


def _danmaku_output_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}.danmaku{path.suffix}")


def _escape_ass_filter_path(path: Path) -> str:
    escaped = str(path).replace("\\", "/")
    for character in ("\\", ":", "'", ",", ";", "[", "]"):
        escaped = escaped.replace(character, f"\\{character}")
    return escaped


def _frame_rate_number(value: str) -> int:
    try:
        return int(float(value))
    except ValueError:
        return 0


def _merge_with_ffmpeg(
    video_part: Path,
    audio_part: Path,
    output_path: Path,
    *,
    overwrite: bool,
) -> None:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise UnsupportedStreamError(
            "DASH video and audio were downloaded, but ffmpeg was not found. "
            "Run '.\\.venv\\Scripts\\python.exe -m pip install -e . pytest' "
            f"to install the bundled ffmpeg helper. Temporary files: {video_part}, {audio_part}"
        )

    temp_path = _new_staging_path(output_path, suffix=".mux.mp4")
    command = [
        ffmpeg,
        "-y",
        "-nostdin",
        "-i",
        str(video_part),
        "-i",
        str(audio_part),
        "-c",
        "copy",
        str(temp_path),
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        temp_path.unlink(missing_ok=True)
        stderr = completed.stderr.decode("utf-8", errors="replace")
        raise UnsupportedStreamError(
            "ffmpeg failed to merge DASH video and audio. "
            f"Temporary files: {video_part}, {audio_part}\n{stderr.strip()}"
        )
    _publish_staging_file(temp_path, output_path, label="merged DASH output")


def _burn_ass_with_ffmpeg(
    input_path: Path,
    ass_path: Path,
    output_path: Path,
    *,
    overwrite: bool,
) -> None:
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        raise UnsupportedStreamError(
            "Danmaku ASS was written, but ffmpeg was not found. "
            "Install the bundled ffmpeg helper with '.\\.venv\\Scripts\\python.exe -m pip install -e .'. "
            f"Original video: {input_path}; ASS: {ass_path}"
        )

    temp_path = _new_staging_path(output_path, suffix=".danmaku.mp4")

    command = [
        ffmpeg,
        "-hide_banner",
        "-y",
        "-nostdin",
        "-i",
        str(input_path),
        "-vf",
        f"ass='{_escape_ass_filter_path(ass_path)}'",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(temp_path),
    ]
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        temp_path.unlink(missing_ok=True)
        stderr = completed.stderr.decode("utf-8", errors="replace")
        raise UnsupportedStreamError(
            "ffmpeg failed to burn danmaku into the video. "
            f"Original video: {input_path}; ASS: {ass_path}\n{stderr.strip()}"
        )

    _publish_staging_file(temp_path, output_path, label="danmaku output")


def _new_staging_path(output_path: Path, *, suffix: str) -> Path:
    descriptor, raw_path = tempfile.mkstemp(
        dir=output_path.parent,
        prefix=f".{output_path.stem}.",
        suffix=suffix,
    )
    os.close(descriptor)
    return Path(raw_path)


@contextmanager
def _reserve_output(output_path: Path, *, overwrite: bool) -> Iterator[None]:
    reserved = False
    if not overwrite:
        try:
            descriptor = os.open(output_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise FileExistsError(f"output file already exists: {output_path}") from None
        else:
            os.close(descriptor)
            reserved = True
    try:
        yield
        if not output_path.is_file() or output_path.stat().st_size <= 0:
            raise DownloadIntegrityError(f"output file was not finalized: {output_path}")
    except Exception:
        if reserved:
            output_path.unlink(missing_ok=True)
        raise


def _publish_staging_file(staging_path: Path, output_path: Path, *, label: str) -> None:
    try:
        if not staging_path.is_file() or staging_path.stat().st_size <= 0:
            raise DownloadIntegrityError(f"{label} is empty")
        os.replace(staging_path, output_path)
    except Exception:
        staging_path.unlink(missing_ok=True)
        raise


def _write_text_atomic(output_path: Path, value: str) -> None:
    staging_path = _new_staging_path(output_path, suffix=".txt")
    try:
        staging_path.write_text(value, encoding="utf-8")
        os.replace(staging_path, output_path)
    except Exception:
        staging_path.unlink(missing_ok=True)
        raise


def _find_ffmpeg() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    try:
        import imageio_ffmpeg
    except ImportError:
        return None
    return imageio_ffmpeg.get_ffmpeg_exe()
