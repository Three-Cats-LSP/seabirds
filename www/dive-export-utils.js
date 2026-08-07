(function(){
'use strict';
const NS=window.SeaBirds=window.SeaBirds||{};
function safeName(dive,extension){const base=(dive.site||'SeaBirds dive').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()||'SeaBirds dive';return`${base}_${dive.date||'undated'}.${extension}`}
function xml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]))}
function profile(dive){return(dive.profile||[]).map(point=>({...point,t:Number(point.t??point.time??0),depth:Number(point.depth??0)})).filter(point=>Number.isFinite(point.t)&&Number.isFinite(point.depth))}
async function saveBlob(blob,filename){const file=new File([blob],filename,{type:blob.type});if(/Android/i.test(navigator.userAgent)&&navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:filename});return}const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
NS.DiveExportUtils={safeName,xml,profile,saveBlob};
})();
