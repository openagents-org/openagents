# Role Agent Roundtable Design Spec

日期：2026-06-14

## 1. 背景

AgentHive 当前圆桌 P0 已经实现了本地深色桌面圆桌、Agent 配置、Fact Pack、阶段推进、讨论区和最终输出。旧 P0 的核心取舍是“受控上下文注入”：每个 Agent 拥有 `skillContent`，运行时把该 Agent 的 Skill 内容拼入 prompt。

这个取舍适合快速 demo，但不满足当前目标。当前目标不是让 AI 戴上商业领袖面具说话，而是让系统拉起可验证的商业领袖 Role Agent：每个 Role Agent 加载对应 Skill、拥有来源语料、遵守人物心智模型、在圆桌中直接做判断、追问、反驳、修正和收敛。

本规格将旧 P0 的 `skillContent` 注入路径定义为 legacy path。它可以作为迁移期止血手段，但不能作为最终验收路径。

## 2. 目标

构建 AgentHive Role Agent Roundtable，使用户能围绕一个创新 idea 拉起一组强商业领袖 Role Agent，进行像真实高强度 CEO 圆桌一样的讨论。

成功体验是：

- 用户看到的不是“我以某某视角参与”的 AI 角色，而是一组已加载 Skill 的 Role Agent 在会议桌上直接做商业判断。
- Musk、Bezos、Jobs、Drucker、Grove、Thiel、Walton 等商业领袖角色能体现各自公开材料中可验证的思考方式、表达节奏和冲突偏好。
- 讨论不是一轮表态后总结，而是有 back-and-forth、点名追问、证据请求、假设攻防、修正和可执行结论。
- 产品界面能显示哪些角色是真实 Role Agent、对应 Skill 是否已加载、研究语料是否合格、输出是否通过审计。
- Nuwa Skill Factory 能防止未来继续生成浅层、模板化、角色味弱的商业领袖 Skill。

## 3. 非目标

- 不冒充或声称真人本人在线参与。
- 不伪造未公开观点、未验证发言或不存在的引用。
- 不把法律、医疗、投资、监管等高风险建议包装成最终结论。
- 不在第一阶段追求完整企业级权限、安全沙箱、云端多租户或团队协同。
- 不把头像、视觉 polish 或导出能力置于 Role Agent 真实性和讨论强度之前。

## 4. 已知事实与候选假设

### 4.1 已知事实

1. Nuwa 原 Skill 方法要求深度调研、六类研究文件、来源分级、心智模型萃取、表达 DNA 和 Agentic Protocol。
2. 当前 `roundtable-skills` 是 Nuwa 的单代理适配版，README 明确写明未使用女娲原流程的并行 subagent。
3. 当前 7 个商业领袖 Skill 都存在研究材料偏薄、来源沉淀不足、Agentic Protocol 模板化的问题，不只是 Musk。
4. 当前运行时存在 `RoundtableAgent.skillContent`，并通过 `renderAgentPrompt` 注入 Skill 正文。
5. 当前 Codex runner 使用 `--ephemeral`、`--ignore-user-config` 和 `--ignore-rules`，这与“加载已安装 Skill / 用户规则 / 角色 profile”的方向冲突。
6. 当前讨论编排有固定目标选择和字数限制，会压低追问、反驳和人物风格展开。

### 4.2 候选假设

1. 高置信候选：当前角色弱主要来自 Nuwa 执行链路被单代理化、产物门槛不硬，而不是 Nuwa 原方法论本身。
2. 高置信候选：把 Skill 当 prompt 注入是角色感弱的重要机制原因。
3. 中置信候选：Nuwa 原质量检查偏结构完整，不足以挡住浅研究、模板化协议和低人格强度。
4. 未证实：当前 Musk Skill 是否直接来自 GitHub 现成 Skill，仍需 diff 原始 example、当前 Skill 和生成日志。

这些候选假设在实现前必须经过审计或 spike 验证，不能直接当作最终根因。

## 5. 产品原则

### 5.1 Role Agent 优先

商业领袖是 Role Agent，不是 role prompt。

Role Agent 至少包含：

- `roleAgentId`
- `displayName`
- `publicFigureName`
- `runtimeProvider`
- `skillId`
- `skillPath`
- `skillLoadStatus`
- `corpusPath`
- `sourceManifestPath`
- `qualityScores`
- `avatar`
- `meetingRole`
- `participationMode`

其中 `participationMode` 至少包含：

- `participant`：台前参与讨论。
- `background_research`：后台补充事实或政策，不主动上台。
- `judge`：审计讨论质量，不参与讨论内容。
- `chair`：主持和调度讨论，不替代商业领袖观点。

### 5.2 Skill 不再整段注入 prompt

最终架构中，Role Agent 的 prompt 不包含完整 `SKILL.md` 正文。

允许 prompt 包含：

- 当前议题
- 用户目标
- 事实包
- 公开 transcript
- 当前发言任务
- 被挑战对象
- 输出协议
- 必要的安全和事实边界

不允许 prompt 包含：

- 该角色完整 Skill 正文
- 其他角色完整 Skill 正文
- 其他角色私有语料
- 用于伪装“本人在线”的暗示

### 5.3 公开人物边界由 UI 统一披露

Role Agent 发言中不得出现：

- “我以某某视角”
- “非本人观点”
- “目标对象：某某”
- “作为一个 AI”
- “基于公开材料推断”
- “你的挑战成立”
- “我接受你的挑战”

必要的模拟性质、来源边界和非本人声明由 UI 或角色详情统一展示，不进入每条会议发言。

### 5.4 证据纪律

没有足够证据判断根因时，Role Agent 不得给正式修复方案。最多输出：

- 已知事实
- 候选假设
- 验证路径
- 临时止血方案
- 未证实部分

这条规则适用于产品输出、Skill 生成、审计报告和圆桌总结。

## 6. 系统架构

Role Agent Roundtable 分为五个核心子系统。

### 6.1 Skill Factory

Skill Factory 负责从 Nuwa 方法生成或补强 Role Agent Skill。

输入：

- 人物名称
- 会议职责
- 项目领域
- 可用一手材料
- 可用二手材料
- 用户额外约束

输出：

- `SKILL.md`
- `references/research/01-writings.md`
- `references/research/02-conversations.md`
- `references/research/03-expression-dna.md`
- `references/research/04-external-views.md`
- `references/research/05-decisions.md`
- `references/research/06-timeline.md`
- `references/sources/source-manifest.json`
- `evals/persona-cases.json`
- `evals/generation-report.json`

最低质量门：

- 每个公开人物至少 10 条一手来源摘录或可定位出处。
- 每个核心心智模型至少有 2 条不同来源证据。
- 每个 Skill 至少包含 5 个人物专属反驳模式。
- 每个 Skill 至少包含 5 个该人物不会说的 AI 套话或错误口吻。
- Agentic Protocol 的研究维度必须从该人物心智模型反推，不能与其他角色高度相似。
- 没有 source manifest 的 Skill 不能发布为可用 Role Agent。
- 没有通过 persona/evidence/intensity judge 的 Skill 只能标记为 draft。

### 6.2 Role Agent Registry

Role Agent Registry 管理已安装和可用角色。

职责：

- 记录 Role Agent 元数据。
- 显示 Skill 安装状态。
- 显示来源语料完整度。
- 显示最近一次 eval 分数。
- 控制角色是否能进入台前讨论。
- 区分公开人物角色、岗位角色、后台研究角色、judge 角色。

Registry 中的公开人物角色必须能打开详情页，查看：

- 经典来源
- 研究摘要
- 核心心智模型
- 决策启发式
- 表达 DNA
- 禁用套话
- 测试 transcript
- 质量分
- 头像来源说明

### 6.3 Role Agent Runtime

Role Agent Runtime 负责拉起可通信的角色 Agent。

标准生命周期：

1. install skill
2. verify skill load
3. spawn isolated role agent
4. send roundtable task
5. receive structured response
6. run output judge
7. accept, retry, or escalate

Codex 路径的目标行为：

- 为每个 Role Agent 准备隔离 profile 或隔离 working directory。
- Skill 通过 Codex 可识别的 Skill 安装机制、profile 或工作目录规则被加载。
- Role Agent prompt 只传任务，不传完整 Skill 正文。
- `--ignore-user-config` 和 `--ignore-rules` 不得在最终 Role Agent 模式中强制启用。
- `--ephemeral` 只允许用于无记忆测试；真实讨论可使用隔离会话或可控记忆。

如果 Codex CLI 无法直接加载隔离 Skill，则 Runtime 必须验证替代路径：

- 隔离 `CODEX_HOME`
- 角色工作目录下的 `AGENTS.md`
- Codex thread/subagent
- Claude Code profile
- 本地 agent process adapter

替代路径必须通过同一套 skill-load verification，不能退回“整段 Skill 注入 prompt”作为最终架构。

### 6.4 Roundtable Orchestrator

Roundtable Orchestrator 负责讨论节奏和冲突质量。

默认阶段：

1. Opening Positions：每个商业领袖给出初始判断。
2. Conflict Mapping：主持 Agent 识别最强分歧和缺证据点。
3. Targeted Challenge：动态点名挑战，不按固定相邻顺序。
4. Evidence Pull：需要事实时调用后台研究/政策/医学/公司上下文 Agent。
5. Revision：被挑战者必须修正、拒绝或重写假设。
6. Decision Pressure：主持 Agent 逼近取舍、责任人、时间窗口和验证动作。
7. Closing：保留共识、分歧、风险、下一步，不粉饰成全员一致。

讨论强度要求：

- 至少 3 轮有效 back-and-forth。
- 每轮至少有一个直接挑战或证据请求。
- 被点名角色必须回应具体挑战，不能泛泛重复立场。
- 复杂议题不强制 180-360 字；UI 可以折叠长发言。
- 关闭阶段不能绕过未解决分歧。

### 6.5 Quality Judge

Quality Judge 不参与台前讨论，只做审计。

每条 Role Agent 输出至少评估：

- `persona_fidelity`：是否符合该人物公开材料中可观察的思考方式。
- `commercial_sharpness`：是否有商业判断、取舍和操作性。
- `evidence_discipline`：是否标注事实边界，避免无证据定论。
- `disagreement_intensity`：是否敢于挑战关键假设。
- `anti_mask_language`：是否避免 AI 扮演套话。
- `actionability`：是否给出可执行的下一步或验证动作。

低于阈值时：

- 可要求该 Role Agent 重新发言。
- 可要求主持 Agent 重新点名追问。
- 可把输出标记为低质量并进入审计记录。

## 7. 产品界面

### 7.1 Agent Registry 页面

原“管理智能体”升级为 Agent Registry。

列表至少显示：

- 头像
- 名称
- 类型：公开人物 / 岗位 / 后台研究 / judge / 主持
- Runtime：Codex / Claude / Local / Legacy
- Skill 状态：未安装 / 已安装 / 已验证加载 / 加载失败
- 语料状态：缺失 / 草稿 / 合格
- 最近质量分
- 是否可上台

用户操作：

- 查看详情
- 安装或重新验证 Skill
- 运行角色测试
- 设为台前参与者
- 设为后台 Agent
- 禁用 legacy prompt 模式

### 7.2 Role Agent 详情页

详情页不是单纯 prompt 编辑器，而是角色操作台。

主要区域：

- 身份与会议职责
- Skill 加载状态
- 来源语料与经典材料
- 核心心智模型
- 表达 DNA
- 禁止套话
- 讨论测试样例
- 最近 eval 报告
- 头像与来源说明

公开人物头像要求：

- 优先使用真实公开头像或用户提供头像。
- 不使用生成的虚拟头像冒充真人。
- 头像来源需要可追溯或由用户确认。

### 7.3 Roundtable 页面

圆桌页面保留现有深色商务桌面风格，但强化状态透明度。

新增可见信息：

- 当前上台 Role Agent 列表。
- 每个角色是否为 verified role agent。
- 哪些后台 Agent 被调用。
- 讨论强度状态：回合数、直接挑战数、证据请求数。
- Judge 结果摘要。
- Fact Pack 来源状态。
- 当前未解决分歧。

### 7.4 Legacy 标识

只要系统仍在使用 `skillContent` 注入，就必须在 UI 中标记为 legacy mode。

legacy mode 可以用于：

- 开发期止血。
- Skill load spike 失败时的临时演示。
- 用户手动粘贴角色内容的低可信模式。

legacy mode 不能用于：

- 最终验收。
- 标记为 verified role agent。
- 宣称“已加载 Skill”。

## 8. 数据流

### 8.1 Skill 生成流

1. 用户选择或输入公开人物。
2. Skill Factory 收集来源和研究材料。
3. 生成研究文件、source manifest 和 Skill。
4. 运行质量 gate。
5. 通过后写入 Registry。
6. 未通过则标记为 draft，并显示失败原因。

### 8.2 Role Agent 运行流

1. 用户选择 Role Agent 进入圆桌。
2. Runtime 验证每个 Role Agent 的 Skill 加载状态。
3. Orchestrator 生成当前轮任务。
4. Runtime 向对应 Role Agent 发送任务。
5. Role Agent 返回结构化发言。
6. Judge 审计输出。
7. Orchestrator 决定接受、重试、追问或调用后台 Agent。
8. UI 展示发言、关系边、审计状态和 Fact Pack 更新。

### 8.3 后台 Agent 调用流

1. 台前 Role Agent 或主持 Agent 提出证据请求。
2. Orchestrator 将请求路由给后台 Agent。
3. 后台 Agent 输出事实、来源、限制和未证实项。
4. Fact Pack 更新。
5. 台前 Role Agent 基于更新后的 Fact Pack 继续讨论。

后台 Agent 默认不进入台前讨论流。

## 9. 验收标准

### 9.1 Skill Factory 验收

- 7 个商业领袖 Skill 均有 source manifest。
- 7 个商业领袖 Skill 均有完整六类研究文件。
- 每个 Skill 的 research 文件不再只是短摘要。
- Agentic Protocol Step 2 不同角色之间不高度重复。
- 每个 Skill 都有 persona eval cases。
- 弱 Skill 会被 gate 拒绝。

### 9.2 Runtime 验收

- Role Agent 模式下，生成 prompt 不包含完整 `SKILL.md` 正文。
- Runtime 能检测 Skill 是否真实加载。
- UI 能显示 Skill 已验证加载或加载失败。
- legacy prompt 注入路径被清楚标识。
- Codex runner 不在 Role Agent 模式下强制使用 `--ignore-user-config` 和 `--ignore-rules`。

### 9.3 讨论验收

使用 PDF 中一个资源聚焦或管线补强 idea 清理环境后测试。

合格讨论必须满足：

- 至少 3 轮有效 back-and-forth。
- 至少 3 个直接点名挑战。
- 至少 2 个证据请求进入 Fact Pack。
- 至少 1 次后台 Agent 被调用。
- Closing 明确保留共识、分歧、风险和下一步。
- 发言中不出现面具感语言。
- Judge 报告显示 persona、商业锐度、证据纪律、反驳强度达到阈值。

### 9.4 UI 验收

- Agent Registry 所有按钮可交互。
- Role Agent 详情页能打开并显示 Skill、语料、质量分。
- Roundtable 页面能显示 verified / legacy 状态。
- 深色界面文字可读，不出现浅底白字或低对比文字。
- 头像使用真实头像或用户确认头像，不能默认使用虚拟假头像。

## 10. 迁移策略

### 10.1 第一阶段：审计与止血

- 保留 legacy path，但标记清楚。
- 修正面具感语言过滤。
- 增加讨论回合和挑战强度。
- 政策/事实专家后台化。
- 产出 7 个商业领袖 Skill 的审计报告。

### 10.2 第二阶段：Role Agent Runtime Spike

- 用 dummy Skill 验证 Codex CLI 是否能真实加载 Skill。
- 验证隔离 profile / working directory / CODEX_HOME 方案。
- 记录成功路径和失败路径。
- 不在 spike 前承诺最终 runner 方案。

### 10.3 第三阶段：Skill Factory 强修正

- 加强 Nuwa 产物质量门。
- 重新生成或补强 7 个商业领袖 Skill。
- 添加 source manifest、persona cases 和 generation report。

### 10.4 第四阶段：Role Agent 最小闭环

- 先支持 1-2 个 verified Role Agent。
- 再扩展到 7 个商业领袖。
- 每个 Role Agent 必须通过加载验证和输出审计。

### 10.5 第五阶段：完整圆桌验收

- 接入动态 Orchestrator。
- 接入后台 Agent 调用。
- 接入 Judge。
- 用 PDF idea 做完整测试。

## 11. 风险与处理

### 11.1 Codex CLI Skill 加载能力不符合预期

状态：未证实。

处理：

- 先做最小 spike。
- 如果失败，验证隔离 `CODEX_HOME`、工作目录规则、Codex subagent、Claude Code profile。
- 不把完整 Skill 注入 prompt 作为最终替代方案。

### 11.2 公开人物模仿边界

状态：长期风险。

处理：

- 产品统一披露是公开材料萃取的模拟 Role Agent。
- 发言中不自我免责声明，避免破坏沉浸。
- 不伪造私人观点或最新立场。
- 引用必须可追溯。

### 11.3 Skill Factory 生成成本上升

状态：确定会发生。

处理：

- 优先补强核心 7 个商业领袖。
- 新角色先 draft，再 verified。
- UI 显示草稿状态，避免弱角色直接进入高价值讨论。

### 11.4 讨论更长导致 UI 压力

状态：确定会发生。

处理：

- 消息支持折叠。
- 右侧显示讨论强度摘要。
- Closing 使用结构化导出。
- 不用短字数硬限制牺牲讨论质量。

## 12. 测试策略

### 12.1 设计测试

- 检查 Agent Registry、Role Agent 详情页、Roundtable 页面是否覆盖所有核心状态。
- 检查 legacy 和 verified 状态是否视觉上明确区分。

### 12.2 单元测试

- Skill quality gate 拒绝浅 research。
- Skill quality gate 拒绝重复 Agentic Protocol。
- Role Agent prompt 不包含完整 Skill 正文。
- Runtime command 在 Role Agent 模式下不强制忽略用户配置和规则。
- 后台 Agent 默认不参与台前发言。

### 12.3 集成测试

- dummy Skill 安装、加载、验证。
- 单个 Role Agent 接收任务并返回结构化发言。
- Judge 能识别面具感语言并触发重试或标记。

### 12.4 E2E 测试

- 清理测试环境。
- 导入或选择 PDF 中一个 idea。
- 启动 3-5 个商业领袖 Role Agent。
- 跑完整讨论。
- 检查讨论轮次、挑战数、证据请求、后台调用、Judge 分数和最终输出。

## 13. 决策

本规格采用 C 方案：Role Agent 正解架构。

原因：

- 它直接回应用户目标：像商业领袖本人在圆桌上共同讨论，而不是 AI 角色 prompt 表演。
- 它能从机制上避免继续把 Skill 当 prompt 注入。
- 它能用质量门和审计防止 Nuwa 产物再次弱化。
- 它保留 legacy path 作为临时止血，但不会让 legacy path 混入最终验收。

下一步是基于本规格写 implementation plan。该 plan 必须按 Superpowers TDD 执行：先写失败测试，再实现最小代码，再验证通过。
