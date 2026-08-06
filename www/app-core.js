(function(){
'use strict';
const NS=window.SeaBirds=window.SeaBirds||{};
const gearCatalog={
 'Core Dive Gear':['BCD / wing','Regulator','Fins','Mask','Wetsuit / Drysuit','Weights & belt','Dive computer','Backup computer'],
 'Safety & Accessories':['SMB + spool','Backup SMB','Torch','Backup torch','Knife / cutter','Wet notes'],
 'Tanks & Gas':['Cylinder(s)','Stage / deco bottles','O2 analyzer'],
 'Camera & Photo':['Camera housing','Camera body','Strobes','Video lights']
};
const clone=value=>value==null?value:(typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)));
const defaultGearLibrary=()=>clone(gearCatalog);
const defaultSettings=()=>({depth:'m',temp:'c',volume:'l',weight:'kg',pressure:'bar',dateFormat:'ymd',timeFormat:'12'});
const normalizeState=(value={})=>Object.assign({dives:[],deletedDiveIds:[],gearLibrary:defaultGearLibrary(),revision:0,updatedAt:''},value,{settings:Object.assign(defaultSettings(),value.settings||{})});
const sampleProfile=(depth,duration)=>[{t:0,depth:0,type:'surface'},{t:2,depth,type:'descent'},{t:Math.max(3,duration-5),depth,type:'bottom'},{t:duration-2,depth:5,type:'ascent'},{t:duration,depth:0,type:'surface'}];
const demo=[
 {id:'demo-1',date:'2026-07-28',site:'Blue Corner',location:'Palau',depth:31.8,duration:52,temp:28,buddy:'Maya',notes:'Strong current, grey reef sharks.',profile:sampleProfile(31.8,52)},
 {id:'demo-2',date:'2026-07-26',site:'German Channel',location:'Palau',depth:24.3,duration:61,temp:28,buddy:'Maya',notes:'Manta cleaning station.',profile:sampleProfile(24.3,61)},
 {id:'demo-3',date:'2026-06-15',site:'USS Liberty',location:'Tulamben, Bali',depth:27.1,duration:48,temp:27,buddy:'Ken',notes:'Early morning wreck dive.',profile:sampleProfile(27.1,48)}
];
let state=normalizeState(),ready=false;
const renderers=new Set(),features=new Map();
function esc(value){const node=document.createElement('div');node.textContent=value??'';return node.innerHTML}
function converted(value){return state.settings.depth==='ft'?value*3.28084:value}
function temperature(value){return state.settings.temp==='f'?value*9/5+32:value}
function formatGas(gas){const [o2,he]=String(gas).split('/').map(Number);if(o2===21&&!he)return'Air';if(!he&&o2>21)return`EAN${o2}`;if(o2&&he)return`Tx ${o2}/${he}`;return gas}
function formatDate(value){const d=new Date(value+'T12:00:00'),year=d.getFullYear(),month=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0'),format=state.settings.dateFormat||'ymd',numeric=format==='dmy'?`${day}-${month}-${year}`:format==='mdy'?`${month}-${day}-${year}`:`${year}-${month}-${day}`;return{day:d.getDate(),month:d.toLocaleDateString(undefined,{month:'short'}).toUpperCase(),ymd:numeric,full:numeric}}
function showError(message,title='Something went wrong'){const dialog=document.getElementById('errorDialog');if(!dialog)return;document.getElementById('errorDialogTitle').textContent=title;document.getElementById('errorDialogMessage').textContent=message||'An unexpected error occurred.';if(!dialog.open)dialog.showModal()}
function notify(message){if(/\b(error|failed|failure|cannot|can't|could not|unable|unavailable|not found|already exists|required|invalid|rejected|timed out|timeout|blocked)\b/i.test(message)){showError(message);return}const node=document.getElementById('toast');if(!node)return;node.textContent=message;node.classList.add('show');setTimeout(()=>node.classList.remove('show'),2600)}
function renderAll(){renderers.forEach(renderer=>{try{renderer(state)}catch(error){console.error(error);showError(error.message||String(error))}})}
async function save(sync=true){state.updatedAt=new Date().toISOString();state.revision=(state.revision||0)+1;await window.SeaBirdsStorage.save(state);if(sync)window.SeaBirdsSync?.queue(clone(state))}
async function commit(mutator,options={}){const {sync=true,render=true}=options;const next=clone(state);await mutator(next);state=normalizeState(next);await save(sync);if(render)renderAll();return state}
function navigate(id){document.querySelectorAll('.view').forEach(node=>node.classList.toggle('active',node.id===id));document.querySelectorAll('.nav').forEach(node=>node.classList.toggle('active',node.dataset.view===id));const name=document.getElementById('viewName');if(name)name.textContent=({dashboard:'Overview',dives:'Dive log',devices:'Devices',settings:'Settings'})[id];document.querySelector('.sidebar')?.classList.remove('open')}
function setSyncStatus(status){document.getElementById('syncStatus').textContent=status.text;document.getElementById('googleSignIn').textContent=status.signedIn?'Sign out':'Sign in with Google';document.getElementById('storageMode').textContent=status.signedIn?'Cloud sync':'Local-first';document.getElementById('storageDetail').textContent=status.signedIn?status.text:'Sign in to sync across devices'}
async function init(){if(ready)return state;state=normalizeState(await window.SeaBirdsStorage.load());localStorage.removeItem('seabirds_state_v1');window.units=state.settings.depth==='ft'?'imperial':'metric';window._lspCssVar=(name,fallback)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim()||fallback;ready=true;return state}
function registerFeature(name,api){features.set(name,api);return api}
const Core=NS.Core={init,getState:()=>state,getStateSnapshot:()=>clone(state),commit,renderAll,navigate,registerRenderer:fn=>(renderers.add(fn),fn),registerFeature,feature:name=>features.get(name),clone,esc,converted,temperature,formatGas,formatDate,showError,notify,normalizeState,defaultGearLibrary,sampleProfile,demo};
window.SeaBirdsShowError=showError;
window.SeaBirdsApp={getState:()=>clone(state),getSyncMeta:()=>({revision:state.revision||0,updatedAt:state.updatedAt||''}),applyRemote:async remote=>{state=normalizeState(remote);await window.SeaBirdsStorage.save(state);renderAll()},setSyncStatus};
window.addEventListener('unhandledrejection',event=>{event.preventDefault();showError(event.reason?.message||String(event.reason||'An unexpected error occurred.'))});
window.addEventListener('error',event=>showError(event.message||'An unexpected error occurred.'));
})();
