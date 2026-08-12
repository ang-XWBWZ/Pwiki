export interface BackgroundQueueStatus {
  running: boolean;
  queued: number;
  completed: number;
  failed: number;
  lastError?: string;
}

/**
 * 单 worker、按 key 合并的后台队列。
 * 同一文件在 worker 处理前被连续编辑时，只保留最后一次任务。
 */
export class CoalescingBackgroundQueue<T> {
  private readonly pending = new Map<string, T>();
  private worker: Promise<void> | null = null;
  private active = false;
  private completed = 0;
  private failed = 0;
  private lastError?: string;

  constructor(private readonly handler: (task: T) => Promise<void>) {}

  enqueue(key: string, task: T): void {
    this.pending.set(key, task);
    this.start();
  }

  cancelPrefix(prefix: string): void {
    for (const key of this.pending.keys()) {
      if (key.startsWith(prefix)) this.pending.delete(key);
    }
  }

  status(): BackgroundQueueStatus {
    return {
      running: this.active || this.worker !== null,
      queued: this.pending.size,
      completed: this.completed,
      failed: this.failed,
      lastError: this.lastError,
    };
  }

  async drain(): Promise<void> {
    for (;;) {
      const current = this.worker;
      if (!current) return;
      await current;
    }
  }

  private start(): void {
    if (this.worker) return;
    this.worker = this.run().finally(() => {
      this.worker = null;
      if (this.pending.size > 0) this.start();
    });
  }

  private async run(): Promise<void> {
    // 让发起 CRUD 的当前事件循环先返回，避免后台计算抢在响应写出前开始。
    await new Promise<void>((resolve) => setImmediate(resolve));
    this.active = true;
    try {
      while (this.pending.size > 0) {
        const next = this.pending.entries().next().value as [string, T] | undefined;
        if (!next) break;
        const [key, task] = next;
        this.pending.delete(key);
        try {
          await this.handler(task);
          this.completed++;
        } catch (error) {
          this.failed++;
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      }
    } finally {
      this.active = false;
    }
  }
}
