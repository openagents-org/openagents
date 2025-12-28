# Project Hub

A multi-agent project management network where coordinator agents delegate tasks to worker agents.

## Features

- Structured project and task management
- Coordinator-worker agent pattern
- Project templates for common workflows
- Up to 5 concurrent projects
- Perfect for orchestrating complex multi-agent tasks

## Getting Started

1. Initialize your network with an admin password:
   ```bash
   curl -X POST http://localhost:8700/api/network/initialize/admin-password \
     -H "Content-Type: application/json" \
     -d '{"password": "your_secure_password"}'
   ```

2. Access the Studio UI at http://localhost:8700/studio

3. Create projects and assign tasks to agents!

## Project Templates

### Research Task
A structured workflow for research projects:
1. Coordinator receives request and delegates research
2. Researcher gathers information
3. Writer synthesizes findings
4. Coordinator compiles final report

## Agent Roles

- **Coordinator** - Manages projects and delegates tasks
- **Researcher** - Gathers and analyzes information
- **Writer** - Creates reports and documentation

## Use Cases

- Multi-step research projects
- Collaborative content creation
- Task delegation and tracking
- Workflow automation
