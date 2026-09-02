/** Runs before e2e suite loads AppModule — must run before ConfigModule reads env. */
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(__dirname, '../.env') })
