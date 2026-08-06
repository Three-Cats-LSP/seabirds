(function(){
'use strict';
let auth,db,ref,divesRef,unsubs=[],timer,pullTimer,user=null,ready=false,writing=false;
const cfg=window.SEABIRDS_FIREBASE_CONFIG;

function status(text){window.SeaBirdsApp?.setSyncStatus({text,signedIn:!!user})}
function clone(value){return JSON.parse(JSON.stringify(value))}
function stamp(value){const n=Date.parse(value||'');return Number.isFinite(n)?n:0}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b)}
function safeId(id){return encodeURIComponent(String(id)).replace(/\./g,'%2E')}

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
  return {
    dives:diveSnap.docs.map(doc=>doc.data()),
    deletedDiveIds:meta.deletedDiveIds||[],gearLibrary:meta.gearLibrary||{},settings:meta.settings||{depth:'m',temp:'c'},
    revision:meta.revision||0,updatedAt:meta.updatedAt||''
  };
}

async function writeRemote(payload){
  if(!ref||!user)return;
  writing=true;
  try{
    await ref.set({schemaVersion:2,settings:payload.settings||{},gearLibrary:payload.gearLibrary||{},deletedDiveIds:payload.deletedDiveIds||[],revision:payload.revision||0,updatedAt:payload.updatedAt||new Date().toISOString(),serverUpdatedAt:firebase.firestore.FieldValue.serverTimestamp()});
    const operations=[];
    for(const dive of payload.dives||[])operations.push({type:'set',ref:divesRef.doc(safeId(dive.id)),data:clone(dive)});
    for(const id of payload.deletedDiveIds||[])operations.push({type:'delete',ref:divesRef.doc(safeId(id))});
    for(let offset=0;offset<operations.length;offset+=400){
      const batch=db.batch();
      for(const operation of operations.slice(offset,offset+400))operation.type==='set'?batch.set(operation.ref,operation.data):batch.delete(operation.ref);
      await batch.commit();
    }
  }finally{writing=false}
}

async function reconcile(){
  if(!ref||writing)return;
  try{
    const local=window.SeaBirdsApp.getState(),remote=await readRemote(),merged=mergeStates(local,remote);
    if(!same(local,merged))window.SeaBirdsApp.applyRemote(merged);
    if(!same(remote,merged))await writeRemote(merged);
    status(`Synced · ${user.displayName||user.email}`);
  }catch(error){status(`Sync error · ${error.message}`)}
}

function schedulePull(){clearTimeout(pullTimer);pullTimer=setTimeout(()=>{if(ready&&!writing)reconcile()},500)}

function init(){
  if(!cfg||!window.firebase){status('Cloud sync needs Firebase configuration');return}
  if(!firebase.apps.length)firebase.initializeApp(cfg);
  auth=firebase.auth();db=firebase.firestore();
  try{db.enablePersistence({synchronizeTabs:true}).catch(()=>{})}catch{}
  auth.onAuthStateChanged(async account=>{
    user=account;ready=false;unsubs.forEach(fn=>fn());unsubs=[];
    if(!account){ref=null;divesRef=null;status('Not signed in');return}
    ref=db.collection('users').doc(account.uid).collection('seabirds').doc('state');divesRef=ref.collection('dives');status('Connecting…');
    await reconcile();ready=true;
    unsubs=[ref.onSnapshot(schedulePull,error=>status(`Sync error · ${error.message}`)),divesRef.onSnapshot(schedulePull,error=>status(`Sync error · ${error.message}`))];
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
  }else await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
}

function queue(payload,now=false){
  if(!ref||!ready)return;
  clearTimeout(timer);timer=setTimeout(async()=>{status('Syncing…');try{await writeRemote(payload);status(`Synced · ${user.displayName||user.email}`)}catch(error){status(`Sync error · ${error.message}`)}},now?0:1200);
}
window.SeaBirdsSync={init,signIn,queue};
})();
