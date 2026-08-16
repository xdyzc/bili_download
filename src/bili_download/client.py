"""Small Bilibili web API client used by the local downloader."""

from __future__ import annotations

import json
import gzip
import zlib
from typing import Any, Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .models import DashMedia, LoginStatus, PlayUrl, StreamSegment, VideoInfo, VideoPage
from .video_id import BiliVideoRef


API_BASE = "https://api.bilibili.com"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0 Safari/537.36"
)
MEDIA_CDN_SUFFIXES = ("bilivideo.com", "bilivideo.cn")
SENSITIVE_REDIRECT_HEADERS = ("Cookie", "Authorization", "Proxy-Authorization")


class BiliApiError(RuntimeError):
    """Raised when Bilibili returns an error response."""


class BiliNetworkError(RuntimeError):
    """Raised when a request cannot be completed."""


class SafeMediaRedirectHandler(HTTPRedirectHandler):
    """Reject non-CDN redirects and strip credentials from media requests."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_media_url(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            for header in SENSITIVE_REDIRECT_HEADERS:
                redirected.remove_header(header)
        return redirected


class BiliClient:
    def __init__(
        self,
        *,
        timeout: int = 20,
        opener: Any | None = None,
        media_opener: Any | None = None,
        cookie_header: str = "",
    ) -> None:
        self.timeout = timeout
        self._opener = opener or build_opener()
        self._media_opener = media_opener or (
            opener if opener is not None else build_opener(SafeMediaRedirectHandler())
        )
        self._cookie_header = cookie_header

    def get_login_status(self) -> LoginStatus:
        payload = self._get_json("/x/web-interface/nav", {})
        data = _expect_data(payload)
        vip = data.get("vipInfo") or {}
        vip_label = vip.get("label") or {}
        label_text = vip_label.get("text") if isinstance(vip_label, dict) else ""
        return LoginStatus(
            is_login=bool(data.get("isLogin")),
            username=str(data.get("uname") or ""),
            user_id=_optional_int(data.get("mid")),
            vip_label=str(label_text or ""),
        )

    def get_video_info(self, video_ref: BiliVideoRef) -> VideoInfo:
        params = (
            {"bvid": video_ref.value}
            if video_ref.kind == "bvid"
            else {"aid": video_ref.value}
        )
        payload = self._get_json("/x/web-interface/view", params)
        data = _expect_data(payload)
        raw_pages = data.get("pages")
        if not isinstance(raw_pages, list):
            raise BiliApiError("video metadata did not include a pages array")
        pages: list[VideoPage] = []
        for raw_page in raw_pages:
            if not isinstance(raw_page, dict):
                raise BiliApiError("video metadata included an invalid page")
            index = _required_int(raw_page.get("page"), "video page number")
            pages.append(
                VideoPage(
                    index=index,
                    cid=_required_int(raw_page.get("cid"), "video page cid"),
                    title=str(raw_page.get("part") or f"P{index}"),
                    duration=_optional_int(raw_page.get("duration")),
                )
            )
        if not pages:
            raise BiliApiError("video metadata did not include any pages")

        owner = data.get("owner") or {}
        if not isinstance(owner, dict):
            owner = {}
        bvid = data.get("bvid")
        if not isinstance(bvid, str) or not bvid:
            raise BiliApiError("video metadata did not include a valid bvid")
        return VideoInfo(
            bvid=bvid,
            aid=_required_int(data.get("aid"), "video aid"),
            title=str(data.get("title") or bvid),
            owner_name=str(owner.get("name") or ""),
            pages=tuple(pages),
        )

    def get_play_url(
        self,
        *,
        bvid: str,
        cid: int,
        quality: int | None = None,
        dash: bool = True,
    ) -> PlayUrl:
        payload = self._get_json(
            "/x/player/playurl",
            {
                "bvid": bvid,
                "cid": str(cid),
                "qn": str(quality or 127),
                "fnval": "4048" if dash else "0",
                "fnver": "0",
                "fourk": "0",
                "otype": "json",
            },
            referer=f"https://www.bilibili.com/video/{bvid}/",
        )
        data = _expect_data(payload)
        durl = data.get("durl") or []
        if not isinstance(durl, list):
            raise BiliApiError("play-url response included an invalid durl array")
        segments = tuple(
            StreamSegment(
                url=str(segment["url"]),
                backup_urls=tuple(str(url) for url in segment.get("backup_url") or ()),
                size=_optional_int(segment.get("size")),
            )
            for segment in durl
            if isinstance(segment, dict) and segment.get("url")
        )
        dash_data = data.get("dash") or {}
        if not isinstance(dash_data, dict):
            raise BiliApiError("play-url response included an invalid dash object")
        dash_videos = dash_data.get("video") or ()
        dash_audios = dash_data.get("audio") or ()
        if not isinstance(dash_videos, (list, tuple)) or not isinstance(
            dash_audios, (list, tuple)
        ):
            raise BiliApiError("play-url response included invalid DASH streams")
        return PlayUrl(
            quality=_optional_int(data.get("quality")),
            format=str(data.get("format") or ""),
            accept_quality=tuple(int(qn) for qn in data.get("accept_quality") or ()),
            accept_description=tuple(
                str(item) for item in data.get("accept_description") or ()
            ),
            segments=segments,
            dash_videos=tuple(
                _parse_dash_media(item)
                for item in dash_videos
                if isinstance(item, dict)
                and (item.get("base_url") or item.get("baseUrl"))
            ),
            dash_audios=tuple(
                _parse_dash_media(item)
                for item in dash_audios
                if isinstance(item, dict)
                and (item.get("base_url") or item.get("baseUrl"))
            ),
        )

    def get_default_play_url(self, *, bvid: str, cid: int) -> PlayUrl:
        return self.get_play_url(bvid=bvid, cid=cid)

    def get_danmaku_xml(self, *, cid: int, bvid: str | None = None) -> str:
        referer = (
            f"https://www.bilibili.com/video/{bvid}/"
            if bvid
            else "https://www.bilibili.com/"
        )
        request = Request(
            f"https://comment.bilibili.com/{cid}.xml",
            headers=_xml_headers(referer, cookie_header=self._cookie_header),
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read()
                encoding = response.headers.get("Content-Encoding", "")
        except (HTTPError, URLError) as exc:
            raise BiliNetworkError(f"danmaku request failed: cid={cid}") from exc

        return _decode_response_body(raw, encoding).decode("utf-8", errors="replace")

    def open_stream(self, urls: Iterable[str], *, referer: str):
        last_error: Exception | None = None
        for url in urls:
            try:
                _validate_media_url(url)
                request = Request(url, headers=_download_headers(referer))
                response = self._media_opener.open(request, timeout=self.timeout)
                final_url = response.geturl() if hasattr(response, "geturl") else url
                try:
                    _validate_media_url(final_url)
                except BiliNetworkError:
                    response.close()
                    raise
                return response
            except (HTTPError, URLError, BiliNetworkError) as exc:
                last_error = exc

        raise BiliNetworkError(f"could not open media stream: {last_error}")

    def _get_json(
        self,
        path: str,
        params: dict[str, str],
        *,
        referer: str = "https://www.bilibili.com/",
    ) -> dict[str, Any]:
        url = f"{API_BASE}{path}?{urlencode(params)}"
        request = Request(
            url,
            headers=_json_headers(referer, cookie_header=self._cookie_header),
        )
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                raw = response.read()
        except (HTTPError, URLError) as exc:
            raise BiliNetworkError(f"request failed: {url}") from exc

        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BiliApiError("Bilibili returned invalid JSON") from exc

        if not isinstance(payload, dict):
            raise BiliApiError("Bilibili returned a non-object JSON response")
        return payload


def _expect_data(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        code = int(payload.get("code", -1))
    except (TypeError, ValueError) as exc:
        raise BiliApiError("Bilibili response included an invalid status code") from exc
    if code != 0:
        message = payload.get("message") or payload.get("msg") or "unknown error"
        raise BiliApiError(f"Bilibili API error {code}: {message}")

    data = payload.get("data")
    if not isinstance(data, dict):
        raise BiliApiError("Bilibili response did not include a data object")
    return data


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None


def _required_int(value: Any, label: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise BiliApiError(f"Bilibili response did not include a valid {label}") from exc
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_dash_media(item: dict[str, Any]) -> DashMedia:
    return DashMedia(
        id=int(item["id"]),
        url=str(item.get("base_url") or item.get("baseUrl")),
        backup_urls=tuple(
            str(url)
            for url in (
                item.get("backup_url")
                or item.get("backupUrl")
                or item.get("backup_urls")
                or ()
            )
        ),
        bandwidth=_optional_int(item.get("bandwidth")),
        codecs=str(item.get("codecs") or ""),
        mime_type=str(item.get("mime_type") or item.get("mimeType") or ""),
        width=_optional_int(item.get("width")),
        height=_optional_int(item.get("height")),
        frame_rate=str(item.get("frame_rate") or item.get("frameRate") or ""),
        size=_optional_int(item.get("size")),
    )


def _json_headers(referer: str, *, cookie_header: str = "") -> dict[str, str]:
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Referer": referer,
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


def _download_headers(referer: str) -> dict[str, str]:
    return {
        "Accept": "*/*",
        "Origin": "https://www.bilibili.com",
        "Referer": referer,
        "User-Agent": DEFAULT_USER_AGENT,
    }


def _validate_media_url(url: str) -> None:
    try:
        parsed = urlparse(str(url))
        port = parsed.port
    except ValueError as exc:
        raise BiliNetworkError("media URL is invalid") from exc
    hostname = (parsed.hostname or "").rstrip(".").lower()
    if parsed.scheme.lower() != "https" or not hostname or parsed.username or parsed.password:
        raise BiliNetworkError("media URL must be an authenticated-free HTTPS CDN URL")
    if port not in (None, 443):
        raise BiliNetworkError("media URL used a disallowed port")
    allowed = any(
        hostname == suffix or hostname.endswith(f".{suffix}")
        for suffix in MEDIA_CDN_SUFFIXES
    )
    if hostname.startswith("upos-") and hostname.endswith(".akamaized.net"):
        allowed = True
    if not allowed:
        raise BiliNetworkError("media URL host is not an allowed Bilibili CDN")


def _xml_headers(referer: str, *, cookie_header: str = "") -> dict[str, str]:
    headers = {
        "Accept": "application/xml,text/xml,*/*",
        "Accept-Encoding": "gzip, deflate",
        "Referer": referer,
        "User-Agent": DEFAULT_USER_AGENT,
    }
    if cookie_header:
        headers["Cookie"] = cookie_header
    return headers


def _decode_response_body(raw: bytes, encoding: str) -> bytes:
    normalized = encoding.strip().lower()
    if normalized == "gzip":
        return gzip.decompress(raw)
    if normalized == "deflate":
        try:
            return zlib.decompress(raw)
        except zlib.error:
            return zlib.decompress(raw, -zlib.MAX_WBITS)
    if normalized == "br":
        try:
            import brotli
        except ImportError:
            return raw
        return brotli.decompress(raw)
    return raw
