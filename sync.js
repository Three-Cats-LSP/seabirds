(function(){
'use strict';
let auth,db,ref,divesRef,unsubs=[],timer,pullTimer,user=null,ready=false,writing=false,syncedDiveVersions={};
const cfg=window.SEABIRDS_FIREBASE_CONFIG;
const query=new URLSearchParams(location.search),desktopAuthPort=query.get('desktop-auth')||sessionStorage.getItem('seabirds_desktop_auth_port'),desktopAuthState=query.get('desktop-state')||sessionStorage.getItem('seabirds_desktop_auth_state');

function status(text){window.SeaBirdsApp?.setSyncStatus({text,signedIn:!!user})}
function clone(value){return JSON.parse(JSON.stringify(value))}
function stamp(value){const n=Date.parse(value||'');return Number.isFinite(n)?n:0}
function safeId(id){return encodeURIComponent(String(id)).replace(/\./g,'%2E')}
function versionKey(uid){return`seabirds_synced_dives_${uid}`}
function loadVersions(){try{return JSON.parse(localStorage.getItem(versionKey(user.uid))||'{}')}catch{return{}}}
function saveVersions(){if(user)localStorage.setItem(versionKey(user.uid),JSON.stringify(syncedDiveVersions))}

function mergeStates(local,remote){
  local=local||{};remote=remote||{};
  const deleted=[...new Set([...(local.deletedDiveIds||[]),...(remote.deletedDiveIds||[])])];
  const deletedSet=new Set(deleted);
  const dives=new Map();
  for(const dive of remote.dives||[])dives.set(dive.id,clone(dive));
  for(const dive of local.dives||[]){
    const current=dives.get(dive.id);
    if(!current||stamp(dive.updatedAt)>=stamp(current.updatedAt))dives.set(dive.id,clone(dive));
  }
  for(const id of deletedSet)dives.delete(id);
  const localNewer=stamp(local.updatedAt)>=stamp(remote.updatedAt);
  const gearLibrary=clone(remote.gearLibrary||{});
  for(const [category,items] of Object.entries(local.gearLibrary||{}))gearLibrary[category]=[...new Set([...(gearLibrary[category]||[]),...items])];
  return {
    ...clone(remote),...clone(localNewer?local:remote),
    dives:[...dives.values()].sort((a,b)=>String(a.id).localeCompare(String(b.id))),deletedDiveIds:deleted.sort(),gearLibrary,
    settings:clone((localNewer?local.settings:remote.settings)||local.settings||remote.settings||{depth:'m',temp:'c'}),
    revision:Math.max(local.revision||0,remote.revision||0),
    updatedAt:new Date(Math.max(stamp(local.updatedAt),stamp(remote.updatedAt))||Date.now()).toISOString()
  };
}

async function readRemote(){
  const [metaSnap,diveSnap]=await Promise.all([ref.get(),divesRef.get()]);
  const meta=metaSnap.exists?metaSnap.data():{};
  if(diveSnap.empty&&meta.payload)return clone(meta.payload);
  syncedDiveVersions={};diveSnap.docs.forEach(doc=>{const dive=doc.data();syncedDiveVersions[dive.id]=dive.updatedAt||''});saveVersions();
  return {
    dives:diveSnap.docs.map(doc=>doc.data()),
    deletedDiveIds:meta.deletedDiveIds||[],gearLibrary:meta.gearLibrary||{},settings:meta.settings||{depth:'m',temp:'c'},
    revision:meta.revision||0,updatedAt:meta.updatedAt||''
  };
}

async function writeRemote(payload,forceAll=false){
  if(!ref||!user)return;
  writing=true;
  try{
    const operations=[];
    for(const dive of payload.dives||[])if(forceAll||syncedDiveVersions[dive.id]!==String(dive.updatedAt||''))operations.push({type:'set',ref:divesRef.doc(safeId(dive.id)),data:clone(dive),id:dive.id,version:String(dive.updatedAt||'')});
    for(const id of payload.deletedDiveIds||[])operations.push({type:'delete',ref:divesRef.doc(safeId(id))});
    for(let offset=0;offset<operations.length;offset+=400){
      const batch=db.batch();
      for(const operation of operations.slice(offset,offset+400))operation.type==='set'?batch.set(operation.ref,operation.data):batch.delete(operation.ref);
      await batch.commit();
      for(const operation of operations.slice(offset,offset+400))if(operation.type==='set')syncedDiveVersions[operation.id]=operation.version;else delete syncedDiveVersions[decodeURIComponent(operation.ref.id)];
    }
    saveVersions();
    await ref.set({schemaVersion:2,settings:payload.settings||{},gearLibrary:payload.gearLibrary||{},deletedDiveIds:payload.deletedDiveIds||[],revision:payload.revision||0,updatedAt:payload.updatedAt||new Date().toISOString(),serverUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
  }finally{writing=false}
}

async function reconcile(){
  if(!ref||writing)return;
  try{
    const metaSnap=await ref.get(),meta=metaSnap.exists?metaSnap.data():null,localMeta=window.SeaBirdsApp.getSyncMeta();
    if(meta&&(localMeta.revision||0)===(meta.revision||0)&&stamp(localMeta.updatedAt)===stamp(meta.updatedAt)){status(`Synced · ${user.displayName||user.email}`);return}
    const local=window.SeaBirdsApp.getState();
    if(!meta){await writeRemote(local,true);status(`Synced · ${user.displayName||user.email}`);return}
    const localRevision=local.revision||0,remoteRevision=meta.revision||0,remoteNewer=remoteRevision>localRevision||(remoteRevision===localRevision&&stamp(meta.updatedAt)>stamp(local.updatedAt));
    if(remoteNewer){const remote=await readRemote(),merged=mergeStates(local,remote);window.SeaBirdsApp.applyRemote(merged);const remoteIds=new Map((remote.dives||[]).map(dive=>[dive.id,dive.updatedAt||''])),hasLocalChanges=(local.dives||[]).some(dive=>remoteIds.get(dive.id)!==(dive.updatedAt||''))||(local.deletedDiveIds||[]).some(id=>!(remote.deletedDiveIds||[]).includes(id));if(hasLocalChanges)await writeRemote(merged)}
    else await writeRemote(local);
    status(`Synced · ${user.displayName||user.email}`);
  }catch(error){status(`Sync error · ${error.message}`);window.SeaBirdsShowError?.(error.message||String(error),'Cloud sync error')}
}

function schedulePull(){clearTimeout(pullTimer);pullTimer=setTimeout(()=>{if(ready&&!writing)reconcile()},500)}

function init(){
  if(!cfg||!window.firebase){status('Cloud sync needs Firebase configuration');return}
  if(!firebase.apps.length)firebase.initializeApp(cfg);
  auth=firebase.auth();db=firebase.firestore();
  if(desktopAuthPort&&desktopAuthState&&!window.__TAURI__){
    const panel=document.createElement('div'),button=document.createElement('button'),title=document.createElement('b'),note=document.createElement('p');
    panel.style.cssText='position:fixed;inset:0;z-index:10000;background:#f4f7f5;display:grid;place-content:center;text-align:center;font:18px system-ui;color:#062c36;padding:24px';
    title.textContent='Continue SeaBirds desktop sign-in';note.textContent='Google authentication opens here in your regular browser, then returns securely to the SeaBirds app.';
    button.textContent='Sign in with Google';button.style.cssText='justify-self:center;padding:14px 22px;border:0;border-radius:10px;background:#ef6b57;color:white;font-weight:700;cursor:pointer';button.onclick=()=>signIn().catch(error=>{note.textContent=error.message;window.SeaBirdsShowError?.(error.message||String(error),'Google sign-in failed')});
    panel.append(title,note,button);document.body.append(panel);button.hidden=true;note.textContent='Checking Google sign-inâ€¦';
    auth.getRedirectResult().then(result=>{
      const credential=result&&firebase.auth.GoogleAuthProvider.credentialFromResult(result);
      if(credential?.idToken){sessionStorage.removeItem('seabirds_desktop_auth_port');sessionStorage.removeItem('seabirds_desktop_auth_state');location.replace(`http://localhost:${desktopAuthPort}/auth-callback?id_token=${encodeURIComponent(credential.idToken)}&state=${encodeURIComponent(desktopAuthState)}`);return}
      note.textContent='Google authentication opens in this regular browser tab, then returns securely to the SeaBirds app.';button.hidden=false;
    }).catch(error=>{note.textContent=error.message;button.hidden=false;window.SeaBirdsShowError?.(error.message||String(error),'Google sign-in failed')});
  }
  try{db.enablePersistence({synchronizeTabs:false}).catch(()=>{})}catch{}
  auth.onAuthStateChanged(async account=>{
    user=account;ready=false;unsubs.forEach(fn=>fn());unsubs=[];
    if(!account){ref=null;divesRef=null;status('Not signed in');return}
    ref=db.collection('users').doc(account.uid).collection('seabirds').doc('state');divesRef=ref.collection('dives');syncedDiveVersions=loadVersions();status(`Signed in · ${account.displayName||account.email}`);ready=true;
    setTimeout(()=>reconcile(),0);
    unsubs=[ref.onSnapshot(snapshot=>{if(writing||!snapshot.exists)return;const remote=snapshot.data()||{},local=window.SeaBirdsApp.getSyncMeta(),remoteRevision=remote.revision||0,localRevision=local.revision||0;if(remoteRevision>localRevision||(remoteRevision===localRevision&&stamp(remote.updatedAt)>stamp(local.updatedAt)))schedulePull()},error=>status(`Sync error · ${error.message}`))];
  });
}

async function signIn(){
  if(!auth)throw new Error('Cloud sync is not configured');
  if(user){await auth.signOut();return}
  const native=window.Capacitor?.isNativePlatform?.()&&window.Capacitor?.Plugins?.FirebaseAuthentication;
  if(native){
    const result=await window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle({skipNativeAuth:true});
    const token=result?.credential?.idToken;
    if(!token)throw new Error('Google did not return an ID token');
    await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
  }else if(window.__TAURI__?.core?.invoke){
    const invoke=window.__TAURI__.core.invoke;
    await invoke('begin_google_login');status('Complete sign-in in your browserâ€¦');
    const deadline=Date.now()+300000;
    while(Date.now()<deadline){
      const token=await invoke('take_google_token');
      if(token){await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));return}
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw new Error('Google sign-in timed out. Please try again.');
  }else if(desktopAuthPort&&desktopAuthState){
    if(!/^\d{2,5}$/.test(desktopAuthPort)||+desktopAuthPort>65535||!/^[0-9a-f-]{36}$/i.test(desktopAuthState))throw new Error('Invalid SeaBirds desktop sign-in request.');
    sessionStorage.setItem('seabirds_desktop_auth_port',desktopAuthPort);sessionStorage.setItem('seabirds_desktop_auth_state',desktopAuthState);
    await auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
  }else await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
}

function queue(payload,now=false){
  if(!ref||!ready)return;
  clearTimeout(timer);timer=setTimeout(async()=>{status('Syncing…');try{await writeRemote(payload);status(`Synced · ${user.displayName||user.email}`)}catch(error){status(`Sync error · ${error.message}`);window.SeaBirdsShowError?.(error.message||String(error),'Cloud sync error')}},now?0:1200);
}
window.SeaBirdsSync={init,signIn,queue};
})();
