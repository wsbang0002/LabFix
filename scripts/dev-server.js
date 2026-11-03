import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from '../api/analyze.js';
const html=await readFile(new URL('../index.html',import.meta.url));
const server=http.createServer(async(req,res)=>{
 if(req.url==='/api/analyze') {
  res.status=n=>{res.statusCode=n;return res;};
  res.json=value=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));return res;};
  if(req.method==='POST') {
   try {
    const parts=[];let size=0;
    for await(const chunk of req) {size+=chunk.length;if(size>65536){res.status(413).json({success:false,error:'Request too large'});return;}parts.push(chunk);}
    req.body=JSON.parse(Buffer.concat(parts).toString('utf8'));
   }catch {res.status(400).json({success:false,error:'Invalid JSON'});return;}
  }
  return handler(req,res);
 }
 if(req.url!=='/') {res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('LabFix local development server started'));
