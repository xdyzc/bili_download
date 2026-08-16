from __future__ import annotations

import json
import time

from bili_download.cookies import load_cookie_file


def test_load_cookie_file_from_browser_json(tmp_path) -> None:
    cookie_file = tmp_path / "bili.json"
    cookie_file.write_text(
        json.dumps(
            [
                {
                    "domain": ".bilibili.com",
                    "expirationDate": time.time() + 3600,
                    "name": "SESSDATA",
                    "value": "secret-session",
                },
                {
                    "domain": ".example.com",
                    "name": "ignored",
                    "value": "nope",
                },
            ]
        ),
        encoding="utf-8",
    )

    jar = load_cookie_file(cookie_file)

    assert jar.header == "SESSDATA=secret-session"


def test_cookie_file_rejects_lookalike_domains_and_header_injection(tmp_path) -> None:
    cookie_file = tmp_path / "bili.json"
    cookie_file.write_text(
        json.dumps(
            [
                {"domain": "notbilibili.com", "name": "SESSDATA", "value": "stolen"},
                {"domain": ".bilibili.com", "name": "safe", "value": "yes"},
                {"domain": "api.bilibili.com", "name": "bad\r\nInjected", "value": "x"},
                {"domain": "api.bilibili.com", "name": "bad", "value": "x; injected=y"},
            ]
        ),
        encoding="utf-8",
    )

    assert load_cookie_file(cookie_file).header == "safe=yes"


def test_cookie_mapping_drops_invalid_pairs(tmp_path) -> None:
    cookie_file = tmp_path / "bili.json"
    cookie_file.write_text(
        json.dumps({"SESSDATA": "secret", "bad name": "x", "evil": "x\ny"}),
        encoding="utf-8",
    )

    assert load_cookie_file(cookie_file).header == "SESSDATA=secret"
