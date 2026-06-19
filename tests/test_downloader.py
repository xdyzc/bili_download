from __future__ import annotations

from io import BytesIO

import pytest

import bili_download.downloader as downloader_module
from bili_download.downloader import BiliDownloader, UnsupportedStreamError
from bili_download.models import DashMedia, PlayUrl, StreamSegment, VideoInfo, VideoPage
from bili_download.video_id import BiliVideoRef


class FakeResponse(BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()


class FakeClient:
    def __init__(self, play_url: PlayUrl | None = None) -> None:
        self.video = VideoInfo(
            bvid="BV1xx411c7mD",
            aid=170001,
            title="Test Video",
            owner_name="tester",
            pages=(VideoPage(index=1, cid=123, title="Intro"),),
        )
        self.last_quality: int | None = None
        self.play_url = play_url or PlayUrl(
            quality=16,
            format="mp4",
            accept_quality=(16,),
            accept_description=("360P",),
            segments=(
                StreamSegment(url="https://example.test/part-1.mp4"),
                StreamSegment(url="https://example.test/part-2.mp4"),
            ),
        )

    def get_video_info(self, video_ref: BiliVideoRef) -> VideoInfo:
        assert video_ref.bvid == "BV1xx411c7mD"
        return self.video

    def get_play_url(self, *, bvid: str, cid: int, quality: int | None = None) -> PlayUrl:
        assert bvid == "BV1xx411c7mD"
        assert cid == 123
        self.last_quality = quality
        return self.play_url

    def open_stream(self, urls, *, referer: str):
        url = tuple(urls)[0]
        if url.endswith("part-1.mp4"):
            return FakeResponse(b"hello ")
        if url.endswith("video.m4s"):
            return FakeResponse(b"video")
        if url.endswith("audio.m4s"):
            return FakeResponse(b"audio")
        return FakeResponse(b"world")


def test_downloader_writes_segments_to_file(tmp_path) -> None:
    downloader = BiliDownloader(client=FakeClient())

    result = downloader.download("BV1xx411c7mD", output_dir=tmp_path)

    assert result.path.read_bytes() == b"hello world"
    assert result.path.name == "Test Video.mp4"
    assert result.bytes_written == 11
    assert result.segments == 2


def test_downloader_passes_requested_quality(tmp_path) -> None:
    client = FakeClient()
    downloader = BiliDownloader(client=client)

    downloader.download("BV1xx411c7mD", output_dir=tmp_path, quality=80)

    assert client.last_quality == 80


def test_downloader_merges_dash_streams(monkeypatch, tmp_path) -> None:
    client = FakeClient(
        PlayUrl(
            quality=116,
            format="dash",
            accept_quality=(116,),
            accept_description=("1080P60",),
            segments=(),
            dash_videos=(
                DashMedia(
                    id=116,
                    url="https://example.test/video.m4s",
                    bandwidth=1000,
                    height=1080,
                    frame_rate="60.000",
                    codecs="avc1.640033",
                ),
            ),
            dash_audios=(
                DashMedia(
                    id=30280,
                    url="https://example.test/audio.m4s",
                    bandwidth=320000,
                ),
            ),
        )
    )

    def fake_merge(video_part, audio_part, output_path, *, overwrite):
        assert video_part.read_bytes() == b"video"
        assert audio_part.read_bytes() == b"audio"
        output_path.write_bytes(b"merged")

    monkeypatch.setattr(downloader_module, "_merge_with_ffmpeg", fake_merge)
    downloader = BiliDownloader(client=client)

    result = downloader.download("BV1xx411c7mD", output_dir=tmp_path, quality=116)

    assert result.path.read_bytes() == b"merged"
    assert result.mode == "dash"
    assert result.bytes_written == 10


def test_downloader_rejects_dash_only_response(tmp_path) -> None:
    client = FakeClient(
        PlayUrl(
            quality=16,
            format="",
            accept_quality=(),
            accept_description=(),
            segments=(),
        )
    )
    downloader = BiliDownloader(client=client)

    with pytest.raises(UnsupportedStreamError):
        downloader.download("BV1xx411c7mD", output_dir=tmp_path)
