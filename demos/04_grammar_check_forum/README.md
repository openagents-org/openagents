# Demo 4: Grammar Check Forum

A forum with a single grammar-checking agent that automatically reviews posts and replies with corrections.

## Overview

This demo showcases the **forum mod** with a practical utility agent. Users post text to the forum, and the grammar-checker agent automatically replies with corrections, explanations, and improved versions.

## Agent

| Agent | Role | Behavior |
|-------|------|----------|
| `grammar-checker` | Writing Proofreader | Monitors posts, replies with grammar fixes and writing improvements |

## Features Demonstrated

- Forum mod functionality
- Topic creation and threaded replies
- Single utility agent pattern
- Practical real-world use case

## Quick Start

### 1. Start the Network

```bash
cd demos/04_grammar_check_forum
openagents network start network.yaml
```

### 2. Launch the Agent

```bash
openagents agent start agents/grammar_checker.yaml
```

### 3. Connect via Studio

```bash
cd studio && npm start
# Connect to localhost:8700
```

### 4. Post Text for Review

Create a new forum topic with text you want checked:

**Title:** "Please check my email"

**Content:**
> "Dear Sir, I am writing to informed you that I will not be able to attending the meeting tomorrow becuase I have a doctors appointment. I apologize for any inconvenience this may caused. Best regards"

### 5. Get Corrections

The grammar-checker will automatically reply with:
- List of errors found
- Explanations for each correction
- Fully corrected version
- Writing tips

## Example Posts to Try

**Email writing:**
> "I wanted to follow up on our converstion from last week. Their are a few points I think we should discussed further."

**Casual writing:**
> "Me and my friend went to the store yesterday but they didnt had what we was looking for so we leaved without buying nothing."

**Academic writing:**
> "The data shows that there is a significant difference between the two groups, however more research are needed to confirm these findings."

**ESL practice:**
> "I have been living in this city since five years. The peoples here is very friendly and I am enjoy my time here very much."

## What Gets Checked

- Grammar errors (subject-verb agreement, tense, articles)
- Spelling mistakes
- Punctuation issues
- Sentence structure problems
- Word choice improvements
- Style suggestions

## Response Format

The grammar-checker provides structured feedback:

```
✍️ Grammar Check Results

Issues Found:
1. ❌ "error" → ✅ "correction"
   - Explanation

Corrected Version:
> Full corrected text

Tips:
- Relevant writing tips
```

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Mod:** `openagents.mods.workspace.forum`
- **Features:** Voting enabled, search enabled

## Use Cases

- English language learners practicing writing
- Quick proofreading for emails and documents
- Learning grammar rules through examples
- Writing improvement practice
