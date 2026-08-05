const {app,BrowserWindow,shell}=require('electron');
const http=require('http');
const fs=require('fs');
const path=require('path');

const webRoot=path.resolve(__dirname,'..','www');
const mimeTypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
let localServer;

function startLocalServer(){
  return new Promise((resolve,reject)=>{
    localServer=http.createServer((request,response)=>{
      try{
        const requestPath=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
        const relativePath=requestPath==='/'?'index.html':requestPath.replace(/^\/+/, '');
        const filePath=path.resolve(webRoot,relativePath);
        if(filePath!==webRoot&&!filePath.startsWith(webRoot+path.sep)){
          response.writeHead(403);response.end('Forbidden');return;
        }
        fs.readFile(filePath,(error,data)=>{
          if(error){response.writeHead(error.code==='ENOENT'?404:500);response.end('Not found');return}
          response.writeHead(200,{'Content-Type':mimeTypes[path.extname(filePath).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
          response.end(data);
        });
      }catch{response.writeHead(400);response.end('Bad request')}
    });
    localServer.once('error',reject);
    localServer.listen(0,'127.0.0.1',()=>resolve(localServer.address().port));
  });
}

function createWindow(port){
  const win=new BrowserWindow({width:1440,height:920,minWidth:900,minHeight:640,backgroundColor:'#f4f7f5',title:'SeaBirds',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.removeMenu();
  win.loadURL(`http://localhost:${port}/index.html`);
  win.webContents.setWindowOpenHandler(({url})=>{
    const isFirebaseAuth=url==='about:blank'||/^https:\/\/(accounts\.google\.com|seabirds-threecats-lsp\.firebaseapp\.com)\//.test(url);
    if(isFirebaseAuth)return{action:'allow',overrideBrowserWindowOptions:{width:520,height:720,parent:win,modal:false,autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}};
    if(/^https?:/.test(url))shell.openExternal(url);
    return{action:'deny'};
  });
}
app.whenReady().then(async()=>{const port=await startLocalServer();createWindow(port);app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow(port)})});
app.on('before-quit',()=>localServer?.close());
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
