"""Minimal no-cookie downloader for public Bilibili videos."""

from __future__ import annotations

from pathlib import Path
import re

from .client import BiliClient
from .models import DownloadResult, PlayUrl, VideoInfo, VideoPage
from .video_id import parse_bili_video_ref


CHUNK_SIZE = 1024 * 256


class UnsupportedStreamError(RuntimeError):
    """Raised when the first downloader version cannot handle a stream."""


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
        overwrite: bool = False,
    ) -> DownloadResult:
        video_ref = parse_bili_video_ref(url_or_bv)
        video = self.client.get_video_info(video_ref)
        target_page = _select_page(video, page or video_ref.page)
        play_url = self.client.get_play_url(
            bvid=video.bvid,
            cid=target_page.cid,
            quality=quality,
        )
        if not play_url.segments:
            raise UnsupportedStreamError(
                "Bilibili did not return a durl stream. "
                "This first version cannot download DASH-only responses yet."
            )

        path = output_file or _default_output_path(output_dir, video, target_page, play_url)
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and not overwrite:
            raise FileExistsError(f"output file already exists: {path}")

        part_path = path.with_name(f"{path.name}.part")
        if part_path.exists():
            part_path.unlink()

        referer = f"https://www.bilibili.com/video/{video.bvid}/"
        bytes_written = 0
        with part_path.open("wb") as destination:
            for segment in play_url.segments:
                with self.client.open_stream(segment.urls, referer=referer) as response:
                    while True:
                        chunk = response.read(CHUNK_SIZE)
                        if not chunk:
                            break
                        destination.write(chunk)
                        bytes_written += len(chunk)

        if path.exists() and overwrite:
            path.unlink()
        part_path.replace(path)

        return DownloadResult(
            path=path,
            bytes_written=bytes_written,
            segments=len(play_url.segments),
            video=video,
            page=target_page,
            play_url=play_url,
        )

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


def _default_output_path(
    output_dir: Path,
    video: VideoInfo,
    page: VideoPage,
    play_url: PlayUrl,
) -> Path:
    name = _safe_filename(video.title)
    if len(video.pages) > 1:
        name = f"{name}_P{page.index}_{_safe_filename(page.title)}"
    return output_dir / f"{name}{_extension_for(play_url)}"


def _safe_filename(value: str, *, fallback: str = "bili_video") -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", value).strip(" ._")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned[:120] or fallback


def _extension_for(play_url: PlayUrl) -> str:
    media_format = play_url.format.lower()
    if "mp4" in media_format:
        return ".mp4"
    if "flv" in media_format:
        return ".flv"
    return ".flv"
