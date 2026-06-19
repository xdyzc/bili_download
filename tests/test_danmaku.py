from __future__ import annotations

import pytest

from bili_download.danmaku import ass_escape, ass_time, parse_danmaku_xml, write_ass


def test_parse_danmaku_xml_extracts_events() -> None:
    events = parse_danmaku_xml(
        """<?xml version="1.0" encoding="UTF-8"?>
        <i>
          <d p="1.25,1,25,16777215,0,0,0,1">hello &amp; bili</d>
          <d p="2.50,5,25,16711680,0,0,0,2">top</d>
          <d p="3.75,4,25,65280,0,0,0,3">bottom</d>
        </i>
        """
    )

    assert [event.text for event in events] == ["hello & bili", "top", "bottom"]
    assert [event.mode for event in events] == [1, 5, 4]
    assert events[0].time == 1.25


def test_parse_danmaku_xml_rejects_invalid_xml() -> None:
    with pytest.raises(ValueError):
        parse_danmaku_xml("<i><d></i>")


def test_ass_helpers_format_time_and_escape_text() -> None:
    assert ass_time(3661.234) == "1:01:01.23"
    assert ass_escape(r"a\{b}") == r"a\\\{b\}"


def test_write_ass_outputs_scroll_top_and_bottom(tmp_path) -> None:
    events = parse_danmaku_xml(
        """<i>
          <d p="1,1,25,16777215,0,0,0,1">scroll</d>
          <d p="2,5,25,16777215,0,0,0,2">top</d>
          <d p="3,4,25,16777215,0,0,0,3">bottom</d>
        </i>"""
    )
    ass_path = tmp_path / "demo.ass"

    write_ass(events, ass_path, width=1280, height=720, video_duration=10)

    text = ass_path.read_text(encoding="utf-8")
    assert "PlayResX: 1280" in text
    assert "\\move(1280," in text
    assert "\\an8\\pos(640," in text
    assert "\\an2\\pos(640," in text
    assert text.count("Dialogue:") == 3
