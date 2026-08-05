const {app,BrowserWindow,shell}=require('electron');
const path=require('path');
function createWindow(){
  const win=new BrowserWindow({width:1440,height:920,minWidth:900,minHeight:640,backgroundColor:'#f4f7f5',title:'SeaBirds',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.removeMenu();
  win.loadFile(path.join(__dirname,'..','www','index.html'));
  win.webContents.setWindowOpenHandler(({url})=>{if(/^https?:/.test(url))shell.openExternal(url);return{action:'deny'}});
}
app.whenReady().then(()=>{createWindow();app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)createWindow()})});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
