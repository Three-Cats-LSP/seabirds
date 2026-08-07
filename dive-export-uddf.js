(function(){
'use strict';
const NS=window.SeaBirds=window.SeaBirds||{},U=()=>NS.DiveExportUtils;
function build(dive){const x=U().xml,p=U().profile(dive),dateTime=`${dive.date||''}T${dive.time||'00:00'}:00`,waypoints=p.map(point=>`        <waypoint><divetime>${point.t.toFixed(1)}</divetime><depth>${point.depth.toFixed(2)}</depth>${Number.isFinite(point.temperature??point.temp)?`<temperature>${Number(point.temperature??point.temp).toFixed(2)}</temperature>`:''}${point.ndl!=null?`<ndl>${x(point.ndl)}</ndl>`:''}${point.tts!=null?`<tts>${x(point.tts)}</tts>`:''}</waypoint>`).join('\n');return`<?xml version="1.0" encoding="UTF-8"?>
<uddf version="3.2.0">
  <generator><name>SeaBirds</name><type>logbook</type><manufacturer>Three Cats LSP</manufacturer></generator>
  <dives>
    <dive id="${x(dive.id||'seabirds-dive')}">
      <informationbeforedive><datetime>${x(dateTime)}</datetime>${dive.diveNumber?`<divenumber>${x(dive.diveNumber)}</divenumber>`:''}<divemode>${x(dive.diveMode||'OC')}</divemode></informationbeforedive>
      <samples>
${waypoints}
      </samples>
      <informationafterdive><greatestdepth>${x(dive.depth||0)}</greatestdepth><diveduration>${x(dive.duration||0)}</diveduration><lowesttemperature>${x(dive.temp??'')}</lowesttemperature><notes>${x(dive.notes||'')}</notes></informationafterdive>
      <applicationdata><seabirds><title>${x(dive.site||'')}</title><location>${x(dive.location||'')}</location><buddy>${x(dive.buddy||'')}</buddy><style>${x(dive.diveStyle||'')}</style><gas>${x(dive.gasUsed||'')}</gas><tags>${x((dive.tags||[]).join(', '))}</tags><equipment>${x((dive.equipment||[]).join(', '))}</equipment></seabirds></applicationdata>
    </dive>
  </dives>
</uddf>
`}
async function save(dive){const text=build(dive);await U().saveBlob(new Blob([text],{type:'application/xml;charset=utf-8'}),U().safeName(dive,'uddf'))}
NS.DiveUddfExport={build,save};
})();
