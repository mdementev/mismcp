#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/agent-sut_expert"
cd "$DIR/agent-sut_expert"
export AGENT_ID="sut_expert"
exec opencode --prompt "hi"
