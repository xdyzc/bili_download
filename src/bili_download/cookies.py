"""Cookie loading helpers for user-provided Bilibili sessions."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import time
from typing import Any


class CookieLoadError(RuntimeError):
    """Raised when a cookie file cannot be parsed."""


@dataclass(frozen=True)
class CookieJar:
    header: str

    @property
    def is_empty(self) -> bool:
        return not self.header


def load_cookie_file(path: Path) -> CookieJar:
    if not path.exists():
        raise CookieLoadError(f"cookie file was not found: {path}")

    try:
        raw = path.read_text(encoding="utf-8")
        payload = json.loads(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CookieLoadError(f"could not read cookie file: {path}") from exc

    if isinstance(payload, list):
        return CookieJar(_cookies_from_browser_json(payload))
    if isinstance(payload, dict):
        if "cookies" in payload and isinstance(payload["cookies"], list):
            return CookieJar(_cookies_from_browser_json(payload["cookies"]))
        return CookieJar(_cookies_from_mapping(payload))

    raise CookieLoadError("unsupported cookie file format")


def _cookies_from_browser_json(items: list[Any]) -> str:
    now = time.time()
    pairs: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        domain = str(item.get("domain") or "")
        if "bilibili.com" not in domain:
            continue

        expires = item.get("expirationDate")
        if expires is not None:
            try:
                if float(expires) <= now:
                    continue
            except (TypeError, ValueError):
                continue

        name = item.get("name")
        value = item.get("value")
        if not name or value is None:
            continue
        pairs.append(f"{name}={value}")

    return "; ".join(pairs)


def _cookies_from_mapping(mapping: dict[str, Any]) -> str:
    pairs = []
    for name, value in mapping.items():
        if value is None:
            continue
        pairs.append(f"{name}={value}")
    return "; ".join(pairs)

