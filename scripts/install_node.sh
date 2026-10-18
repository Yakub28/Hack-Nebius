#!/usr/bin/env bash
# Node.js LTS into .tools/node (git-ignored), for building the web UI without a system-wide install.
# The download is checked against nodejs.org's published SHA-256 sums. Remove .tools/ to undo.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(curl -fsS https://nodejs.org/dist/index.json | python3 -c "import json,sys; print(next(r['version'] for r in json.load(sys.stdin) if r['lts']))")
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin-arm64 ;; Darwin-x86_64) platform=darwin-x64 ;;
  Linux-x86_64) platform=linux-x64 ;; Linux-aarch64) platform=linux-arm64 ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac
file="node-$version-$platform.tar.gz"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
curl -fsSo "$tmp/$file" "https://nodejs.org/dist/$version/$file"
curl -fsSo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/$version/SHASUMS256.txt"
(cd "$tmp" && grep " $file\$" SHASUMS256.txt | shasum -a 256 -c -)
mkdir -p .tools && rm -rf .tools/node && tar -xzf "$tmp/$file" -C .tools && mv ".tools/node-$version-$platform" .tools/node
echo "Node $version in .tools/node"
