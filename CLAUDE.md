# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lovable clone using Claude Code SDK and Daytona sandboxes for isolated code generation and preview.

## Commands

### Development
```bash
# Install dependencies
cd lovable-ui
npm install

# Run development server
npm run dev

# Build the application
npm run build

# Run production server
npm run start

# Lint the code
npm run lint
```

### Daytona Sandbox Scripts
```bash
# Generate website in new sandbox
npx tsx scripts/generate-in-daytona.ts "[prompt]"

# Generate in existing sandbox
npx tsx scripts/generate-in-daytona.ts [sandbox-id] "[prompt]"

# Get preview URL for sandbox
npx tsx scripts/get-preview-url.ts [sandbox-id] [port]

# Debug sandbox issues (check server status)
# Use ssh to connect to sandbox for debugging

# Remove sandbox
npx tsx scripts/remove-sandbox.ts [sandbox-id]

# Test preview URL functionality
npx tsx scripts/test-preview-url.ts
```

## Architecture

### Core Components

1. **Next.js Frontend (lovable-ui/)**
   - `/app/generate/page.tsx` - Main generation UI with live preview
   - `/app/api/generate-daytona/route.ts` - API endpoint that streams generation progress
   - Real-time streaming of Claude Code messages and tool usage

2. **Claude Code Integration**
   - Uses `@anthropic-ai/claude-code` SDK for AI-powered code generation
   - Configured with allowed tools: Read, Write, Edit, MultiEdit, Bash, LS, Glob, Grep
   - Maximum 20 turns per generation

3. **Daytona Sandbox System**
   - Creates isolated Node.js containers for code generation
   - `sandbox.getPreviewLink(port)` returns publicly accessible preview URLs
   - Sandboxes persist for debugging and can be reused

### Generation Flow

1. User submits prompt → Frontend sends to `/api/generate-daytona`
2. API spawns `scripts/generate-in-daytona.ts` as child process
3. Script creates/connects to Daytona sandbox
4. Installs Claude Code SDK in sandbox
5. Runs generation script that uses Claude Code to create website
6. Starts dev server in sandbox (port 3000)
7. Returns preview URL via `sandbox.getPreviewLink()`
8. Frontend displays preview in iframe

### Message Protocol

 The API uses Server-Sent Events with special markers:
- `__CLAUDE_MESSAGE__` - Claude assistant messages
- `__TOOL_USE__` - Tool invocations
- `__TOOL_RESULT__` - Tool results (filtered)
- Regular console output sent as progress messages

## Environment Variables

Required in `.env`:
- `ANTHROPIC_API_KEY` - For Claude Code SDK
- `DAYTONA_API_KEY` - For sandbox management

## Current Implementation Status

- ✅ Website generation in isolated Daytona sandboxes
- ✅ Live preview URLs with public access
- ✅ Real-time progress streaming
- ✅ Claude Code message and tool usage display
- ✅ Sandbox persistence for debugging
- ✅ Sandbox reuse capability
 