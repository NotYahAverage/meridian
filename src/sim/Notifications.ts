export type Severity = 'info' | 'good' | 'warning' | 'critical';

export type NoticeIcon =
  | 'info'
  | 'power'
  | 'water'
  | 'sewage'
  | 'fire'
  | 'garbage'
  | 'money'
  | 'traffic'
  | 'milestone'
  | 'people'
  | 'road'
  | 'health'
  | 'police'
  | 'education'
  | 'happy'
  | 'factory'
  | 'build'
  | 'weather'
  | 'metro'
  | 'research';

export interface Notice {
  id: number;
  tick: number;
  severity: Severity;
  icon: NoticeIcon;
  title: string;
  text: string;
  x?: number;
  z?: number;
}

/** Sim-side message feed with per-topic cooldowns so the player isn't spammed. */
export class Notifications {
  readonly recent: Notice[] = [];
  private pending: Notice[] = [];
  private cooldown = new Map<string, number>();
  private nextId = 1;

  push(tick: number, n: Omit<Notice, 'id' | 'tick'>, key?: string, cooldownTicks = 24 * 20): Notice | null {
    if (key) {
      const until = this.cooldown.get(key);
      if (until !== undefined && tick < until) return null;
      this.cooldown.set(key, tick + cooldownTicks);
    }
    const notice: Notice = { ...n, id: this.nextId++, tick };
    this.recent.unshift(notice);
    if (this.recent.length > 60) this.recent.pop();
    this.pending.push(notice);
    return notice;
  }

  /** Notices created since the last call. */
  drain(): Notice[] {
    const p = this.pending;
    this.pending = [];
    return p;
  }

  resetCooldown(key: string): void {
    this.cooldown.delete(key);
  }

  clear(): void {
    this.recent.length = 0;
    this.pending = [];
    this.cooldown.clear();
  }
}
