from __future__ import annotations

import pytest

from bili_download.cookies import CookieLoadError
from bili_download.gui import _format_bytes, _quality_options, import_cookie_file
from bili_download.models import DashMedia, PlayUrl


def test_quality_options_include_dash_details() -> None:
    play_url = PlayUrl(
        quality=116,
        format="dash",
        accept_quality=(116, 80),
        accept_description=("1080P60", "1080P"),
        segments=(),
        dash_videos=(
            DashMedia(
                id=116,
                url="https://example.test/video.m4s",
                height=1080,
                frame_rate="60.000",
                bandwidth=1000,
            ),
        ),
    )

    options = _quality_options(play_url)

    assert [option.code for option in options] == [116, 80]
    assert options[0].label == "116 - 1080P60  1080p 60.000fps"
    assert options[1].label == "80 - 1080P"


def test_format_bytes_uses_compact_units() -> None:
    assert _format_bytes(512) == "512.0B"
    assert _format_bytes(2048) == "2.0KB"
    assert _format_bytes(3 * 1024 * 1024) == "3.0MB"


def test_import_cookie_file_validates_before_overwriting(tmp_path) -> None:
    source = tmp_path / "source.json"
    destination = tmp_path / "bili.json"
    source.write_text('{"SESSDATA": "new", "bili_jct": "token"}', encoding="utf-8")
    destination.write_text('{"SESSDATA": "old"}', encoding="utf-8")

    import_cookie_file(source, destination)

    assert destination.read_text(encoding="utf-8") == source.read_text(encoding="utf-8")

    bad_source = tmp_path / "bad.json"
    bad_source.write_text("{bad json", encoding="utf-8")

    with pytest.raises(CookieLoadError):
        import_cookie_file(bad_source, destination)

    assert destination.read_text(encoding="utf-8") == source.read_text(encoding="utf-8")
