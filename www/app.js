(async function(){
'use strict';
const Core=window.SeaBirds.Core;
await Core.init();
['equipment','diveEditor','diveExport','diveList','devices','settings','importExport'].forEach(name=>Core.feature(name)?.init());
const mobileSummary=document.querySelector('.mobile-stats-collapse');
if(mobileSummary){
  const mobileQuery=window.matchMedia('(max-width: 600px)');
  const syncSummaryDisclosure=()=>mobileSummary.toggleAttribute('open',!mobileQuery.matches);
  syncSummaryDisclosure();
  mobileQuery.addEventListener?.('change',syncSummaryDisclosure);
}
document.documentElement.dataset.seabirdsReady='true';
document.addEventListener('click',event=>{const nav=event.target.closest('[data-view]');if(nav)Core.navigate(nav.dataset.view);const target=event.target.closest('[data-goto]');if(target)Core.navigate(target.dataset.goto);if(event.target.closest('.menu'))document.querySelector('.sidebar')?.classList.toggle('open')});
Core.renderAll();
window.SeaBirdsSync?.init();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
