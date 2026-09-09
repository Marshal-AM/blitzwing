"""Minimal inference result type for HTTP-chain contributors."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class InferenceResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str
