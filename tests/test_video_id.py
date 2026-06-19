from __future__ import annotations

import pytest

from bili_download.video_id import BiliVideoRef, parse_bili_video_ref


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (
            "https://www.bilibili.com/video/BV1xx411c7mD/",
            BiliVideoRef(kind="bvid", value="BV1xx411c7mD"),
        ),
        (
            "https://www.bilibili.com/video/BV1xx411c7mD/?p=3",
            BiliVideoRef(kind="bvid", value="BV1xx411c7mD", page=3),
        ),
        (
            "BV1xx411c7mD",
            BiliVideoRef(kind="bvid", value="BV1xx411c7mD"),
        ),
        (
            "https://www.bilibili.com/video/av170001",
            BiliVideoRef(kind="aid", value="170001"),
        ),
        (
            "av170001?p=2",
            BiliVideoRef(kind="aid", value="170001", page=2),
        ),
    ],
)
def test_parse_bili_video_ref(raw: str, expected: BiliVideoRef) -> None:
    assert parse_bili_video_ref(raw) == expected


def test_aid_property_returns_integer() -> None:
    assert parse_bili_video_ref("av170001").aid == 170001


def test_invalid_input_raises_value_error() -> None:
    with pytest.raises(ValueError):
        parse_bili_video_ref("https://example.com/watch")

