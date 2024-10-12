import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export interface Config {
  port: number
  hostname: string
  max_cache: number
  perma_files: string[]
  burn_rate: number
  metadata_endpoint: string
  bootstrap_nodes: string[]
  public_hostname: string
  prefer_node: 'FASTEST' | 'LEAST_USED' | 'RANDOM' | 'HIGHEST_HITRATE'
  upload_secret: string
  memory_threshold: number
  memory_threshold_reached_wait: number
  timeout: number
  log_level: 'verbose' | 'normal'
  summary_speed: number
  compare_speed: number
  backfill: boolean
  compare_nodes: boolean
  compare_files: boolean
  s3_access_key_id: string
  s3_secret_access_key: string
  s3_endpoint: string
  cache_s3: boolean
}

const DIRNAME = path.dirname(fileURLToPath(import.meta.url))

const defaultConfig: Config = JSON.parse(fs.readFileSync(path.join(DIRNAME, '../config.default.json')).toString())

const getConfig = (config: Partial<Config> = {}): Config => {
  return {
    port: config?.port ?? defaultConfig.port,
    hostname: config?.hostname ?? defaultConfig.hostname,
    max_cache: config?.max_cache ?? defaultConfig.max_cache,
    perma_files: config?.perma_files ?? defaultConfig.perma_files,
    burn_rate: config?.burn_rate ?? defaultConfig.burn_rate,
    metadata_endpoint: config?.metadata_endpoint ?? defaultConfig.metadata_endpoint,
    bootstrap_nodes: config?.bootstrap_nodes ?? defaultConfig.bootstrap_nodes,
    public_hostname: config?.public_hostname ?? defaultConfig.public_hostname,
    prefer_node: config?.prefer_node ?? defaultConfig.prefer_node,
    upload_secret: config?.upload_secret ?? defaultConfig.upload_secret,
    memory_threshold: config?.memory_threshold ?? defaultConfig.memory_threshold,
    memory_threshold_reached_wait: config?.memory_threshold_reached_wait ?? defaultConfig.memory_threshold_reached_wait,
    timeout: config?.timeout ?? defaultConfig.timeout,
    log_level: config?.log_level ?? defaultConfig.log_level,
    summary_speed: config?.summary_speed ?? defaultConfig.summary_speed,
    compare_speed: config?.compare_speed ?? defaultConfig.compare_speed,
    backfill: config?.backfill ?? defaultConfig.backfill,
    compare_nodes: config?.compare_nodes ?? defaultConfig.compare_nodes,
    compare_files: config?.compare_files ?? defaultConfig.compare_files,
    s3_access_key_id: config?.s3_access_key_id ?? defaultConfig.s3_access_key_id,
    s3_secret_access_key: config?.s3_secret_access_key ?? defaultConfig.s3_secret_access_key,
    s3_endpoint: config?.s3_endpoint ?? defaultConfig.s3_endpoint,
    cache_s3: config?.cache_s3 ?? defaultConfig.cache_s3
  }
}

export default getConfig
