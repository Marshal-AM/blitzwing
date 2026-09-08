"""Bootstrap the JVM for hedera-sdk-py (uses pyjnius, not JPype)."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, List

logger = logging.getLogger(__name__)

_JVM_READY = False
_BigInteger = None


def _discover_java_home() -> str | None:
    explicit = (os.environ.get("JAVA_HOME") or "").strip()
    if explicit and Path(explicit).is_dir():
        return explicit
    candidates = [
        "/usr/lib/jvm/java-21-openjdk-amd64",
        "/usr/lib/jvm/java-17-openjdk-amd64",
        "/usr/lib/jvm/default-java",
    ]
    for path in candidates:
        if Path(path).is_dir():
            return path
    return None


def ensure_java_vm() -> None:
    """Ensure hedera/jnius can load java.math.BigInteger."""
    global _JVM_READY, _BigInteger
    if _JVM_READY and _BigInteger is not None:
        return

    java_home = _discover_java_home()
    if java_home:
        os.environ["JAVA_HOME"] = java_home

    # hedera-sdk-py starts the JVM via jnius on import — do NOT start JPype first.
    from hedera import AccountId  # noqa: F401
    from jnius import autoclass

    _BigInteger = autoclass("java.math.BigInteger")
    _JVM_READY = True
    logger.info("JVM ready via jnius (hedera-sdk-py)")


def big_integers(values: List[int]) -> List[Any]:
    ensure_java_vm()
    assert _BigInteger is not None
    return [_BigInteger(str(int(v))) for v in values]
