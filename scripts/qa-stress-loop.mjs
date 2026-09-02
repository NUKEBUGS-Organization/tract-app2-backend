#!/usr/bin/env node
/** Run crash + API QA in a loop. Usage: node scripts/qa-stress-loop.mjs [rounds] */
import { spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rounds = Math.max(1, parseInt(process.argv[2] ?? '5', 10))

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: resolve(__dirname, '..') })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
  })
}

async function main() {
  console.log(`\n🔁 Stress loop — ${rounds} round(s)\n`)
  for (let i = 1; i <= rounds; i++) {
    console.log(`\n══════════ Round ${i}/${rounds} ══════════\n`)
    await run('node', ['scripts/qa-crash-test.mjs'])
    await new Promise((r) => setTimeout(r, 3000))
    await run('node', ['scripts/qa-api-test.mjs'])
    if (i < rounds) await new Promise((r) => setTimeout(r, 5000))
  }
  console.log(`\n✅ All ${rounds} round(s) passed\n`)
}

main().catch((e) => {
  console.error('\n💥 Stress loop failed:', e.message)
  process.exit(1)
})
