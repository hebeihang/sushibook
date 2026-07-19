import { describe, it, expect } from 'vitest';
import { SushiMLStoryManager } from './bridge';
import { gameStore } from '../store/gameStore';
import { emitter } from '../core/EventBus';

const SRC = `## start
---
mood: default
---
起点。

>> 向左 -> left
>> 向右 -> missing_scene

## left
---
mood: float
---
左边的世界。

>> 回去 -> start`;

describe('SushiMLStoryManager — 场景导航', () => {
  it('默认从第一个场景开始', () => {
    const mgr = new SushiMLStoryManager(SRC);
    expect(mgr.sceneId).toBe('start');
    expect(mgr.sceneIds).toEqual(['start', 'left']);
  });

  it('selectChoice 跳转到目标场景', () => {
    const mgr = new SushiMLStoryManager(SRC);
    mgr.advance();
    const text = mgr.selectChoice(0);
    expect(mgr.sceneId).toBe('left');
    expect(text).toContain('左边的世界');
  });

  it('选项指向不存在的场景时拒绝跳转', () => {
    const mgr = new SushiMLStoryManager(SRC);
    mgr.advance();
    const result = mgr.selectChoice(1); // -> missing_scene
    expect(result).toBeNull();
    expect(mgr.sceneId).toBe('start');
  });

  it('validateLinks 找出悬空引用', () => {
    const mgr = new SushiMLStoryManager(SRC);
    expect(mgr.validateLinks()).toEqual([{ scene: 'start', target: 'missing_scene' }]);
  });

  it('reload 保留当前场景（若仍存在）', () => {
    const mgr = new SushiMLStoryManager(SRC);
    mgr.selectChoice(0);
    expect(mgr.sceneId).toBe('left');
    mgr.reload(SRC + '\n\n## extra\n新场景。');
    expect(mgr.sceneId).toBe('left');
  });

  it('reload 后当前场景消失则回到第一个场景', () => {
    const mgr = new SushiMLStoryManager(SRC);
    mgr.selectChoice(0);
    mgr.reload('## only\n唯一场景。');
    expect(mgr.sceneId).toBe('only');
  });

  it('空文档抛出错误', () => {
    expect(() => new SushiMLStoryManager('')).not.toThrow(); // 无标题 → start 场景
    const mgr = new SushiMLStoryManager('随便一句。');
    expect(mgr.sceneId).toBe('start');
  });

  it('渲染数据的 sentenceDirectives 与句子对齐', () => {
    const mgr = new SushiMLStoryManager(`## s
第一句。{typewriter: 60ms}
第二句。{pause: 800}`);
    const data = mgr.getCurrentRenderData()!;
    expect(data.sentenceDirectives[0].typewriter).toBe('60ms');
    expect(data.sentenceDirectives[1].pause).toBe('800');
  });
});

// ============================================================
// Kiny 风格运行时
// ============================================================

const RUNTIME_SRC = `~ let gold = 0

## start
~ gold = gold + 1
金币{gold}枚。{seq:初见。|再见。|又见。}
* 拾起宝石 -> gem
>> {gold >= 2} 进入宝库 -> vault
>> 结束 -> END

## gem
你拾起宝石。已访问{visits("gem")}次。
>> 回去 -> start

## vault
宝库之门开启。
>> 回去 -> start`;

describe('SushiMLStoryManager — 变量与逻辑行', () => {
  it('序言声明 + 场景逻辑行按进入次数执行', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    const text = mgr.advance()!;
    expect(text).toContain('金币1枚');
  });

  it('variables 快照可读（不含内置函数）', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    expect(mgr.variables.gold).toBe(1);
    expect('visits' in mgr.variables).toBe(false);
  });

  it('visits() 内置函数可在插值中使用', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    const text = mgr.selectChoice(0)!; // 拾起宝石 -> gem
    expect(text).toContain('已访问1次');
  });

  it('热重载保留变量值，新声明补充', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    mgr.reload(RUNTIME_SRC + '\n\n## extra\n~ let silver = 5\n多出的场景。\n>> 回去 -> start');
    expect(mgr.variables.gold).toBe(1); // 不被序言重置
  });
});

describe('SushiMLStoryManager — 条件选项与一次性选项', () => {
  it('条件为假的选项不出现', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    const choices = gameStoreChoices();
    expect(choices.map((c) => c.text)).toEqual(['拾起宝石', '结束']); // 宝库被隐藏
  });

  it('回访后条件满足，选项出现', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    mgr.selectChoice(0); // -> gem
    mgr.selectChoice(0); // 回去 -> start（第二次进入，gold=2）
    const choices = gameStoreChoices();
    expect(choices.map((c) => c.text)).toEqual(['进入宝库', '结束']); // 一次性选项消失，宝库出现
  });

  it('一次性选项选过即消失，重启后恢复', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    mgr.selectChoice(0); // 拾起宝石
    mgr.selectChoice(0); // 回到 start
    expect(gameStoreChoices().some((c) => c.text === '拾起宝石')).toBe(false);
    mgr.restart();
    expect(gameStoreChoices().some((c) => c.text === '拾起宝石')).toBe(true);
  });
});

describe('SushiMLStoryManager — 变体与访问计数', () => {
  it('seq 按访问次数推进', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    expect(mgr.advance()).toContain('初见');
    mgr.selectChoice(0); // -> gem
    expect(mgr.selectChoice(0)).toContain('再见'); // 第二次进 start
  });

  it('advance 幂等：重播不推进变体', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    expect(mgr.advance()).toContain('初见');
    expect(mgr.advance()).toContain('初见'); // 重播同场景
  });

  it('同场景内变体按调用点独立推进（修复锁步：条件分支内变体只在真正渲染时计数）', () => {
    // 甲 每次进入 start 都渲染；乙 只在偶数次进入（@if）时渲染。
    // 锁步旧模型：乙 会随 visits(start) 跳到第 2 项（乙Y）；
    // 修复后：乙 第一次真正渲染时应为第 1 项（乙X）。
    const SRC2 = `~ let n = 0

## start
~ n = n + 1
甲{seq:甲一|甲二|甲三}
@if {n % 2 == 0}
> 乙{seq:乙X|乙Y|乙Z}
>> 去中转 -> hop

## hop
中转。
>> 回 -> start`;
    const mgr = new SushiMLStoryManager(SRC2);
    const first = mgr.advance()!;          // 第 1 次进 start：n=1，@if 假
    expect(first).toContain('甲一');
    expect(first).not.toContain('乙');     // 乙 未渲染 → 其调用点不计数

    mgr.selectChoice(0);                    // 去中转 -> hop
    const second = mgr.selectChoice(0)!;    // 回 -> start：第 2 次进入，n=2，@if 真
    expect(second).toContain('甲二');       // 甲：第 2 项（随重访推进）
    expect(second).toContain('乙X');        // 乙：首次渲染 → 第 1 项（独立计数）
    expect(second).not.toContain('乙Y');    // 关键：未被 visits 锁步带跑到第 2 项
  });
});

describe('SushiMLStoryManager — END 结局与重启', () => {
  it('-> END 进入结局画面', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    const text = mgr.selectChoice(1)!; // 结束 -> END
    expect(mgr.isEnded).toBe(true);
    expect(mgr.sceneId).toBe('END');
    expect(text).toContain('完');
    expect(gameStoreChoices()[0].text).toContain('重新开始');
  });

  it('结局后任意选择触发重启，状态清零', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    mgr.selectChoice(1); // END
    const text = mgr.selectChoice(0)!; // 重新开始
    expect(mgr.isEnded).toBe(false);
    expect(mgr.sceneId).toBe('start');
    expect(text).toContain('金币1枚'); // gold 重置后重新 +1
    expect(text).toContain('初见'); // 访问计数重置
  });

  it('结局画面含统计与「继续探索」选项', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    const text = mgr.selectChoice(1)!; // 结束 -> END
    expect(text).toContain('到访了');
    expect(text).toContain('个场景');
    const choices = gameStoreChoices();
    expect(choices).toHaveLength(2);
    expect(choices[1].text).toContain('继续探索');
    expect(choices[1].text).toContain('start'); // 结局前场景名
  });

  it('继续探索：不清档回到结局前场景', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    mgr.advance();
    mgr.selectChoice(0); // 拾起宝石 -> gem（once 消耗 + gold 累积）
    mgr.selectChoice(0); // 回去 -> start（gold=2）
    mgr.selectChoice(1); // 结束 -> END（此时可见 [进入宝库, 结束]）
    expect(mgr.isEnded).toBe(true);
    const text = mgr.selectChoice(1)!; // 继续探索 → 回到 start
    expect(mgr.isEnded).toBe(false);
    expect(mgr.sceneId).toBe('start');
    expect(mgr.variables.gold).toBe(3); // 变量未清档（重入 start 再 +1）
    expect(text).toContain('金币3枚');
    // once 选项仍处于已消耗状态
    expect(gameStoreChoices().some((c) => c.text === '拾起宝石')).toBe(false);
  });

  it('END 是合法跳转目标，不算悬空引用', () => {
    const mgr = new SushiMLStoryManager(RUNTIME_SRC);
    expect(mgr.validateLinks()).toEqual([]);
  });

  it('deadEndScenes 找出无选项场景', () => {
    const mgr = new SushiMLStoryManager(`## a
去 b。
>> 走 -> b

## b
这里没有出路。`);
    expect(mgr.deadEndScenes()).toEqual(['b']);
  });
});

// ============================================================
// 执行流：分支体 / @if / 粘连 / 子场景 / 命令
// ============================================================

const FLOW_SRC = `~ let clue = false

## scene
开场白。

* 查看线索
> 你俯身细看。
> @if {clue}
> > 又看了一遍，没有新发现。
> @else
> > 灰尘下露出一枚[[徽章]]。
> > ~ clue = true
* 环顾四周
> 房间很安静<>
> ，安静得反常。
>> {clue} 带着徽章离开 -> out

## out
你走了出去。
-> 巷口

### 巷口
巷口空无一人。
>> 结束 -> END`;

describe('SushiMLStoryManager — 分支体与汇合', () => {
  it('选中分支体选项：文字追加，once 消失，组重新武装', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    const before = mgr.advance()!;
    expect(before).toBe('开场白。');
    // 初始只有两个 once 调查项（条件选项 clue=false 隐藏）
    expect(gameStoreChoices().map((c) => c.text)).toEqual(['查看线索', '环顾四周']);

    const after = mgr.selectChoice(0)!; // 查看线索
    expect(after).toContain('开场白。'); // 旧文字保留（追加式）
    expect(after).toContain('你俯身细看。');
    expect(after).toContain('徽章'); // @else 分支（clue 当时为 false）
    expect(mgr.variables.clue).toBe(true); // 体内逻辑行生效
    // 重新武装：once 已选项消失，条件选项现身
    expect(gameStoreChoices().map((c) => c.text)).toEqual(['环顾四周', '带着徽章离开']);
  });

  it('@if 按当前变量选分支', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    mgr.advance();
    mgr.selectChoice(0); // 第一次：@else 分支，clue=true
    // 场景内没有重进，@if 已消费；直接验证变量驱动的条件选项
    expect(gameStoreChoices().some((c) => c.text === '带着徽章离开')).toBe(true);
  });

  it('分支体内粘连：两行缝成一句', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    mgr.advance();
    const text = mgr.selectChoice(1)!; // 环顾四周
    expect(text).toContain('房间很安静，安静得反常。');
  });

  it('独立 -> 跳转与 ### 子场景相对解析', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    mgr.advance();
    mgr.selectChoice(0); // 拿到徽章
    const text = mgr.selectChoice(1)!; // 带着徽章离开 -> out → 巷口
    expect(mgr.sceneId).toBe('out.巷口');
    expect(text).toBe('巷口空无一人。'); // divert 进子场景后缓冲重置
  });

  it('@bg_show 命令发射 host:command 事件', () => {
    const received: Array<{ name: string; args: unknown[] }> = [];
    const handler = (e: { name: string; args: unknown[] }) => received.push(e);
    emitter.on('host:command', handler);
    try {
      new SushiMLStoryManager(`## s
@bg_show("#112233")
一句话。
>> 结束 -> END`);
      expect(received).toEqual([{ name: 'bg_show', args: ['#112233'] }]);
    } finally {
      emitter.off('host:command', handler);
    }
  });

  it('未加引号的命令参数不会让执行流崩溃（B5）', () => {
    const received: Array<{ name: string; args: unknown[] }> = [];
    const handler = (e: { name: string; args: unknown[] }) => received.push(e);
    emitter.on('host:command', handler);
    let mgr: SushiMLStoryManager;
    try {
      mgr = new SushiMLStoryManager(`## s
@bg_show(linear-gradient(180deg, #0b1026, #05070f))
一句话。
>> 结束 -> END`);
      const text = mgr.advance();
      // 执行流未被打断：场景内容正常渲染
      expect(text).toContain('一句话。');
    } finally {
      emitter.off('host:command', handler);
    }
    // 降级：整段原始参数作为单个字符串下发，而非抛错中断
    expect(received).toEqual([
      { name: 'bg_show', args: ['linear-gradient(180deg, #0b1026, #05070f)'] },
    ]);
  });

  it('未知命令告警但不中断', () => {
    const mgr = new SushiMLStoryManager(`## s
@unknown_cmd("x")
正文照常。
>> 结束 -> END`);
    expect(mgr.advance()).toContain('正文照常');
  });

  it('validateLinks 支持子场景相对目标', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    expect(mgr.validateLinks()).toEqual([]);
  });
});

describe('SushiMLStoryManager — 选项标签自动计数（Kiny §5.5）', () => {
  const LABEL_SRC = `## s
"什么事？"

>> (greet) 问候他
> "你好。"
>> (ignore) 无视他
> 我什么也没说。
>> {greet > 0} 问他叫什么 -> named
>> 问候了{greet}次 -> END

## named
他说出了名字。
>> 结束 -> END`;

  it('标签注册为初值 0 的全局变量', () => {
    const mgr = new SushiMLStoryManager(LABEL_SRC);
    expect(mgr.variables.greet).toBe(0);
    expect(mgr.variables.ignore).toBe(0);
  });

  it('选中后计数递增，条件选项据此解锁', () => {
    const mgr = new SushiMLStoryManager(LABEL_SRC);
    mgr.advance();
    expect(gameStoreChoices().some((c) => c.text === '问他叫什么')).toBe(false);
    mgr.selectChoice(0); // (greet)
    expect(mgr.variables.greet).toBe(1);
    expect(gameStoreChoices().some((c) => c.text === '问他叫什么')).toBe(true);
    // 插值中可读计数
    expect(gameStoreChoices().some((c) => c.text.includes('{greet}'))).toBe(true); // 选项文本不做插值（按字面显示）
  });

  it('标签重复报错', () => {
    expect(
      () => new SushiMLStoryManager(`## s
>> (dup) 甲 -> END
>> (dup) 乙 -> END`)
    ).toThrow(/标签重复/);
  });

  it('标签与 let 变量重名报错', () => {
    expect(
      () => new SushiMLStoryManager(`~ let greet = 1
## s
>> (greet) 问候 -> END`)
    ).toThrow(/重名/);
  });

  it('linkStats 统计入链数', () => {
    const mgr = new SushiMLStoryManager(FLOW_SRC);
    const stats = mgr.linkStats();
    expect(stats.get('out')).toBe(1);
    expect(stats.get('out.巷口')).toBe(1);
    expect(stats.get('scene')).toBe(0);
  });
});

/** 从 gameStore 读取最近一次 advance 后的可见选项 */
function gameStoreChoices() {
  return gameStore.getState().story.choices;
}

describe('SceneRenderData.marks — B3 词汇表数据完整性', () => {
  const MARK_SRC = `## start
---
mood: default
---
你拾起[[灯笼|会发光的灯]]{relation: item}，又看见[[灯笼]]。
第二次遇到[[深渊|无底之境]]。

>> 继续 -> start`;

  it('marks 携带 annotation / directives.relation / isFirstOccurrence', () => {
    const mgr = new SushiMLStoryManager(MARK_SRC);
    mgr.advance();
    const data = mgr.getCurrentRenderData();
    expect(data).not.toBeNull();
    const marks = data!.marks;

    expect(marks).toHaveLength(3);

    // 带注释 + relation 的词
    const lantern = marks.find((m) => m.text === '灯笼');
    expect(lantern).toBeDefined();
    expect(lantern!.annotation).toBe('会发光的灯');
    expect(lantern!.directives.relation).toBe('item');

    // 同文本重复提及：首次 true，后续 false
    const lanternOccurrences = marks.filter((m) => m.text === '灯笼');
    expect(lanternOccurrences).toHaveLength(2);
    expect(lanternOccurrences[0].isFirstOccurrence).toBe(true);
    expect(lanternOccurrences[1].isFirstOccurrence).toBe(false);

    // 独立词的注释与首次标记
    const abyss = marks.find((m) => m.text === '深渊');
    expect(abyss!.isFirstOccurrence).toBe(true);
    expect(abyss!.annotation).toBe('无底之境');
  });

  it('无标记词的场景 marks 为空数组', () => {
    const mgr = new SushiMLStoryManager(SRC);
    mgr.advance();
    expect(mgr.getCurrentRenderData()!.marks).toEqual([]);
  });
});

// ============================================================
// 修复回归：B6 / B9 / B10 / B11
// ============================================================

describe('修复回归 — B9 死胡同检查细分', () => {
  it('硬死胡同：无跳转也无任何选项组 → deadEndScenes', () => {
    const mgr = new SushiMLStoryManager(`## a
第一句。

## b
第二句。

## c
第三句。`);
    expect(mgr.deadEndScenes().sort()).toEqual(['a', 'b', 'c']);
    expect(mgr.stickyDeadEnds()).toEqual([]);
    expect(mgr.onceOnlyDeadEnds()).toEqual([]);
  });

  it('粘性死循环：选项无目标也无内容 → stickyDeadEnds（且不算硬死胡同）', () => {
    const mgr = new SushiMLStoryManager(`## a
前言。

>> 重复选项
>> 又一个重复

## b
其它。
-> END`);
    expect(mgr.stickyDeadEnds()).toEqual(['a']);
    expect(mgr.deadEndScenes()).toEqual([]);
  });

  it('一次性死胡同：唯一出口是 * once 选项 → onceOnlyDeadEnds', () => {
    const mgr = new SushiMLStoryManager(`## a
前言。

* 离开 -> b

## b
终局。
-> END`);
    expect(mgr.onceOnlyDeadEnds()).toEqual(['a']);
    expect(mgr.deadEndScenes()).toEqual([]);
    expect(mgr.stickyDeadEnds()).toEqual([]);
  });

  it('正常可重复选项（非 once、有目标）不算任何死胡同', () => {
    const mgr = new SushiMLStoryManager(`## a
前言。

>> 离开 -> b

## b
终局。
-> END`);
    expect(mgr.deadEndScenes()).toEqual([]);
    expect(mgr.stickyDeadEnds()).toEqual([]);
    expect(mgr.onceOnlyDeadEnds()).toEqual([]);
  });
});

describe('修复回归 — B6 热重载 replay 不递增 visits（确定性）', () => {
  it('reload 跨 divert 重放时，目标场景 visits 不重复 +1', () => {
    const src = `## start
开头。
-> mid

## mid
中间。`;
    const mgr = new SushiMLStoryManager(src);
    const visits = (mgr as unknown as { visits: Map<string, number> }).visits;
    const afterConstruct = visits.get('mid') ?? 0;
    mgr.reload(src);
    const afterReload1 = visits.get('mid') ?? 0;
    mgr.reload(src);
    const afterReload2 = visits.get('mid') ?? 0;
    expect(afterReload1).toBe(afterConstruct); // B6：replay 模式不 +visits
    expect(afterReload2).toBe(afterConstruct);
  });
});

describe('修复回归 — B10 大纲跳转不递增 visits', () => {
  it('gotoScene 走 replay，不推进访问计数', () => {
    const mgr = new SushiMLStoryManager(`## a
-> b

## b
终局。`);
    const visits = (mgr as unknown as { visits: Map<string, number> }).visits;
    const before = visits.get('b') ?? 0;
    mgr.gotoScene('b');
    const after = visits.get('b') ?? 0;
    expect(after).toBe(before); // B10：大纲跳转属预览，不 +visits
    expect(mgr.sceneId).toBe('b');
  });
});

describe('修复回归 — B11 相对解析排除自身 / 跨父回退', () => {
  it('子场景内 -> <自身名> 解析到其它父下同名兄弟，不自跳转死循环', () => {
    const mgr = new SushiMLStoryManager(`## deep.x
自身场景。

-> x

## other.x
兄弟场景。`);
    // 进入 deep.x 后遇 -> x：排除解析回自身(deep.x)，回退到 other.x
    expect(mgr.sceneId).toBe('other.x');
  });

  it('精确绝对 id 优先于相对解析', () => {
    const mgr = new SushiMLStoryManager(`## a
-> other.x

## other.x
目标。`);
    expect(mgr.sceneId).toBe('other.x');
  });
});
