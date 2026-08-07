(function(){
'use strict';
const NS=window.SeaBirds=window.SeaBirds||{},Core=NS.Core;
function current(){return Core.feature('diveEditor')?.getDraft()}
async function run(format){const dive=current();if(!dive)return;const exporters={text:NS.DiveTextExport,pdf:NS.DivePdfExport,uddf:NS.DiveUddfExport};document.getElementById('diveExportDialog').close();try{await exporters[format].save(Core.clone(dive));Core.notify(`Saved as ${format.toUpperCase()}`)}catch(error){Core.showError(error?.message||String(error),'Export failed')}}
function init(){document.getElementById('openDiveExport').onclick=()=>document.getElementById('diveExportDialog').showModal();document.querySelectorAll('[data-dive-export]').forEach(button=>button.onclick=()=>run(button.dataset.diveExport))}
Core.registerFeature('diveExport',{init,run});
})();
