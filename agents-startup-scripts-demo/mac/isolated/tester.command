#!/bin/bash
# Isolated run: each agent gets its own working directory, so sessions
# (and bus delivery) can never mix between agents.
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR/agent-tester"
cd "$DIR/agent-tester"
export AGENT_ID="tester"
exec opencode
