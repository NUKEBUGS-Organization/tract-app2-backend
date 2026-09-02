#!/usr/bin/env node
/**
 * Maximum stress: crash hunt → heavy load → API integrity (sequential per round).
 * Usage: node scripts/qa-stress-heavy.mjs [rounds]
 */
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { openSync, closeSync, unlinkSync, writeFileSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rounds = Math.max(1, parseInt(process.argv[2] ?? '5', 10))
const LOCK = resolve(__dirname, '../.qa-stress.lock')

function acquireLock() {
  try {
    const fd = openSync(LOCK, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch {
    console.error('Another stress run is active (.qa-stress.lock). Wait for it to finish.')
    process.exit(1)
  }
}

function releaseLock() {
  try {
    unlinkSync(LOCK)
  } catch {
    /* ignore */
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: resolve(__dirname, '..') })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

async function main() {
  acquireLock()
  console.log(`\n💣 TRACT heavy stress — ${rounds} round(s)\n`)

  try {
    for (let i = 1; i <= rounds; i++) {
      console.log(`\n══════════ Round ${i}/${rounds} ══════════\n`)

      await run('node', ['scripts/qa-crash-test.mjs'])
      await run('node', ['scripts/qa-heavy-load.mjs', '3'])
      await new Promise((r) => setTimeout(r, 15_000))
      await run('node', ['scripts/qa-api-test.mjs'])

      if (i < rounds) await new Promise((r) => setTimeout(r, 5000))
    }

    console.log(`\n✅ All ${rounds} heavy stress round(s) passed\n`)
  } finally {
    releaseLock()
  }
}

main().catch((e) => {
  console.error('\n💥 Heavy stress failed:', e.message)
  process.exit(1)
})
