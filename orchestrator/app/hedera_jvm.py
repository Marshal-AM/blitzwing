"""Bootstrap JPype / JVM before java.* imports (required by hedera-sdk-py)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

_JVM_READY = False


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
    """Start the JVM once so `from java.math import BigInteger` works."""
    global _JVM_READY
    if _JVM_READY:
        return

    java_home = _discover_java_home()
    if java_home:
        os.environ["JAVA_HOME"] = java_home

    try:
        import jpype
        import jpype.imports  # noqa: F401

        if not jpype.isJVMStarted():
            jvm_path = jpype.getDefaultJVMPath()
            logger.info("Starting JVM via JPype (%s)", jvm_path)
            jpype.startJVM(jvm_path, convertStrings=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("JPype startJVM failed (%s); trying hedera import", exc)
        from hedera import Client  # noqa: F401

    from java.math import BigInteger  # noqa: F401

    _JVM_READY = True
    logger.info("JVM ready for Hedera SDK")


def big_integers(values: list[int]) -> list:
    ensure_java_vm()
    from java.math import BigInteger

    return [BigInteger(str(int(v))) for v in values]
