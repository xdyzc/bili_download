"""Helpers for converting Bilibili danmaku XML into ASS subtitles."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree


DANMAKU_DURATION = 9.5
DANMAKU_PRIMARY_ALPHA = "80"
DANMAKU_OUTLINE_ALPHA = "FF"
DANMAKU_OUTLINE_WIDTH = 0


@dataclass(frozen=True)
class DanmakuEvent:
    time: float
    mode: int
    font_size: int
    color: int
    text: str


def parse_danmaku_xml(xml_text: str) -> tuple[DanmakuEvent, ...]:
    """Parse Bilibili XML danmaku into timestamped events."""
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as exc:
        raise ValueError("Bilibili returned invalid danmaku XML") from exc

    events: list[DanmakuEvent] = []
    for node in root.findall(".//d"):
        metadata = (node.get("p") or "").split(",")
        if len(metadata) < 4:
            continue
        text = node.text or ""
        if not text.strip():
            continue
        try:
            events.append(
                DanmakuEvent(
                    time=max(0.0, float(metadata[0])),
                    mode=int(float(metadata[1])),
                    font_size=int(float(metadata[2])),
                    color=int(float(metadata[3])),
                    text=text,
                )
            )
        except ValueError:
            continue

    return tuple(sorted(events, key=lambda item: item.time))


def write_ass(
    events: tuple[DanmakuEvent, ...],
    ass_path: Path,
    *,
    width: int = 1920,
    height: int = 1080,
    video_duration: float | None = None,
) -> None:
    """Write an ASS subtitle file with simple Bilibili-like danmaku motion."""
    width = max(320, int(width or 1920))
    height = max(240, int(height or 1080))
    font_size = max(24, round(height / 28))
    row_height = round(font_size * 1.25)
    scrolling_rows = max(6, int((height * 0.42) // row_height))
    fixed_rows = max(3, int((height * 0.16) // row_height))
    max_end = (
        video_duration + 2
        if video_duration is not None and video_duration > 0
        else float("inf")
    )

    lines = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {width}",
        f"PlayResY: {height}",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Danmaku,Microsoft YaHei,{font_size},&H{DANMAKU_PRIMARY_ALPHA}FFFFFF,&H{DANMAKU_PRIMARY_ALPHA}FFFFFF,&H{DANMAKU_OUTLINE_ALPHA}000000,&H00000000,-1,0,0,0,100,100,0,0,1,{DANMAKU_OUTLINE_WIDTH},0,7,0,0,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    scroll_index = 0
    top_index = 0
    bottom_index = 0
    for event in events:
        start = max(0.0, event.time)
        end = min(max_end, start + DANMAKU_DURATION)
        if end <= start:
            continue

        text = ass_escape(event.text)
        estimated_width = max(160, len(text) * font_size)
        if event.mode == 5:
            row = top_index % fixed_rows
            top_index += 1
            y = 20 + row * row_height
            tag = f"{{\\an8\\pos({width // 2},{y})}}"
        elif event.mode == 4:
            row = bottom_index % fixed_rows
            bottom_index += 1
            y = height - 20 - row * row_height
            tag = f"{{\\an2\\pos({width // 2},{y})}}"
        else:
            row = scroll_index % scrolling_rows
            scroll_index += 1
            y = 20 + row * row_height
            tag = f"{{\\move({width},{y},-{estimated_width},{y})}}"

        lines.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},Danmaku,,0,0,0,,{tag}{text}"
        )

    ass_path.parent.mkdir(parents=True, exist_ok=True)
    ass_path.write_text("\n".join(lines), encoding="utf-8")


def ass_time(seconds: float) -> str:
    centiseconds = max(0, round(seconds * 100))
    hours = centiseconds // 360000
    minutes = (centiseconds % 360000) // 6000
    secs = (centiseconds % 6000) // 100
    cs = centiseconds % 100
    return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"


def ass_escape(text: str) -> str:
    return (
        str(text)
        .replace("\\", "\\\\")
        .replace("{", "\\{")
        .replace("}", "\\}")
        .replace("\r", " ")
        .replace("\n", " ")
    )
