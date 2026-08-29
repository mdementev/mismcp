#!/usr/bin/env bash
#
# Install mismcp (bus + plugin) into the global opencode config.
# Works on macOS and Linux (and WSL).
#
# Usage:
#   ./install.sh                 # copy bus + plugin, wire MCP config
# Should be run from the repo directory (or any path; it locates itself).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
BUS_DIR="$CONFIG_DIR/bus"
PLUGINS_DIR="$CONFIG_DIR/plugins"
SERVER_JS="$BUS_DIR/dist/mcp-server.js"

echo "=== mismcp installer ==="

# --- 0. node check -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node is not installed or not on PATH. Install Node.js >= 22.5: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; } || [ "$NODE_MAJOR" -lt 22 ]; then
  echo "ERROR: Node $(node -v) detected; Node >= 22.5 is required (for built-in node:sqlite)." >&2
  exit 1
fi

# --- 1. copy bus -------------------------------------------------------------
echo "1. copying bus -> $BUS_DIR"
mkdir -p "$CONFIG_DIR"
rm -rf "$BUS_DIR"
cp -R "$REPO_DIR/bus" "$BUS_DIR"

echo "2. installing dependencies (npm install) + build (tsc)"
(
  cd "$BUS_DIR"
  npm install --no-fund --no-audit
  npm run build
)

# --- 2. copy plugin ----------------------------------------------------------
echo "3. copying plugin -> $PLUGINS_DIR/mismcp.ts"
mkdir -p "$PLUGINS_DIR"
cp "$REPO_DIR/plugin/mismcp.ts" "$PLUGINS_DIR/"

# --- 3. wire MCP server into opencode.json -----------------------------------
echo "4. wiring MCP server into $CONFIG_DIR/opencode.json"
if [ -f "$CONFIG_DIR/opencode.jsonc" ]; then
  echo "WARN: found opencode.jsonc, not touching it. Add the mismcp MCP entry manually (see README)."
elif [ -f "$CONFIG_DIR/opencode.json" ]; then
  if node - "$CONFIG_DIR/opencode.json" "$SERVER_JS" <<'NODE'
const fs = require("node:fs")
const [file, serverJs] = process.argv.slice(2)
const merge = {
  mcp: {
    mismcp: {
      type: "local",
      command: ["node", "--experimental-sqlite", serverJs],
      environment: { AGENT_ID: "{env:AGENT_ID}", BUS_PATH: "{env:BUS_PATH}" },
    },
  },
}
try {
  const cfg = JSON.parse(fs.readFileSync(file, "utf8"))
  const out = {
    ...cfg,
    mcp: { ...(cfg.mcp || {}), mismcp: merge.mcp.mismcp },
  }
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n")
  console.log("  merged mismcp MCP entry into " + file)
} catch (err) {
  console.error("WARN: could not parse " + file + " as plain JSON (" + err.message + "). Not touched.")
  console.error("      Add the mismcp MCP entry manually (see README).")
}
NODE
  then
    :
  else
    echo "WARN: config merge step failed, see messages above."
  fi
else
  cat > "$CONFIG_DIR/opencode.json" <<JSON
{
  "mcp": {
    "mismcp": {
      "type": "local",
      "command": ["node", "--experimental-sqlite", "$SERVER_JS"],
      "environment": { "AGENT_ID": "{env:AGENT_ID}", "BUS_PATH": "{env:BUS_PATH}" }
    }
  }
}
JSON
  echo "  created $CONFIG_DIR/opencode.json"
fi

echo
echo "=== done. Restart opencode for the config to apply. ==="
echo "    Bus DB : \$BUS_PATH (default ~/.mismcp/bus.db)"
echo "    Reinstall (e.g. after pulling updates): rerun ./install.sh"