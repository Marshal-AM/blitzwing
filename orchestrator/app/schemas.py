"""OpenAI-compatible request/response models."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    max_tokens: Optional[int] = None
    temperature: Optional[float] = 0.7
    top_p: Optional[float] = 0.9
    stream: bool = False
    stop: Optional[Union[str, List[str]]] = None


class Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChoiceMessage(BaseModel):
    role: Literal["assistant"] = "assistant"
    content: str


class Choice(BaseModel):
    index: int = 0
    message: ChoiceMessage
    finish_reason: Optional[str] = "stop"


class ChatCompletionResponse(BaseModel):
    id: str
    object: Literal["chat.completion"] = "chat.completion"
    created: int
    model: str
    choices: List[Choice]
    usage: Usage
    blitzwing_payment: Optional[Dict[str, Any]] = None


class Delta(BaseModel):
    role: Optional[Literal["assistant"]] = None
    content: Optional[str] = None


class StreamChoice(BaseModel):
    index: int = 0
    delta: Delta
    finish_reason: Optional[str] = None


class ChatCompletionChunk(BaseModel):
    id: str
    object: Literal["chat.completion.chunk"] = "chat.completion.chunk"
    created: int
    model: str
    choices: List[StreamChoice]


class ModelCard(BaseModel):
    id: str
    object: Literal["model"] = "model"
    created: int
    owned_by: str = "blitzwing"


class ModelList(BaseModel):
    object: Literal["list"] = "list"
    data: List[ModelCard]


class HealthResponse(BaseModel):
    status: str
    model: str
    model_loaded: bool
    initial_peers: List[str]
    detail: Optional[str] = None
    extra: Optional[Dict[str, Any]] = None
    max_layers_available: Optional[int] = None
    total_layers: Optional[int] = None
    cost_per_layer_tinybars: Optional[int] = None
    x402_enabled: Optional[bool] = None


class HostJoinRequest(BaseModel):
    model: str
    layers: int
    public_ip: str
    shard_manager_url: str
    hedera_account_id: str


class HostJoinResponse(BaseModel):
    host_id: str
    model: str
    block_indices: str
    layers_hosted: int
    initial_peers: List[str]
    donor_host_id: str
    max_layers_available: int
    total_layers: int
    hedera_account_id: str


class HostReadyRequest(BaseModel):
    host_id: str
    peer_multiaddr: Optional[str] = None


class InternalPayoutRequest(BaseModel):
    request_id: str


class HostHeartbeatRequest(BaseModel):
    host_id: str
    block_indices: Optional[str] = None
    petals_running: Optional[bool] = None
    peer_multiaddr: Optional[str] = None
    shard_manager_url: Optional[str] = None


class SwarmManifestResponse(BaseModel):
    model: str
    total_layers: int
    complete: bool
    detail: Optional[str] = None
    hosts: List[HostPublic]


class HostLeaveRequest(BaseModel):
    host_id: str


class HostPublic(BaseModel):
    host_id: str
    role: str
    model: str
    block_indices: str
    layers_hosted: int
    status: str
    public_ip: Optional[str] = None
    last_heartbeat: int
    hedera_account_id: Optional[str] = None


class HostListResponse(BaseModel):
    model: str
    total_layers: int
    max_layers_available: int
    cost_per_layer_tinybars: Optional[int] = None
    hosts: List[HostPublic]
