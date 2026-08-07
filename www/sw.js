const CACHE='seabirds-fc2e2b6b9740';
const ASSETS=['./','index.html','app.css','seabirds.css','app.js','app-core.js','dive-list.js','dive-editor.js','dive-export-utils.js','dive-export-text.js','dive-export-pdf.js','dive-export-uddf.js','dive-export-ui.js','equipment.js','devices-ui.js','settings-ui.js','import-export.js','storage.js','shearwater.js','sync.js','update.js','app-version.js','version.json','zhl-profile-engine.js','plot-core.js','manifest.webmanifest','icon-192.png','icon-512.png','seabirds-app-icon.png','shearwater-logo-stacked.png','tab-profile.png','tab-notes.png','tab-equipment.png','tab-information.png','tab-export.png','app-threecats.png','app-dplanner.png','app-tviewer.png','app-getinwater.png','firebase-config.js','vendor/jspdf.umd.min.js','vendor/firebase/firebase-app-compat.js','vendor/firebase/firebase-auth-compat.js','vendor/firebase/firebase-firestore-compat.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request)));
});
