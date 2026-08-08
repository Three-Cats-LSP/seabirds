(function(global){
'use strict';

// Profile tissue calculator extracted from the validated LSP+ ZHL-16C engine.
// SeaBirds uses the same coefficients and Schreiner loading model, adapted to
// sampled dive-computer profiles instead of planned depth segments.
const N2=[
  [5.0,1.2599,0.5050],[8.0,1.0000,0.6514],[12.5,0.8618,0.7222],[18.5,0.7562,0.7825],
  [27.0,0.6200,0.8126],[38.3,0.5043,0.8434],[54.3,0.4410,0.8693],[77.0,0.4000,0.8910],
  [109.0,0.3750,0.9092],[146.0,0.3500,0.9222],[187.0,0.3295,0.9319],[239.0,0.3065,0.9403],
  [305.0,0.2835,0.9477],[390.0,0.2610,0.9544],[498.0,0.2480,0.9602],[635.0,0.2327,0.9653]
];
const HE_HT=[1.88,3.02,4.72,6.99,10.21,14.48,20.53,29.11,41.20,55.19,70.69,90.34,115.29,147.42,188.24,240.03];
const HE_AB=[
  [1.7424,0.4245],[1.3830,0.5747],[1.1919,0.6527],[1.0458,0.7223],[0.9220,0.7582],[0.8205,0.7957],
  [0.7305,0.8279],[0.6502,0.8553],[0.5950,0.8757],[0.5545,0.8903],[0.5333,0.8997],[0.5189,0.9073],
  [0.5181,0.9122],[0.5176,0.9171],[0.5172,0.9217],[0.5119,0.9267]
];
const SURFACE=1.01325,WATER_VAPOR=0.0627,BAR_PER_METRE=0.1;

function initTissues(){const pN2=(SURFACE-WATER_VAPOR)*0.7902;return N2.map(()=>({pN2,pHe:0}))}
function ambient(depth){return SURFACE+Math.max(0,+depth||0)*BAR_PER_METRE}
function parseGas(value,fallback){
  if(value&&typeof value==='object'){
    const o2=+(value.o2??value.oxygen),he=+(value.he??value.helium);
    if(Number.isFinite(o2)||Number.isFinite(he))return{o2:Math.max(0,o2||0)/100,he:Math.max(0,he||0)/100};
  }
  const match=String(value||'').match(/(\d+(?:\.\d+)?)\s*(?:\/|%\s*O2(?:\s*\/\s*)?)(\d+(?:\.\d+)?)?/i);
  if(match)return{o2:Math.max(0,+match[1])/100,he:Math.max(0,+(match[2]||0))/100};
  return fallback||{o2:0.21,he:0};
}
function inspired(depth,gas,setpoint){
  const dry=Math.max(0,ambient(depth)-WATER_VAPOR),n2=Math.max(0,1-gas.o2-gas.he),inert=n2+gas.he;
  if(Number.isFinite(setpoint)&&setpoint>0&&inert>0){
    const available=Math.max(0,dry-setpoint);
    return{n2:available*n2/inert,he:available*gas.he/inert};
  }
  return{n2:dry*n2,he:dry*gas.he};
}
function schreinerTarget(p0,start,end,halfTime,time){
  if(!(time>0))return p0;
  const k=Math.LN2/halfTime,rate=(end-start)/time;
  return start+rate*(time-1/k)-(start-p0-rate/k)*Math.exp(-k*time);
}
function loadSegment(tissues,fromDepth,toDepth,time,gas,setpoint){
  if(!(time>0))return tissues;
  const from=inspired(fromDepth,gas,setpoint),to=inspired(toDepth,gas,setpoint);
  return tissues.map((tissue,index)=>({
    pN2:schreinerTarget(tissue.pN2,from.n2,to.n2,N2[index][0],time),
    pHe:schreinerTarget(tissue.pHe||0,from.he,to.he,HE_HT[index],time)
  }));
}
function gf99(tissues,depth){
  const pAmb=ambient(depth);let maximum=0;
  tissues.forEach((tissue,index)=>{
    const pN2=tissue.pN2||0,pHe=tissue.pHe||0,total=pN2+pHe;if(!(total>0))return;
    let a,b;
    if(pHe>0){a=(pN2*N2[index][1]+pHe*HE_AB[index][0])/total;b=(pN2*N2[index][2]+pHe*HE_AB[index][1])/total}
    else{a=N2[index][1];b=N2[index][2]}
    const mValue=a+pAmb/b,margin=mValue-pAmb;
    if(margin>0)maximum=Math.max(maximum,(total-pAmb)/margin*100);
  });
  return Math.max(0,maximum);
}
function annotate(profile,options){
  if(!Array.isArray(profile)||profile.length<2)return profile||[];
  // A Shearwater OC sample may expose a measured PPO2 value.  That is not a
  // CCR setpoint and must not be used to reduce inert-gas loading.  Doing so
  // produces an artificially low (often invisible) GF99 trace for air/Nx
  // dives.  Only honour setpoint data when the caller explicitly identifies a
  // closed-circuit profile.
  const closedCircuit=options?.closedCircuit===true;
  let tissues=initTissues(),previousTime=0,previousDepth=0,gas=parseGas(options?.gas),setpoint=null;
  return profile.map(point=>{
    const time=+(point.t??point.time),depth=Math.max(0,+point.depth||0);
    if(!Number.isFinite(time))return{...point};
    gas=parseGas(point.gas,gas);
    const nextSetpoint=closedCircuit?+(point.setpoint??point.ppo2):NaN;
    if(Number.isFinite(nextSetpoint)&&nextSetpoint>0)setpoint=nextSetpoint;
    const duration=Math.max(0,time-previousTime);
    tissues=loadSegment(tissues,previousDepth,depth,duration,gas,setpoint);
    previousTime=time;previousDepth=depth;
    return{...point,gf99:+gf99(tissues,depth).toFixed(1),gf99Calculated:true};
  });
}

global.SeaBirdsZhlProfile={annotate,initTissues,loadSegment,gf99};
})(typeof window!=='undefined'?window:globalThis);
