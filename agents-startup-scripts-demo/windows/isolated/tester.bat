@echo off
rem Isolated run: each agent gets its own working directory.
set "AGENT_ID=tester"
title opencode - tester (isolated)
if not exist "%~dp0agent-tester" mkdir "%~dp0agent-tester"
cd /d "%~dp0agent-tester"
opencode
