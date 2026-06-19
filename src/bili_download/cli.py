"""Command line entry point for the local Bilibili downloader."""

from __future__ import annotations

import argparse
from pathlib import Path

from .client import BiliApiError, BiliNetworkError
from .downloader import BiliDownloader, UnsupportedStreamError
from .video_id import parse_bili_video_ref


def main(argv: list[str] | None = None) -> int:
    argv = _normalize_argv(argv)
    parser = argparse.ArgumentParser(prog="bili-download")
    subparsers = parser.add_subparsers(dest="command")

    parse_parser = subparsers.add_parser("parse", help="parse a Bilibili URL or id")
    parse_parser.add_argument("url_or_id", help="Bilibili video URL, BV id, or av id")

    download_parser = subparsers.add_parser(
        "download",
        help="download the default no-cookie stream for a Bilibili video",
    )
    download_parser.add_argument("url_or_bv", help="Bilibili video URL, BV id, or av id")
    download_parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="output file path; defaults to downloads/<video-title>.<ext>",
    )
    download_parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("downloads"),
        help="directory for default output files",
    )
    download_parser.add_argument("-p", "--page", type=int, help="video page number")
    download_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace the output file if it already exists",
    )

    args = parser.parse_args(argv)

    try:
        if args.command == "download":
            return _download(args)

        if args.command == "parse":
            return _parse(args.url_or_id)

        if not args.command:
            parser.print_help()
            return 2
    except (ValueError, FileExistsError, BiliApiError, BiliNetworkError, UnsupportedStreamError) as exc:
        print(f"error: {exc}")
        return 1

    return 2


def _normalize_argv(argv: list[str] | None) -> list[str] | None:
    if argv is None:
        return None
    if not argv:
        return argv
    if argv[0] in {"parse", "download", "-h", "--help"}:
        return argv
    return ["parse", *argv]


def _parse(url_or_id: str) -> int:
    video_ref = parse_bili_video_ref(url_or_id)
    if video_ref.kind == "bvid":
        print(f"bvid={video_ref.value}")
    else:
        print(f"aid={video_ref.value}")

    if video_ref.page is not None:
        print(f"page={video_ref.page}")

    return 0


def _download(args: argparse.Namespace) -> int:
    downloader = BiliDownloader()
    result = downloader.download(
        args.url_or_bv,
        output_dir=args.output_dir,
        output_file=args.output,
        page=args.page,
        overwrite=args.overwrite,
    )
    print(f"saved={result.path}")
    print(f"title={result.video.title}")
    print(f"page={result.page.index}")
    print(f"bytes={result.bytes_written}")
    print(f"segments={result.segments}")
    return 0

