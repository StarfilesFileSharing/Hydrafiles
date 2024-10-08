import fs from 'fs'
import path from 'path'
import CONFIG from './config'

const DIRNAME = path.resolve()

function init (): void {
  if (!fs.existsSync(path.join(DIRNAME, 'files'))) fs.mkdirSync(path.join(DIRNAME, 'files'))
  if (!fs.existsSync(path.join(DIRNAME, 'nodes.json'))) fs.writeFileSync(path.join(DIRNAME, 'nodes.json'), JSON.stringify(CONFIG.bootstrap_nodes))
  if (CONFIG.upload_secret.length === 0) {
    CONFIG.upload_secret = Math.random().toString(36).substring(2, 15)
    fs.writeFileSync(path.join(DIRNAME, 'config.json'), JSON.stringify(CONFIG, null, 2))
  }
}

export default init
