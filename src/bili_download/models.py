"""Shared data models for Bilibili video metadata and downloads."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VideoPage:
    index: int
    cid: int
    title: str
    duration: int | None = None


@dataclass(frozen=True)
class VideoInfo:
    bvid: str
    aid: int
    title: str
    owner_name: str
    pages: tuple[VideoPage, ...]


@dataclass(frozen=True)
class StreamSegment:
    url: str
    backup_urls: tuple[str, ...] = ()
    size: int | None = None

    @property
    def urls(self) -> tuple[str, ...]:
        return (self.url, *self.backup_urls)


@dataclass(frozen=True)
class DashMedia:
    id: int
    url: str
    backup_urls: tuple[str, ...] = ()
    bandwidth: int | None = None
    codecs: str = ""
    mime_type: str = ""
    width: int | None = None
    height: int | None = None
    frame_rate: str = ""
    size: int | None = None

    @property
    def urls(self) -> tuple[str, ...]:
        return (self.url, *self.backup_urls)


@dataclass(frozen=True)
class PlayUrl:
    quality: int | None
    format: str
    accept_quality: tuple[int, ...]
    accept_description: tuple[str, ...]
    segments: tuple[StreamSegment, ...]
    dash_videos: tuple[DashMedia, ...] = ()
    dash_audios: tuple[DashMedia, ...] = ()


@dataclass(frozen=True)
class DownloadResult:
    path: Path
    bytes_written: int
    segments: int
    video: VideoInfo
    page: VideoPage
    play_url: PlayUrl
    mode: str = "durl"
    danmaku_video_path: Path | None = None
    danmaku_xml_path: Path | None = None
    danmaku_ass_path: Path | None = None
    danmaku_count: int = 0


@dataclass(frozen=True)
class LoginStatus:
    is_login: bool
    username: str = ""
    user_id: int | None = None
    vip_label: str = ""
