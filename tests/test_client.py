from __future__ import annotations

import gzip
import zlib

from bili_download.client import _decode_response_body


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
