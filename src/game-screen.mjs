#!/usr/bin/env node
/** Loopback-only display of Krillion's actual client using the bot's own guest seat. */
import {createServer} from 'node:http';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
const seatFile=path.resolve(process.argv[2]??'runs/current-seat.json');
const port=Number(process.argv[3]??8768),origin=`http://127.0.0.1:${port}`;
const cache=new Map();
const seat=()=>JSON.parse(fs.readFileSync(seatFile,'utf8'));
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const follow=`setInterval(async()=>{try{const s=await(await fetch('/watch-state',{cache:'no-store'})).json();if(s.code&&!location.pathname.endsWith('/'+s.code))location.replace('/party/'+s.code)}catch{}},1000);`;
async function upstream(url){
 if(cache.has(url))return cache.get(url);
 const r=await fetch('https://krillion.io'+url,{signal:AbortSignal.timeout(20000)});
 const type=r.headers.get('content-type')??'application/octet-stream';
 const body=Buffer.from(await r.arrayBuffer());
 const answer={status:r.status,type,body};
 if(r.ok&&!type.includes('text/html'))cache.set(url,answer);
 return answer;
}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 try{
  if(req.url==='/watch-state'){const s=seat();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:s.code,name:s.name}));return;}
  if(req.url?.startsWith('/api/party/token')){
   const s=seat();let exp=s.tokenExp;try{exp??=JSON.parse(Buffer.from(s.token.split('.')[1],'base64url')).exp;}catch{}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({token:s.token,exp:exp??Math.floor(Date.now()/1000)+86400}));return;
  }
  if(req.url==='/'||req.url==='/watch'){
   const s=seat();res.writeHead(302,{Location:'/party/'+s.code});res.end();return;
  }
  if(req.url?.startsWith('/upstream/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const r=await fetch('https://party.krillion.io'+req.url.slice('/upstream'.length),{method:req.method,headers:{'Content-Type':'application/json',Origin:'https://krillion.io'},body:req.method==='GET'?undefined:Buffer.concat(chunks),signal:AbortSignal.timeout(15000)});
   res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')??'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return;
  }
  const r=await upstream(req.url??'/');let body=r.body;
  if(r.type.includes('javascript'))body=Buffer.from(body.toString().replaceAll('https://party.krillion.io',origin+'/upstream'));
  if(r.type.includes('text/html')&&/^\/party\/[A-Z]{4}/.test(req.url??'')){
   const s=seat(),data={playerId:s.playerId,playerKey:s.playerKey,name:s.name,character:s.character??'krill'};
   const boot=`<script>sessionStorage.setItem('krillion-party-seat:'+${encode(s.code)},${encode(JSON.stringify(data))});localStorage.setItem('krillion-party-name',${encode(s.name)});${follow}</script>`;
   body=Buffer.from(body.toString().replace('<head>','<head>'+boot));
  }
  res.writeHead(r.status,{'Content-Type':r.type});res.end(body);
 }catch{res.writeHead(503,{'Content-Type':'text/html'});res.end(`<p>Waiting for the bot's game…</p><script>setTimeout(()=>location.reload(),1500)</script>`);}
});
server.on('upgrade',(req,socket,head)=>{
 if(!req.url?.startsWith('/upstream/rooms/')){socket.destroy();return;}
 const target=tls.connect({host:'party.krillion.io',port:443,servername:'party.krillion.io'},()=>{
  const headers={...req.headers,host:'party.krillion.io',origin:'https://krillion.io'};
  target.write(`GET ${req.url.slice('/upstream'.length)} HTTP/1.1\r\n`+Object.entries(headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
  if(head.length)target.write(head);socket.pipe(target);target.pipe(socket);
 });
 target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy());socket.on('close',()=>target.destroy());
});
server.listen(port,'127.0.0.1',()=>console.log(`Actual game display: ${origin}/watch`));
