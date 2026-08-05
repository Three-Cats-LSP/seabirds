const CACHE='seabirds-v14';
const ASSETS=['./','index.html','app.css','seabirds.css','app.js','shearwater.js','sync.js','plot-core.js','manifest.webmanifest','icon.svg','firebase-config.js','vendor/firebase/firebase-app-compat.js','vendor/firebase/firebase-auth-compat.js','vendor/firebase/firebase-firestore-compat.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request)));
});
