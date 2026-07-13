/**
 * ProblemsPanel — 编辑器底部问题面板（Kiny Editor 风格）
 *
 * 集中显示解析错误 / 静态检查警告 / 运行时错误，
 * 并驱动编辑器头部的校验状态徽标。
 */

export interface Problem {
  severity: 'error' | 'warning';
  message: string;
}

export class ProblemsPanel {
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private chipEl: HTMLElement;
  private problems: Problem[] = [];

  constructor(listEl: HTMLElement, statusEl: HTMLElement, chipEl: HTMLElement) {
    this.listEl = listEl;
    this.statusEl = statusEl;
    this.chipEl = chipEl;
    this.render();
  }

  /** 覆盖设置（每次校验后调用） */
  public set(problems: Problem[]): void {
    this.problems = problems;
    this.render();
  }

  /** 追加一条运行时错误 */
  public pushRuntime(message: string): void {
    this.problems.push({ severity: 'error', message: `[运行时] ${message}` });
    this.render();
  }

  private render(): void {
    const errors = this.problems.filter((p) => p.severity === 'error').length;
    const warnings = this.problems.length - errors;

    // 状态徽标
    if (this.problems.length === 0) {
      this.chipEl.textContent = '✓ 校验通过';
      this.chipEl.className = 'status-chip ok';
      this.statusEl.textContent = '语法 + 语义校验通过';
    } else {
      const parts: string[] = [];
      if (errors) parts.push(`${errors} 错误`);
      if (warnings) parts.push(`${warnings} 警告`);
      this.chipEl.textContent = parts.join(' · ');
      this.chipEl.className = `status-chip ${errors ? 'err' : 'warn'}`;
      this.statusEl.textContent = parts.join('，');
    }

    // 问题列表
    this.listEl.innerHTML = '';
    if (this.problems.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'problem-item ok';
      ok.textContent = '无错误';
      this.listEl.appendChild(ok);
      return;
    }
    for (const p of this.problems) {
      const item = document.createElement('div');
      item.className = `problem-item ${p.severity}`;
      item.textContent = `${p.severity === 'error' ? '✕' : '⚠'} ${p.message}`;
      this.listEl.appendChild(item);
    }
  }
}
