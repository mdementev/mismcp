@echo off
rem Isolated run: each agent gets its own working directory.
set "AGENT_ID=developer"
title opencode - developer (isolated)
if not exist "%~dp0agent-developer" mkdir "%~dp0agent-developer"
cd /d "%~dp0agent-developer"
opencode
