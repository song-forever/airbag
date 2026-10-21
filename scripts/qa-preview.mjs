import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const fixture=fileURLToPath(new URL('../tests/browser/',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.wasm':'application/wasm','.tflite':'application/octet-stream'};
const port=Number(process.env.QA_PORT||4318);
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(!['GET','HEAD'].includes(req.method))throw Error('Not found');
  const base=url.pathname.startsWith('/airbag/')?root:fixture;
  const relative=decodeURIComponent(url.pathname.startsWith('/airbag/')?url.pathname.slice(8):url.pathname.slice(1))||'index.html';
  const file=path.resolve(base,relative);
  if(!file.startsWith(path.resolve(base)+path.sep)||relative.split('/').includes('..'))throw Error('Not found');
  const info=await stat(file);if(!info.isFile())throw Error('Not found');
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');
  if(req.method==='HEAD'){res.end();return;}
  if(file===path.join(root,'index.html')){
   const html=await readFile(file,'utf8');res.end(html.replace('<head>','<head><script src="/mock-provider.js"></script><script src="/mock-camera.js"></script>'));
  }else createReadStream(file).pipe(res);
 }catch{res.statusCode=404;res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Local QA only: http://localhost:'+port+'/'));
