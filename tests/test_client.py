from __future__ import annotations

import gzip
import json
from io import BytesIO
import zlib

import pytest

from bili_download.client import (
    BiliApiError,
    BiliClient,
    BiliNetworkError,
    _decode_response_body,
)


class FakeResponse(BytesIO):
    def __init__(self, body: bytes, *, url: str = "") -> None:
        super().__init__(body)
        self.headers = {}
        self._url = url

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def geturl(self) -> str:
        return self._url


class RecordingOpener:
    def __init__(self, response: FakeResponse) -> None:
        self.response = response
        self.requests = []

    def open(self, request, *, timeout):
        self.requests.append(request)
        return self.response


def test_decode_response_body_supports_common_encodings() -> None:
    raw = b"<i><d>hello</d></i>"

    assert _decode_response_body(raw, "") == raw
    assert _decode_response_body(gzip.compress(raw), "gzip") == raw
    assert _decode_response_body(zlib.compress(raw), "deflate") == raw


def test_decode_response_body_supports_raw_deflate() -> None:
    raw = b"<i><d>hello</d></i>"
    compressed = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    encoded = compressed.compress(raw) + compressed.flush()

    assert _decode_response_body(encoded, "deflate") == raw


@pytest.mark.parametrize(
    "url",
    [
        "https://upos-sz-mirrorcos.bilivideo.com/video.m4s",
        "https://cn-hbcd-cu-01-01.bilivideo.cn/video.m4s",
        "https://upos-hz-mirrorakam.akamaized.net/video.m4s",
    ],
)
def test_media_requests_accept_known_cdns_without_login_cookie(url: str) -> None:
    opener = RecordingOpener(FakeResponse(b"media", url=url))
    client = BiliClient(media_opener=opener, cookie_header="SESSDATA=secret")

    with client.open_stream([url], referer="https://www.bilibili.com/video/BV1/") as response:
        assert response.read() == b"media"

    assert opener.requests[0].get_header("Cookie") is None


@pytest.mark.parametrize(
    "url",
    [
        "http://upos-sz-mirrorcos.bilivideo.com/video.m4s",
        "https://evil.example/video.m4s",
        "https://bilivideo.com.evil.example/video.m4s",
        "https://upos-sz-mirrorcos.bilivideo.com:8443/video.m4s",
    ],
)
def test_media_requests_reject_untrusted_urls(url: str) -> None:
    client = BiliClient(media_opener=RecordingOpener(FakeResponse(b"media", url=url)))

    with pytest.raises(BiliNetworkError):
        client.open_stream([url], referer="https://www.bilibili.com/")


def test_media_requests_reject_cross_host_redirect_result() -> None:
    source = "https://video.bilivideo.com/video.m4s"
    opener = RecordingOpener(FakeResponse(b"media", url="https://evil.example/video.m4s"))
    client = BiliClient(media_opener=opener, cookie_header="SESSDATA=secret")

    with pytest.raises(BiliNetworkError):
        client.open_stream([source], referer="https://www.bilibili.com/")
    assert opener.requests[0].get_header("Cookie") is None


@pytest.mark.parametrize("payload", [[], {"code": "bad", "data": {}}, {"code": 0, "data": []}])
def test_api_boundary_rejects_invalid_response_shapes(payload) -> None:
    response = FakeResponse(json.dumps(payload).encode(), url="https://api.bilibili.com/test")
    client = BiliClient(opener=RecordingOpener(response))

    with pytest.raises(BiliApiError):
        client.get_login_status()
