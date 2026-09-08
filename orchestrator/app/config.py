"""Environment-driven settings for the orchestrator."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

try:
    from dotenv import load_dotenv

    _orch_env = Path(__file__).resolve().parents[1] / ".env"
    _root_env = Path(__file__).resolve().parents[2] / ".env"
    load_dotenv(_root_env)
    load_dotenv(_orch_env, override=True)
except ImportError:
    pass


def _split_peers(raw: str) -> List[str]:
    return [p.strip() for p in raw.split(",") if p.strip()]


def _truthy(raw: Optional[str], default: bool = False) -> bool:
    if raw is None or raw == "":
        return default
    return raw not in ("0", "false", "False", "no", "NO")


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
    ready_verify_timeout_seconds: int = 120
    skip_ready_verify: bool = False
    inference_timeout_seconds: int = 180
    petals_use_auto_relay: bool = True
    # x402 / Hedera payouts
    x402_enabled: bool = False
    cost_per_layer_tinybars: int = 0
    mother_account_id: Optional[str] = None
    mother_private_key: Optional[str] = None
    facilitator_url: str = "http://127.0.0.1:8791"
    hedera_network: str = "hedera-testnet"
    hcs_topic_id: Optional[str] = None
    escrow_contract_id: Optional[str] = None
    escrow_evm_address: Optional[str] = None
    escrow_operator_private_key: Optional[str] = None

    @property
    def request_price_tinybars(self) -> int:
        return int(self.total_layers) * int(self.cost_per_layer_tinybars)

    @classmethod
    def from_env(cls) -> "Settings":
        peers_raw = os.getenv("INITIAL_PEERS", "")
        announce_raw = os.getenv("ANNOUNCE_PEERS", "") or peers_raw
        cost_raw = os.getenv("COST_PER_LAYER_TINYBARS", "0")
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
            ready_verify_timeout_seconds=int(
                os.getenv("READY_VERIFY_TIMEOUT_SECONDS", str(cls.ready_verify_timeout_seconds))
            ),
            skip_ready_verify=_truthy(os.getenv("SKIP_READY_VERIFY"), default=False),
            inference_timeout_seconds=int(
                os.getenv("INFERENCE_TIMEOUT_SECONDS", str(cls.inference_timeout_seconds))
            ),
            petals_use_auto_relay=_truthy(os.getenv("PETALS_USE_AUTO_RELAY"), default=True),
            x402_enabled=_truthy(os.getenv("X402_ENABLED"), default=False),
            cost_per_layer_tinybars=int(cost_raw or "0"),
            mother_account_id=(os.getenv("MOTHER_ACCOUNT_ID") or None),
            mother_private_key=(os.getenv("MOTHER_PRIVATE_KEY") or None),
            facilitator_url=(
                os.getenv("FACILITATOR_URL") or cls.facilitator_url
            ).rstrip("/"),
            hedera_network=os.getenv("HEDERA_NETWORK", cls.hedera_network),
            hcs_topic_id=(os.getenv("HCS_TOPIC_ID") or None),
            escrow_contract_id=(os.getenv("ESCROW_CONTRACT_ID") or None),
            escrow_evm_address=(os.getenv("ESCROW_EVM_ADDRESS") or None),
            escrow_operator_private_key=(
                os.getenv("ESCROW_OPERATOR_PRIVATE_KEY") or os.getenv("MOTHER_PRIVATE_KEY") or None
            ),
        )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings.from_env()
