import { existsSync } from 'fs'
import { resolve } from 'path'
import { config as loadDotenv } from 'dotenv'

/** Ensure `.env` overrides existing process env (aligns local secrets with committed `.env.example`). */
const envPath = resolve(process.cwd(), '.env')
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, override: true })
}
