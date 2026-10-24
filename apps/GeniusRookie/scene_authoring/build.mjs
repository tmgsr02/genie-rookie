/** Anatomy Figure. Static art is precomputed; carriers reuse the kit at their rest positions. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const kit=path.resolve(here,'../../../server/explainer/vendor/anatomy/kit');
const out=path.resolve(here,'../src/ios/PipecatVoice/LessonScene');
const k=await import(path.join(kit,'iso-kit.mjs'));
const P=k.fitProjection(k.boxCorners({x:-155,y:-48,w:310,d:96,r:0},-15,130),720,360,{pad:36,azimuth:65,elevation:25});
P.scale *= 1.25;
let count=0;
const solid=(x,y,w,d,z,h,tone='mid',r=2)=>{count++;return k.solidSvg(k.slabOf({x,y,w,d,r},z,h,P,4,.7),{tone});};
let base='';
// Four elastomer feet, separate mounting shoes; all land on the bench base.
for(const x of [-132,114])for(const y of [-32,24]){base+=solid(x,y,18,12,-12,6,'lo');base+=solid(x-1,y-1,20,14,-6,3,'lo');}
base+=solid(-150,-43,300,86,-3,10,'lo',8);
base+=solid(-144,-37,288,74,7,2,'mid',6);
base+=k.lineSvg(k.planOutline({x:-138,y:-31,w:276,d:62,r:4},9,P),{tone:'faint'});
for(const x of [-136,131])for(const y of [-29,25]){
 base+=solid(x,y,5,5,9,1,'lo',1);
 base+=k.dotsSvg([k.iso([x+2.5,y+2.5,10],P)],{size:.7,tone:'hi'});
}
// Front engraved instrument plate, bounded rule lines, paired mounting screws.
base+=solid(-31,24,62,10,9,1,'lo',1);
for(let i=0;i<3;i++)base+=k.lineSvg(k.lineOnTop([-22,27+i*2],[18-i*6,27+i*2],10,P),{tone:'mid',free:true});
for(const x of [-27,27])base+=k.dotsSvg([k.iso([x,29,10],P)],{size:.65,tone:'mid'});
for(const y of [-19,12]){
 base+=solid(-20,y,40,8,9,5,'mid');
 base+=solid(-9,y+1,18,6,14,64,'mid');
 for(const x of [-16,12])base+=solid(x,y+2,4,4,14,1,'lo',.5);
}
// Back bearing, keeper plates and a front axle cap surround the visible beam.
base+=solid(-16,-22,32,7,73,20,'hi');
let beam=solid(-143,-8,286,16,78,8,'hi');
beam+=solid(-140,-6,280,12,86,1,'lo',1);
for(const x of [-143,137])beam+=solid(x,-10,6,20,77,12,'mid',1);
for(let n=1;n<=4;n++)for(const sign of [-1,1]){
 const x=sign*n*30;
 beam+=solid(x-2,-8,4,16,87,.7,'mid',.5);
 beam+=k.dotsSvg([k.iso([x,-4,88],P)],{size:.6,tone:'hi'});
}
// The zero marker is the single lit subject; notches are physical inlays.
beam+=solid(-2,-8,4,16,87,1,'hi',.5);
let front=solid(-14,13,28,7,73,20,'hi');
front+=solid(-8,20,16,3,78,10,'mid');
for(const x of [-10,7])front+=solid(x,20,3,3,88,3,'lo',.5);
const pivot=k.iso([0,0,82],P);
const svg=`<svg id="bench" viewBox="0 0 720 360" role="img" aria-labelledby="bench-title bench-desc"><title id="bench-title">Balance bench</title><desc id="bench-desc">Identical weight blocks on two movable carriers, measured in notches from the middle.</desc>${base}<g id="tilt"><g id="beam">${beam}</g><g id="left_carrier"></g><g id="right_carrier"></g></g><g id="pivot">${front}</g></svg>`;
fs.writeFileSync(path.join(out,'geometry.js'),`window.BENCH=${JSON.stringify({P,pivot,svg,staticParts:count})};\n`);
// A local classic script works in WKWebView file resources without module fetches.
fs.writeFileSync(path.join(out,'kit.js'),fs.readFileSync(path.join(kit,'iso-kit.mjs'),'utf8').replace(/^export /gm,''));
fs.writeFileSync(path.join(out,'iso.css'),fs.readFileSync(path.join(kit,'iso.css')));
console.log(`Balance Figure built: ${count} static solids plus 2 carriers (12 solids) and 4 weight blocks = ${count+16} purposeful solids.`);
