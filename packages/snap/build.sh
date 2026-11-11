#!/bin/sh
# Test, cross-compile static Linux binaries, and pack them the way the
# published wan27 snap was packed: mksquashfs, without LXD or Multipass.
# snap/snapcraft.yaml is the recipe for a later `snapcraft pack` in this
# directory. This script does not log in or upload.
set -eu
cd "$(dirname "$0")"
version=0.1.0
go test -count=1 ./...

write_meta() {
  arch=$1
  cat > "build/$arch/meta/snap.yaml" <<EOF
name: wan30
version: '$version'
summary: Client for a wan30.video account
description: |
  Command line client for a wan30.video account. It speaks the same
  Streamable HTTP MCP endpoint as the Wan30 command line client:
  POST {origin}/api/mcp/.
  Purchased wan30.video credits are required for generation. Sign-up,
  check-in and gift credits alone do not qualify. estimate does not
  spend credits. generate does not call the service unless
  --confirm-spend is present, and that flag is not sent.
  This is not an official Alibaba, DashScope, or Tongyi client.
architectures:
  - $arch
base: core24
confinement: strict
grade: stable
license: MIT
title: Client for a Wan30 video account
links:
  website:
    - https://wan30.video/
  source-code:
    - https://github.com/NotUsingGithub/wan30-mcp
  issues:
    - https://github.com/NotUsingGithub/wan30-mcp/issues
  contact:
    - https://github.com/NotUsingGithub/wan30-mcp/issues
apps:
  wan30:
    command: bin/wan30
    plugs:
      - network
      - home
EOF
}

for arch in amd64 arm64; do
  mkdir -p "build/$arch/meta" "build/$arch/bin"
  write_meta "$arch"
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -ldflags="-s -w" -o "build/$arch/bin/wan30" .
  chmod 755 "build/$arch/bin/wan30"
  mksquashfs "build/$arch" "build/wan30_${version}_${arch}.snap" -noappend -comp xz -all-root -no-xattrs -no-fragments
done

./build/amd64/bin/wan30 --help >/dev/null
input=$(mktemp)
trap 'rm -f "$input"' EXIT
printf '%s\n' '{"modelId":"wan30-text-to-video","prompt":"A paper boat"}' > "$input"
set +e
smoke=$(./build/amd64/bin/wan30 generate --input "$input" --request-id paper-boat-request 2>&1)
smoke_status=$?
set -e
printf '%s\n' "$smoke"
if [ "$smoke_status" -ne 1 ] || ! printf '%s\n' "$smoke" | grep -q 'SPEND_NOT_CONFIRMED'; then
  echo "packed binary did not refuse an unconfirmed generate" >&2
  exit 1
fi
unsquashfs -l "build/wan30_${version}_amd64.snap"
unsquashfs -l "build/wan30_${version}_arm64.snap"
ls -l build/*.snap
