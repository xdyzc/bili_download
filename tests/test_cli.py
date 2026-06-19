from __future__ import annotations

from bili_download.cli import main


def test_cli_prints_bvid(capsys) -> None:
    exit_code = main(["https://www.bilibili.com/video/BV1xx411c7mD/?p=3"])

    assert exit_code == 0
    assert capsys.readouterr().out.splitlines() == [
        "bvid=BV1xx411c7mD",
        "page=3",
    ]

