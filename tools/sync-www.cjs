const fs=require('fs');const path=require('path');
const root=path.resolve(__dirname,'..'),www=path.join(root,'www');
fs.mkdirSync(www,{recursive:true});
for(const file of ['index.html','app.css','seabirds.css','app.js','sync.js','plot-core.js','manifest.webmanifest','icon.svg','firebase-config.js','sw.js'])fs.copyFileSync(path.join(root,file),path.join(www,file));
const src=path.join(root,'vendor','firebase'),dest=path.join(www,'vendor','firebase');fs.mkdirSync(dest,{recursive:true});
for(const file of fs.readdirSync(src))fs.copyFileSync(path.join(src,file),path.join(dest,file));
