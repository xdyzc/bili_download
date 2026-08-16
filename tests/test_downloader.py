from __future__ import annotations

from io import BytesIO

import pytest

import bili_download.downloader as downloader_module
from bili_download.downloader import BiliDownloader, UnsupportedStreamError
from bili_download.models import DashMedia, PlayUrl, StreamSegment, VideoInfo, VideoPage
from bili_download.video_id import BiliVideoRef


class FakeResponse(BytesIO):
    def __init__(self, value: bytes, *, content_length: int | None = None) -> None:
        super().__init__(value)
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)

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
        self.last_danmaku_cid: int | None = None
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

    def get_danmaku_xml(self, *, cid: int, bvid: str | None = None) -> str:
        assert bvid == "BV1xx411c7mD"
        self.last_danmaku_cid = cid
        return '<i><d p="1,1,25,16777215,0,0,0,1">hello</d></i>'

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
    assert result.path.name == "Test Video_BV1xx411c7mD.mp4"
    assert result.bytes_written == 11
    assert result.segments == 2


def test_downloader_passes_requested_quality(tmp_path) -> None:
    client = FakeClient()
    downloader = BiliDownloader(client=client)

    downloader.download("BV1xx411c7mD", output_dir=tmp_path, quality=80)

    assert client.last_quality == 80


def test_downloader_reports_progress_callback(tmp_path) -> None:
    events = []
    downloader = BiliDownloader(client=FakeClient())

    downloader.download(
        "BV1xx411c7mD",
        output_dir=tmp_path,
        progress_callback=lambda label, written, total, done: events.append(
            (label, written, total, done)
        ),
    )

    assert events
    assert events[-1] == ("video", 11, None, True)


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


def test_downloader_writes_and_burns_danmaku(monkeypatch, tmp_path) -> None:
    client = FakeClient()

    def fake_burn(input_path, ass_path, output_path, *, overwrite):
        assert input_path.read_bytes() == b"hello world"
        assert "Dialogue:" in ass_path.read_text(encoding="utf-8")
        assert overwrite is False
        output_path.write_bytes(b"with danmaku")

    monkeypatch.setattr(downloader_module, "_burn_ass_with_ffmpeg", fake_burn)
    downloader = BiliDownloader(client=client)

    result = downloader.download("BV1xx411c7mD", output_dir=tmp_path, danmaku=True)

    assert client.last_danmaku_cid == 123
    assert result.path.read_bytes() == b"hello world"
    assert result.danmaku_video_path is not None
    assert result.danmaku_video_path.read_bytes() == b"with danmaku"
    assert result.danmaku_xml_path is not None
    assert result.danmaku_xml_path.read_text(encoding="utf-8").startswith("<i>")
    assert result.danmaku_ass_path is not None
    assert result.danmaku_count == 1


def test_downloader_keeps_zero_danmaku_result_without_burning(monkeypatch, tmp_path) -> None:
    client = FakeClient()
    client.get_danmaku_xml = lambda *, cid, bvid=None: "<i></i>"  # type: ignore[method-assign]

    def fail_burn(*args, **kwargs):
        raise AssertionError("empty danmaku should not invoke ffmpeg")

    monkeypatch.setattr(downloader_module, "_burn_ass_with_ffmpeg", fail_burn)
    downloader = BiliDownloader(client=client)

    result = downloader.download("BV1xx411c7mD", output_dir=tmp_path, danmaku=True)

    assert result.danmaku_video_path is None
    assert result.danmaku_xml_path is not None
    assert result.danmaku_ass_path is not None
    assert result.danmaku_count == 0


def test_progress_output_has_bar_and_single_speed_suffix(monkeypatch, capsys) -> None:
    monkeypatch.setattr(downloader_module.time, "monotonic", lambda: 10.0)

    downloader_module._print_progress(
        "video qn=126",
        50,
        100,
        9.0,
        done=True,
    )

    output = capsys.readouterr().err
    assert "[##############--------------]" in output
    assert "50.00%" in output
    assert "50.0B/100.0B" in output
    assert "50.0B/s" in output
    assert "/s/s" not in output


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


def test_downloader_retries_backup_after_truncated_response(tmp_path) -> None:
    play_url = PlayUrl(
        quality=16,
        format="mp4",
        accept_quality=(16,),
        accept_description=("360P",),
        segments=(
            StreamSegment(
                url="https://example.test/short.mp4",
                backup_urls=("https://example.test/complete.mp4",),
                size=5,
            ),
        ),
    )

    class RetryClient(FakeClient):
        def open_stream(self, urls, *, referer: str):
            url = tuple(urls)[0]
            return FakeResponse(b"bad" if "short" in url else b"hello")

    result = BiliDownloader(client=RetryClient(play_url)).download(
        "BV1xx411c7mD",
        output_dir=tmp_path,
    )

    assert result.path.read_bytes() == b"hello"
    assert result.bytes_written == 5


def test_downloader_does_not_publish_when_all_sources_are_truncated(tmp_path) -> None:
    play_url = PlayUrl(
        quality=16,
        format="mp4",
        accept_quality=(16,),
        accept_description=("360P",),
        segments=(StreamSegment(url="https://example.test/short.mp4", size=5),),
    )

    class ShortClient(FakeClient):
        def open_stream(self, urls, *, referer: str):
            return FakeResponse(b"bad")

    with pytest.raises(downloader_module.DownloadIntegrityError, match="all media sources failed"):
        BiliDownloader(client=ShortClient(play_url)).download(
            "BV1xx411c7mD",
            output_dir=tmp_path,
        )

    assert not (tmp_path / "Test Video_BV1xx411c7mD.mp4").exists()


def test_dash_merge_failure_preserves_existing_output(monkeypatch, tmp_path) -> None:
    play_url = PlayUrl(
        quality=80,
        format="dash",
        accept_quality=(80,),
        accept_description=("1080P",),
        segments=(),
        dash_videos=(DashMedia(id=80, url="https://example.test/video.m4s"),),
        dash_audios=(DashMedia(id=30280, url="https://example.test/audio.m4s"),),
    )
    output = tmp_path / "existing.mp4"
    output.write_bytes(b"old-media")

    def fail_merge(*args, **kwargs):
        raise UnsupportedStreamError("merge failed")

    monkeypatch.setattr(downloader_module, "_merge_with_ffmpeg", fail_merge)

    with pytest.raises(UnsupportedStreamError, match="merge failed"):
        BiliDownloader(client=FakeClient(play_url)).download(
            "BV1xx411c7mD",
            output_file=output,
            overwrite=True,
        )

    assert output.read_bytes() == b"old-media"


def test_staging_paths_are_unique_and_windows_device_names_are_safe(tmp_path) -> None:
    output = tmp_path / "video.mp4"
    first = downloader_module._new_staging_path(output, suffix=".part")
    second = downloader_module._new_staging_path(output, suffix=".part")
    try:
        assert first != second
        assert downloader_module._safe_filename("CON") == "_CON"
        assert downloader_module._safe_filename("Lpt9.txt") == "_Lpt9.txt"
    finally:
        first.unlink(missing_ok=True)
        second.unlink(missing_ok=True)


def test_ffmpeg_merge_stages_before_atomic_replace(monkeypatch, tmp_path) -> None:
    video = tmp_path / "video.part"
    audio = tmp_path / "audio.part"
    output = tmp_path / "output.mp4"
    video.write_bytes(b"video")
    audio.write_bytes(b"audio")
    output.write_bytes(b"old")
    monkeypatch.setattr(downloader_module, "_find_ffmpeg", lambda: "ffmpeg")

    def fake_run(command, **kwargs):
        staging = downloader_module.Path(command[-1])
        assert staging != output
        staging.write_bytes(b"new")
        return type("Completed", (), {"returncode": 0, "stderr": b""})()

    monkeypatch.setattr(downloader_module.subprocess, "run", fake_run)

    downloader_module._merge_with_ffmpeg(video, audio, output, overwrite=True)

    assert output.read_bytes() == b"new"
