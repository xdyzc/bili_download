"""Cookie loading helpers for user-provided Bilibili sessions."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
import time
from typing import Any


class CookieLoadError(RuntimeError):
    """Raised when a cookie file cannot be parsed."""


COOKIE_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")


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

        domain = str(item.get("domain") or "").strip().lstrip(".").rstrip(".").lower()
        if domain != "bilibili.com" and not domain.endswith(".bilibili.com"):
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
        if not _is_valid_cookie_pair(name, value):
            continue
        pairs.append(f"{name}={value}")

    return "; ".join(pairs)


def _cookies_from_mapping(mapping: dict[str, Any]) -> str:
    pairs = []
    for name, value in mapping.items():
        if not _is_valid_cookie_pair(name, value):
            continue
        pairs.append(f"{name}={value}")
    return "; ".join(pairs)


def _is_valid_cookie_pair(name: Any, value: Any) -> bool:
    if not isinstance(name, str) or not name or value is None:
        return False
    text_value = str(value)
    if COOKIE_CONTROL_RE.search(name) or COOKIE_CONTROL_RE.search(text_value):
        return False
    if any(character in name for character in ";=, \t") or ";" in text_value:
        return False
    return True

