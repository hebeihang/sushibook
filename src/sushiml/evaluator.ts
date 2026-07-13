/**
 * SushiML 表达式求值器
 *
 * 参照 Kiny 的「逻辑即 JavaScript」设计：不发明表达式语言，
 * 直接把 JS 表达式/语句嵌入故事文本。
 *
 * 沙盒机制：Proxy + with——所有标识符读写都被 Proxy 拦截到变量表，
 * 未声明变量读取时报错（不会沉默返回 undefined），
 * 赋值未声明变量时报错（不会沉默创建全局变量）。
 */

/** 允许在表达式中直接使用的 JS 全局对象 */
const GLOBAL_ALLOWLIST: Record<string, unknown> = {
  Math,
  JSON,
  String,
  Number,
  Boolean,
  Array,
  Object,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  undefined: undefined,
  NaN,
  Infinity,
};

/** 变量表类型 */
export type VarTable = Record<string, unknown>;

/**
 * 构建 with() 作用域代理
 * @param vars - 变量表
 * @param declareMode - true 时允许对新变量赋值（用于 let/const 声明）
 */
function buildScopeProxy(vars: VarTable, declareMode: boolean): object {
  return new Proxy(vars, {
    // with() 会对每个标识符查询 has —— 返回 true 把所有标识符都拦下来
    has: () => true,
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (typeof key !== 'string') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, key)) return target[key];
      if (Object.prototype.hasOwnProperty.call(GLOBAL_ALLOWLIST, key)) {
        return GLOBAL_ALLOWLIST[key];
      }
      throw new Error(`未声明的变量: ${key}`);
    },
    set: (target, key, value) => {
      if (typeof key !== 'string') return false;
      if (!declareMode && !Object.prototype.hasOwnProperty.call(target, key)) {
        throw new Error(`不能给未声明的变量赋值: ${key}（先用 ~ let ${key} = … 声明）`);
      }
      target[key] = value;
      return true;
    },
  });
}

/**
 * 求值一个 JS 表达式
 * @throws 语法错误 / 未声明变量
 */
export function evalExpression(expr: string, vars: VarTable): unknown {
  const code = expr.trim();
  if (!code) return '';
  const scope = buildScopeProxy(vars, false);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('__scope', `with(__scope){ return (${code}); }`);
  return fn(scope);
}

/**
 * 求值表达式并转为插值文本
 * undefined / null → 空字符串（Kiny §7.5 语义）
 */
export function evalToText(expr: string, vars: VarTable): string {
  const result = evalExpression(expr, vars);
  if (result === undefined || result === null) return '';
  return String(result);
}

/**
 * 求值条件表达式（转 boolean）
 */
export function evalCondition(expr: string, vars: VarTable): boolean {
  return Boolean(evalExpression(expr, vars));
}

/** 声明语句的解析结果 */
const DECL_RE = /^(let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*([\s\S]+)$/;

/**
 * 执行一条 `~` 逻辑语句
 *
 * 支持：
 * - `let x = expr` / `const x = expr` 声明（重复声明报错，除非 declareIfMissing）
 * - 任意 JS 赋值/调用语句（`x = 5`、`x += 1`、`x--`、`arr.push(1)`）
 *
 * @param declareIfMissing - 热重载模式：已存在的声明跳过（保留当前值）
 */
export function execStatement(
  stmt: string,
  vars: VarTable,
  options: { declareIfMissing?: boolean } = {}
): void {
  const code = stripLineComment(stmt.trim());
  if (!code) return;

  const decl = code.match(DECL_RE);
  if (decl) {
    const name = decl[2];
    const exists = Object.prototype.hasOwnProperty.call(vars, name);
    if (exists) {
      if (options.declareIfMissing) return; // 热重载：保留现值
      throw new Error(`变量重复声明: ${name}`);
    }
    vars[name] = evalExpression(decl[3], vars);
    return;
  }

  // 普通语句：在 with 作用域内执行（赋值经 Proxy set 校验）
  const scope = buildScopeProxy(vars, false);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('__scope', `with(__scope){ ${code}; }`);
  fn(scope);
}

/** 去掉行尾 // 注释（忽略字符串内的 //，简易实现：只在无引号行生效） */
function stripLineComment(code: string): string {
  const idx = code.indexOf('//');
  if (idx === -1) return code;
  // 若 // 前有未闭合引号则不裁剪（避免切断字符串字面量）
  const before = code.slice(0, idx);
  const quotes = (before.match(/["'`]/g) || []).length;
  if (quotes % 2 !== 0) return code;
  return before.trimEnd();
}

/**
 * 确定性伪随机：用于 shuffle 变体
 * 同一 (场景, 调用点, 访问次数) 恒定返回同一索引
 */
export function deterministicIndex(seedText: string, itemCount: number): number {
  if (itemCount <= 0) return 0;
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // xorshift 混淆
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return Math.abs(h) % itemCount;
}
