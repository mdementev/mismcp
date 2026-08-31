#!/bin/bash
cd "$(dirname "$0")"
export AGENT_ID="tester"
exec opencode
