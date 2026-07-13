# SushiBook Studio

「生命感文案」创作工具：将文字转化为具有视觉生命力的字符粒子动画。左侧用 **SushiML** 标记语言编写分支叙事，右侧实时预览粒子渲染效果。

## 快速开始

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 生产构建
npm test           # 单元测试
npm run typecheck  # 仅类型检查
```

## 架构

```
EditorPanel (CodeMirror 6, .sushi 源文本)
    ↓ debounce 500ms
SushiMLStoryManager.reload() / advance()      sushiml/bridge.ts
    ↓ 解析 AST + 场景导航
emitter: sushi:sceneData → story:stateChange   core/EventBus.ts (mitt)
    ↓
LayoutEngine.buildLayoutSnapshot()             core/LayoutEngine.ts
    │  Pretext 排版测量 + LayoutCursor 字素对齐
    │  → 每个 glyph 标注 charMeta（标记/颜色/动效/注释/句子索引）
    ↓
emitter: layout:snapshotUpdate
    ↓
Renderer.updateSnapshot()                      render/Renderer.ts
    │  同场景 → 粒子索引复用（平滑变形）
    │  跨场景 → 溶解-重生（active/dying 双列表）
    ↓
Particle[] + EffectLibrary                     p5.js draw 循环
    │  物理（缓动飞行/吸附）与动效（锚点偏移）解耦
    ↓
Canvas
```

全局状态：`store/gameStore.ts`（Zustand vanilla）。

### 关键设计决策

- **字体门控**：`FontLoader.loadFont()` 阻塞至 Web 字体加载完成，保证 Pretext 测量与 p5 渲染使用同一字体；加载失败时两侧同步回退 sans-serif。
- **锚点偏移动效**：情绪力场 / 词语持续动效每帧只计算相对排版锚点的有界偏移，绝不修改粒子物理位置 → 文字不会累积漂移。
- **字素级对齐**：parser 和 LayoutEngine 都以 `Intl.Segmenter` 字素为单位，通过 Pretext 的 `LayoutCursor` 把换行后的每个字符精确映射回原文元数据。
- **双轨分离**：AI 只生成内容轨（文本 + `[[标记]]`），`ai/effectRules.ts` 规则引擎自动注入效果轨（typewriter / pause）。

## SushiML 语法

```
// 整行注释（任何位置）
~ let gold = 10                 序言区（第一个 ## 之前）：全局变量声明

## scene_id                     场景标题
---
mood: default | tense | float | storm    场景情绪力场
enter: dissolve | fade-in | typewriter   场景进入过渡（默认 dissolve）
speed: slow | normal | fast               过渡速度倍率（默认 normal）
---
~ gold = gold + 1               场景逻辑行：每次进入场景时执行（JS 语句）
普通句子。
逐字出现的句子。{typewriter: 60ms}
本句显示完后停顿。{pause: 800}
本句出现前等待。{pause-before: 500}
含[[标记词语]]的句子。
带注释的[[词语|悬停显示的注释]]。
带动效的[[词语]]{enter: sink}。
带颜色的[[词语]]{color: #ff6b6b}。
你还剩{gold}枚金币。            {…} 表达式插值（JS 表达式，undefined/null 输出为空）
状态：{gold >= 5 ? "富有" : "拮据"}    行内条件（三元）
{seq:初见。|再见。|之后都是这句。}     变体：按场景访问次数依次推进
{cycle:白天|黄昏|夜晚}              变体：循环轮换
{once:只显示一次}                   变体：用完为空
{shuffle:甲|乙|丙}                  变体：确定性随机

>> 选项文字 -> target_scene_id        粘性选项（可重复选）
* 选项文字 -> target_scene_id         一次性选项（选过即永久消失，重访场景也不恢复）
                                      需要「每次到访限一次」时用粘性 + 状态变量守卫：
                                      >> {!peeked} 细看   体内 ~ peeked = true，场景入口 ~ peeked = false
>> {gold >= 5} 买下它 -> shop         条件选项（为假时隐藏）
>> (greet) 问候他                     选项标签：自动计数全局变量（选中次数，初值 0），
                                      后续用 {greet} 读取；标签全局唯一、不可与变量重名
>> 合上书页 -> END                    结局（显示结束画面 + 重新开始）

* 凑近细看                            无目标选项：选中后执行分支体，之后汇合
> 分支体第一行（行首 > 标层级）
> @if {depth >= 2}                    条件链（@if/@elif/@else，体再进一层）
> > 条件为真时追加这句。
> @else
> > 否则追加这句。
> 回到分支体层（if 链已闭合）

-> target_scene                       独立跳转行（正文/分支体内皆可）
上半句<>                              行尾粘连：下一句不换行直接接上
@bg_show("linear-gradient(…)")        宿主命令：背景（URL/#颜色/渐变）
@bgm_play("assets/loop.mp3")          宿主命令：BGM（play/pause/stop）

### 子场景名                          子场景（ID = 父.子）；同父内 -> 子名，跨父 -> 父.子
```

词语动效（`enter:`）：`fly-in-left` `rain` `flare`（入场）；`sink` `swim` `heat` `drift` `sparkle` `pull`（持续状态）。

场景过渡（`enter:` / `speed:`，写在场景 frontmatter）：`dissolve` 旧文字淡出后新文字飞入（默认）；`fade-in` 新旧文字交叉淡入；`typewriter` 新文字按阅读顺序级联出现。`speed: slow` 将过渡时长放大 1.6 倍、`speed: fast` 缩短为 0.6 倍。

运行时语义：
场景体是顺序执行流（帧栈逐项执行），句子在执行时求值并**追加**进显示缓冲——选中分支体选项后，旧文字保持原位，新文字带 typewriter 时序飞入下方；执行完分支体自动**汇合**继续。若汇合后场景已无新停点，最近的选项组会**重新武装**（once 已选项过滤），天然形成「调查循环」。`->` 跳转（含子场景相对解析）清空缓冲进入新场景（溶解重建）。
逻辑即 JavaScript——`~` 行与 `{…}` 插值都是 JS，经 Proxy 沙盒求值，读写未声明变量都会报错（不会沉默失败）；内置函数 `visits("场景id")` 返回场景访问次数。变体函数按场景访问次数推进（`advance` 幂等，只有导航才计数）。行尾 `{…}` 消歧：key 全部命中效果指令白名单（typewriter/pause/…）才是效果指令，否则按插值处理。热重载保留变量/访问计数/once 状态并确定性重放当前场景（跳过 `~` 副作用）；「重新开始」清空全部运行时状态。静态检查：悬空跳转目标（含分支体内、子场景相对目标）与死胡同场景（无选项也无跳转）在错误横幅提示。

## 交互

| 操作 | 效果 |
|------|------|
| 编辑源文本 | 500ms 防抖后自动热更新预览 |
| Ctrl/Cmd + Enter | 立即应用 |
| 点击选项按钮 / 数字键 1-9 | 选择分支 |
| Space / Enter（焦点不在编辑器） | 重播当前场景 |
| 悬停标记词语 | 显示注释 tooltip |
| ✨ AI 生成 | 输入创意，LLM 生成完整分支故事（OpenAI 兼容 API） |

## 目录结构

```
src/
├── main.ts              入口：模块接线 + 键盘/分栏/错误处理
├── core/
│   ├── EventBus.ts      mitt 事件总线 + debounce
│   └── LayoutEngine.ts  Pretext 排版 + charMeta 标注
├── sushiml/
│   ├── types.ts         SushiML AST 类型
│   ├── parser.ts        .sushi → AST
│   └── bridge.ts        SushiMLStoryManager（场景导航 + 事件发射）
├── render/
│   ├── Particle.ts      字符粒子（状态机：flying/idle/fading）
│   ├── Renderer.ts      p5.js 渲染器（场景切换策略 + typewriter 时序）
│   └── EffectLibrary.ts 语义化动效库（入场/持续/情绪）
├── editor/
│   ├── EditorPanel.ts   CodeMirror 6 封装
│   ├── sushiMLLanguage.ts  语法高亮
│   └── DirectivePanel.ts   指令插入面板
├── ui/
│   ├── ChoiceUI.ts      分支选项按钮
│   └── AIPanel.ts       AI 生成弹窗
├── ai/
│   ├── aiService.ts     OpenAI 兼容 API 客户端
│   ├── systemPrompt.ts  内容轨生成约束
│   └── effectRules.ts   效果轨自动注入规则
├── infrastructure/
│   ├── FontLoader.ts    字体预加载门控 + FONT_CONFIG
│   └── MeasureContext.ts 离屏 Canvas 测量单例
├── store/gameStore.ts   Zustand 全局状态
├── types/               layout / particle / story 类型
└── stories/demo.sushi   演示故事
```
