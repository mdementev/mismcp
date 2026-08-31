@echo off
rem Isolated run: each agent gets its own working directory.
set "AGENT_ID=analyst"
title opencode - analyst (isolated)
if not exist "%~dp0agent-analyst" mkdir "%~dp0agent-analyst"
cd /d "%~dp0agent-analyst"
opencode
