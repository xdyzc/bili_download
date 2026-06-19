"""Command line entry point for the local Bilibili downloader."""

from __future__ import annotations

import argparse
from pathlib import Path

from .client import BiliApiError, BiliNetworkError
from .cookies import CookieLoadError, load_cookie_file
from .downloader import BiliDownloader, UnsupportedStreamError
from .client import BiliClient
from .video_id import parse_bili_video_ref


def main(argv: list[str] | None = None) -> int:
    argv = _normalize_argv(argv)
    parser = argparse.ArgumentParser(prog="bili-download")
    parser.add_argument(
        "--cookie-file",
        type=Path,
        help="browser-exported Bilibili cookie JSON file",
    )
    subparsers = parser.add_subparsers(dest="command")

    parse_parser = subparsers.add_parser("parse", help="parse a Bilibili URL or id")
    parse_parser.add_argument("url_or_id", help="Bilibili video URL, BV id, or av id")

    download_parser = subparsers.add_parser(
        "download",
        help="download a Bilibili video stream",
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
        "-q",
        "--quality",
        type=int,
        help="requested Bilibili qn quality code, for example 16, 32, 64, 80",
    )
    download_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="replace the output file if it already exists",
    )

    qualities_parser = subparsers.add_parser(
        "qualities",
        help="list available qn quality codes for a Bilibili video",
    )
    qualities_parser.add_argument("url_or_bv", help="Bilibili video URL, BV id, or av id")
    qualities_parser.add_argument("-p", "--page", type=int, help="video page number")

    args = parser.parse_args(argv)

    try:
        if args.command == "download":
            return _download(args)

        if args.command == "qualities":
            return _qualities(args)

        if args.command == "parse":
            return _parse(args.url_or_id)

        if not args.command:
            parser.print_help()
            return 2
    except (
        ValueError,
        FileExistsError,
        BiliApiError,
        BiliNetworkError,
        CookieLoadError,
        UnsupportedStreamError,
    ) as exc:
        print(f"error: {exc}")
        return 1

    return 2


def _normalize_argv(argv: list[str] | None) -> list[str] | None:
    if argv is None:
        return None
    if not argv:
        return argv
    if argv[0].startswith("-"):
        return argv
    if argv[0] in {"parse", "download", "qualities"}:
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
    downloader = _build_downloader(args.cookie_file)
    result = downloader.download(
        args.url_or_bv,
        output_dir=args.output_dir,
        output_file=args.output,
        page=args.page,
        quality=args.quality,
        overwrite=args.overwrite,
    )
    print(f"saved={result.path}")
    print(f"title={result.video.title}")
    print(f"page={result.page.index}")
    print(f"bytes={result.bytes_written}")
    print(f"segments={result.segments}")
    if result.play_url.quality is not None:
        print(f"quality={result.play_url.quality}")
    return 0


def _qualities(args: argparse.Namespace) -> int:
    downloader = _build_downloader(args.cookie_file)
    video, page, play_url = downloader.get_available_qualities(
        args.url_or_bv,
        page=args.page,
    )
    print(f"title={video.title}")
    print(f"page={page.index}")
    if play_url.quality is not None:
        print(f"default={play_url.quality}")

    for code, description in zip(
        play_url.accept_quality,
        play_url.accept_description,
        strict=False,
    ):
        marker = " *" if code == play_url.quality else ""
        print(f"{code}\t{description}{marker}")

    return 0


def _build_downloader(cookie_file: Path | None) -> BiliDownloader:
    cookie_header = ""
    if cookie_file is not None:
        cookie_header = load_cookie_file(cookie_file).header
    return BiliDownloader(BiliClient(cookie_header=cookie_header))

