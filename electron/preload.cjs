const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('SeaBirdsDesktop',{
  saveJson:(filename,data)=>ipcRenderer.invoke('seabirds:save-json',{filename,data})
});
