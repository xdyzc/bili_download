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
