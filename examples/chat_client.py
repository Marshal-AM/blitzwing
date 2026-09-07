"""
Consumer example: call the Blitzwing OpenAI-compatible chat completions API.

Uses plain HTTP (stdlib) — no OpenAI SDK and no API key.

Prereqs (operator side already running):
  - VM1 Petals + orchestrator on :8000
  - VM2 Petals joined to the swarm

Usage:
  set BLITZWING_BASE_URL=http://<VM1_IP>:8000/v1
  python examples/chat_client.py

  python examples/chat_client.py --base-url http://34.x.x.x:8000/v1 -q "What is Petals?"
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, Iterator, List


DEFAULT_MODEL = "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
DEFAULT_SYSTEM = (
    "You are a helpful assistant running on a private Petals swarm. "
    "Keep answers concise and clear."
)
DEFAULT_QUERY = "Explain in one short paragraph what a distributed LLM swarm is."


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Blitzwing chat completions consumer example")
    parser.add_argument(
        "--base-url",
        default=os.getenv("BLITZWING_BASE_URL", "http://127.0.0.1:8000/v1"),
        help="Orchestrator API base URL (env: BLITZWING_BASE_URL)",
    )
    parser.add_argument("--model", default=os.getenv("BLITZWING_MODEL", DEFAULT_MODEL))
    parser.add_argument(
        "--system",
        default=os.getenv("BLITZWING_SYSTEM", DEFAULT_SYSTEM),
        help="System prompt",
    )
    parser.add_argument(
        "-q",
        "--query",
        default=os.getenv("BLITZWING_QUERY", DEFAULT_QUERY),
        help="User message / query",
    )
    parser.add_argument("--max-tokens", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument(
        "--stream",
        action="store_true",
        help="Stream tokens as they arrive (SSE)",
    )
    return parser.parse_args()


def _endpoint(base_url: str) -> str:
    return base_url.rstrip("/") + "/chat/completions"


def _post_json(url: str, payload: Dict[str, Any], *, stream: bool = False) -> urllib.request.addinfourl:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "text/event-stream" if stream else "application/json"},
        method="POST",
    )
    return urllib.request.urlopen(req, timeout=600)


def chat_completion(
    *,
    base_url: str,
    model: str,
    messages: List[Dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> Dict[str, Any]:
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    with _post_json(_endpoint(base_url), payload, stream=False) as resp:
        return json.loads(resp.read().decode("utf-8"))


def iter_sse_deltas(
    *,
    base_url: str,
    model: str,
    messages: List[Dict[str, str]],
    max_tokens: int,
    temperature: float,
) -> Iterator[str]:
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": True,
    }
    with _post_json(_endpoint(base_url), payload, stream=True) as resp:
        while True:
            line = resp.readline()
            if not line:
                break
            text = line.decode("utf-8").strip()
            if not text or text.startswith(":"):
                continue
            if not text.startswith("data:"):
                continue
            data = text[len("data:") :].strip()
            if data == "[DONE]":
                break
            chunk = json.loads(data)
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta") or {}
            content = delta.get("content")
            if content:
                yield content


def main() -> None:
    args = parse_args()
    messages = [
        {"role": "system", "content": args.system},
        {"role": "user", "content": args.query},
    ]

    print(f"base_url : {args.base_url}")
    print(f"model    : {args.model}")
    print(f"system   : {args.system}")
    print(f"query    : {args.query}")
    print("---")

    try:
        if args.stream:
            print("assistant: ", end="", flush=True)
            for piece in iter_sse_deltas(
                base_url=args.base_url,
                model=args.model,
                messages=messages,
                max_tokens=args.max_tokens,
                temperature=args.temperature,
            ):
                print(piece, end="", flush=True)
            print()
            return

        response = chat_completion(
            base_url=args.base_url,
            model=args.model,
            messages=messages,
            max_tokens=args.max_tokens,
            temperature=args.temperature,
        )
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        sys.exit(1)

    choice = response["choices"][0]
    print(f"assistant: {choice['message']['content']}")
    usage = response.get("usage") or {}
    if usage:
        print("---")
        print(
            f"usage: prompt={usage.get('prompt_tokens')} "
            f"completion={usage.get('completion_tokens')} "
            f"total={usage.get('total_tokens')}"
        )
        print(f"finish_reason: {choice.get('finish_reason')}")


if __name__ == "__main__":
    main()
