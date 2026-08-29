# Install mismcp (bus + plugin) into the global opencode config.
# Works on Windows (PowerShell 5.1+). Run from an elevated or normal prompt:
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Requires Node.js >= 22.5 on PATH.

$ErrorActionPreference = "Stop"

# Windows PowerShell 5.1 "UTF8" writes a BOM, which JSON.parse rejects — write BOM-free UTF-8.
function Write-JsonFile {
    param([string]$Path, [string]$Json)
    [System.IO.File]::WriteAllText($Path, $Json, (New-Object System.Text.UTF8Encoding($false)))
}

$RepoDir = $PSScriptRoot
$ConfigDir = Join-Path $env:USERPROFILE ".config\opencode"
$BusDir = Join-Path $ConfigDir "bus"
$PluginsDir = Join-Path $ConfigDir "plugins"
$ServerJs = Join-Path $BusDir "dist\mcp-server.js"

Write-Host "=== mismcp installer (Windows) ==="

# --- 0. node check -----------------------------------------------------------
$NodeExe = Get-Command node -ErrorAction SilentlyContinue
if (-not $NodeExe) {
    Write-Error "ERROR: node is not installed or not on PATH. Install Node.js >= 22.5: https://nodejs.org"
    exit 1
}
$NodeVer = (& node -v).Trim()
$NodeParts = $NodeVer -replace "^v", "" -split "\."
$Major = [int]$NodeParts[0]
$Minor = [int]$NodeParts[1]
if ($Major -lt 22 -or ($Major -eq 22 -and $Minor -lt 5)) {
    Write-Error "ERROR: Node $NodeVer detected; Node >= 22.5 is required (for built-in node:sqlite)."
    exit 1
}

# --- 1. copy bus -------------------------------------------------------------
Write-Host "1. copying bus -> $BusDir"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
if (Test-Path $BusDir) { Remove-Item -Recurse -Force $BusDir }
Copy-Item -Recurse -Force (Join-Path $RepoDir "bus") $BusDir

Write-Host "2. installing dependencies (npm install) + build (tsc)"
Push-Location $BusDir
try {
    & npm.cmd install --no-fund --no-audit
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
} finally {
    Pop-Location
}

# --- 2. copy plugin ----------------------------------------------------------
Write-Host "3. copying plugin -> $PluginsDir\mismcp.ts"
New-Item -ItemType Directory -Force -Path $PluginsDir | Out-Null
Copy-Item -Force (Join-Path $RepoDir "plugin\mismcp.ts") (Join-Path $PluginsDir "mismcp.ts")

# --- 3. wire MCP server into opencode.json -----------------------------------
$JsonPath = Join-Path $ConfigDir "opencode.json"
$JsoncPath = Join-Path $ConfigDir "opencode.jsonc"
Write-Host "4. wiring MCP server into $JsonPath"

if (Test-Path $JsoncPath) {
    Write-Warning "Found opencode.jsonc; not touching it. Add the mismcp MCP entry manually (see README)."
} elseif (Test-Path $JsonPath) {
    try {
        $cfg = Get-Content -Raw -Path $JsonPath | ConvertFrom-Json
        $mcp = [PSCustomObject]@{
            type        = "local"
            command     = @("node", "--experimental-sqlite", $ServerJs)
            environment = [PSCustomObject]@{ AGENT_ID = "{env:AGENT_ID}"; BUS_PATH = "{env:BUS_PATH}" }
        }
        if ($null -eq $cfg.mcp) {
            $cfg | Add-Member -NotePropertyName "mcp" -NotePropertyValue ([PSCustomObject]@{ mismcp = $mcp })
        } else {
            $cfg.mcp | Add-Member -NotePropertyName "mismcp" -NotePropertyValue $mcp -Force
        }
        $json = $cfg | ConvertTo-Json -Depth 12
        Write-JsonFile -Path $JsonPath -Json $json
        Write-Host "  merged mismcp MCP entry into $JsonPath"
    } catch {
        Write-Warning "Could not parse $JsonPath as JSON: $($_.Exception.Message). Not touched."
        Write-Warning "Add the mismcp MCP entry manually (see README)."
    }
} else {
    $content = @{
        mcp = @{
            mismcp = @{
                type        = "local"
                command     = @("node", "--experimental-sqlite", $ServerJs)
                environment = @{ AGENT_ID = "{env:AGENT_ID}"; BUS_PATH = "{env:BUS_PATH}" }
            }
        }
    }
    $json = $content | ConvertTo-Json -Depth 12
    Write-JsonFile -Path $JsonPath -Json $json
    Write-Host "  created $JsonPath"
}

Write-Host ""
Write-Host "=== done. Restart opencode for the config to apply. ==="
Write-Host "    Bus DB: %USERPROFILE%\.mismcp\bus.db (BUS_PATH)"
Write-Host "    Reinstall (e.g. after pulling updates): rerun .\install.ps1"