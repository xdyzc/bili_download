from __future__ import annotations

from pathlib import Path

import bili_download.cli as cli
from bili_download.cli import main
from bili_download.models import (
    DashMedia,
    DownloadResult,
    LoginStatus,
    PlayUrl,
    VideoInfo,
    VideoPage,
)


def test_cli_prints_bvid(capsys) -> None:
    exit_code = main(["https://www.bilibili.com/video/BV1xx411c7mD/?p=3"])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "bvid=BV1xx411c7mD",
        "page=3",
    ]


def test_cli_download_prints_result_without_danmaku_by_default(
    monkeypatch,
    capsys,
    tmp_path,
) -> None:
    class FakeDownloader:
        def download(
            self,
            url_or_bv,
            *,
            output_dir,
            output_file,
            page,
            quality,
            progress,
            overwrite,
            danmaku,
        ):
            assert url_or_bv == "BV1xx411c7mD"
            assert output_dir == tmp_path
            assert output_file is None
            assert page is None
            assert quality is None
            assert progress is False
            assert overwrite is False
            assert danmaku is False
            return DownloadResult(
                path=Path("downloads/Test Video.mp4"),
                bytes_written=11,
                segments=1,
                video=VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                page=VideoPage(index=1, cid=123, title="Intro"),
                play_url=PlayUrl(
                    quality=16,
                    format="mp4",
                    accept_quality=(16,),
                    accept_description=("360P",),
                    segments=(),
                ),
            )

    monkeypatch.setattr(cli, "_build_downloader", lambda cookie_file: FakeDownloader())

    exit_code = main(["download", "BV1xx411c7mD", "--output-dir", str(tmp_path)])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "saved=downloads\\Test Video.mp4",
        "danmaku_count=0",
        "title=Test Video",
        "page=1",
        "bytes=11",
        "segments=1",
        "quality=16",
        "mode=durl",
    ]


def test_cli_download_can_enable_danmaku(monkeypatch, capsys, tmp_path) -> None:
    class FakeDownloader:
        def download(
            self,
            url_or_bv,
            *,
            output_dir,
            output_file,
            page,
            quality,
            progress,
            overwrite,
            danmaku,
        ):
            assert danmaku is True
            return DownloadResult(
                path=Path("downloads/Test Video.mp4"),
                danmaku_video_path=Path("downloads/Test Video.danmaku.mp4"),
                danmaku_xml_path=Path("downloads/Test Video.danmaku.xml"),
                danmaku_ass_path=Path("downloads/Test Video.danmaku.ass"),
                danmaku_count=2,
                bytes_written=11,
                segments=1,
                video=VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                page=VideoPage(index=1, cid=123, title="Intro"),
                play_url=PlayUrl(
                    quality=16,
                    format="mp4",
                    accept_quality=(16,),
                    accept_description=("360P",),
                    segments=(),
                ),
            )

    monkeypatch.setattr(cli, "_build_downloader", lambda cookie_file: FakeDownloader())

    exit_code = main(
        [
            "download",
            "BV1xx411c7mD",
            "--output-dir",
            str(tmp_path),
            "--danmaku",
        ]
    )

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines()[:5] == [
        "saved=downloads\\Test Video.mp4",
        "danmaku_video=downloads\\Test Video.danmaku.mp4",
        "danmaku_xml=downloads\\Test Video.danmaku.xml",
        "danmaku_ass=downloads\\Test Video.danmaku.ass",
        "danmaku_count=2",
    ]


def test_cli_qualities_prints_available_options(monkeypatch, capsys) -> None:
    class FakeDownloader:
        def get_available_qualities(self, url_or_bv, *, page):
            assert url_or_bv == "BV1xx411c7mD"
            assert page is None
            return (
                VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                VideoPage(index=1, cid=123, title="Intro"),
                PlayUrl(
                    quality=80,
                    format="mp4",
                    accept_quality=(80, 64, 32, 16),
                    accept_description=("1080P", "720P", "480P", "360P"),
                    segments=(),
                    dash_videos=(
                        DashMedia(
                            id=80,
                            url="https://example.test/video.m4s",
                            height=1080,
                            frame_rate="30.000",
                            codecs="avc1.640033",
                            bandwidth=1000,
                        ),
                    ),
                ),
            )

    monkeypatch.setattr(cli, "_build_downloader", lambda cookie_file: FakeDownloader())

    exit_code = main(["qualities", "BV1xx411c7mD"])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "title=Test Video",
        "page=1",
        "default=80",
        "80\t1080P\t1080p 30.000fps avc1.640033 *",
        "64\t720P",
        "32\t480P",
        "16\t360P",
    ]


def test_cli_account_prints_login_status(monkeypatch, capsys) -> None:
    class FakeClient:
        def get_login_status(self):
            return LoginStatus(
                is_login=True,
                username="tester",
                user_id=123,
                vip_label="大会员",
            )

    monkeypatch.setattr(cli, "_build_client", lambda cookie_file: FakeClient())

    exit_code = main(["account"])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "logged_in=true",
        "username=tester",
        "mid=123",
        "vip=大会员",
    ]


def test_interactive_mode_downloads_with_user_input(monkeypatch, capsys, tmp_path) -> None:
    monkeypatch.setattr(cli, "_app_dir", lambda: tmp_path)
    inputs = iter(["BV1xx411c7mD", "80", "", ""])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(inputs))

    class FakeClient:
        def get_login_status(self):
            return LoginStatus(is_login=True, username="tester")

    class FakeDownloader:
        def get_available_qualities(self, url_or_bv, *, page):
            return (
                VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                VideoPage(index=1, cid=123, title="Intro"),
                PlayUrl(
                    quality=80,
                    format="mp4",
                    accept_quality=(80,),
                    accept_description=("1080P",),
                    segments=(),
                ),
            )

        def download(
            self,
            url_or_bv,
            *,
            output_dir,
            output_file,
            page,
            quality,
            progress,
            overwrite,
            danmaku,
        ):
            assert url_or_bv == "BV1xx411c7mD"
            assert output_dir == tmp_path / "downloads"
            assert quality == 80
            assert progress is True
            assert overwrite is True
            assert danmaku is False
            return DownloadResult(
                path=tmp_path / "downloads" / "Test Video.mp4",
                bytes_written=11,
                segments=2,
                video=VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                page=VideoPage(index=1, cid=123, title="Intro"),
                play_url=PlayUrl(
                    quality=80,
                    format="mp4",
                    accept_quality=(80,),
                    accept_description=("1080P",),
                    segments=(),
                ),
                mode="dash",
            )

    monkeypatch.setattr(cli, "_build_client", lambda cookie_file: FakeClient())
    monkeypatch.setattr(cli, "_build_downloader", lambda cookie_file: FakeDownloader())
    (tmp_path / "bili.json").write_text("[]", encoding="utf-8")

    exit_code = main([])

    assert exit_code == 0
    output = capsys.readouterr().out
    assert "Account status:" in output
    assert "username=tester" in output
    assert "Available qualities:" in output
    assert "Danmaku: disabled" in output
    assert "Done." in output


def test_interactive_mode_can_enable_danmaku(monkeypatch, capsys, tmp_path) -> None:
    monkeypatch.setattr(cli, "_app_dir", lambda: tmp_path)
    inputs = iter(["BV1xx411c7mD", "", "y", ""])
    monkeypatch.setattr("builtins.input", lambda prompt="": next(inputs))

    class FakeDownloader:
        def get_available_qualities(self, url_or_bv, *, page):
            return (
                VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                VideoPage(index=1, cid=123, title="Intro"),
                PlayUrl(
                    quality=80,
                    format="mp4",
                    accept_quality=(80,),
                    accept_description=("1080P",),
                    segments=(),
                ),
            )

        def download(
            self,
            url_or_bv,
            *,
            output_dir,
            output_file,
            page,
            quality,
            progress,
            overwrite,
            danmaku,
        ):
            assert danmaku is True
            return DownloadResult(
                path=tmp_path / "downloads" / "Test Video.mp4",
                bytes_written=11,
                segments=2,
                video=VideoInfo(
                    bvid="BV1xx411c7mD",
                    aid=170001,
                    title="Test Video",
                    owner_name="tester",
                    pages=(VideoPage(index=1, cid=123, title="Intro"),),
                ),
                page=VideoPage(index=1, cid=123, title="Intro"),
                play_url=PlayUrl(
                    quality=80,
                    format="mp4",
                    accept_quality=(80,),
                    accept_description=("1080P",),
                    segments=(),
                ),
                mode="dash",
            )

    monkeypatch.setattr(cli, "_build_downloader", lambda cookie_file: FakeDownloader())

    exit_code = main([])

    assert exit_code == 0
    assert "Danmaku: enabled" in capsys.readouterr().out

