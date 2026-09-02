import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { Worker } from 'worker_threads'
import * as os from 'os'
import * as bcrypt from 'bcryptjs'

/**
 * bcryptjs is pure JS and runs on the main thread; N concurrent login/register
 * hashes serialise there and stall every other request (measured: 30 parallel
 * logins -> trivial-endpoint p95 ~3s). This runs the same bcryptjs off the main
 * thread on a small worker_threads pool, so hashing no longer blocks the event
 * loop and N hashes run pool-wide in parallel.
 *
 * No new dependency (worker_threads is stdlib, bcryptjs unchanged). If workers
 * fail to spin up, every call transparently falls back to inline bcryptjs.
 */

const WORKER_SRC = `
const { parentPort } = require('worker_threads');
const bcrypt = require('bcryptjs');
parentPort.on('message', async (m) => {
  try {
    const out = m.op === 'hash'
      ? await bcrypt.hash(m.data, m.rounds)
      : await bcrypt.compare(m.data, m.hash);
    parentPort.postMessage({ id: m.id, ok: true, out });
  } catch (e) {
    parentPort.postMessage({ id: m.id, ok: false, err: String((e && e.message) || e) });
  }
});
`

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

@Injectable()
export class PasswordHasherService implements OnModuleDestroy {
  private readonly logger = new Logger(PasswordHasherService.name)
  private readonly workers: Worker[] = []
  private readonly pending = new Map<number, Pending>()
  private rr = 0
  private seq = 0
  private disabled = false

  constructor() {
    const size = Math.max(2, Math.min(4, os.cpus().length - 1))
    try {
      for (let i = 0; i < size; i++) this.workers.push(this.spawn())
      this.logger.log(`Password hasher pool started (${this.workers.length} workers)`)
    } catch (err) {
      this.disabled = true
      this.logger.warn(
        `Worker pool unavailable — falling back to inline bcryptjs: ${
          err instanceof Error ? err.message : err
        }`,
      )
    }
  }

  private spawn(): Worker {
    const w = new Worker(WORKER_SRC, { eval: true })
    w.on('message', (msg: { id: number; ok: boolean; out?: unknown; err?: string }) => {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.out)
      else p.reject(new Error(msg.err ?? 'hash worker error'))
    })
    w.on('error', (err) => {
      this.logger.error(`hash worker error: ${err.message}`)
      // Fail any in-flight jobs; keep the pool usable by replacing the worker.
      for (const [id, p] of this.pending) {
        this.pending.delete(id)
        p.reject(err)
      }
      const idx = this.workers.indexOf(w)
      if (idx !== -1 && !this.disabled) {
        try {
          this.workers[idx] = this.spawn()
        } catch {
          this.disabled = true
        }
      }
    })
    w.unref()
    return w
  }

  private run<T>(payload: Record<string, unknown>): Promise<T> {
    if (this.disabled || this.workers.length === 0) {
      return payload.op === 'hash'
        ? (bcrypt.hash(payload.data as string, payload.rounds as number) as Promise<T>)
        : (bcrypt.compare(payload.data as string, payload.hash as string) as Promise<T>)
    }
    const id = ++this.seq
    const worker = this.workers[this.rr++ % this.workers.length]
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ id, ...payload })
    })
  }

  hash(plain: string, rounds: number): Promise<string> {
    return this.run<string>({ op: 'hash', data: plain, rounds })
  }

  compare(plain: string, hash: string): Promise<boolean> {
    if (!hash) return Promise.resolve(false)
    return this.run<boolean>({ op: 'compare', data: plain, hash })
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate().catch(() => undefined)))
  }
}
