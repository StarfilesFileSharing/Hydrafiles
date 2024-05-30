const http = require('http');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');

/* TODO ////////////////////////////////////////
- Node health check
- File checksum validation
- File content-length validation
// TODO //////////////////////////////////////*/


// CONFIG /////////////////////////////////////
const PORT = 3000;
const HOSTNAME = '127.0.0.1';
const MAX_STORAGE = 100 * 1024 * 1024 * 1024; // 100GB
const PERMA_FILES = []; // File hashes to never delete when storage limit is reached
const BURN_RATE = 0.1; // Percentage of files to purge when storage limit is reached
// CONFIG /////////////////////////////////////


// ADVANCED CONFIG ////////////////////////////
const METADATA_ENDPOINT = 'https://api2.starfiles.co/file/';
const BOOTSTRAP_NODES = [
	{"host": "hydrafiles.com", "http": true, "dns": false, "cf": false},
	{"host": "starfilesdl.com", "http": true, "dns": false, "cf": false},
];
const NODES_PATH = path.join(__dirname, 'nodes.json');
// ADVANCED CONFIG ////////////////////////////


// INITIALISATION /////////////////////////////
if(!fs.existsSync(path.join(__dirname, 'files'))) fs.mkdirSync(path.join(__dirname, 'files'));
if(!fs.existsSync(path.join(__dirname, 'nodes.json'))) fs.writeFileSync(path.join(__dirname, 'nodes.json'), JSON.stringify(BOOTSTRAP_NODES));
// INITIALISATION /////////////////////////////


let usedStorage = 0;
const download_count = {};

const isIp = (host) => host.match(/(?:\d+\.){3}\d+(?::\d+)?/) !== null;

const server = http.createServer(async (req, res) => {
    console.log(req.url)
    if (req.url === '/'){
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=604800' });
        fs.createReadStream('index.html').pipe(res);

    }else if(req.url === '/nodes'){
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600'});
        fs.createReadStream(NODES_PATH).pipe(res);

    }else if(req.url.startsWith('/announce')){
        const params = Object.fromEntries(new URLSearchParams(req.url.split('?')[1]));
        const host = params['host'];
        if(!host) return res.end('Invalid request\n');
        
        const response = await fetch(`${isIp(host) ? 'http' : 'https'}://${host}/download/04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f/c8fcb43d6e46`);
        const arrayBuffer = await response.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        if(hash === '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f'){
            const nodes = JSON.parse(fs.readFileSync(NODES_PATH));
            if(!nodes.find(node => node.host === host)){
                nodes.push({host, http: true, dns: false, cf: false});
                fs.writeFileSync(NODES_PATH, JSON.stringify(nodes));
            }
            res.end('Announced\n');
        }else res.end('Invalid request\n');

    }else if(req.url.startsWith('/download/')){
        const fileHash = req.url.split('/')[2];
        const fileId = req.url.split('/')[3];
        
        const filePath = path.join(__dirname, 'files', fileHash);

        const headers = {
            'Content-Type': 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000',
        }

        if(fileId){
            const response = await fetch(`${METADATA_ENDPOINT}${fileId}`);
            if(response.status === 200){
                const metadata = await response.json();
                headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(metadata.name).replace(/%20/g, ' ')}"`;
                headers['Content-Length'] = metadata.size;
            }
        }

        if(fs.existsSync(filePath)){
            res.writeHead(200, headers);
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            download_count[fileHash] = download_count[fileHash] ? download_count[fileHash] + 1 : 1;
        }else{
            const nodes = JSON.parse(fs.readFileSync(NODES_PATH));
            for(const node of nodes){
                if(node.http){
                    if(node.host === `${req.headers.host}`) continue;

                    const response = await fetch(`${isIp(node.host) ? 'http' : 'https'}://${node.host}/download/${fileHash}${fileId ? `/${fileId}` : ''}`);
                    if(response.status === 200){
                        if(!headers['Content-Length']) headers['Content-Length'] = response.headers.get('content-length');
                        if(!headers['Content-Disposition']) headers['Content-Disposition'] = `attachment; filename="${response.headers.get('content-disposition').split('=')[1].replace(/"/g, '')}"`;
                        
                        res.writeHead(200, headers);
                        response.body.pipe(res);

                        let remainingSpace = MAX_STORAGE - usedStorage;
                        if(response.headers.get('content-length') > remainingSpace){
                            const files = fs.readdirSync(path.join(__dirname, 'files'));
                            for (const file of files) {
                                if(PERMA_FILES.includes(file) || Object.keys(download_count).includes(file)) continue;

                                const stats = fs.statSync(path.join(__dirname, 'files', file));
                                fs.unlinkSync(path.join(__dirname, 'files', file));
                                usedStorage -= stats.size;
                                remainingSpace += stats.size;

                                if (response.headers.get('content-length') <= remainingSpace) break;
                            }
                            if (response.headers.get('content-length') > remainingSpace) {
                                const sorted = Object.entries(download_count).sort(([,a],[,b]) => a-b).filter(([file]) => !PERMA_FILES.includes(file))
                                for (let i = 0; i < sorted.length / (BURN_RATE*100); i++) {
                                    const stats = fs.statSync(path.join(__dirname, 'files', sorted[i][0]));
                                    fs.unlinkSync(path.join(__dirname, 'files', sorted[i][0]));
                                    usedStorage -= stats.size;
                                }
                            }
                        }
                        response.body.pipe(fs.createWriteStream(filePath));
                        usedStorage += parseInt(response.headers.get('content-length'));
                        return;
                    }
                }
            }
            
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('File not found\n');
        }

    }else{
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found\n');
    }
});

server.listen(PORT, HOSTNAME, async () => {
    console.log(`Server running at http://${HOSTNAME}:${PORT}/`);

    // Save self to nodes.json
    const nodes = JSON.parse(fs.readFileSync(NODES_PATH));
    if(!nodes.find(node => node.host === HOSTNAME || node.host === `${HOSTNAME}:${PORT}`)){
        nodes.push({host: HOSTNAME + (PORT != 80 ? `:${PORT}` : ''), http: true, dns: false, cf: false});
        fs.writeFileSync(NODES_PATH, JSON.stringify(nodes));
    }

    // Call all nodes and pull their /nodes
    for(const node of nodes){
        if(node.http){
            if(node.host === `${HOSTNAME}:${PORT}`) continue;
            const response = await fetch(`${isIp(node.host) ? 'http' : 'https'}://${node.host}/nodes`);
            if(response.status === 200){
                const remoteNodes = await response.json();
                for(const remoteNode of remoteNodes){
                    if(!nodes.find(node => node.host === remoteNode.host)){
                        const response = await fetch(`${isIp(remoteNode.host) ? 'http' : 'https'}://${remoteNode.host}/download/04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f/c8fcb43d6e46`);
                        const arrayBuffer = await response.arrayBuffer();
                        const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                        if(hash === '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f'){
                            await fetch(`${isIp(remoteNode.host) ? 'http' : 'https'}://${remoteNode.host}/announce?host=${HOSTNAME + (PORT != 80 ? `:${PORT}` : '')}`);
                            nodes.push(remoteNode);
                        }
                    }
                }
            }
        }
    }

    // Calculate used storage
    const filesPath = path.join(__dirname, 'files');
    if(fs.existsSync(filesPath)){
        const files = fs.readdirSync(filesPath);
        for(const file of files){
            const stats = fs.statSync(path.join(filesPath, file));
            usedStorage += stats.size;
        }
    }
    console.log(`Files dir size: ${usedStorage} bytes`);

    await fetch(`${isIp(HOSTNAME) ? 'http' : 'https'}://${HOSTNAME + (PORT != 80 ? `:${PORT}` : '')}/download/04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f/c8fcb43d6e46`);
    if(!fs.existsSync(path.join(__dirname, 'files', '04aa07009174edc6f03224f003a435bcdc9033d2c52348f3a35fbb342ea82f6f')))
        console.error('Download test failed')
    else{
        console.log('Announcing to nodes');
        const nodes = JSON.parse(fs.readFileSync(NODES_PATH));
        for(const node of nodes){
            if(node.http){
                if(node.host === `${HOSTNAME}:${PORT}` || node.host === HOSTNAME) continue;
                await fetch(`${isIp(node.host) ? 'http' : 'https'}://${node.host}/announce?host=${HOSTNAME + (PORT != 80 ? `:${PORT}` : '')}`);
            }
        }
    }
});
