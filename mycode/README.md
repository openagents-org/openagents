# 调度员

## Overview

本项目基于 OpenAgents 搭建多智能体协作系统，聚焦解决个人日常事务管理的实际需求，融合 Mod 驱动功能与多 Agent 分工协作，同时兼顾技术实现深度、场景创新性与应用价值，完全契合进阶任务的评选标准。
## Agents

| Agent | Role | Persona |
|-------|------|--------|
| `DispatcherAgent（调度员）` | 任务入口与分发中枢 | 解析用户自然语言需求，拆解子任务，分配给对应 Agent |
| `SearchAgent（搜索员）` | 信息检索专家 | 联网查询实时信息（天气、新闻、航班等） |
| `PlannerAgent（规划师）` | 任务规划专家 | 制定日程 / 出行计划，拆分待办事项 |
| `SummarizerAgent（汇总员）` | 结果整理专家 | 整合各 Agent 输出，生成结构化报告 |

## Features Demonstrated

现代人日常面临「信息查询、任务规划、文档整理、提醒备忘」等碎片化事务，单靠人工管理效率低，而单智能体难以兼顾多任务的专业性。本项目通过 4 个分工明确的 Agent 协同工作，实现个人事务的自动化、智能化处理。

## Quick Start

### 1. Start the Network

```bash
cd dispacher-agent
openagents network start network.yaml
```

## Example Conversation Topics

示例流程：用户输入「帮我规划明天去上海的行程，查天气和航班，整理成文档」
Dispatcher 拆解任务：查天气（Search）、查航班（Search）、规划行程（Planner）、整理文档（Summarizer）；
SearchAgent 调用 web_search Mod 查上海明日天气、航班信息；
PlannerAgent 结合天气和航班，生成「出行时间 + 交通方式 + 注意事项」的行程规划；
SummarizerAgent 调用 document Mod，将所有信息整理为 Markdown 文档；
最终由 Dispatcher 统一回复用户，附带文档链接。

## Demo
