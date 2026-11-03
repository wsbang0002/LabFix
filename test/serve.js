// Local static fixture only. Browser tests intercept the API; never calls external services.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const html=await readFile(new URL('../index.html',import.meta.url));
http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}else{res.writeHead(404);res.end();}}).listen(4173,'127.0.0.1');
