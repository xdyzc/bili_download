from __future__ import annotations

from pathlib import Path

import bili_download.cli as cli
from bili_download.cli import main
from bili_download.models import DownloadResult, PlayUrl, VideoInfo, VideoPage


def test_cli_prints_bvid(capsys) -> None:
    exit_code = main(["https://www.bilibili.com/video/BV1xx411c7mD/?p=3"])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "bvid=BV1xx411c7mD",
        "page=3",
    ]


def test_cli_download_prints_result(monkeypatch, capsys, tmp_path) -> None:
    class FakeDownloader:
        def download(self, url_or_bv, *, output_dir, output_file, page, overwrite):
            assert url_or_bv == "BV1xx411c7mD"
            assert output_dir == tmp_path
            assert output_file is None
            assert page is None
            assert overwrite is False
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

    monkeypatch.setattr(cli, "BiliDownloader", FakeDownloader)

    exit_code = main(["download", "BV1xx411c7mD", "--output-dir", str(tmp_path)])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "saved=downloads\\Test Video.mp4",
        "title=Test Video",
        "page=1",
        "bytes=11",
        "segments=1",
    ]

