const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..'),www=path.join(root,'www');
fs.mkdirSync(www,{recursive:true});
for(const file of ['index.html','app.css','seabirds.css','app.js','storage.js','shearwater.js','sync.js','update.js','app-version.js','version.json','plot-core.js','manifest.webmanifest','icon.svg','icon-192.png','icon-512.png','seabirds-app-icon.png','shearwater-logo-stacked.png','firebase-config.js','sw.js','tab-profile.png','tab-notes.png','tab-equipment.png','tab-information.png'])fs.copyFileSync(path.join(root,file),path.join(www,file));
const src=path.join(root,'vendor','firebase'),dest=path.join(www,'vendor','firebase');fs.mkdirSync(dest,{recursive:true});
for(const file of fs.readdirSync(src))fs.copyFileSync(path.join(src,file),path.join(dest,file));
