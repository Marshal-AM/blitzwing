"""Serialize torch tensors for HTTP transfer."""

from __future__ import annotations

import base64
from typing import Any, Dict

import numpy as np
import torch


def tensor_to_payload(tensor: torch.Tensor) -> Dict[str, Any]:
    arr = tensor.detach().cpu().contiguous().numpy()
    return {
        "b64": base64.b64encode(arr.tobytes()).decode("ascii"),
        "shape": list(arr.shape),
        "dtype": str(arr.dtype),
    }


def tensor_from_payload(payload: Dict[str, Any]) -> torch.Tensor:
    arr = np.frombuffer(
        base64.b64decode(payload["b64"]),
        dtype=np.dtype(payload["dtype"]),
    ).reshape(payload["shape"])
    return torch.from_numpy(arr.copy())
