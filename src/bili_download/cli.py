"""Command line entry point for the local Bilibili downloader."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

from .client import BiliApiError, BiliClient, BiliNetworkError
from .cookies import CookieLoadError, load_cookie_file
from .downloader import BiliDownloader, UnsupportedStreamError
from .video_id import parse_bili_video_ref


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if not argv:
        return _interactive()

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
    download_parser.add_argument(
        "--progress",
        action="store_true",
        help="show download progress in the terminal",
    )
    download_parser.add_argument(
        "--danmaku",
        action="store_true",
        help="download danmaku and generate an extra burned-in danmaku MP4",
    )

    qualities_parser = subparsers.add_parser(
        "qualities",
        help="list available qn quality codes for a Bilibili video",
    )
    qualities_parser.add_argument("url_or_bv", help="Bilibili video URL, BV id, or av id")
    qualities_parser.add_argument("-p", "--page", type=int, help="video page number")

    subparsers.add_parser("account", help="show current Bilibili login status")

    args = parser.parse_args(argv)

    try:
        if args.command == "download":
            return _download(args)

        if args.command == "qualities":
            return _qualities(args)

        if args.command == "account":
            return _account(args)

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
    if argv[0] in {"parse", "download", "qualities", "account"}:
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
        progress=args.progress,
        overwrite=args.overwrite,
        danmaku=args.danmaku,
    )
    print(f"saved={result.path}")
    if result.danmaku_video_path is not None:
        print(f"danmaku_video={result.danmaku_video_path}")
    if result.danmaku_xml_path is not None:
        print(f"danmaku_xml={result.danmaku_xml_path}")
    if result.danmaku_ass_path is not None:
        print(f"danmaku_ass={result.danmaku_ass_path}")
    print(f"danmaku_count={result.danmaku_count}")
    print(f"title={result.video.title}")
    print(f"page={result.page.index}")
    print(f"bytes={result.bytes_written}")
    print(f"segments={result.segments}")
    if result.play_url.quality is not None:
        print(f"quality={result.play_url.quality}")
    print(f"mode={result.mode}")
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

    dash_by_quality = {}
    for stream in play_url.dash_videos:
        current = dash_by_quality.get(stream.id)
        if current is None or (stream.bandwidth or 0) > (current.bandwidth or 0):
            dash_by_quality[stream.id] = stream

    for code, description in zip(
        play_url.accept_quality,
        play_url.accept_description,
        strict=False,
    ):
        marker = " *" if code == play_url.quality else ""
        dash = dash_by_quality.get(code)
        detail = ""
        if dash is not None:
            detail_parts = []
            if dash.height:
                detail_parts.append(f"{dash.height}p")
            if dash.frame_rate:
                detail_parts.append(f"{dash.frame_rate}fps")
            if dash.codecs:
                detail_parts.append(dash.codecs)
            if detail_parts:
                detail = "\t" + " ".join(detail_parts)
        print(f"{code}\t{description}{detail}{marker}")

    return 0


def _account(args: argparse.Namespace) -> int:
    client = _build_client(args.cookie_file)
    status = client.get_login_status()
    print(f"logged_in={str(status.is_login).lower()}")
    if status.username:
        print(f"username={status.username}")
    if status.user_id is not None:
        print(f"mid={status.user_id}")
    if status.vip_label:
        print(f"vip={status.vip_label}")
    return 0


def _build_client(cookie_file: Path | None) -> BiliClient:
    cookie_header = ""
    if cookie_file is not None:
        cookie_header = load_cookie_file(cookie_file).header
    return BiliClient(cookie_header=cookie_header)


def _build_downloader(cookie_file: Path | None) -> BiliDownloader:
    return BiliDownloader(_build_client(cookie_file))


def _interactive() -> int:
    print("")
    print("Bili Download")
    print("=============")
    print("")

    app_dir = _app_dir()
    cookie_file = app_dir / "bili.json"
    if cookie_file.exists():
        print(f"Using cookie file: {cookie_file}")
        print("")
        print("Account status:")
        account_code = main(["--cookie-file", str(cookie_file), "account"])
        if account_code != 0:
            print("Could not verify cookie login status.")
        print("")
        cookie_args = ["--cookie-file", str(cookie_file)]
    else:
        print("No bili.json found next to the executable. Continuing without cookies.")
        print("")
        cookie_args = []

    video = input("Enter BV id or Bilibili video URL: ").strip()
    if not video:
        print("No input provided.")
        input("Press Enter to exit:")
        return 1

    print("")
    print("Available qualities:")
    quality_code = main([*cookie_args, "qualities", video])
    if quality_code != 0:
        print("Could not list qualities. You can still try the default download.")
    print("")

    quality = input("Enter quality code, or press Enter for default: ").strip()
    danmaku_answer = input("Burn danmaku into an extra MP4? (y/N): ").strip().lower()
    with_danmaku = danmaku_answer in {"y", "yes"}
    download_dir = app_dir / "downloads"
    download_args = [
        *cookie_args,
        "download",
        video,
        "--output-dir",
        str(download_dir),
        "--overwrite",
        "--progress",
    ]
    if quality:
        download_args.extend(["--quality", quality])
    if with_danmaku:
        download_args.append("--danmaku")

    print("", flush=True)
    print("Downloading to:", flush=True)
    print(f"  {download_dir}", flush=True)
    if with_danmaku:
        print("Danmaku: enabled, an extra burned-in MP4 will be generated.", flush=True)
    else:
        print("Danmaku: disabled, only the original MP4 will be generated.", flush=True)
    print("", flush=True)
    exit_code = main(download_args)
    print("")
    if exit_code == 0:
        print("Done.")
    else:
        print(f"Download failed. Exit code: {exit_code}")
    input("Press Enter to exit:")
    return exit_code


def _app_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path.cwd()

