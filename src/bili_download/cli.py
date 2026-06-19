"""Command line entry point for small learning experiments."""

from __future__ import annotations

import argparse

from .video_id import parse_bili_video_ref


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bili-download")
    parser.add_argument("url_or_id", help="Bilibili video URL, BV id, or av id")
    args = parser.parse_args(argv)

    video_ref = parse_bili_video_ref(args.url_or_id)
    if video_ref.kind == "bvid":
        print(f"bvid={video_ref.value}")
    else:
        print(f"aid={video_ref.value}")

    if video_ref.page is not None:
        print(f"page={video_ref.page}")

    return 0

