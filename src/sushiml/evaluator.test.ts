import { describe, it, expect } from 'vitest';
import {
  evalExpression,
  evalToText,
  evalCondition,
  execStatement,
  deterministicIndex,
  type VarTable,
} from './evaluator';

describe('evalExpression — 表达式求值', () => {
  it('读取变量并计算', () => {
    const vars: VarTable = { gold: 10, name: '灰隼' };
    expect(evalExpression('gold + 5', vars)).toBe(15);
    expect(evalExpression('name', vars)).toBe('灰隼');
    expect(evalExpression('gold >= 5 && gold < 20', vars)).toBe(true);
  });

  it('未声明变量读取时报错', () => {
    expect(() => evalExpression('unknown_var + 1', {})).toThrow(/未声明的变量: unknown_var/);
  });

  it('白名单全局对象可用（Math 等）', () => {
    expect(evalExpression('Math.max(3, 7)', {})).toBe(7);
    expect(evalExpression('parseInt("42")', {})).toBe(42);
  });

  it('三元条件表达式', () => {
    const vars: VarTable = { hp: 30 };
    expect(evalExpression('hp > 50 ? "良好" : "虚弱"', vars)).toBe('虚弱');
  });
});

describe('evalToText — 插值文本', () => {
  it('undefined/null 输出空字符串', () => {
    expect(evalToText('undefined', {})).toBe('');
    expect(evalToText('null', {})).toBe('');
  });

  it('数字与字符串转文本', () => {
    expect(evalToText('1 + 2', {})).toBe('3');
    expect(evalToText('"你好" + "世界"', {})).toBe('你好世界');
  });
});

describe('evalCondition', () => {
  it('真值转换', () => {
    expect(evalCondition('1 > 0', {})).toBe(true);
    expect(evalCondition('!flag', { flag: false })).toBe(true);
    expect(evalCondition('flag', { flag: false })).toBe(false);
  });
});

describe('execStatement — 逻辑语句', () => {
  it('let 声明写入变量表', () => {
    const vars: VarTable = {};
    execStatement('let gold = 10', vars);
    expect(vars.gold).toBe(10);
  });

  it('const 声明同 let', () => {
    const vars: VarTable = {};
    execStatement('const MAX = 100', vars);
    expect(vars.MAX).toBe(100);
  });

  it('重复声明报错', () => {
    const vars: VarTable = { gold: 1 };
    expect(() => execStatement('let gold = 2', vars)).toThrow(/重复声明/);
  });

  it('declareIfMissing 模式：已存在则保留现值（热重载语义）', () => {
    const vars: VarTable = { gold: 99 };
    execStatement('let gold = 10', vars, { declareIfMissing: true });
    expect(vars.gold).toBe(99);
    execStatement('let silver = 5', vars, { declareIfMissing: true });
    expect(vars.silver).toBe(5);
  });

  it('赋值与复合赋值', () => {
    const vars: VarTable = { gold: 10 };
    execStatement('gold = 20', vars);
    expect(vars.gold).toBe(20);
    execStatement('gold += 5', vars);
    expect(vars.gold).toBe(25);
    execStatement('gold--', vars);
    expect(vars.gold).toBe(24);
  });

  it('给未声明变量赋值时报错（不会沉默创建）', () => {
    expect(() => execStatement('ghost = 1', {})).toThrow(/不能给未声明的变量赋值/);
  });

  it('声明可引用已有变量', () => {
    const vars: VarTable = { base: 10 };
    execStatement('let doubled = base * 2', vars);
    expect(vars.doubled).toBe(20);
  });

  it('行尾 // 注释被忽略', () => {
    const vars: VarTable = {};
    execStatement('let x = 1 // 初始化', vars);
    expect(vars.x).toBe(1);
  });
});

describe('deterministicIndex — 确定性随机', () => {
  it('相同种子返回相同索引', () => {
    const a = deterministicIndex('scene#0#1', 5);
    const b = deterministicIndex('scene#0#1', 5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(5);
  });

  it('不同访问次数可产生不同索引（至少不越界）', () => {
    for (let visit = 1; visit <= 10; visit++) {
      const idx = deterministicIndex(`s#0#${visit}`, 3);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(3);
    }
  });
});
