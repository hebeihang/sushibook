import { describe, it, expect } from 'vitest';
import { parseYamlStyle, resolveSceneStyle, resolveWordStyle } from './styleParser';

describe('styleParser — Phase 5 外置样式表', () => {
  it('parseYamlStyle 解析全局样式', () => {
    const yaml = `
global:
  typewriter: 80ms
  pause: 600ms
`;
    const style = parseYamlStyle(yaml);
    expect(style.global).toEqual({ typewriter: 80, pause: 600 });
  });

  it('parseYamlStyle 解析词语样式', () => {
    const yaml = `
words:
  sword: { color: '#ff6b6b', size: 1.2, enter: flash }
  spell: { color: '#6c5ce7', enter: sparkle }
`;
    const style = parseYamlStyle(yaml);
    expect(style.words?.sword).toMatchObject({ color: '#ff6b6b', size: 1.2, enter: 'flash' });
    expect(style.words?.spell).toMatchObject({ color: '#6c5ce7', enter: 'sparkle' });
  });

  it('parseYamlStyle 解析 mood 覆盖', () => {
    const yaml = `
global:
  typewriter: 80ms

moods:
  tense: { typewriter: 100ms }
  float: { typewriter: 60ms }
`;
    const style = parseYamlStyle(yaml);
    expect(style.moods?.tense?.typewriter).toBe(100);
    expect(style.moods?.float?.typewriter).toBe(60);
  });

  it('resolveSceneStyle 按优先级合并样式', () => {
    const style = parseYamlStyle(`
global:
  typewriter: 80ms
  pause: 600ms

moods:
  tense: { typewriter: 120ms }

words:
  sword: { color: '#ff6b6b' }
`);

    // 默认 mood
    const defaultResolved = resolveSceneStyle(style, 'default');
    expect(defaultResolved.typewriter).toBe(80);
    expect(defaultResolved.pause).toBe(600);

    // tense mood 覆盖
    const tenseResolved = resolveSceneStyle(style, 'tense');
    expect(tenseResolved.typewriter).toBe(120);
    expect(tenseResolved.pause).toBe(600); // 从全局继承
    expect(tenseResolved.wordStyles?.sword).toMatchObject({ color: '#ff6b6b' });
  });

  it('resolveWordStyle 内联规则优先级最高', () => {
    const style = parseYamlStyle(`
words:
  sword: { color: '#ff6b6b', size: 1.0, enter: sink }
`);
    const sceneStyle = resolveSceneStyle(style, 'default');

    // 仅用外部样式
    const withoutInline = resolveWordStyle(sceneStyle, 'sword');
    expect(withoutInline).toMatchObject({ color: '#ff6b6b', size: 1.0, enter: 'sink' });

    // 内联规则覆盖
    const withInline = resolveWordStyle(sceneStyle, 'sword', { color: '#00ff00', size: 1.5 });
    expect(withInline).toMatchObject({ color: '#00ff00', size: 1.5, enter: 'sink' });
  });

  it('resolveWordStyle 处理不存在的词语', () => {
    const style = parseYamlStyle('words:\n  sword: { color: "#ff6b6b" }');
    const sceneStyle = resolveSceneStyle(style, 'default');

    const unknown = resolveWordStyle(sceneStyle, 'unknown');
    expect(Object.keys(unknown)).toHaveLength(0);
  });
});
