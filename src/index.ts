import http from 'http'
import fs from 'fs'
import path from 'path'
import formidable from 'formidable'
import CONFIG from './config'
import init from './init'
import Nodes, { Node, nodeFrom } from './nodes'
import FileManager, { Metadata, File } from './file'
import { isIp, isPrivateIP, promiseWithTimeout, estimateNumberOfHopsWithRandomAndCertainty } from './utils'

// TODO: IDEA: HydraTorrent - New Github repo - "Hydrafiles + WebTorrent Compatibility Layer" - Hydrafiles noes can optionally run HydraTorrent to seed files via webtorrent
// Change index hash from sha256 to infohash, then allow nodes to leech files from webtorrent + normal torrent
// HydraTorrent is a WebTorrent hybrid client that plugs into Hydrafiles
// Then send a PR to WebTorrent for it to connect to the Hydrafiles network as default webseeds
// HydraTorrent is 2-way, allowing for fetching-seeding files via both hydrafiles and torrent
//
// ALSO THIS ALLOWS FOR PLAUSIBLE DENIABLITY FOR NORMAL TORRENTS
// Torrent clients can connect to the Hydrafiles network and claim they dont host any of the files they seed
// bittorrent to http proxy
// starfiles.co would use webtorrent to download files

init()

const DIRNAME = path.resolve()
const NODES_PATH = path.join(DIRNAME, 'nodes.json')
const fileTable: { [key: string]: { id?: string, name?: string } } = JSON.parse(fs.readFileSync(path.join(DIRNAME, 'filetable.json')).toString())
const nodesManager = new Nodes()
const fileManager = new FileManager(nodesManager)

const setFiletable = (hash: string, id: string | undefined, name: string | undefined): void => {
  if (typeof fileTable[hash] === 'undefined') fileTable[hash] = {}
  if (typeof id !== 'undefined') fileTable[hash].id = id
  if (typeof name !== 'undefined') fileTable[hash].name = name
  fs.writeFileSync(path.join(DIRNAME, 'filetable.json'), JSON.stringify(fileTable, null, 2))
}

const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>): Promise<void> => {
  try {
    if (req.url === '/' || req.url === null || typeof req.url === 'undefined') {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=604800' })
      fs.createReadStream('public/index.html').pipe(res)
    } else if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: true }))
    } else if (req.url === '/nodes' || req.url.startsWith('/nodes?')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' })
      res.end(JSON.stringify(await nodesManager.getValidNodes()))
    } else if (req.url.startsWith('/announce')) {
      const params = Object.fromEntries(new URLSearchParams(req.url.split('?')[1]))
      const host = params.host

      const nodes = nodesManager.getNodes()
      if (nodes.find((node) => node.host === host) != null) {
        res.end('Already known\n')
        return
      }

      if (await nodesManager.downloadFromNode(nodeFrom(host), '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f') !== false) {
        nodesManager.nodes.push({ host, http: true, dns: false, cf: false, hits: 0, rejects: 0, bytes: 0, duration: 0 })
        fs.writeFileSync(NODES_PATH, JSON.stringify(nodes))
        res.end('Announced\n')
      } else res.end('Invalid request\n')
    } else if (req.url?.startsWith('/download/')) {
      const hash = req.url.split('/')[2]
      const fileId = req.url.split('/')[3]

      const headers: { [key: string]: string } = {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
      }

      let file: File | false = false
      try {
        file = await promiseWithTimeout(fileManager.getFile(hash, fileId), CONFIG.timeout)
      } catch (error) {
        console.error(error)
      }

      if (file === false) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('404 File Not Found\n')
        return
      }

      headers['Signal-Strength'] = String(file.signal)
      console.log(hash, 'Signal Strength:', file.signal, estimateNumberOfHopsWithRandomAndCertainty(file.signal))

      let name: string | undefined
      if (typeof fileId !== 'undefined') {
        const response = await fetch(`${CONFIG.metadata_endpoint}${fileId}`)
        if (response.status === 200) name = (await response.json() as Metadata).name
      }

      name = typeof name !== 'undefined' ? name : (file.name ?? fileTable[hash]?.name)
      headers['Content-Length'] = file.file.length.toString()
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(name ?? 'File').replace(/%20/g, ' ')}"`

      setFiletable(hash, fileId, name)

      res.writeHead(200, headers)
      res.end(file.file)
    } else if (req.url === '/upload') {
      const uploadSecret = req.headers['x-hydra-upload-secret']
      if (uploadSecret !== CONFIG.upload_secret) {
        res.writeHead(401, { 'Content-Type': 'text/plain' })
        res.end('401 Unauthorized\n')
        return
      }

      const form = formidable({})
      form.parse(req, (err: unknown, fields: formidable.Fields, files: formidable.Files) => {
        if (err !== undefined && err !== null) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('500 Internal Server Error\n')
          return
        }

        if (typeof fields.hash === 'undefined' || typeof files.file === 'undefined') {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('400 Bad Request\n')
          return
        }

        const hash = fields.hash[0]
        const file = files.file[0]

        setFiletable(hash, undefined, file.originalFilename as string)

        console.log('Uploading', hash)

        if (fs.existsSync(path.join(DIRNAME, 'files', hash))) {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('200 OK\n')
          return
        }

        if (!CONFIG.perma_files.includes(hash)) CONFIG.perma_files.push(hash)

        fs.writeFileSync(path.join(DIRNAME, 'config.json'), JSON.stringify(CONFIG, null, 2))

        fileManager.cacheFile(hash, fs.readFileSync(file.filepath))

        res.writeHead(201, { 'Content-Type': 'text/plain' })
        res.end('200 OK\n')
      })
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404 Page Not Found\n')
    }
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')
  }
}

const server = http.createServer((req, res) => {
  console.log('Request Received:', req.url)

  void handleRequest(req, res)
})

server.listen(CONFIG.port, CONFIG.hostname, (): void => {
  console.log(`Server running at ${CONFIG.public_hostname}/`)

  const handleListen = async (): Promise<void> => {
    // Call all nodes and pull their /nodes
    const nodes = nodesManager.getNodes({ includeSelf: false })
    for (const node of nodes) {
      try {
        if (node.http) {
          console.log(`Fetching nodes from ${node.host}/nodes`)
          const response = await fetch(`${node.host}/nodes`)
          if (response.status === 200) {
            const remoteNodes = await response.json() as Node[]
            for (const remoteNode of remoteNodes) {
              if (typeof nodes.find((node: { host: string }) => node.host === remoteNode.host) === 'undefined' && (await nodesManager.downloadFromNode(remoteNode, '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f') !== false)) nodesManager.nodes.push(remoteNode)
            }
          }
        }
      } catch (e) {
        console.error(`    Failed to fetch nodes from ${node.host}/nodes`)
      }
    }

    fs.writeFileSync(NODES_PATH, JSON.stringify(nodes))

    console.log('Testing network connection')
    const file = await nodesManager.getFile('04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f')
    if (file === false) console.error('Download test failed, cannot connect to network')
    else {
      console.log('Connected to network')
      if (isIp(CONFIG.public_hostname) && isPrivateIP(CONFIG.public_hostname)) console.error('Public hostname is a private IP address, cannot announce to other nodes')
      else {
        console.log(`Testing downloads ${CONFIG.public_hostname}/download/04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f`)

        const response = await nodesManager.downloadFromNode(nodeFrom(`${CONFIG.public_hostname}`), '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f')
        console.log(`Download ${response === false ? 'Failed' : 'Succeeded'}`)

        // Save self to nodes.json
        if (nodes.find((node: { host: string }) => node.host === CONFIG.public_hostname) == null) {
          nodesManager.nodes.push({ host: CONFIG.public_hostname, http: true, dns: false, cf: false, hits: 0, rejects: 0, bytes: 0, duration: 0 })
          fs.writeFileSync(NODES_PATH, JSON.stringify(nodes))
        }

        console.log('Announcing to nodes')
        await nodesManager.announce()
      }
    }
  }
  handleListen().catch((e) => console.error(e))
})