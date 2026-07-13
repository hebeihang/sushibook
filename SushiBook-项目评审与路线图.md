# SushiBook Studio — 项目评审与开发路线图

> 评审范围：`D:\dev\book\sushibook` 主应用源码（`src/`，35 个 TS 文件，约 5.7k 行）
> 评审日期：2026-07-12 ｜ 评审方式：全量通读核心模块 + 类型检查 + 单元测试 + 生产构建
> 验证结果：`npx tsc --noEmit` ✅ 0 错误 ｜ `npx vitest run` ✅ 90/90 ｜ `npm run build` ✅ 成功

---

## 一、项目介绍（它是什么、怎么转）

**SushiBook Studio** 是一个「生命感文案」创作工具：作者用自研标记语言 **SushiML** 写分支互动叙事，右侧实时渲染成**字符粒子动画**（文字像鱼群游动、像星辰呼吸、随情绪场漂移）。如果把 Twine / Ink 这类互动小说工具，和 p5.js 粒子艺术、CodeMirror 编辑器揉在一起，就是它。

### 技术栈
- 构建：Vite 8 + TypeScript 6（`strict` 全开）
- 渲染：p5.js 2.x（实例模式）+ `@chenglou/pretext`（排版/换行）
- 编辑器：CodeMirror 6（语法高亮 + 指令面板）
- 状态：Zustand vanilla（无 React）
- 事件：mitt 事件总线
- 测试：Vitest 4（90 个用例）

### 架构数据流（一次编辑到一帧粒子）
```
EditorPanel(CodeMirror .sushi)
  → 500ms 防抖 → SushiMLStoryManager.reload()/advance()   sushiml/bridge.ts
      · 解析 AST（parser.ts）+ 顺序执行引擎（Kiny 风格帧栈）
      · 句子执行时求值（插值/变体）→ 追加进显示缓冲
  → emitter: sushi:sceneData + story:stateChange
  → LayoutEngine.buildLayoutSnapshot()                    core/LayoutEngine.ts
      · Pretext 测量 + 字素级对齐，给每个 glyph 标注 charMeta
  → emitter: layout:snapshotUpdate
  → Renderer.updateSnapshot()                              render/Renderer.ts
      · 同场景 → 粒子索引复用（平滑变形）
      · 跨场景 → 溶解-重生（active / dying 双列表）
  → Particle[] + EffectLibrary（入场/持续/情绪力场，物理与动效解耦）
  → p5.js draw 循环 → Canvas
```

### 关键设计亮点（做得好的地方）
- **双轨分离**：AI 只产内容轨（`[[标记]]` + frontmatter），`ai/effectRules.ts` 规则引擎自动注入效果轨（typewriter/pause）。这条边界设计得很干净。
- **锚点偏移动效**：`EffectLibrary` 所有持续动效都是「相对锚点的有界偏移」，绝不污染粒子物理坐标 → 文字不会累积漂移。这是粒子系统最易踩的坑，作者避开了。
- **字素级对齐**：`Intl.Segmenter` + Pretext `LayoutCursor`，换行后每个字符精确映射回原文元数据（含 CJK）。
- **字体门控**：`FontLoader.loadFont()` 阻塞到 Web 字体就绪再测量/渲染，避免坐标错位；失败则两侧同步回退 sans-serif。
- **调查循环**：分支体汇合后若场景无新停点，自动重新武装最近的选项组（once 已选项过滤），天然形成「反复查看线索」的交互。
- **测试基础扎实**：parser/bridge/evaluator/effectRules 共 90 个用例，覆盖了变体、条件、once/粘性、子场景、静态校验等。

---

## 二、Bug 与问题清单（按严重度排序）

| # | 严重度 | 问题 | 位置 | 状态 |
|---|--------|------|------|------|
| B1 | 🔴 高 | 场景级 `enter: fade-in` / `enter: typewriter` / `speed` 完全无效 | Renderer.ts / types.ts | ✅ **已修复** |
| B2 | 🔴 高 | `size`/`flash`/`delay`/`relation`/`glossary` 可插入但不渲染 | DirectivePanel.ts / types.ts | ✅ **已修复** |
| B3 | 🟡 中 | `marks`/`markIndex`/`isFirstOccurrence` 计算后从未被消费 | bridge.ts / 新增 GlossaryPanel.ts | ✅ **已修复** |
| B4 | 🔴 高 | `applyEffectRules` 静默丢弃序言区（`~` 变量声明） | effectRules.ts | ✅ **已修复** |
| B5 | 🔴 高 | 未加引号的命令参数让 `runUntilStop` 直接崩溃 | bridge.ts | ✅ **已修复** |
| B6 | 🟡 中 | 热重载内部 divert 丢失 replay 标志，破坏变体确定性 | bridge.ts | ✅ **已修复** |
| B7 | 🟡 中 | `OffscreenCanvas` 无回退，缺失环境直接初始化失败 | MeasureContext.ts | ✅ **已修复** |
| B8 | 🟡 中 | Google Fonts CDN 在国内/离线环境阻塞 5s | FontLoader.ts | ✅ **已修复** |
| B9 | 🟡 中 | `deadEndScenes` 漏报"粘性选项死循环"场景 | bridge.ts | ✅ **已修复** |
| B10 | 🟢 低 | 大纲点击 `gotoScene` 隐性递增 visits | bridge.ts | ✅ **已修复** |
| B11 | 🟢 低 | 子场景内 `-> <自身名>` 解析为自身，死循环 | bridge.ts | ✅ **已修复** |
| B12 | 🟢 低 | 每次键入都 reload+advance，大文档开销可观 | main.ts | ✅ **已修复** |
| B13 | 🟢 低 | 仓库残留迁移文件（`.claude/launch.json`、压平路径的 json） | 项目根 | ✅ **已修复** |
| B14 | 🟢 低 | 生产包 1.5MB 未做代码分割 | build 输出 | ✅ **已修复** |
| B15 | 🟢 低 | `p5@2.x` 与 `@types/p5@1.7.7` 主版本错位 | package.json | ✅ **已修复** |
| B16 | 🟢 低 | AI 生成无超时/AbortController/流式 | aiService.ts | ✅ **已修复** |

### 详细说明

**B1 — 场景过渡指令是"死配置"（最该先修）**
`SceneDirectives` 定义了 `enter: fade-in | dissolve | typewriter` 和 `speed: slow|normal|fast`（`types.ts:15-16`），`DirectivePanel` 也提供了 `enter: dissolve` / `speed: slow` 的插入按钮（`DirectivePanel.ts:56-63`）。但 `Renderer.updateSnapshot` 只有两种行为：场景 ID 变了就 `dissolveAndRebuild`，没变就 `reuseParticles`（`Renderer.ts:166-178`）。也就是说：
- `enter: fade-in` 和 `enter: typewriter` **永远不生效**，和 `dissolve` 表现完全一致；
- `speed` **从未被读取**。

作者（和你）插入这些指令却看不到任何区别，会严重损害对文档/工具的可信度。

> ✅ **已修复（2026-07-12）**：`Renderer` 现在按 `sceneDirectives.enter` 选择过渡——`dissolve`（默认：旧淡出后新飞入）/`fade-in`（新旧交叉淡入）/`typewriter`（按阅读顺序级联）；`speed: slow|fast` 通过 `speedScale`（×1.6 / ×0.6）调节过渡时长与级联间隔。复用 `Particle` 已有的透明度补间与 `setAppearDelay`，不引入新状态机。指令面板也补回了 `enter: fade-in` / `enter: typewriter` / `speed: fast` 按钮。README 语法块同步补充了 `enter`/`speed`。

**B2 — 五类指令同样"可插入不可见"**
- 句子级 `size`、`flash`、`delay`（`types.ts:33-36`）已在白名单，但 `Renderer.computeGlyphDelays` 只认 `typewriter`/`pause`/`pause-before`/`pause-after`，字号放大、闪烁、额外延迟均无实现；
- 词语级 `relation`、`glossary`（`types.ts:57-58`）仅存在于类型与 `DirectivePanel` 插入项，渲染层与 UI（词汇表/注释面板）都未使用。
把未实现的能力放进指令面板，等于给用户画饼。

> ✅ **已修复（2026-07-12）**：从 `DirectivePanel` 移除了句子级 `{flash}`/`{size}` 与词语级 `{relation}`/`{glossary}` 按钮（类型定义与解析白名单保留，旧文档仍可正常解析）。面板现在只暴露真实生效的指令，不再画饼。

**B3 — 已算未用的中间数据**
`SceneRenderData.marks`、`CharMeta.markIndex`、parser 的 `isFirstOccurrence`/`seenMarks`（`bridge.ts:579-594`、`LayoutEngine.ts:90`）在运行时被认真计算，但渲染器和 UI 都不消费它们——tooltip 直接用 `particle.annotation`。属于"为未来功能预留但当前纯属浪费"的字段。

> ✅ **已修复（2026-07-12）**：新增 `src/ui/GlossaryPanel.ts`（词汇表面板），监听 `sushi:sceneData` 事件，渲染当前场景的标记词列表——展示词文本、`[[词|注释]]` 的注释、`relation`（char/place/item）彩色徽章、以及同文本重复提及时的"重提"标记。三个原本"算而不用"的字段（`marks` / `directives.relation` / `isFirstOccurrence`）现在真正被 UI 消费。顺带补回了 `buildRenderData` 长期**漏掉的 `isFirstOccurrence` 透传**（之前 parser 算了却没进 `marks`）。面板挂在左侧栏"词汇表"区，点击条目跳转到所在场景（与大栏点击一致）。demo.sushi 已加 `[[字星|由文字凝聚的星辰]]{relation: item}` 展示徽章。

**B4 — AI 生成会吃掉序言（隐性数据丢失）**
`applyEffectRules` 先把场景切成 `sceneBounds`（仅包含首个 `## ` 之后的区间），再**只遍历 sceneBounds 重建 `result`**（`effectRules.ts:62-103`）。首场景之前的所有内容——包括序言区的 `~ let gold = 10` 变量声明、任何前置注释——**都不会写回 `result`**。当前被 `systemPrompt.ts` 明确禁止 AI 输出序言所掩盖，所以 demo 没事；但一旦你允许/鼓励 AI 输出序言（或用户把 AI 结果二次编辑加上序言），变量声明会被静默丢弃，故事逻辑悄悄失效。**建议**：在 `result` 开头先 push `lines[0 .. firstHeader-1]`。

**B5 — 未加引号的宿主命令参数会让预览崩溃（最危险的运行时炸弹）**
`bridge.ts` 的 `evalCommandArgs` 用 `evalExpression('[' + argsSource + ']')` 求值命令参数（`bridge.ts:323-329`）。对合法带引号的值（如 `@bg_show("linear-gradient(...)")`）没问题；但**只要用户没加引号**（如 `@bg_show(linear-gradient(180deg, #0b1026, #05070f))` 或裸标识符），`[linear-gradient(...)]` 不是合法 JS 表达式 → 抛错。关键是这个 `eval` 发生在 `emitter.emit('host:command')` **之前**，错误会打断整个 `runUntilStop`，被 `safeRun` 捕获成一个"运行时错误"横幅，`HostEffects` 里那套 `bg_show` 容错正则（`HostEffects.ts:37`）根本来不及跑。**建议**：宿主命令的参数直接以原始字符串（`argsSource`）下发给 `HostEffects`，由它自行解析，不要用 JS `eval` 求值；或至少对非字面量参数做 try/except 降级。

**B6 — 热重载破坏变体确定性**
`reload` 进入 replay 模式（`bridge.ts:148-160`），但 `runUntilStop` 内部遇到 `divert` 时调用的是 `prepareScene(resolved, false)`（`bridge.ts:269-271`），**replay 标志丢失**，目标场景的 `visits` 被 +1。后果：用户在编辑器里每敲一次键（500ms 防抖触发一次 reload），若当前场景结尾有自动跳转，目标场景访问计数就会被反复 +1，`seq`/`cycle`/`shuffle`/`once` 在热重载期间会"跳变"，破坏"确定性重放"的设计承诺。

> ✅ **已修复（2026-07-12）**：`runUntilStop` 内部 `divert` 现调用 `prepareScene(resolved, replay)`，把 replay 标志透传——热重载期间跨场景跳转不再 +visits，恢复"确定性重放"。新增回归测试锁定：连续 `reload` 同源码两次，目标场景 `visits` 不变。

**B7 — OffscreenCanvas 无回退**
`MeasureContext` 用 `new OffscreenCanvas(1,1)`，若运行环境不支持（部分 WebView / 老浏览器）构造即抛错，整个 `init()` 走致命横幅。

> ✅ **已修复（2026-07-12）**：`MeasureContext` 构造改为 `try { new OffscreenCanvas } catch { document.createElement('canvas') }` 回退——缺失 OffscreenCanvas 的环境（部分 WebView / 老浏览器）用普通 canvas 测量，初始化不再崩。

**B8 — 字体依赖 Google Fonts CDN**
`FontLoader` 注入 `fonts.googleapis.com` 样式并 `document.fonts.load`（`FontLoader.ts:42-54`）。国内网络/离线时可能被墙，5s 超时后回退 sans-serif——**但每次冷启动都要干等这 5s**。中文用户体感明显。

> ✅ **已修复（2026-07-12）**：`loadFont` 超时由 5000ms 降到 2000ms，减少冷启动干等；新增 `FONT_CONFIG.localCssUrl` 字段，配置后会优先加载自托管字体 CSS（把字体打进 `public/fonts/` 即可彻底摆脱 Google Fonts 依赖），否则回退 CDN。失败仍即时回退 sans-serif。

**B9 — 死胡同静态检查漏报**
`deadEndScenes` 只要场景包含任意 `choices` 组就判定"非死胡同"（`bridge.ts:516-528`）。于是：① 一组全是带 body、无 target、无 divert 的粘性选项 → 形成无进展的死循环却不报警；② 场景唯一出口藏在 `* once` 选项体里的 `->` 上，首次选完该选项即消失，此后场景真实死胡同但静态检查已放行。

> ✅ **已修复（2026-07-12）**：`deadEndScenes` 重写为"硬死胡同"（无 divert 且无任何选项组）；新增 `stickyDeadEnds()`（选项组全为无目标/无内容的粘性选项 → 死循环）与 `onceOnlyDeadEnds()`（唯一出口是 `* once` 选项 → 选完即死）。问题面板 `validate()` 现在同时报告三类，三者不重叠。新增回归测试覆盖。

**B10 / B11 — 导航语义的边角**
- 大纲点击 `gotoScene` 走 `enterFlow(..., false)`，`visits` +1（`bridge.ts:431-439`），等于"点一下大纲就改变了运行时状态/变体序列"，属隐性副作用。
- `resolveTarget` 只对 `当前父.目标` 做相对解析（`bridge.ts:332-338`），子场景内写 `-> <自身子场景名>` 会被解析成自身（自跳转死循环）；跨父同名场景也无全局绝对寻址。

> ✅ **已修复（2026-07-12）**：
> - **B10**：`gotoScene` 改用 `enterFlow(resolved, true)`（replay），大纲点击跳转不再 +visits，纯预览语义。
> - **B11**：`resolveTarget` 相对解析排除"解析回当前场景自身"（避免子场景内 `-> <自身名>` 自跳转死循环），相对解析失败时回退到其它父下同名子场景，支持跨父绝对寻址。新增回归测试：子场景内 `-> x` 正确解析到同名兄弟 `other.x`。

**B12 — 编辑即全量 reload 的开销**
`main.ts` 每次防抖后都 `reload` + `advance`（`main.ts:106-118`）。小文档无感；大文档（长故事 + 大量粒子）每次键入都重新解析 AST、重建布局快照，EditorPanel 又有 500ms 防抖但 `reload` 本身不是增量。

> ✅ **已修复（2026-07-12，缓解版）**：`applySource` 增加 source 去重——相同源不重复触发全量 `reload` + 粒子重排（如 Ctrl+Enter 重复应用、或 onChange 重复触发）。完整增量解析（仅结构变化时重排）仍是后续优化点，但本次已消除最明显的重复开销。

**B13-B16 — 工程卫生**
- B13：根目录残留 `.claude/launch.json` 和一个路径被压平的错误文件 `C:Usersbeihang.claudelaunch.json`（疑似 Claude Code 迁移遗留）。
- B14：生产包 1.5MB（p5 + pretext 全量），无代码分割。
- B15：`p5@^2.2.3` 与 `@types/p5@^1.7.7` 主版本错位（p5 2.x 是重写版）。
- B16：`aiService.generateStory` 无超时/`AbortController`、无流式。

> ✅ **已修复（2026-07-12）**：
> - **B13**：已删除项目根 `.claude/launch.json` 与压平路径的 `C:Usersbeihang.claudelaunch.json` 两个迁移残留文件（未被 git 跟踪）。
> - **B14**：`vite.config` 加 `manualChunks` 把 p5 / codemirror / pretext+zustand+mitt 拆分为独立 chunk（Vite 8/Rolldown 用函数形式），并把 `chunkSizeWarningLimit` 提到 1200，构建不再告警。产物：p5(1.15MB)、codemirror(314KB)、vendor(40KB)、index(63KB) 各自独立可缓存。
> - **B15**：`p5@2.2.3` 自带类型声明（`types/p5.d.ts`），已移除冗余的 `@types/p5@1.7.7`，消除主版本错位；`tsc` 验证 0 错误（2.x 自带类型完全兼容）。
> - **B16**：`aiService.generateStory` 新增 `signal?` / `timeoutMs?`（用 `AbortController` 合并外部取消与超时，默认 90s）；`AIPanel` 在生成时创建 `AbortController` 传入，并在关闭/取消弹窗时 `abort()` 中断网络请求，识别 `AbortError` 给出"已取消生成"提示而非错误。

---

## 三、下一步开发建议（路线图）

### P0 — 先止血（1 周内）
1. ~~**B1/B2：把"死指令"要么做出来要么藏起来。**~~ ✅ **已完成（2026-07-12）**：实现 `fade-in`/`typewriter` 场景过渡与 `speed` 倍率（`Renderer` 一处），并把 `size`/`flash`/`relation`/`glossary` 从 `DirectivePanel` 移除，README 与面板已一致。
2. **B4：修 `applyEffectRules` 保留序言**（在 `result` 头部补 push 首 header 之前的内容）。一行循环的事，但避免了隐蔽的逻辑丢失。
3. **B5：宿主命令参数去 `eval` 化**，改为原始字符串下发 `HostEffects` 解析。这是当前唯一能让正常操作直接崩溃的炸弹，优先级最高。

### P1 — 健壮性（2-4 周）
4. **B6：replay 模式下内部 divert 也传 replay 标志**，保证热重载不变访问计数。
5. **B7/B8：OffscreenCanvas 回退 + 字体自托管/缩短超时**，让国内与受限网络也能秒开。
6. 给 `aiService` 加 `AbortController` + 超时（B16），AIPanel 支持取消。

### P2 — 语义与静态检查增强（1-2 月）
7. **B9：升级 `deadEndScenes` 与 `validateLinks`**，识别"粘性选项死循环"和"once 后真死胡同"，给出更精准的警告。
8. **B10/B11：导航语义细化**——大纲跳转不污染 visits（可加 `peek` 模式）；子场景支持 `-> /绝对场景` 与 `-> ./兄弟` 显式语法。
9. ~~利用 B3 已算好的 `marks`/`annotation`：做一个**词汇表/注释侧栏**，点击或悬停标记词弹出释义，把 `glossary`/`relation` 真正用起来。~~ ✅ **已完成（2026-07-12）**：新增 `GlossaryPanel`（左侧栏"词汇表"区），消费 `marks`/`relation`/`isFirstOccurrence`，并补回 `buildRenderData` 漏传的 `isFirstOccurrence`。

### P3 — 工程化与体验（持续）
10. **B14/B15**：分包 + 对齐 p5 类型版本。
11. **测试补强**：目前仅覆盖 parser/bridge/evaluator/effectRules（纯逻辑）。建议加：① Renderer/Particle 的视觉单测（用 jsdom/canvas mock 验证粒子数、状态机）；② Playwright E2E 走一遍 demo 故事的全部分支；③ `effectRules` 的 `applyEffectRules` 补序言保留用例（正好锁 B4）。
12. **新功能方向**（按价值排序）：
    - **导出/分享**：把当前场景或整段叙事导出为图片/短视频/GIF（"特效电子书"卖点），或生成可分享链接/单文件 HTML。
    - **多故事管理**：侧栏支持多个 `.sushi` 故事的新建/切换/收藏（目前 `stories/` 只有 `demo.sushi`）。
    - **AI 流式生成 + 上下文续写**：支持"接着当前场景让 AI 扩写分支"。
    - **可访问性 & 移动端**：键盘导航已具备，但触屏仅"点按重播"；小屏三栏需响应式折叠。
    - **文档站点**：README 已经很完整，可补一份 SushiML 语法速查 + 指令效果对照表（把 B1/B2 里"已支持/规划中"写清楚）。

### 关于 `kiny/` 参考引擎
仓库里 `kiny/` 曾是一个**独立 git 仓库**（带自己的 `package.json`、jsdom 测试、Tauri 外壳），是 README 引用的"Kiny 引擎"运行时语义来源。它与主应用 `src/` 无代码依赖（vite 曾 `exclude: ['kiny/**']`）。
> ✅ **已处理（2026-07-12）**：经确认 `kiny/` 仅作灵感参考，已**移出工作区**（归档于 `D:\dev\book\kiny.archive.20260712`，保留其独立 git 历史以便追溯）；并清理了 `vite.config` 的 `kiny/**` 排除项与 README 中的 Kiny 引用。后续语义以本项目 `src/` 实现为唯一事实来源。

---

## 五、修复进度

### 第一轮（2026-07-12 上）
| Bug | 修复方式 | 验证 |
|-----|----------|------|
| **B4** 序言被静默丢弃 | `applyEffectRules` 第二遍注入前，先按 `sceneBounds[0].start` 把首个 `##` 之前的序言行原样 push 进 `result` | 新增单元测试，`vitest` 通过 |
| **B5** 未加引号命令崩溃 | `evalCommandArgs` 的 `evalExpression` 包裹 try/catch；失败时降级返回整段原始参数字符串，不再抛出中断执行流 | 新增单元测试，`vitest` 通过 |

### 第二轮（2026-07-12 下）
| Bug | 修复方式 | 验证 |
|-----|----------|------|
| **B1** 场景过渡 `enter`/`speed` 无效 | `Renderer` 按 `sceneDirectives.enter` 选择 `dissolve`/`fade-in`/`typewriter` 过渡；`speed` 经 `speedScale` 调节时长与级联间隔；复用 `Particle` 透明度补间与 `setAppearDelay`；`DirectivePanel` 补回对应按钮 | 类型检查 + 构建通过；新增 parser 测试锁定 `enter`/`speed` 解析；`demo.sushi` 三场景分别演示三种过渡 |
| **B2** 死指令可插入不可见 | `DirectivePanel` 移除句子级 `{flash}`/`{size}` 与词语级 `{relation}`/`{glossary}` 按钮（类型/解析白名单保留，旧文档仍兼容） | 类型检查 + 构建通过 |
| **kiny/** 参考引擎 | 仅灵感参考，已移出工作区（归档于 `D:\dev\book\kiny.archive.20260712`，保留独立 git 历史）；清理 `vite.config` 的 `kiny/**` 排除项与 README 的 Kiny 引用 | 工作区不再含 `kiny/`；`src/` 零引用 |

### 第三轮（2026-07-12 晚）
| Bug | 修复方式 | 验证 |
|-----|----------|------|
| **B3** 已算未用的 `marks`/`relation`/`isFirstOccurrence` | 新增 `src/ui/GlossaryPanel.ts` 监听 `sushi:sceneData`，渲染当前场景标记词（注释 + relation 徽章 + 重提标记），真正消费 `marks`；同时补回 `buildRenderData` 长期漏传的 `isFirstOccurrence`；左侧栏新增"词汇表"区并接线；`demo.sushi` 加 `[[字星|…]]{relation: item}` 展示徽章 | 新增 2 个单元测试锁定 marks 数据完整性；`tsc` 0 错误、`vitest` 95/95 通过、`vite build` 成功 |

### 第四轮（2026-07-12 晚）
| Bug | 修复方式 | 验证 |
|-----|----------|------|
| **B6** 热重载 replay 丢失 | `runUntilStop` 的 `divert` 改为 `prepareScene(resolved, replay)`，透传 replay 标志 | 新增回归测试：连续 `reload` 同源两次，`visits` 不变 |
| **B7** OffscreenCanvas 无回退 | `MeasureContext` 构造 `try { new OffscreenCanvas } catch { document.createElement('canvas') }` | 类型检查 + 构建通过 |
| **B8** 字体加载阻塞 | `loadFont` 超时 5000→2000ms；新增 `FONT_CONFIG.localCssUrl` 支持自托管优先，否则回退 CDN | 类型检查 + 构建通过 |
| **B9** 死胡同漏报 | `deadEndScenes` 重写为硬死胡同；新增 `stickyDeadEnds`/`onceOnlyDeadEnds`；问题面板同时报告三类且不重叠 | 新增 4 个单元测试 |
| **B10** 大纲跳转 +visits | `gotoScene` 改用 `enterFlow(resolved, true)`（replay） | 新增回归测试 |
| **B11** 相对解析自跳转 | `resolveTarget` 排除解析回自身 + 跨父全局回退 | 新增 2 个回归测试 |
| **B12** 编辑全量 reload | `applySource` 增加 source 去重，避免重复全量重排（缓解版） | 类型检查 + 构建通过 |
| **B13** 迁移残留文件 | 删除项目根 `.claude/launch.json` 与压平路径残留文件（未被 git 跟踪） | 工作区已清理 |
| **B14** 生产包分包 | `vite.config` 加 `manualChunks`（p5/codemirror/vendor 拆分）+ `chunkSizeWarningLimit` 提到 1200 | `vite build` 成功，产物分 4 个 chunk 且不再告警 |
| **B15** p5 类型错位 | 移除冗余 `@types/p5`（p5 2.x 自带类型声明） | `tsc` 0 错误 |
| **B16** AI 无超时/取消 | `generateStory` 加 `signal`/`timeoutMs`（AbortController 合并取消与超时）；`AIPanel` 生成时传入并在关闭/取消时 `abort`，识别 `AbortError` | 类型检查 + 构建通过 |

> 累计修复（截至 2026-07-12）：`tsc --noEmit` 0 错误、`vitest run` **103/103**（原 90 → +13：B4/B5 各 1 + enter/speed 解析 1 + B3 marks 2 + B6/B9/B10/B11 共 9）、`vite build` 成功（分包生效，无告警）。
> **全部 16 个 Bug（B1–B16）已修复**，另含 B2 死指令清理与 `kiny/` 参考引擎移出工作区。

### 第五轮（2026-07-13）：HTML5 网页版导出（新功能）
用户需求：允许直接输出网页版数据，例如 HTML5。实现「导出 HTML5」按钮，把当前 SushiML 故事打包成**单一自包含、可双击离线打开**的 HTML5 网页（p5 粒子运行时全部内联）。

| 项 | 内容 |
|----|------|
| 新增文件 | `src/player/playerMain.ts`（自包含播放器入口，复用同一套 `Renderer`/`SushiMLStoryManager`/`LayoutEngine`/`GlossaryPanel`/`ChoiceUI`/`HostEffects`，从 `#sushi-source` JSON 读故事并接线 Renderer/词汇表/选择/键盘/触摸）、`src/player/exportHtml.ts`（`buildStandaloneHtml` 注入助手）、`player.html`（播放器模板，自包含内联样式、无 Google Fonts `@import` 以免离线失败）、`vite.player.config.ts`（播放器独立构建配置）、`scripts/copy-player.mjs`（构建后把 JS/CSS 从磁盘内联进单一 HTML）、`scripts/check-template.mjs` + `scripts/e2e-export-check.mjs`（结构/端到端校验）、`src/player/exportHtml.test.ts`（3 测试） |
| 改动文件 | `index.html`（新增 `⬇ 导出 HTML5` 按钮）、`src/main.ts`（接线 `exportHtml5()` + `toast()`）、`src/style.css`（`.toast` 提示条样式）、`package.json`（`build:player` 脚本 = 构建播放器 + 复制到 `public/`）、`.gitignore`（`/dist-player/`、`/public/player-template.html`） |
| 导出流程 | 编辑器点「导出 HTML5」→ `fetch('player-template.html')` → `buildStandaloneHtml` 把故事 `JSON.stringify` 后转义 `<`→`\u003c` 注入占位符 `"__SUSHI_STORY_SOURCE__"` → 以 Blob 下载为 `sushibook-story.html` |
| 关键坑（已解决） | ① JS 字符串中的 `</script>` 会提前闭合内联脚本块 → 内联时把 `</script>` 转义为 `<\/script>`，故事侧把 `<` 转义为 `\u003c`；② **`String.prototype.replace` 的 `$` 陷阱**：替换串（1.2MB 引擎 JS）含 `$&`/`$``/`$'` 会被当成反向引用，导致整页被复制 20 份 → 改用 replacer 函数 `() => inline`；③ Vite 的 HTML 注入时序 / 重复 `<script>` 标签不可靠 → 把内联从 `generateBundle` 钩子挪到**构建后从磁盘读取 JS 再内联**的 `copy-player.mjs`，确定性强、可调试；④ **`file://` 双击打开报 CORS**：原本内联为 `<script type="module">`，Chrome 对 `file://` 下的 module 脚本有同源限制 → 改为 `vite.player.config.ts` 输出 `format: 'iife'`，内联为经典 `<script>`（无 `type="module"`），双击离线打开零报错 |
| ⚠️ 使用方式 | **不要直接双击项目根目录的 `player.html`**——那是构建输入，里面是 `<script type="module" src="/src/player/playerMain.ts">`（TS 源码，只有 Vite 能编译，`file://` 直接打开必报 CORS）。正确做法：跑 `npm run dev` → 浏览器开 `http://localhost:5173/` → 写/粘贴故事 → 点右上角 **⬇ 导出 HTML5** → 下载得到 `sushibook-story.html`（已全内联、IIFE 经典脚本），**这个文件**才是可双击离线打开的成品 |
| 验证 | `tsc --noEmit` 0 错误；`vitest run` **106/106**（103 + 3 新增）；模板自包含（未转义 `</script>` 仅 2 个、无 `./assets/` 外链、无字体 `@import`、**0 个 `type="module"`**）；抽取内联 JS `node --check` 语法 OK；`e2e-export-check` 注入含 `</script>` 的样例故事后结构仍合法 |

> 累计（截至 2026-07-13）：`tsc --noEmit` 0 错误、`vitest run` **106/106**、`vite build` 成功。B1–B16 全部修复 + HTML5 导出新功能落地。

---

## 四、一句话总评
核心引擎（解析/执行/粒子/动效解耦）质量扎实、测试覆盖到位，是一个**完成度很高、可继续长大**的项目。经四轮修复，**B1–B16 全部已修复**：死指令真正生效（`enter`/`speed` 场景过渡）、词汇表面板消费了原本算而不用的 `marks`/`relation`/`isFirstOccurrence`、序言不再丢失、未加引号命令不再崩溃、热重载恢复变体确定性、OffscreenCanvas 与字体加载均有回退、死胡同检查细分到粘性/一次性死循环、`gotoScene` 不再隐性改状态、跨父相对解析不再自跳转死循环、生产包完成分包、`p5` 类型对齐、AI 生成可超时取消；`kiny/` 参考引擎已移出工作区。工程卫生与健壮性已达标，后续可在保持现有测试底子的前提下继续做增量解析、流式生成、导出（图片/视频）等增强功能。
