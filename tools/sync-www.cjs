const fs=require('fs');const path=require('path');const crypto=require('crypto');
const root=path.resolve(__dirname,'..'),www=path.join(root,'www');
const files=fs.readFileSync(path.join(root,'site-assets-manifest.txt'),'utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
fs.rmSync(www,{recursive:true,force:true});fs.mkdirSync(www,{recursive:true});
for(const file of files){const destination=path.join(www,file);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(root,file),destination);}
const cacheHash=crypto.createHash('sha256');
for(const file of files)if(file!=='sw.js')cacheHash.update(fs.readFileSync(path.join(www,file)));
const cacheRevision=cacheHash.digest('hex').slice(0,12);
const swPath=path.join(www,'sw.js');
fs.writeFileSync(swPath,fs.readFileSync(swPath,'utf8').replace(/const CACHE='[^']+';/,`const CACHE='seabirds-${cacheRevision}';`));
