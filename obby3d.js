// Maths Obby — 3D course renderer (three.js). Exposes window.Track3D with the same
// interface as the 2D track: build, jump, fall, resize, stop.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";

const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- palettes ---------- */
const PAL = {
  lava:   { sky:0x3b1530, fog:0x5a2232, top:["#6e6e7c","#5e5e6b","#7d7d8b"], dirt:["#45454f","#3a3a43","#52525e"], haz:["#ff5a1f","#ff7a1f","#ffb01f","#ff3d14"], hazGlow:true, deco:"rocks" },
  ice:    { sky:0x9fd8ff, fog:0xcfeeff, top:["#f4fbff","#e2f4ff","#ffffff"], dirt:["#8fd3f5","#7ac6ec","#a8def8"], haz:["#1f7fd6","#2b8de6","#63b6ff","#1a6cbd"], hazGlow:false, deco:"clouds" },
  jungle: { sky:0x7fd3ff, fog:0xbfe9ff, top:["#56b33a","#4a9e31","#68c44a"], dirt:["#8a5a33","#7a4e2b","#a87445"], haz:["#4f7a1f","#5c8a24","#7fae2f","#3f6518"], hazGlow:false, deco:"trees" },
  space:  { sky:0x0b0b26, fog:0x140f36, top:["#c0c8d4","#aeb6c2","#d0d6e0"], dirt:["#5c6675","#4e5866","#6a7484"], haz:["#2a1050","#3a1a6a","#8a4dff","#1c0a3a"], hazGlow:true, deco:"space" }
};

function rng(seed){let a=seed|0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

function pixTex(draw){
  const c=document.createElement("canvas");c.width=c.height=16;
  draw(c.getContext("2d"));
  const t=new THREE.CanvasTexture(c);
  t.magFilter=THREE.NearestFilter;t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;
  t.colorSpace=THREE.SRGBColorSpace;
  return t;
}
function speckle(g,cols,r,y0=0,y1=16){
  for(let y=y0;y<y1;y++)for(let x=0;x<16;x++){g.fillStyle=cols[r()<.55?0:1+Math.floor(r()*(cols.length-1))];g.fillRect(x,y,1,1)}
}

/* ---------- state ---------- */
let pr=1,frames=0,acc=0,renderer=null,scene=null,camera=null,clock=null,raf=0,host=null,ro=null,running=false;
let plats=[],coins=[],flags=[],hazTex=null,avatar=null,limbs={},shadow=null,parts=null,partData=[];
let anim=null,blinkUntil=0,landT=-9,curIdx=0,curPal=PAL.jungle;
const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(),tmpV=new THREE.Vector3(),tmpM=new THREE.Matrix4();

const P=i=>new THREE.Vector3(plats[i].x,plats[i].top,plats[i].z);

function ensureRenderer(){
  if(renderer)return;
  const dpr=window.devicePixelRatio||1;
  renderer=new THREE.WebGLRenderer({antialias:dpr<1.5,powerPreference:"default"});
  pr=Math.min(dpr,1.75);renderer.setPixelRatio(pr);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.domElement.addEventListener("webglcontextlost",e=>{e.preventDefault();Track3D.broken=true});
  clock=new THREE.Clock();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&clock)clock.getDelta()});
}

function disposeScene(){
  if(!scene)return;
  scene.traverse(o=>{
    if(o.geometry)o.geometry.dispose();
    const m=o.material;if(m)(Array.isArray(m)?m:[m]).forEach(mm=>{if(mm.map)mm.map.dispose();mm.dispose()});
  });
  scene=null;
}

/* ---------- avatar ---------- */
function box(w,h,d,color,x=0,y=0,z=0){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color}));
  m.position.set(x,y,z);return m;
}
function buildAvatar(skin,hat){
  const g=new THREE.Group();
  const body=new THREE.Group();g.add(body);
  // legs (pivot at hip)
  const legL=new THREE.Group(),legR=new THREE.Group();
  legL.position.set(-.14,.5,0);legR.position.set(.14,.5,0);
  legL.add(box(.24,.5,.28,skin.pants,0,-.25,0));legR.add(box(.24,.5,.28,skin.pants,0,-.25,0));
  body.add(legL,legR);
  // torso
  body.add(box(.56,.62,.32,skin.shirt,0,.81,0));
  // arms (pivot at shoulder)
  const armL=new THREE.Group(),armR=new THREE.Group();
  armL.position.set(-.39,1.08,0);armR.position.set(.39,1.08,0);
  armL.add(box(.2,.58,.24,skin.shirt,0,-.25,0),box(.2,.12,.24,skin.head,0,-.6,0));
  armR.add(box(.2,.58,.24,skin.shirt,0,-.25,0),box(.2,.12,.24,skin.head,0,-.6,0));
  body.add(armL,armR);
  // head
  const head=new THREE.Group();head.position.set(0,1.42,0);
  head.add(box(.6,.6,.6,skin.head));
  head.add(box(.12,.12,.02,0x15172b,-.13,.04,.31),box(.12,.12,.02,0x15172b,.13,.04,.31),box(.22,.05,.02,0x15172b,0,-.14,.31));
  addHat(head,hat);
  body.add(head);
  // blob shadow
  const sh=new THREE.Mesh(new THREE.CircleGeometry(.42,12),new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.28,depthWrite:false}));
  sh.rotation.x=-Math.PI/2;
  limbs={body,legL,legR,armL,armR,head};
  return {g,shadow:sh};
}
function addHat(head,h){
  const B=(w,hh,d,c,x,y,z)=>head.add(box(w,hh,d,c,x,y,z));
  switch(h){
    case "h1":B(.64,.16,.64,0xe2452b,0,.36,0);B(.5,.06,.3,0xa42626,0,.3,.42);break;
    case "h2":B(.66,.08,.18,0x222222,0,.34,0);B(.1,.26,.26,0xff4d6d,-.35,.02,0);B(.1,.26,.26,0xff4d6d,.35,.02,0);break;
    case "h3":{const c=new THREE.Mesh(new THREE.ConeGeometry(.42,.75,4),new THREE.MeshLambertMaterial({color:0x5b3cc4}));c.position.y=.66;c.rotation.y=Math.PI/4;head.add(c);B(.8,.06,.8,0x3d2690,0,.31,0);B(.1,.1,.1,0xffcf3a,.12,.6,.18);break}
    case "h4":B(.64,.2,.64,0x9aa3ad,0,.38,0);B(.1,.3,.1,0xfff6dc,-.38,.42,0);B(.1,.3,.1,0xfff6dc,.38,.42,0);break;
    case "h5":{const t=new THREE.Mesh(new THREE.TorusGeometry(.3,.04,4,12),new THREE.MeshBasicMaterial({color:0xffe07a}));t.rotation.x=Math.PI/2;t.position.y=.55;head.add(t);break}
    case "h6":B(.56,.16,.56,0xffcf3a,0,.38,0);B(.1,.14,.1,0xffcf3a,-.22,.52,.22);B(.1,.18,.1,0xffcf3a,0,.54,.24);B(.1,.14,.1,0xffcf3a,.22,.52,.22);B(.08,.08,.02,0xff4d6d,0,.38,.29);break;
  }
}

/* ---------- build course ---------- */
function build(el,n,theme,lv,skin,hat){
  ensureRenderer();
  host=el;
  el.className="track track3d";el.removeAttribute("style");el.innerHTML="";
  el.appendChild(renderer.domElement);
  disposeScene();
  const pal=PAL[theme]||PAL.jungle;curPal=pal;
  const r=rng(1234+n*7);
  scene=new THREE.Scene();
  scene.background=new THREE.Color(pal.sky);
  scene.fog=new THREE.Fog(pal.fog,22,85);
  camera=new THREE.PerspectiveCamera(55,1,.1,200);

  scene.add(new THREE.HemisphereLight(0xffffff,pal.hazGlow?0x663322:0x556677,1.15));
  const sun=new THREE.DirectionalLight(0xffffff,1.25);sun.position.set(6,12,5);scene.add(sun);

  // textures
  const topTex=pixTex(g=>speckle(g,pal.top,r));
  const dirtTex=pixTex(g=>speckle(g,pal.dirt,r));
  const sideTex=pixTex(g=>{speckle(g,pal.dirt,r);speckle(g,pal.top,r,0,3);for(let x=0;x<16;x++)if(r()<.5){g.fillStyle=pal.top[0];g.fillRect(x,3,1,1+(r()<.3?1:0))}});
  const sideM=new THREE.MeshLambertMaterial({map:sideTex}),topM=new THREE.MeshLambertMaterial({map:topTex}),dirtM=new THREE.MeshLambertMaterial({map:dirtTex});

  // platform layout
  plats=[];
  for(let i=0;i<=n;i++){
    const x=i===0?0:Math.sin(i*.85)*2.6, z=-i*3.8, top=lv(i,n)+1;
    plats.push({x,z,top});
  }
  let topCount=(n+1)*4,dirtCount=plats.reduce((s,p)=>s+(p.top-1)*4,0);
  const cube=new THREE.BoxGeometry(1,1,1);
  const topMesh=new THREE.InstancedMesh(cube,[sideM,sideM,topM,dirtM,sideM,sideM],topCount);
  const dirtMesh=new THREE.InstancedMesh(cube,dirtM,Math.max(1,dirtCount));
  let ti=0,di=0;
  for(const p of plats){
    for(const [ox,oz] of [[-.5,-.5],[.5,-.5],[-.5,.5],[.5,.5]]){
      tmpM.makeTranslation(p.x+ox,p.top-.5,p.z+oz);topMesh.setMatrixAt(ti++,tmpM);
      for(let y=0;y<p.top-1;y++){tmpM.makeTranslation(p.x+ox,y+.5,p.z+oz);dirtMesh.setMatrixAt(di++,tmpM)}
    }
  }
  dirtMesh.count=di;
  scene.add(topMesh,dirtMesh);

  // hazard
  hazTex=pixTex(g=>speckle(g,pal.haz,r));
  hazTex.wrapS=hazTex.wrapT=THREE.RepeatWrapping;hazTex.repeat.set(60,60);
  const haz=new THREE.Mesh(new THREE.PlaneGeometry(240,240),pal.hazGlow?new THREE.MeshBasicMaterial({map:hazTex}):new THREE.MeshLambertMaterial({map:hazTex}));
  haz.rotation.x=-Math.PI/2;haz.position.set(0,.05,-n*1.9);scene.add(haz);

  // coins
  coins=[];
  const coinGeo=new THREE.BoxGeometry(.5,.5,.12),coinMat=new THREE.MeshLambertMaterial({color:0xffcf3a,emissive:0x6b4a00});
  for(let i=1;i<=n;i++){const c=new THREE.Mesh(coinGeo,coinMat);c.position.set(plats[i].x,plats[i].top+1.15,plats[i].z);scene.add(c);coins[i]=c}

  // flags (checkpoints every 5, finish at end)
  flags=[];
  const poleGeo=new THREE.BoxGeometry(.1,2.2,.1),poleMat=new THREE.MeshLambertMaterial({color:0xdddddd});
  for(let i=1;i<=n;i++){
    if(!(i===n||i%5===0))continue;
    const p=plats[i],g=new THREE.Group();g.position.set(p.x+.75,p.top,p.z-.75);
    const pole=new THREE.Mesh(poleGeo,poleMat);pole.position.y=1.1;g.add(pole);
    const fl=box(.8,.5,.06,i===n?0xffcf3a:0x4fd16b,.45,1.9,0);g.add(fl);
    scene.add(g);flags.push(fl);
  }

  // decoration
  addDeco(pal.deco,n,r);

  // avatar
  const a=buildAvatar(skin,hat);avatar=a.g;shadow=a.shadow;scene.add(avatar,shadow);

  // particles
  const pc=36;
  parts=new THREE.InstancedMesh(new THREE.BoxGeometry(.16,.16,.16),new THREE.MeshBasicMaterial(),pc);
  partData=[];const col=new THREE.Color();
  for(let i=0;i<pc;i++){partData.push({p:new THREE.Vector3(),v:new THREE.Vector3(),life:0});tmpM.makeScale(0,0,0);parts.setMatrixAt(i,tmpM);parts.setColorAt(i,col.set(0xffffff))}
  parts.frustumCulled=false;scene.add(parts);

  // place
  curIdx=0;anim=null;blinkUntil=0;
  const p0=P(0);avatar.position.copy(p0);faceToward(0,1);
  snapCamera();
  if(!ro){ro=new ResizeObserver(()=>resize());}
  ro.disconnect();ro.observe(el);
  resize();
  start();
}

function addDeco(kind,n,r){
  const zMin=-n*3.8-30,zMax=12;
  const pick=()=>{let x;do{x=(r()-.5)*70}while(Math.abs(x)<10);return [x,zMin+r()*(zMax-zMin)]};
  const g=new THREE.BoxGeometry(1,1,1);
  if(kind==="clouds"||kind==="trees"){
    const m=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0xffffff,emissive:0x444444}),30);
    for(let i=0;i<30;i++){const [x,z]=pick();tmpM.compose(new THREE.Vector3(x,9+r()*8,z),new THREE.Quaternion(),new THREE.Vector3(3+r()*5,.8+r()*.6,2+r()*3));m.setMatrixAt(i,tmpM)}
    scene.add(m);
  }
  if(kind==="trees"){
    const trunk=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0x7a4e2b}),24),leaf=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0x3f9a2c}),24);
    for(let i=0;i<24;i++){const [x,z]=pick();const h=4+r()*5;
      tmpM.compose(new THREE.Vector3(x,h/2,z),new THREE.Quaternion(),new THREE.Vector3(.8,h,.8));trunk.setMatrixAt(i,tmpM);
      const s=2.5+r()*1.5;tmpM.compose(new THREE.Vector3(x,h+s/2-.3,z),new THREE.Quaternion(),new THREE.Vector3(s,s,s));leaf.setMatrixAt(i,tmpM)}
    scene.add(trunk,leaf);
  }
  if(kind==="rocks"){
    const m=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0x2a1b1f}),26);
    for(let i=0;i<26;i++){const [x,z]=pick();const h=3+r()*12,w=1.5+r()*2.5;tmpM.compose(new THREE.Vector3(x,h/2,z),new THREE.Quaternion(),new THREE.Vector3(w,h,w));m.setMatrixAt(i,tmpM)}
    scene.add(m);
  }
  if(kind==="space"){
    const m=new THREE.InstancedMesh(g,new THREE.MeshLambertMaterial({color:0x6a6f88}),22),q=new THREE.Quaternion();
    for(let i=0;i<22;i++){const [x,z]=pick();const s=.8+r()*2.4;q.setFromEuler(new THREE.Euler(r()*3,r()*3,r()*3));tmpM.compose(new THREE.Vector3(x,3+r()*12,z),q,new THREE.Vector3(s,s,s));m.setMatrixAt(i,tmpM)}
    scene.add(m);
    const sp=new Float32Array(600*3);for(let i=0;i<600;i++){const th=r()*Math.PI*2,ph=Math.acos(2*r()-1),R=90;sp[i*3]=R*Math.sin(ph)*Math.cos(th);sp[i*3+1]=Math.abs(R*Math.cos(ph))*.8+5;sp[i*3+2]=R*Math.sin(ph)*Math.sin(th)-n*1.9}
    const sg=new THREE.BufferGeometry();sg.setAttribute("position",new THREE.BufferAttribute(sp,3));
    scene.add(new THREE.Points(sg,new THREE.PointsMaterial({color:0xffffff,size:1.4,sizeAttenuation:false,fog:false})));
  }
}

/* ---------- motion ---------- */
function faceToward(i,j){
  if(!plats[j])j=i;const a=plats[i],b=plats[j];
  const dx=b.x-a.x,dz=b.z-a.z;if(dx||dz)avatar.rotation.y=Math.atan2(dx,dz);
}
function camTarget(out,look){
  const a=avatar.position;
  const next=plats[Math.min(curIdx+1,plats.length-1)];
  out.set(a.x*.55+2.4,a.y+3.4,a.z+6.4);
  look.set((a.x+next.x)/2,a.y+.9,a.z-2.6);
}
function snapCamera(){camTarget(camPos,camLook);camera.position.copy(camPos);camera.userData.look=camLook.clone();camera.lookAt(camLook)}

function burst(pos,color,count,speed=3){
  const c=new THREE.Color(color);let made=0;
  for(let i=0;i<partData.length&&made<count;i++){
    const d=partData[i];if(d.life>0)continue;
    d.p.copy(pos);d.v.set((Math.random()-.5)*speed,speed*(.6+Math.random()*.8),(Math.random()-.5)*speed);d.life=.7+Math.random()*.4;
    parts.setColorAt(i,c);made++;
  }
  parts.instanceColor.needsUpdate=true;
}

function jump(from,to){return new Promise(res=>{
  curIdx=from;faceToward(from,to);
  if(REDUCED){avatar.position.copy(P(to));curIdx=to;collect(to);res();return}
  const A=P(from),B=P(to);
  anim={type:"jump",t0:clock.elapsedTime,dur:.62,A,B,peak:Math.max(1.5,B.y-A.y+1.3),to,res};
})}
function fall(from){return new Promise(res=>{
  curIdx=from;const to=Math.min(from+1,plats.length-1);faceToward(from,to);
  const A=P(from),B=P(to===from?from:to);
  const G=new THREE.Vector3().lerpVectors(A,B,to===from?0:.55);G.y=A.y-.2;
  if(to===from)G.z-=2;
  if(REDUCED){res();return}
  anim={type:"fall",t0:clock.elapsedTime,dur:1.25,A,G,from,res,splashed:false};
})}
function collect(i){
  const c=coins[i];
  if(c&&c.visible){c.visible=false;burst(c.position,0xffcf3a,12,2.6)}
  landT=clock.elapsedTime;
}

/* ---------- loop ---------- */
function start(){if(running)return;running=true;frames=0;acc=0;clock.getDelta();loop()}
function stop(){running=false;cancelAnimationFrame(raf);if(ro)ro.disconnect()}
function loop(){
  if(!running)return;
  raf=requestAnimationFrame(loop);
  if(document.hidden)return;
  const raw=clock.getDelta(),dt=Math.min(raw,.05),t=clock.elapsedTime;
  // adaptive quality: drop resolution if the device can't hold ~40fps
  frames++;acc+=raw;
  if(acc>2){const fps=frames/acc;frames=0;acc=0;if(fps<40&&pr>.75){pr=Math.max(.75,pr-.5);renderer.setPixelRatio(pr);resize()}}
  update(dt,t);
  renderer.render(scene,camera);
}
const ease=x=>x<.5?2*x*x:1-Math.pow(-2*x+2,2)/2;
function update(dt,t){
  if(hazTex){hazTex.offset.x+=dt*.06;hazTex.offset.y+=dt*.035}
  for(const c of coins){if(c&&c.visible){c.rotation.y+=dt*2.6;c.position.y+=Math.sin(t*3+c.position.z)*.004}}
  for(const f of flags)f.rotation.y=Math.sin(t*4)*.25;

  const L=limbs;let swing=0;
  if(anim){
    const p=Math.min(1,(t-anim.t0)/anim.dur);
    if(anim.type==="jump"){
      const e=ease(p);
      avatar.position.lerpVectors(anim.A,anim.B,e);avatar.position.y+=anim.peak*4*e*(1-e);
      swing=Math.sin(p*Math.PI)*1.1;
      if(p>=1){avatar.position.copy(anim.B);curIdx=anim.to;collect(anim.to);const r=anim.res;anim=null;r()}
    }else{
      const s1=.42;
      if(p<s1){const e=p/s1;avatar.position.lerpVectors(anim.A,anim.G,e);avatar.position.y+=1.3*4*e*(1-e);swing=1}
      else{const e=(p-s1)/(1-s1);avatar.position.copy(anim.G);avatar.position.y=anim.G.y-(anim.G.y+1.6)*Math.min(1,e*e*2.2);avatar.rotation.x=-e*.8;swing=1.4;
        if(!anim.splashed&&avatar.position.y<.2){anim.splashed=true;tmpV.set(anim.G.x,.2,anim.G.z);burst(tmpV,curPal.haz[2],20,4)}
      }
      if(p>=1){avatar.rotation.x=0;avatar.position.copy(anim.A);blinkUntil=t+.9;const r=anim.res;anim=null;r()}
    }
  }
  // limbs
  const idle=anim?0:Math.sin(t*2.2)*.06;
  L.armL.rotation.x=-swing*1.4+idle;L.armR.rotation.x=-swing*1.4-idle;
  L.legL.rotation.x=swing*.6;L.legR.rotation.x=-swing*.6;
  // landing squash + idle breathe
  const ls=t-landT;const sq=ls<.25?Math.sin(ls/.25*Math.PI)*.18:0;
  L.body.scale.set(1+sq*.6,1-sq+(anim?0:Math.sin(t*2.2)*.012),1+sq*.6);
  avatar.visible=t>blinkUntil||Math.floor(t*12)%2===0;
  // shadow
  if(!anim||anim.type==="jump"){
    const base=anim?Math.max(anim.A.y,anim.B.y):avatar.position.y;
    const pl=nearestPlat(avatar.position);
    shadow.visible=!!pl;
    if(pl){shadow.position.set(avatar.position.x,pl.top+.02,avatar.position.z);const h=Math.max(0,avatar.position.y-pl.top);shadow.scale.setScalar(Math.max(.35,1-h*.25))}
  }else shadow.visible=false;
  // particles
  for(let i=0;i<partData.length;i++){
    const d=partData[i];
    if(d.life>0){d.life-=dt;d.v.y-=9*dt;d.p.addScaledVector(d.v,dt);const s=Math.max(0,d.life*1.3);tmpM.compose(d.p,avatar.quaternion,tmpV.set(s,s,s));parts.setMatrixAt(i,tmpM)}
    else{tmpM.makeScale(0,0,0);parts.setMatrixAt(i,tmpM)}
  }
  parts.instanceMatrix.needsUpdate=true;
  // camera follow
  camTarget(tmpV,camLook);
  const k=1-Math.exp(-dt*(anim&&anim.type==="fall"?1.5:4));
  camera.position.lerp(tmpV,k);
  if(!camera.userData.look)camera.userData.look=camLook.clone();
  camera.userData.look.lerp(camLook,k);camera.lookAt(camera.userData.look);
}
function nearestPlat(v){
  for(const p of plats){if(Math.abs(v.x-p.x)<1.05&&Math.abs(v.z-p.z)<1.05)return p}
  return null;
}
function resize(){
  if(!host||!renderer)return;
  const w=host.clientWidth||300,h=host.clientHeight||250;
  renderer.setSize(w,h,false);camera.aspect=w/h;
  camera.fov=w/h<1.1?62:52;camera.updateProjectionMatrix();
}

const Track3D={kind:"3d",broken:false,build,jump,fall,resize,stop};
window.Track3D=Track3D;
