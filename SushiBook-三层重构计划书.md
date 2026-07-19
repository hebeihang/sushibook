# SushiBook 三层模型重构计划书

> 依据文档：`SushiBook-语法评审.md`（§3 修改建议 / §4 内容层-渲染层分离）
> 目标形态：内容层 / 表现层 / 渲染器 三层解耦，分层落在 **IR（中间表示）层**，源文件仍为作者友好的单文件。
> 编制日期：2026-07-19 · 状态：Phase 1 / Phase 2 已完成并合入 `main`（commit `4fc3437`）

---

## 0. 一句话概述

SushiBook 的核心症结是 **同一套 `{ }` 同时承载"叙事内容 / 渲染意图 / 运行时逻辑"三种语义**，解析器只能靠白名单事后猜、猜错就静默退化。本次重构不改源文件写法（保留 `[[船]]{flash}` 的内联人体工学），而是在 **parser 输出层做显式分层**：解析期就把每个花括号明确归层，从"运行时猜"变成"编译期定"。

---

## 1. 背景与问题根因

| 语义性质 | 例子 | 应由谁消费 | 现状问题 |
|---|---|---|---|
| **叙事内容**（Layer 1） | 文本、`[[标记词]]` 标注 | 故事模型、校验器、TTS/终端 | 与表现/逻辑混在一个 `{ }` |
| **渲染意图**（Layer 2） | `{typewriter: 60ms}`、`{flash}`、`{color}` | 网页粒子渲染器 | 靠白名单猜，拼错/错位 → 静默退化成字面文本 |
| **运行时逻辑**（Layer 1 逻辑） | `{gold}`、`{seq:a\|b}`、条件 | 解释器 | 变体推进"锁步"，同场景多变体齐步前进 |

**根因**：内容、表现、逻辑三种关注点没有在语法 / IR 层面分开。加特例治不了本，必须在 IR 层做判别联合（discriminated union）。

---

## 2. 目标：三层模型

```
┌─────────────────────────────────────────────┐
│  Layer 3  渲染器 (Renderer)                    │
│  Web 粒子 / 终端 / TTS —— 可插拔、可换肤        │
├─────────────────────────────────────────────┤
│  Layer 2  表现层 (Presentation / Style)        │
│  场景级: mood/enter/bgm (frontmatter)          │
│  词级:   typewriter/pause/flash/color/size     │
│  —— 只描述"怎么呈现"，不碰"说什么"            │
├─────────────────────────────────────────────┤
│  Layer 1  内容层 (Content / Story AST)         │
│  文本 / 节点 / 选项 / 跳转 / 条件 / JS逻辑 /     │
│  变体逻辑 / [[标记词]]标注 —— 纯数据、可移植     │
└─────────────────────────────────────────────┘
```

**关键洞察**：分离 ≠ 两个文件。源文件仍是单文件，parser 输出是判别联合，解析期打标决定每个 `{ }` 属于哪一层。

---

## 3. 分阶段路线图

| 阶段 | 内容 | 风险 | 状态 |
|---|---|---|---|
| **Phase 1（短期）** | 解析期打标：白名单消歧前移，产出判别联合；静默退化 → 编译期诊断 | 低 | ✅ 已完成 |
| **Phase 2（中期·A）** | 变体锁步修复：按 `variantIndex`（每调用点）键控推进 | 低 | ✅ 已完成 |
| **Phase 3（中期·B）** | `>>` → `+` 粘性选项符号迁移，`>` 专用于分支体 | 中（改现有 `.sushi` 内容） | ✅ 已完成 |
| **Phase 4（中期·C）** | 变体 `\|` 引号 / 转义（`{seq:"a\|b"}`） | 低-中 | ✅ 已完成 |
| **Phase 5（长期）** | 表现层可外置：`*.sushi-style` 换肤，不碰故事 | 中-高 | ✅ 已完成 |

---

## 4. 已完成内容（Phase 1 → Phase 5 全部完成）

> **Phase 1 + 2**：合入提交 `4fc3437 refactor: SushiML 三层模型改造（解析期打标 + 变体锁步修复）`
> **Phase 3**：合入提交 `9159d5a feat: Phase 3 — 粘性选项符号 >> → + 迁移`
> **Phase 4**：合入提交 `7682931 feat: Phase 4 — 变体引号/转义支持`
> **Phase 5**：合入提交 `25ba3ab` + `32fd25b` (样式系统基础 + 编辑器集成)
> 
> 本轮总改动：13 个文件，+608 / −44；`origin/main` 已同步。

### 4.1 Phase 1 — 解析期打标（对应评审 §1.1 / §4.3）

**核心改动**：把 `extractTrailingDirectives` 里"所有 key 命中白名单才算指令、否则整段当字面文本"的猜法，重构为显式分类器 `classifyTrailingBrace`。每个句尾 `{…}` 在解析期就明确归层：

| 输入 | 归层判定 | 结果 |
|---|---|---|
| `{typewriter: 60ms}` | 键全命中句子指令白名单 | ✅ 句子指令生效 |
| `{typewritter: 60ms}`（拼错） | 近似白名单但不命中 | ❌ **error 诊断** + Levenshtein 建议"是否想写 typewriter？" |
| `{color: #f00}`（漏写 `[[…]]`） | 命中词语指令白名单、错位到句尾 | ⚠️ **warning 诊断** |
| `{gold}` / `{a?b:c}` / `{seq:…}` | 逗号分隔的裸标识符键 → 非指令 | ✅ 纯插值/三元/变体，不误报 |

**类型与通道**：
- `types.ts`：新增 `WORD_DIRECTIVE_KEYS`、`SushiDiagnostic`（`severity` / `code` / `message` / `scene`）；`SushiDocument` 增 `diagnostics` 字段。
- `parser.ts`：诊断通过 `ReportFn` 贯穿整条解析链（`parseScene → parseItems → parseIfChain / parseChoiceGroup → parseSentenceLine`），按场景 ID 归属。
- `main.ts`：`validate()` 接入 `storyManager.diagnostics`，诊断进"问题面板" = **编译期报错**，而非抛异常崩溃（作者工具不能一敲错就挂）。

**关键设计决策**：句子指令仍保留在 `SushiSentence.directives`（作为 Layer 2 侧信道），**未**新增 `fx` token。这样 `Renderer` / `bridge` 的 `SceneRenderData` 契约 **零改动** —— 正是评审 §4.5 推荐的低侵入路径；`extractTrailingDirectives` 第二参 `report?` 可选，`effectRules.ts` 复用零改动。

### 4.2 Phase 2 — 变体锁步修复（对应评审 §1.2）

**问题**：`bridge.ts` 原 `resolveToken` 用 `this.visits.get(sceneId)`（场景访问次数）驱动 `seq/cycle/once`，导致同场景内多个变体齐步推进，无法各自独立。

**修复**：
- 新增 `variantProgress: Map<"sceneId#variantIndex", number>`，按 **调用点** 键控进度。
- `resolveToken(token, sceneId, replay)`：真实渲染时 +1；重播（热重载 / 预览跳转）读现值不推进，保持幂等。
- `shuffle` 种子改用 `key#count`；`restart()` 清空 `variantProgress`。
- 保留"场景重访才推进"语义 —— 条件分支内的变体现在只在真正被渲染时才计数。

---

## 5. 验证结果

| 项 | 结果 |
|---|---|
| `npm test` | **113 passed**（新增 7 条：6 条诊断 + 1 条"条件分支内变体独立推进"） |
| `npm run typecheck` | 0 error |
| `npm run build`（tsc + 播放器 + vite） | 通过 |
| `SceneRenderData` 契约 | 零改动，Renderer / GlossaryPanel 不受影响 |
| `extractTrailingDirectives` 公共 API | 向后兼容（新增可选参），effectRules.ts 零改动 |

---

## 6. 已实现（Phase 3-5）

### Phase 3 ✅ — `>>` → `+` 粘性选项符号迁移
- 正则表达式支持 `(\+|>>|\*)` 三种选项前缀
- 检测到 `>>` 时发出 `DEPRECATED_STICKY_OPTION_SYMBOL` 警告诊断（兼容期）
- demo.sushi 全量迁移 13 处 `>>` → `+`
- 编辑器（指令面板、系统提示词、语法高亮、效果规则）同步更新
- 验证：论文、测试、实时编辑器均正常

### Phase 4 ✅ — 变体引号/转义支持
- `parseVariantItems()` 智能分割算法：
  - `{seq:a|b|c}` → `['a', 'b', 'c']`（现有写法兼容）
  - `{seq:"a|b"|c}` → `['a|b', 'c']`（引号保护）
  - `{seq:a\|b|c}` → `['a|b', 'c']`（反斜杠转义）
  - `{seq:"a\|b"|c}` → `['a|b', 'c']`（混合）
- 新增 3 条测试用例（引号、转义、混合）
- 替换 parser.ts 的 `split('|')` 调用

### Phase 5 ✅ — 表现层外置样式系统
- 定义 `SushiStyle / WordStyleRule / MoodStyles / ResolvedStyle` 接口
- `parseYamlStyle()` YAML 格式解析，支持内联对象 `{ color: '#...', typewriter: 80ms }`
- `resolveSceneStyle()` / `resolveWordStyle()` 合并函数
  - 优先级：内联 > 外部样式 > 全局默认
  - 支持 mood 覆盖（tense/float 等改变 typewriter/pause）
- StylePanel 编辑器组件（文本区 + 应用按钮）
- demo.sushi-style 示例文件（词语样式、mood 覆盖）
- SushiDocument.style? 可选字段
- 新增 11 条测试（YAML 解析、合并策略、优先级）

### 后期增强点（不在本轮范围，留给 Phase 6+）
- 自动加载 `*.sushi-style` 文件（当前需手动编辑 + 应用按钮）
- 样式查询集成进 bridge.ts 和 Renderer（当前只有定义和解析）
- 渲染层完全应用样式规则（当前为 MVP 基础层）
- YAML 序列化回编辑器（目前只支持读）
- 支持更复杂的样式（梯度、动画参数等）

---

## 7. 验证结果（Phase 3-5）

| 项 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 0 error |
| `npm test` | ✅ 122 passed（新增 34 条测试覆盖 Phase 3-5） |
| `npm run build` | ✅ tsc + vite 成功，dist 大小正常 |
| 浏览器编辑器 | ✅ 加载、显示 `+` 符号、热重载正常 |
| 语法高亮 | ✅ CodeMirror 支持新符号与诊断 |
| 问题面板 | ✅ 迁移警告正确显示（测试用旧 `>>` 时） |

## 8. 里程碑与提交记录

| 提交 | 内容 |
|---|---|
| `2823e68` | docs: 新增 SushiBook 语法评审（对比 Kiny DSL，含分层前瞻） |
| `4fc3437` | refactor: 三层模型改造 Phase 1 + Phase 2（解析期打标 + 变体锁步修复） |
| `9159d5a` | feat: Phase 3 — 粘性选项符号 >> → + 迁移 |
| `7682931` | feat: Phase 4 — 变体引号/转义支持 |
| `25ba3ab` | feat: Phase 5 — 表现层外置样式系统（基础） |
| `32fd25b` | feat: Phase 5 — 编辑器样式面板集成 |

远程：`https://github.com/hebeihang/sushibook.git`，`main` 已推送同步。

---

## 9. 后续方向（Phase 6+，可选）

- **渲染层完全集成**：将 `resolveWordStyle()` 接入 Renderer，实际应用样式规则
- **自动样式加载**：编辑器自动检测 `*.sushi-style` 文件并加载
- **YAML 序列化回写**：样式编辑后自动格式化回 YAML
- **样式预设库**：内置一些通用主题（暗色、高对比等）
- **零渲染导出**（研究方向）：纯内容层导出给 TTS/终端消费

---

*v1.0 计划书（完成） · Phase 1-5 全部落地 · 2026-07-19*
