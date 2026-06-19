"""Utilities for extracting Bilibili video identifiers from user input."""

from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import parse_qs, urlparse


BV_PATTERN = re.compile(r"BV[0-9A-Za-z]{10}")
AV_PATTERN = re.compile(r"(?:^|[^A-Za-z0-9])(?:av|AV)(\d+)(?:$|[^A-Za-z0-9])")


@dataclass(frozen=True)
class BiliVideoRef:
    """A normalized reference to a Bilibili video."""

    kind: str
    value: str
    page: int | None = None

    @property
    def bvid(self) -> str | None:
        return self.value if self.kind == "bvid" else None

    @property
    def aid(self) -> int | None:
        return int(self.value) if self.kind == "aid" else None


def parse_bili_video_ref(text: str) -> BiliVideoRef:
    """Parse a BV or av identifier from a Bilibili URL or plain text."""

    candidate = text.strip()
    if not candidate:
        raise ValueError("empty input")

    parsed = urlparse(candidate)
    page = _parse_page(parsed.query)

    bv_match = BV_PATTERN.search(candidate)
    if bv_match:
        return BiliVideoRef(kind="bvid", value=bv_match.group(0), page=page)

    av_match = AV_PATTERN.search(candidate)
    if av_match:
        return BiliVideoRef(kind="aid", value=av_match.group(1), page=page)

    raise ValueError(f"could not find a Bilibili video id in: {text!r}")


def _parse_page(query: str) -> int | None:
    values = parse_qs(query).get("p")
    if not values:
        return None

    try:
        page = int(values[0])
    except ValueError:
        return None

    return page if page > 0 else None

