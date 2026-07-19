import { describe, it, expect } from 'vitest';
import { parseSushiML, extractTextAndMeta } from './parser';

describe('parseSushiML — 场景分割', () => {
  it('按 ## 标题分割多个场景并保留顺序', () => {
    const doc = parseSushiML(`## start
第一幕。

## middle
第二幕。

## end
第三幕。`);
    expect(doc.sceneOrder).toEqual(['start', 'middle', 'end']);
    expect(doc.scenes.get('middle')?.sentences[0].plainText).toBe('第二幕。');
  });

  it('正文行内包含 ## 时不误切场景', () => {
    const doc = parseSushiML(`## start
这句话提到 ## 符号但不是标题。
下一句。

## next
另一场。`);
    expect(doc.sceneOrder).toEqual(['start', 'next']);
    expect(doc.scenes.get('start')?.sentences).toHaveLength(2);
  });

  it('无标题时整个文件作为 start 场景', () => {
    const doc = parseSushiML('只有一句话。');
    expect(doc.sceneOrder).toEqual(['start']);
  });

  it('解析 frontmatter 与选项', () => {
    const doc = parseSushiML(`## start
---
mood: tense
enter: dissolve
---
紧张的一幕。

>> 逃跑 -> escape
>> 战斗 -> fight`);
    const scene = doc.scenes.get('start')!;
    expect(scene.frontmatter.mood).toBe('tense');
    expect(scene.frontmatter.enter).toBe('dissolve');
    expect(scene.choices).toHaveLength(2);
    expect(scene.choices[0]).toMatchObject({ text: '逃跑', target: 'escape', once: false });
    expect(scene.choices[1]).toMatchObject({ text: '战斗', target: 'fight', once: false });
  });

  it('frontmatter 解析 enter: fade-in/typewriter 与 speed 倍率（B1 数据层）', () => {
    const doc = parseSushiML(`## a
---
mood: float
enter: typewriter
speed: fast
---
第一句。
>> 继续 -> b

## b
---
enter: fade-in
speed: slow
---
第二句。`);
    expect(doc.scenes.get('a')!.frontmatter.enter).toBe('typewriter');
    expect(doc.scenes.get('a')!.frontmatter.speed).toBe('fast');
    expect(doc.scenes.get('b')!.frontmatter.enter).toBe('fade-in');
    expect(doc.scenes.get('b')!.frontmatter.speed).toBe('slow');
  });
});

describe('parseSushiML — 句子指令与词语标记', () => {
  it('提取行尾句子指令（含标点在指令后）', () => {
    const doc = parseSushiML('## s\n夜色降临。{typewriter: 60ms}');
    const sentence = doc.scenes.get('s')!.sentences[0];
    expect(sentence.directives.typewriter).toBe('60ms');
    expect(sentence.plainText).toBe('夜色降临。');
  });

  it('词语级 {指令} 不被误认为句子指令', () => {
    const doc = parseSushiML('## s\n它像[[鱼群]]{enter: swim}');
    const sentence = doc.scenes.get('s')!.sentences[0];
    expect(sentence.directives.typewriter).toBeUndefined();
    const marked = sentence.tokens.find((t) => t.type === 'marked');
    expect(marked && marked.type === 'marked' && marked.directives.enter).toBe('swim');
  });

  it('词语指令与句子指令共存', () => {
    const doc = parseSushiML('## s\n[[深渊]]{color: #ff6b6b}之中。{pause: 800}');
    const sentence = doc.scenes.get('s')!.sentences[0];
    expect(sentence.directives.pause).toBe('800');
    const marked = sentence.tokens.find((t) => t.type === 'marked');
    expect(marked && marked.type === 'marked' && marked.directives.color).toBe('#ff6b6b');
    expect(sentence.plainText).toBe('深渊之中。');
  });

  it('[[词语|注释]] 解析注释', () => {
    const doc = parseSushiML('## s\n回到[[文字|人类最古老的符号]]的最初。');
    const marked = doc.scenes.get('s')!.sentences[0].tokens.find((t) => t.type === 'marked');
    expect(marked && marked.type === 'marked' && marked.annotation).toBe('人类最古老的符号');
  });

  it('相同标记文本只有首次 isFirstOccurrence=true', () => {
    const doc = parseSushiML('## s\n[[月光]]洒下。\n又见[[月光]]。');
    const marks = doc.scenes.get('s')!.sentences.flatMap((s) =>
      s.tokens.filter((t) => t.type === 'marked')
    );
    expect(marks).toHaveLength(2);
    expect(marks[0].type === 'marked' && marks[0].isFirstOccurrence).toBe(true);
    expect(marks[1].type === 'marked' && marks[1].isFirstOccurrence).toBe(false);
  });
});

describe('extractTextAndMeta — 字素级元数据', () => {
  it('plainText 与 charMeta 字素一一对应，句子间以 \\n 分隔', () => {
    const doc = parseSushiML('## s\n第一句。\n第二句。');
    const { plainText, charMeta } = extractTextAndMeta(doc.scenes.get('s')!);
    expect(plainText).toBe('第一句。\n第二句。');
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    expect(charMeta).toHaveLength([...segmenter.segment(plainText)].length);
  });

  it('sentenceIndex 正确标注每个字素', () => {
    const doc = parseSushiML('## s\n甲乙。\n丙丁。');
    const { plainText, charMeta } = extractTextAndMeta(doc.scenes.get('s')!);
    const chars = [...plainText];
    expect(charMeta[chars.indexOf('甲')].sentenceIndex).toBe(0);
    expect(charMeta[chars.indexOf('丙')].sentenceIndex).toBe(1);
  });

  it('标记词语的字素带 isMarked / wordColor / enterEffect / annotation', () => {
    const doc = parseSushiML('## s\n你潜入[[深海|很深的海]]{enter: sink, color: #6c5ce7}。');
    const { plainText, charMeta } = extractTextAndMeta(doc.scenes.get('s')!);
    const chars = [...plainText];
    const idx = chars.indexOf('深');
    expect(charMeta[idx]).toMatchObject({
      isMarked: true,
      enterEffect: 'sink',
      wordColor: '#6c5ce7',
      annotation: '很深的海',
    });
    // 非标记字符
    expect(charMeta[chars.indexOf('你')].isMarked).toBe(false);
  });

  it('emoji 等复合字素按单字素计数', () => {
    const doc = parseSushiML('## s\n星空👨‍👩‍👧闪烁。');
    const { plainText, charMeta } = extractTextAndMeta(doc.scenes.get('s')!);
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    expect(charMeta).toHaveLength([...segmenter.segment(plainText)].length);
  });
});

describe('parseSushiML — Kiny 风格扩展语法', () => {
  it('// 整行注释被忽略（正文与 frontmatter）', () => {
    const doc = parseSushiML(`## s
---
mood: tense
// 这是 frontmatter 注释
---
// 这是正文注释
只有这一句。`);
    const scene = doc.scenes.get('s')!;
    expect(scene.frontmatter.mood).toBe('tense');
    expect(scene.sentences).toHaveLength(1);
    expect(scene.sentences[0].plainText).toBe('只有这一句。');
  });

  it('序言区收集 ~ 全局声明', () => {
    const doc = parseSushiML(`// 序言注释
~ let gold = 10
~ const NAME = "灰隼"
这行普通文本被忽略

## s
正文。`);
    expect(doc.prelude).toEqual(['let gold = 10', 'const NAME = "灰隼"']);
  });

  it('场景内 ~ 逻辑行收集到 scene.logic', () => {
    const doc = parseSushiML(`## s
~ depth = depth + 1
正文一句。
~ flag = true`);
    const scene = doc.scenes.get('s')!;
    expect(scene.logic).toEqual(['depth = depth + 1', 'flag = true']);
    expect(scene.sentences).toHaveLength(1);
  });

  it('* 一次性选项与 >> 粘性选项', () => {
    const doc = parseSushiML(`## s
正文。
* 拾起灯笼 -> get
>> 离开 -> away`);
    const [c1, c2] = doc.scenes.get('s')!.choices;
    expect(c1).toMatchObject({ text: '拾起灯笼', target: 'get', once: true });
    expect(c2).toMatchObject({ text: '离开', target: 'away', once: false });
  });

  it('条件选项 {cond} 前缀', () => {
    const doc = parseSushiML(`## s
正文。
>> {gold >= 5} 买下它 -> shop
* {!visited} 初次探索 -> explore`);
    const [c1, c2] = doc.scenes.get('s')!.choices;
    expect(c1).toMatchObject({ condition: 'gold >= 5', once: false });
    expect(c2).toMatchObject({ condition: '!visited', once: true });
  });

  it('-> END 结局目标', () => {
    const doc = parseSushiML(`## s
正文。
>> 合上书页 -> END`);
    expect(doc.scenes.get('s')!.choices[0].target).toBe('END');
  });

  it('{表达式} 解析为 expr token', () => {
    const doc = parseSushiML('## s\n你还剩{gold}枚金币。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    const expr = tokens.find((t) => t.type === 'expr');
    expect(expr && expr.type === 'expr' && expr.code).toBe('gold');
  });

  it('行尾非白名单 {…} 按插值处理而不是句子指令', () => {
    const doc = parseSushiML('## s\n你的状态：{hp > 50 ? "良好" : "虚弱"}');
    const sentence = doc.scenes.get('s')!.sentences[0];
    expect(Object.keys(sentence.directives)).toHaveLength(0);
    expect(sentence.tokens.some((t) => t.type === 'expr')).toBe(true);
  });

  it('行尾白名单 {…} 仍是句子指令', () => {
    const doc = parseSushiML('## s\n慢慢显现。{typewriter: 80ms, pause: 400}');
    const sentence = doc.scenes.get('s')!.sentences[0];
    expect(sentence.directives.typewriter).toBe('80ms');
    expect(sentence.directives.pause).toBe('400');
  });

  it('{seq:A|B} 等解析为 variant token 并编号', () => {
    const doc = parseSushiML('## s\n{seq:第一次|之后}钟声{cycle:响了|又响了}。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    const variants = tokens.filter((t) => t.type === 'variant');
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({ kind: 'seq', items: ['第一次', '之后'], variantIndex: 0 });
    expect(variants[1]).toMatchObject({ kind: 'cycle', items: ['响了', '又响了'], variantIndex: 1 });
  });

  it('extractTextAndMeta 用 resolver 求值插值/变体', () => {
    const doc = parseSushiML('## s\n金币{gold}枚，{seq:初见|重逢}。');
    const { plainText } = extractTextAndMeta(doc.scenes.get('s')!, (token) =>
      token.type === 'expr' ? '10' : token.items[0]
    );
    expect(plainText).toBe('金币10枚，初见。');
  });

  it('resolver 返回空串时不产生字素（once 用尽语义）', () => {
    const doc = parseSushiML('## s\n他笑了。{once:第一次见他笑。}');
    const { plainText, charMeta } = extractTextAndMeta(doc.scenes.get('s')!, () => '');
    expect(plainText).toBe('他笑了。');
    expect(charMeta).toHaveLength([...plainText].length);
  });

  it('[[标记]]{enter: …} 与插值共存', () => {
    const doc = parseSushiML('## s\n[[深海]]{enter: sink}第{depth}层。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    expect(tokens.some((t) => t.type === 'marked')).toBe(true);
    expect(tokens.some((t) => t.type === 'expr')).toBe(true);
  });
});

describe('parseSushiML — 解析期打标诊断（三层模型 §4.3 消除静默退化）', () => {
  it('正确句子指令不产生诊断', () => {
    const doc = parseSushiML('## s\n慢慢显现。{typewriter: 80ms, pause: 400}');
    expect(doc.diagnostics).toHaveLength(0);
  });

  it('句尾指令拼写错误 → error 诊断并给出「是否想写」建议', () => {
    const doc = parseSushiML('## s\n慢慢显现。{typewritter: 60ms}');
    expect(doc.diagnostics).toHaveLength(1);
    const d = doc.diagnostics[0];
    expect(d.severity).toBe('error');
    expect(d.code).toBe('unknown-sentence-directive');
    expect(d.scene).toBe('s');
    expect(d.message).toContain('typewriter'); // 建议正确拼写
    // 静默退化已消除：文本原样保留（不丢弃），但不误当作句子指令
    expect(Object.keys(doc.scenes.get('s')!.sentences[0].directives)).toHaveLength(0);
  });

  it('词语指令错位到句尾（漏写 [[…]]）→ warning 诊断', () => {
    const doc = parseSushiML('## s\n那艘船缓缓驶来。{color: #ff6b6b}');
    expect(doc.diagnostics).toHaveLength(1);
    expect(doc.diagnostics[0].code).toBe('misplaced-word-directive');
    expect(doc.diagnostics[0].severity).toBe('warning');
  });

  it('纯插值 {gold} / 三元表达式不误报诊断', () => {
    const doc = parseSushiML('## s\n你还剩{gold}\n状态：{hp > 50 ? "良好" : "虚弱"}');
    expect(doc.diagnostics).toHaveLength(0);
  });

  it('变体 {seq:…} 在句尾不误报诊断', () => {
    const doc = parseSushiML('## s\n钟声响起。{seq:第一次|之后}');
    expect(doc.diagnostics).toHaveLength(0);
  });

  it('Phase 4: 变体引号支持 {seq:"a|b"|c}', () => {
    const doc = parseSushiML('## s\n文字{seq:"进入|黑暗"|逃离}变换。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    const variant = tokens.find((t) => t.type === 'variant');
    expect(variant).toBeDefined();
    if (variant && variant.type === 'variant') {
      expect(variant.items).toEqual(['进入|黑暗', '逃离']);
    }
  });

  it('Phase 4: 变体转义支持 {seq:a\\|b|c}', () => {
    const doc = parseSushiML('## s\n文字{seq:a\\|b|c|d}变换。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    const variant = tokens.find((t) => t.type === 'variant');
    expect(variant).toBeDefined();
    if (variant && variant.type === 'variant') {
      expect(variant.items).toEqual(['a|b', 'c', 'd']);
    }
  });

  it('Phase 4: 混合引号与转义 {seq:"a\\|b"|c\\|d}', () => {
    const doc = parseSushiML('## s\n{seq:"箭头|符号"|逃离\\|回家}。');
    const tokens = doc.scenes.get('s')!.sentences[0].tokens;
    const variant = tokens.find((t) => t.type === 'variant');
    expect(variant).toBeDefined();
    if (variant && variant.type === 'variant') {
      expect(variant.items).toEqual(['箭头|符号', '逃离|回家']);
    }
  });

  it('诊断携带场景 ID，多场景各自归属', () => {
    const doc = parseSushiML('## a\n文本{foo: 1}\n\n## b\n文本{bar: 2}');
    expect(doc.diagnostics.map((d) => d.scene)).toEqual(['a', 'b']);
  });
});

describe('parseSushiML — 执行流结构（分支体/@if/命令/子场景/粘连）', () => {
  it('选项分支体挂到 choice.body（> 层级）', () => {
    const doc = parseSushiML(`## s
开场白。
* 查看
> 第一段体。
> 第二段体。
>> 离开 -> away`);
    const scene = doc.scenes.get('s')!;
    const group = scene.items.find((i) => i.kind === 'choices');
    expect(group && group.kind === 'choices' && group.choices).toHaveLength(2);
    if (group?.kind === 'choices') {
      expect(group.choices[0].body).toHaveLength(2);
      expect(group.choices[0].target).toBeUndefined();
      expect(group.choices[1].body).toHaveLength(0);
      expect(group.choices[1].target).toBe('away');
    }
  });

  it('嵌套：分支体内的 @if 及其 > > 体', () => {
    const doc = parseSushiML(`## s
* 查看
> 前导句。
> @if {x > 1}
> > 深层真句。
> @else
> > 深层假句。
> 汇合句。`);
    const group = doc.scenes.get('s')!.items.find((i) => i.kind === 'choices');
    if (group?.kind !== 'choices') throw new Error('no group');
    const body = group.choices[0].body;
    expect(body.map((i) => i.kind)).toEqual(['sentence', 'if', 'sentence']);
    const ifItem = body[1];
    if (ifItem.kind !== 'if') throw new Error('no if');
    expect(ifItem.branches).toHaveLength(2);
    expect(ifItem.branches[0].condition).toBe('x > 1');
    expect(ifItem.branches[1].condition).toBeNull();
    expect(ifItem.branches[0].body[0].kind).toBe('sentence');
  });

  it('@命令(args) 解析为 command 项', () => {
    const doc = parseSushiML(`## s
@bg_show("linear-gradient(180deg, #000, #111)")
一句话。`);
    const cmd = doc.scenes.get('s')!.items.find((i) => i.kind === 'command');
    expect(cmd && cmd.kind === 'command' && cmd.name).toBe('bg_show');
    expect(cmd && cmd.kind === 'command' && cmd.argsSource).toContain('linear-gradient');
  });

  it('独立 -> 跳转行解析为 divert 项', () => {
    const doc = parseSushiML(`## s
一句话。
-> next`);
    const divert = doc.scenes.get('s')!.items.find((i) => i.kind === 'divert');
    expect(divert && divert.kind === 'divert' && divert.target).toBe('next');
  });

  it('### 子场景 ID = 父.子', () => {
    const doc = parseSushiML(`## parent
父正文。
-> sub

### sub
子正文。`);
    expect(doc.sceneOrder).toEqual(['parent', 'parent.sub']);
    expect(doc.scenes.get('parent.sub')?.sentences[0].plainText).toBe('子正文。');
  });

  it('行尾 <> 标记粘连', () => {
    const doc = parseSushiML(`## s
上半句<>
，下半句。`);
    const scene = doc.scenes.get('s')!;
    expect(scene.sentences[0].glueAfter).toBe(true);
    expect(scene.sentences[0].plainText).toBe('上半句');
    const { plainText } = extractTextAndMeta(scene);
    expect(plainText).toBe('上半句，下半句。');
  });
});
