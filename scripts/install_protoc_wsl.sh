#!/usr/bin/env bash
set -euo pipefail
mkdir -p ~/.local/bin
ZIP="/tmp/protoc.zip"
URL="https://github.com/protocolbuffers/protobuf/releases/download/v28.3/protoc-28.3-linux-x86_64.zip"

echo "Downloading protoc..."
if command -v wget >/dev/null; then
  wget -q --show-progress -O "$ZIP" "$URL"
elif command -v curl >/dev/null; then
  curl -fL --progress-bar -o "$ZIP" "$URL"
else
  python3 - <<'PY'
import urllib.request
urllib.request.urlretrieve(
    "https://github.com/protocolbuffers/protobuf/releases/download/v28.3/protoc-28.3-linux-x86_64.zip",
    "/tmp/protoc.zip",
)
print("downloaded via python")
PY
fi

echo "Extracting..."
unzip -qo "$ZIP" -d "$HOME/.local"
chmod +x "$HOME/.local/bin/protoc"
"$HOME/.local/bin/protoc" --version
echo "PROTOC_OK at $HOME/.local/bin/protoc"
