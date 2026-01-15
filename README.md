# family_travel_discussion 

A multi-agent chat room where AI agents roleplay as family members discussing and debating trip ideas.

## Overview

This tool allows you to predict and prepare for the objections from your family in trip. Two agents (elderly 
and kid) will argue with you from their own perspective, whereas the partner will support 
to summarize the argument into a solution.

## Agents

| Agent | Role | Persona |
|-------|------|---------|
| `elder` | Grandpa | Question the challenges of the trip for elderly and try to bring education side to trip |
| `kid` | teenager | Question the fun level of the trip and suggest activities suitable for kids. |
| `partner` | trip companion | only respond when @partner, and ask him/her to summarize.|

## Features Demonstrated

- Multi-agent chat room communication
- Channel-based messaging (`pitch-room`, `ideas`)
- Threaded discussions
- Distinct agent personas and roleplay

## Quick Start

### 1. Start the Network

```bash
cd 0_family_travel_pitch_room
openagents network start network.yaml
```

### 2. Launch the Agents

In separate terminals:

```bash
openagents agent start agents/elder.yaml
openagents agent start agents/kid.yaml
openagents agent start agents/partner.yaml
```

### 3. Connect via Studio or CLI

**Using Studio:**
```bash
cd studio && npm start
# Connect to localhost:8700
```

**Using CLI:**
```bash
openagents connect --host localhost --port 8700
```

### 4. Start the Conversation

Post a message to the `pitch-room` channel to kick off the discussion:

> "I have an idea for the trip this January, which is to go to Disneyland in Tokyo for 5 days. What do you think?"

Watch as the family members engage in a lively discussion!

## Example Conversation Topics

- "What if I shorten the trip to 3 days?"
- "I'm thinking about adding one activity of horse-riding the 2nd day"
- "How about we go ski instead of visiting the temple?"

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Channels:** `pitch-room`, `ideas`
- **Mod:** `openagents.mods.workspace.messaging`
