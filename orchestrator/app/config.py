"""Environment-driven settings for the orchestrator."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List

try:
    from dotenv import load_dotenv

    _env_file = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(_env_file)
except ImportError:
    pass


def _split_peers(raw: str) -> List[str]:
    return [p.strip() for p in raw.split(",") if p.strip()]


@dataclass(frozen=True)
class Settings:
    model_name: str = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
    initial_peers: List[str] = field(default_factory=list)
    announce_peers: List[str] = field(default_factory=list)
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    default_max_tokens: int = 256
    hard_max_tokens: int = 512
    load_at_startup: bool = True
    total_layers: int = 22
    mother_shard_manager_url: str = "http://127.0.0.1:8001"
    heartbeat_ttl_seconds: int = 180

    @classmethod
    def from_env(cls) -> "Settings":
        peers_raw = os.getenv("INITIAL_PEERS", "")
        announce_raw = os.getenv("ANNOUNCE_PEERS", "") or peers_raw
        return cls(
            model_name=os.getenv("MODEL_NAME", cls.model_name),
            initial_peers=_split_peers(peers_raw),
            announce_peers=_split_peers(announce_raw),
            api_host=os.getenv("API_HOST", cls.api_host),
            api_port=int(os.getenv("API_PORT", str(cls.api_port))),
            default_max_tokens=int(os.getenv("DEFAULT_MAX_TOKENS", str(cls.default_max_tokens))),
            hard_max_tokens=int(os.getenv("HARD_MAX_TOKENS", str(cls.hard_max_tokens))),
            load_at_startup=os.getenv("LOAD_AT_STARTUP", "1") not in ("0", "false", "False"),
            total_layers=int(os.getenv("TOTAL_LAYERS", str(cls.total_layers))),
            mother_shard_manager_url=os.getenv(
                "MOTHER_SHARD_MANAGER_URL", cls.mother_shard_manager_url
            ).rstrip("/"),
            heartbeat_ttl_seconds=int(os.getenv("HEARTBEAT_TTL_SECONDS", str(cls.heartbeat_ttl_seconds))),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
