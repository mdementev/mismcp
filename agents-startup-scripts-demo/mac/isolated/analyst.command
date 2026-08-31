#!/bin/bash
# Isolated run: each agent gets its own working directory, so sessions
# (and bus delivery) can never mix between agents.
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/agent-analyst"
cd "$DIR/agent-analyst"
export AGENT_ID="analyst"
exec opencode
