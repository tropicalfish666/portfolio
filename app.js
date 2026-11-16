(() => {
  'use strict';
  const $=s=>document.querySelector(s),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mod=(v,n)=>((v%n)+n)%n;
  const portfolio=window.PORTFOLIO,frames=portfolio.works.slice();
  for(let i=frames.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[frames[i],frames[j]]=[frames[j],frames[i]];}
  const count=frames.length,middle=Math.floor(count/2),frameFor=index=>frames[mod(index,count)];
  const gallery=$('#gallery'),canvas=$('#film-canvas'),fallback=$('#fallback-film'),detail=$('#frame-dialog'),scene=$('#scene'),transport=$('#film-transport');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),backgroundVideo=$('#background-video'),detailBackground=$('#detail-background-video');
  const backgroundVideoSource=[...(backgroundVideo?.querySelectorAll('source')||[])].find(s=>!s.media||matchMedia(s.media).matches)?.src;
  let backgroundReady=false;
  let backgroundBlobAttempted=false,backgroundBlobUrl=null;
  let paused=reduced.matches,offset=middle+.5,target=offset,velocity=0,momentum=0,elapsed=0,last=performance.now(),lastStatus=0;
  let active=null,activeAbs=middle,selectedAbs=middle,hoverAbs=null,hoverValid=false,phase='browse',progress=0,transition=null;
  let entrance=null,navigation=null,pinnedFrame=middle;
  const AUTO_SPEED=.045;
  let autoHoldUntil=0;
  function holdAuto(duration=2200){autoHoldUntil=performance.now()+duration;}
  function desiredVelocity(now){
    if(paused||phase!=='browse'||dragging||navigation||entrance)return 0;
    if(pointer.inside){const amount=clamp((Math.abs(pointer.nx)-.18)/.82,0,1),axis=Math.sign(pointer.nx)*amount*amount*(3-2*amount);return axis*.72;}
    return now>=autoHoldUntil?AUTO_SPEED:0;
  }
  function advanceTrack(now,seconds){
    if(!dragging&&!paused){const desired=desiredVelocity(now);velocity+=(desired-velocity)*(1-Math.exp(-seconds*3.5));const delta=(velocity+momentum)*seconds;if(Math.abs(delta)>.00001)pinnedFrame=null;target+=delta;momentum*=Math.exp(-seconds*4.5);}
    offset=paused||dragging?target:offset+(target-offset)*(1-Math.exp(-seconds*10));if(Math.abs(offset-target)<.0001)offset=target;
  }
  const frameScale=()=>innerWidth<=600?.84:.90;
  let viewWidth=1,viewHeight=1,visibleFrames=3,band=.6,bounds=[1,1,0,0],wave=.12,aspect=1,depth=.83,twistStrength=.30,curveSpan=1,portrait=false;
  let dragging=false,dragged=false,startX=0,startY=0,dragX=0,dragStamp=0,dragVelocity=0,pressedFrame=null,activePointerId=null;
  const pointer={inside:false,x:0,y:0,nx:0,kind:'none'},lifts=new Map(),liftVelocities=new Map(),hoverProfiles=new Map();
  const getLift=i=>lifts.get(i)||0;
  let gl=null,program,texture,uniforms,lastRenderKey='',lastPickKey='',lastPick=null;
  gallery.dataset.order=frames.map(f=>f.id).join(',');
  function visibleIndices(){const radius=Math.ceil(visibleFrames/2)+2,center=Math.floor(offset);return Array.from({length:radius*2+1},(_,i)=>center-radius+i);}
  function browseIndex(){return pinnedFrame!==null?pinnedFrame:Math.floor(offset);}
  function nearestFrame(index){return index+count*Math.round((offset-index-.5)/count);}
  function normalizeCamera(){
    const shift=Math.floor(offset/count)*count;if(!shift)return;
    offset-=shift;target-=shift;activeAbs-=shift;selectedAbs-=shift;
    if(pinnedFrame!==null)pinnedFrame-=shift;if(hoverAbs!==null)hoverAbs-=shift;if(pressedFrame!==null)pressedFrame-=shift;
    if(navigation){navigation.from-=shift;navigation.to-=shift;navigation.index-=shift;}if(entrance){entrance.from-=shift;entrance.to-=shift;}
    for(const map of [lifts,liftVelocities,hoverProfiles]){const entries=[...map];map.clear();for(const [i,v] of entries)map.set(i-shift,v);}
    lastPickKey='';
  }
  function setPhase(value){phase=value;gallery.dataset.phase=value;syncBackgroundVideo();syncDetailBackground();}
  function clearPointer(){pointer.inside=false;hoverValid=false;hoverAbs=null;gallery.classList.remove('is-hovering');}
  function publishStatus(force=false){
    const index=phase!=='browse'?selectedAbs:hoverValid?hoverAbs:browseIndex(),f=frameFor(index);activeAbs=index;
    const now=performance.now();if(force||now-lastStatus>100){Object.assign(gallery.dataset,{position:offset.toFixed(4),center:String(mod(Math.floor(offset),count)+1),selected:f.id,morph:progress.toFixed(3),hovered:hoverValid?String(hoverAbs):'none',detach:Math.max(0,...lifts.values()).toFixed(3),count:String(count),navigation:navigation?'moving':'idle',frameHeight:(band*viewHeight).toFixed(2),portrait:String(portrait),input:pointer.kind,steering:velocity.toFixed(3),loop:'continuous',hoverStyle:hoverValid?getHoverProfile(hoverAbs).name:'none',autoplay:paused||phase!=='browse'?'off':pointer.inside?'manual':now<autoHoldUntil||entrance||navigation?'waiting':'slow'});lastStatus=now;}
    if(f.id===active&&!force)return;active=f.id;$('#current-description').textContent=f.title+'。'+f.tags.join('，');
    if(phase==='browse'&&!entrance)history.replaceState(null,'','#'+f.id);
    fallback.querySelector('h1').textContent=f.title;fallback.querySelector('p').textContent=f.tags.join(' · ');
    const fallbackImage=fallback.querySelector('.fallback-inside');fallbackImage.classList.toggle('has-cover',!!f.cover);fallbackImage.style.backgroundImage=f.cover?`linear-gradient(0deg,rgba(8,8,12,.82),transparent 70%),url("${f.cover}")`:'';fallback.querySelector('h1').hidden=fallback.querySelector('p').hidden=false;
  }
  function selectFrame(index){if(phase!=='browse')return;finishEntrance();holdAuto();clearPointer();velocity=momentum=0;pinnedFrame=index;target=index+.5;navigation=paused||!gl?null:{from:offset,to:target,index,start:performance.now(),duration:650};if(paused||!gl)offset=target;publishStatus(true);}
  function step(direction){selectFrame((navigation?navigation.index:activeAbs)+direction);}
  const projectSeek=window.createProjectStreaming($('#project-video'),$('#project-seek-status'));
  const coverImages=new Map();let atlasRefreshPending=false;
  function requestAtlasDraw(){if(atlasRefreshPending)return;atlasRefreshPending=true;requestAnimationFrame(()=>{atlasRefreshPending=false;drawAtlas();});}
  const atlas=document.createElement('canvas');atlas.width=4096;atlas.height=Math.ceil(count/4)*1024;
  const ctx=atlas.getContext('2d'),cell=4096/count,tileSize=1024,atlasColumns=4,atlasRows=Math.ceil(count/atlasColumns);
  function rounded(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function trackedWidth(text,spacing){return [...text].reduce((sum,char)=>sum+ctx.measureText(char).width,0)+Math.max(0,[...text].length-1)*spacing;}
  function trackedText(text,x,y,spacing){for(const char of text){ctx.fillText(char,x,y);x+=ctx.measureText(char).width+spacing;}}
  function drawAtlas(){
    lastRenderKey='';ctx.clearRect(0,0,atlas.width,atlas.height);ctx.fillStyle='#161214';ctx.fillRect(0,0,atlas.width,atlas.height);
    for(let i=0;i<count;i++){
      const f=frames[i],x=0,w=cell-24;ctx.save();ctx.translate((i%atlasColumns)*tileSize,Math.floor(i/atlasColumns)*tileSize);ctx.scale(tileSize/cell,tileSize/512);ctx.save();ctx.beginPath();ctx.rect(x+12,70,w,373);ctx.clip();
      const cover=coverImages.get(f.id);
      if(cover){const ratio=16/9,sw=Math.min(cover.naturalWidth,cover.naturalHeight*ratio),sh=sw/ratio;ctx.drawImage(cover,(cover.naturalWidth-sw)/2,(cover.naturalHeight-sh)/2,sw,sh,x+12,70,w,373);const captionShade=ctx.createLinearGradient(x,280,x,443);captionShade.addColorStop(0,'rgba(8,8,12,0)');captionShade.addColorStop(.45,'rgba(8,8,12,.32)');captionShade.addColorStop(1,'rgba(8,8,12,.86)');ctx.fillStyle=captionShade;ctx.fillRect(x+12,280,w,163);}
      else{
      const shade=ctx.createLinearGradient(x,70,x+cell,443);shade.addColorStop(0,'#32232b');shade.addColorStop(.5,'#261c24');shade.addColorStop(1,'#1d2020');ctx.fillStyle=shade;ctx.fillRect(x+12,70,w,373);
      }
      ctx.fillStyle='#f0e5d9';ctx.textAlign='left';let size=cover?34:42;ctx.font=size+'px "ReelDisplay","Microsoft YaHei",sans-serif';while(ctx.measureText(f.title).width>cell-76&&size>27){size--;ctx.font=size+'px "ReelDisplay","Microsoft YaHei",sans-serif';}ctx.fillText(f.title,x+36,cover?360:234);
      ctx.fillStyle='#e1d3d9';ctx.font='500 18px "Microsoft YaHei",sans-serif';const tags=f.tags.join('  /  '),tracking=.9;if(trackedWidth(tags,tracking)>cell-76){trackedText(f.tags.slice(0,2).join('  /  '),x+38,cover?399:283,tracking);trackedText(f.tags.slice(2).join('  /  '),x+38,cover?425:311,tracking);}else trackedText(tags,x+38,cover?409:286,tracking);
      ctx.restore();ctx.strokeStyle='#161214';ctx.lineWidth=2;ctx.strokeRect(x+12,70,w,373);
      ctx.globalCompositeOperation='destination-out';ctx.fillStyle='#000';for(let hole=0;hole<8;hole++){const hx=(hole+.26)*cell/8;rounded(hx,28,cell*.060,22,4);rounded(hx,463,cell*.060,22,4);}ctx.restore();
    }
    gallery.dataset.textureTile=tileSize+'x'+tileSize;gallery.dataset.coverCount=String(coverImages.size);
    if(gl&&texture){gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);}
  }
  function fillDetail(index){
    const f=frameFor(index),projectVideo=$('#project-video');projectSeek.cancel();
    $('#detail-title').textContent=f.title;$('#detail-tags').textContent=f.tags.join(' · ');$('#detail-copy').textContent=f.description||'作品简介待补充';
    const cover=$('#detail-cover');cover.hidden=!f.cover;$('#cover-empty').hidden=!!f.cover;cover.parentElement.style.setProperty('--cover-ratio',f.cover?'16 / 9':'3 / 4');if(f.cover){cover.src=f.cover;cover.alt=f.title+'封面';}else cover.removeAttribute('src');
    $('#video-slot').style.setProperty('--video-ratio',f.aspect||'16 / 9');$('#video-slot').classList.toggle('is-portrait',f.aspect==='9 / 16');projectVideo.hidden=!f.video;$('#video-empty').hidden=!!f.video;
    if(f.video){projectSeek.load(f.video);if(f.videoPoster||f.cover)projectVideo.poster=f.videoPoster||f.cover;else projectVideo.removeAttribute('poster');}else projectVideo.removeAttribute('poster');
    $('#detail-models').replaceChildren(...f.models.map(model=>{const row=document.createElement('span');row.textContent=model;return row;}));detail.dataset.work=f.id;
  }
  const framePoses=[[-0.08,0.03,-0.016,0.01],[0.1,-0.025,0.018,-0.012],[-0.055,0.045,-0.005,0.025],[0.075,-0.035,0.012,-0.02],[-0.09,0.025,-0.02,0.014],[0.055,-0.04,0.015,-0.005],[-0.06,0.03,-0.005,0.018]];
  // Choose the movement from the curve under this physical frame, not its work ID.
  const hoverMotions={
    valley:{name:'valley-rise',pose:[.34,-.025,-.015,.26],shape:[.43,-.025,.055,.98],omega:6.5},
    crest:{name:'crest-settle',pose:[.10,-.035,.018,.17],shape:[.86,.025,.035,.98],omega:7.5},
    left:{name:'left-peel',pose:[.13,-.14,-.07,.19],shape:[.73,-.10,.12,.97],omega:8.5},
    right:{name:'right-peel',pose:[.16,.12,.06,.20],shape:[.72,.10,.10,.97],omega:8},
    float:{name:'float-up',pose:[.24,.008,0,.22],shape:[.68,0,.025,.98],omega:7}
  };
  function makeHoverProfile(index){
    const u=(index+.5-offset)*2/visibleFrames,q=u*curveSpan;
    if(q>-.72&&q<-.28)return hoverMotions.valley;
    if(q>.32&&q<.86)return hoverMotions.crest;
    if(u<-.34)return hoverMotions.left;
    if(u>.34)return hoverMotions.right;
    return hoverMotions.float;
  }
  function getHoverProfile(index){return hoverProfiles.get(index)||makeHoverProfile(index);}
  function lockHoverProfile(index){if(index!==null&&(!hoverProfiles.has(index)||getLift(index)<.02))hoverProfiles.set(index,makeHoverProfile(index));}
  // A nonperiodic rolled strip; the shader and CPU picker share this surface.
  function curve(u){
    const q=u*curveSpan,a=(q+.50)/.44,b=(q-.64)/.94,d=(q+.88)/.62,e=(q-.28)/.83;
    return [u*aspect,wave*(-1.05*Math.exp(-a*a)+.32*Math.exp(-b*b)-.22*q-.20*q*q*q),depth*(.86*Math.exp(-e*e)-.50*Math.exp(-d*d)-.22)];
  }
  function surface(index,localX,y,liftOverride=null){
    const u=(index+.5-offset+localX)*2/visibleFrames,q=u*curveSpan,a=(q+.50)/.44,b=(q-.64)/.94,d=(q+.88)/.62,e=(q-.28)/.83;
    const p=curve(u),dy=wave*curveSpan*(2.10*a*Math.exp(-a*a)/.44-.64*b*Math.exp(-b*b)/.94-.22-.60*q*q),dz=depth*curveSpan*(-1.72*e*Math.exp(-e*e)/.83+1.00*d*Math.exp(-d*d)/.62);
    const length=Math.hypot(aspect,dy,dz),tx=aspect/length,ty=dy/length,tz=dz/length,bLength=Math.hypot(tx,tz),bx=-tz/bLength,bz=tx/bLength;
    const vx=0,vy=1,vz=0,r=(q+.42)/.60,t=(q-1.12)/.84,twist=-twistStrength*(1.05*Math.exp(-r*r)-.62*Math.exp(-t*t)-.12),co=Math.cos(twist),si=Math.sin(twist);
    const rx=vx*co+bx*si,ry=vy*co,rz=vz*co+bz*si,nx=ty*rz-tz*ry,ny=tz*rx-tx*rz,nz=tx*ry-ty*rx;
    const bow=.035*band*(1-y*y)*(1+.25*q/Math.sqrt(1+q*q));
    p[0]+=y*band*rx+bow*nx;p[1]+=y*band*ry+bow*ny;p[2]+=y*band*rz+bow*nz;
    const pose=framePoses[mod(mod(index,count),framePoses.length)],localEdge=localX*2,seamWeight=Math.pow(Math.max(0,1-localEdge*localEdge),2);
    p[0]+=band*(y*pose[0]+.015*localEdge*y)*seamWeight;
    p[1]+=band*(pose[2]+localEdge*pose[1]+.025*(localEdge*localEdge-.3)*y)*seamWeight;
    p[2]+=(pose[3]+band*(localEdge*pose[1]+.018*(1-y*y)))*seamWeight;
    const lift=liftOverride===null?getLift(index):liftOverride;
    if(lift>0){
      const profile=getHoverProfile(index),h=profile.pose,s=profile.shape;
      const peel=lift*lift*(3-2*lift),flex=lift*(2-lift),edge=localX*2,center=curve((index+.5-offset)*2/visibleFrames);
      const curl=flex*(1-peel)*band*(.08*edge*edge-.035*edge)*(.6+s[2]*3);
      p[0]+=nx*curl;p[1]+=ny*curl;p[2]+=nz*curl;
      const target=[center[0]+edge*aspect/visibleFrames+band*h[2]*y,center[1]+band*(s[3]*y+h[1]*edge),center[2]+band*.02*(1-y*y)];
      for(let axis=0;axis<3;axis++)p[axis]+=(target[axis]-p[axis])*peel*s[0];
      const lip=s[2]*band*peel*edge*edge*(.55+.45*Math.sign(s[1])*edge);
      p[1]+=band*h[0]*peel+lip*(.3+.7*y);p[2]+=h[3]*peel+band*s[1]*edge*peel+lip;
      const compensate=(1-(center[2]+h[3]*peel)/3.4)/(1-center[2]/3.4);p[0]*=compensate;p[1]*=compensate;
    }
    return p;
  }
  function project(index,localX,y,liftOverride=null){
    const p=surface(index,localX,y,liftOverride),w=1-p[2]/3.4;return {x:p[0]/aspect/w,y:p[1]/w,z:p[2],w};
  }
  function pointAt(event,stableHover=false){
    const pickKey=[event.clientX,event.clientY,stableHover,hoverAbs,offset.toFixed(5),viewWidth,viewHeight,...visibleIndices().map(i=>getLift(i).toFixed(3))].join(',');
    if(pickKey===lastPickKey)return lastPick;
    const r=gallery.getBoundingClientRect(),nx=(event.clientX-r.left)/r.width*2-1,ny=1-(event.clientY-r.top)/r.height*2;
    function hitFrame(index,liftOverride=null){let nearestZ=-Infinity;
      for(let s=0;s<32;s++){
        const a=-.5+s/32,b=a+1/32,p=[project(index,a,-1,liftOverride),project(index,b,-1,liftOverride),project(index,b,1,liftOverride),project(index,a,1,liftOverride)];
        let inside=false;for(let i=0,j=3;i<4;j=i++){if((p[i].y>ny)!==(p[j].y>ny)&&nx<(p[j].x-p[i].x)*(ny-p[i].y)/(p[j].y-p[i].y)+p[i].x)inside=!inside;}
        if(inside)nearestZ=Math.max(nearestZ,p.reduce((sum,point)=>sum+point.z,0)/4);
      }return nearestZ;
    }
    if(stableHover&&hoverAbs!==null&&(hitFrame(hoverAbs)>-Infinity||hitFrame(hoverAbs,0)>-Infinity)){lastPickKey=pickKey;lastPick=hoverAbs;return hoverAbs;}
    let nearest=null,nearestZ=-Infinity;for(const index of visibleIndices()){const z=hitFrame(index);if(z>nearestZ){nearest=index;nearestZ=z;}}
    if(stableHover&&nearest===null)for(const index of visibleIndices()){const z=hitFrame(index,0);if(z>nearestZ){nearest=index;nearestZ=z;}}
    lastPickKey=pickKey;lastPick=nearest;return nearest;
  }
  function drawTransport(scale,travel=0,visibility=1,roll=0){
    const w=innerWidth,h=innerHeight,x=w*(1-scale)/2,y=h*(1-scale)/2-travel*h;
    transport.style.opacity=String(visibility);
    transport.style.setProperty('--rail-width',x+'px');
    transport.style.setProperty('--pitch',Math.max(20,x*.60)+'px');
    transport.style.setProperty('--film-y',roll+'px');
    transport.dataset.visible=visibility>.01?'true':'false';
    const svg=transport.querySelector('svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
    $('#film-matte').setAttribute('d',`M0 0H${w}V${h}H0Z M${x} ${y}V${y+h*scale}H${w-x}V${y}Z`);
  }
  function finishEntrance(){
    if(!entrance)return;
    offset=target;entrance=null;holdAuto(1200);
    scene.style.transform='';scene.dataset.scale='1.000';gallery.dataset.entrance='complete';drawTransport(1,0,0);
    active=null;publishStatus(true);
  }
  function updateEntrance(now){
    if(!entrance)return;
    const t=clamp((now-entrance.start)/2450,0,1),roll=clamp(t/.78,0,1),ease=1-Math.pow(1-roll,4),expand=clamp((t-.72)/.28,0,1),settle=expand*expand*(3-2*expand);
    offset=entrance.from+(entrance.to-entrance.from)*ease;target=entrance.to;
    const scale=frameScale()+(1-frameScale())*settle;
    scene.style.transform=`scale(${scale})`;scene.dataset.scale=scale.toFixed(3);
    gallery.dataset.entrance=t<.72?'rolling':'expanding';
    drawTransport(scale,0,1-settle,-ease*innerHeight*.65);
    if(t===1)finishEntrance();
  }
  function updateTransition(){
    const p=progress,shrink=clamp(p/.3,0,1),pull=clamp((p-.28)/.53,0,1),expand=clamp((p-.8)/.2,0,1);
    const ease=t=>t*t*(3-2*t),s=1-(1-frameScale())*ease(shrink),q=ease(pull),end=ease(expand);
    scene.style.transform=`translate3d(0,${-112*q}%,0) scale(${s})`;
    scene.style.borderRadius='0';
    $('#detail-stage').style.transform=`translate3d(0,${112*(1-q)}svh,0) scale(${frameScale()+(1-frameScale())*end})`;
    drawTransport(s,1.12*q,ease(shrink)*(1-ease(expand)),-q*innerHeight*1.4);
    detail.dataset.transitionStage=p<.28?'shrink':p<.8?'pull':'settle';
  }
  function finishTransition(){
    transition=null;
    if(progress===1){$('#detail-stage').style.transform='none';$('#detail-stage').style.willChange='auto';setPhase('open');detail.classList.add('is-ready');detail.classList.remove('is-leaving');}
    else{setPhase('browse');detail.classList.remove('is-ready','is-leaving');detail.close();scene.style.transform='';scene.style.borderRadius='';drawTransport(1,0,0);document.body.classList.remove('is-detail');clearPointer();target=offset;holdAuto();gallery.focus({preventScroll:true});}
    publishStatus(true);
  }
  function runTransition(to){
    $('#detail-stage').style.willChange='transform';
    const duration=paused||reduced.matches?0:(to?1550:1250)*Math.abs(to-progress);
    transition={from:progress,to,start:performance.now(),duration};
    if(!duration){progress=to;updateTransition();finishTransition();}
  }

  function openDetail(index=activeAbs){
    if(phase!=='browse')return;finishEntrance();navigation=null;selectedAbs=index;pinnedFrame=index;target=offset;velocity=momentum=0;clearPointer();fillDetail(index);setPhase('opening');
    document.body.classList.add('is-detail');detail.classList.remove('is-ready','is-leaving');detail.showModal();detail.scrollTop=0;progress=0;updateTransition();history.replaceState(null,'','#'+frameFor(index).id);runTransition(1);
  }
  function closeDetail(){if(phase==='browse'||phase==='closing')return;$('#project-video').pause();projectSeek.cancel();detail.scrollTop=0;detail.classList.remove('is-ready');detail.classList.add('is-leaving');setPhase('closing');runTransition(0);}
  function nextDetail(){if(phase!=='open')return;selectedAbs++;pinnedFrame=selectedAbs;offset=target=selectedAbs+.5;normalizeCamera();fillDetail(selectedAbs);detail.scrollTop=0;history.replaceState(null,'','#'+frameFor(selectedAbs).id);publishStatus(true);}
  $('#back-to-film').addEventListener('click',closeDetail);$('#detail-next').addEventListener('click',nextDetail);detail.addEventListener('cancel',event=>{event.preventDefault();closeDetail();});
  $('.wordmark').addEventListener('click',event=>{event.preventDefault();selectFrame(nearestFrame(middle));});
  let resumeTimer;$('#download-resume').addEventListener('click',()=>{if(portfolio.resumeUrl){const a=document.createElement('a');a.href=portfolio.resumeUrl;a.download='Resume-LiuJinrui.pdf';a.click();}else{clearTimeout(resumeTimer);$('#resume-status').textContent='简历文件待提供';$('#resume-status').classList.add('is-visible');resumeTimer=setTimeout(()=>$('#resume-status').classList.remove('is-visible'),3000);}});
  gallery.addEventListener('keydown',event=>{if(phase!=='browse')return;const commands={ArrowLeft:()=>step(-1),ArrowRight:()=>step(1),Home:()=>selectFrame(nearestFrame(0)),End:()=>selectFrame(nearestFrame(count-1)),Enter:()=>openDetail()};if(commands[event.key]){event.preventDefault();commands[event.key]();}});
  function syncBackgroundVideo(){
    if(!backgroundVideo)return;backgroundVideo.muted=true;
    if(!backgroundReady||paused||document.hidden||phase!=='browse'){backgroundVideo.pause();return;}
    const play=backgroundVideo.play();if(play)play.catch(error=>{if(error.name!=='AbortError')backgroundVideo.dataset.playback='poster';if(error.name==='NotSupportedError')recoverBackgroundSource();});
  }
  function syncDetailBackground(){
    if(!detailBackground)return;
    const viewing=phase==='opening'||phase==='open';detailBackground.muted=true;
    if(viewing&&!detailBackground.poster)detailBackground.poster=detailBackground.dataset.poster;
    if(!viewing||paused||document.hidden){detailBackground.pause();return;}
    if(!detailBackground.dataset.loaded){
      for(const source of detailBackground.querySelectorAll('source'))source.src=source.dataset.src;
      detailBackground.dataset.loaded='true';detailBackground.load();
    }
    const play=detailBackground.play();if(play)play.catch(error=>{if(error.name!=='AbortError')detailBackground.dataset.playback='poster';});
  }
  function recoverDetailBackground(){if(detailBackground?.paused)syncDetailBackground();}
  document.addEventListener('pointerdown',recoverDetailBackground,{capture:true});
  document.addEventListener('keydown',recoverDetailBackground,{capture:true});
  document.addEventListener('visibilitychange',syncDetailBackground);
  detailBackground?.addEventListener('playing',()=>{detailBackground.dataset.playback='video';});
  window.addEventListener('pageshow',syncDetailBackground);
  // Some hosts ignore byte ranges. A local Blob lets the media engine seek without HTTP ranges.
  async function recoverBackgroundSource(){
    if(!backgroundReady||!backgroundVideoSource||backgroundBlobAttempted||paused||document.hidden||phase!=='browse')return;
    backgroundBlobAttempted=true;
    try{
      const response=await fetch(backgroundVideoSource);
      if(!response.ok||!response.headers.get('Content-Type')?.startsWith('video/'))throw Error('Video unavailable');
      const blob=await response.blob();backgroundBlobUrl=URL.createObjectURL(blob);
      backgroundVideo.src=backgroundBlobUrl;backgroundVideo.load();syncBackgroundVideo();
    }catch{backgroundVideo.dataset.playback='poster';}
  }
  // An autoplay rejection is temporary: retry inside the next real user gesture.
  function recoverBackgroundVideo(){if(backgroundVideo?.paused&&!paused&&!document.hidden)syncBackgroundVideo();}
  document.addEventListener('pointerdown',recoverBackgroundVideo,{capture:true});
  document.addEventListener('keydown',recoverBackgroundVideo,{capture:true});
  backgroundVideo?.addEventListener('playing',()=>{backgroundVideo.dataset.playback='video';});
  backgroundVideo?.addEventListener('error',recoverBackgroundSource,{capture:true});
  if(backgroundVideo?.error)recoverBackgroundSource();
  window.addEventListener('pageshow',()=>{syncBackgroundVideo();last=performance.now();});
  window.addEventListener('pagehide',event=>{if(!event.persisted&&backgroundBlobUrl)URL.revokeObjectURL(backgroundBlobUrl);});

  function setMotion(){document.body.classList.toggle('motion-paused',paused);$('#motion-toggle').setAttribute('aria-pressed',String(paused));$('#motion-toggle').setAttribute('aria-label',paused?'播放胶片动态':'暂停胶片动态');$('#motion-label').textContent=paused?'MOTION OFF':'MOTION ON';if(paused){finishEntrance();navigation=null;velocity=momentum=0;offset=target;}syncBackgroundVideo();syncDetailBackground();publishStatus(true);}
  $('#motion-toggle').addEventListener('click',()=>{paused=!paused;setMotion();});reduced.addEventListener('change',event=>{paused=event.matches;if(paused&&transition){progress=transition.to;updateTransition();finishTransition();}setMotion();});
  function resize(){const saved=scene.style.transform;scene.style.transform='none';measure();scene.style.transform=saved;if(entrance)updateEntrance(performance.now());else if(phase==='open'){$('#detail-stage').style.transform='none';$('#detail-stage').style.willChange='auto';}else if(phase!=='browse')updateTransition();}
  function measure(){
    const r=gallery.getBoundingClientRect();viewWidth=r.width;viewHeight=r.height;portrait=innerHeight>innerWidth;
    const filmHeight=(r.width<601?Math.min(r.height*.63,r.width*.84):portrait?Math.min(r.height*.66,r.width*.68):Math.min(r.height*.78,r.width/3.15/1.14))*.84;
    visibleFrames=r.width/(filmHeight*1.14);band=filmHeight*(portrait?.90:.82)/r.height;wave=Math.min(portrait?.32:.38,filmHeight*(portrait?.55:.62)/r.height);aspect=r.width/r.height;curveSpan=Math.min(1,visibleFrames/3.05);depth=portrait?.55:1.20;twistStrength=portrait?.70:.90;lastPickKey='';
    if(pinnedFrame!==null&&!entrance){target=pinnedFrame+.5;if(!navigation)offset=target;}
    if(pointer.inside){pointer.inside=pointer.x>=r.left&&pointer.x<=r.right&&pointer.y>=r.top&&pointer.y<=r.bottom;pointer.nx=clamp((pointer.x-r.left)/r.width*2-1,-1,1);}
    if(navigation)navigation.to=target;
    bounds=[r.width/innerWidth,r.height/innerHeight,(r.left+r.width/2)/innerWidth*2-1,1-(r.top+r.height/2)/innerHeight*2];
    if(gl){lastRenderKey='';const ratio=Math.min(devicePixelRatio||1,innerWidth<=600?1.75:2.5),pw=Math.round(innerWidth*ratio),ph=Math.round(innerHeight*ratio);if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;gl.viewport(0,0,pw,ph);}}
  }
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Film shader unavailable');return s;}
  const steps=72,rows=10;
  try{
    gl=canvas.getContext('webgl',{alpha:true,antialias:true,powerPreference:'low-power'});if(!gl||gl.getParameter(gl.MAX_TEXTURE_SIZE)<4096)throw Error('Film rendering unavailable');
    const vertex=`attribute vec2 position;uniform float band,offset,visible,total,time,index,frame,lift,wave,aspect,depth,twistStrength,curveSpan;uniform vec4 bounds,hoverPose,hoverShape;varying highp vec2 uv;varying vec3 surfaceNormal;varying float filmEdge;
      vec3 curve(float u){float q=u*curveSpan;float a=(q+.50)/.44,b=(q-.64)/.94,d=(q+.88)/.62,e=(q-.28)/.83;return vec3(u*aspect,wave*(-1.05*exp(-a*a)+.32*exp(-b*b)-.22*q-.20*q*q*q),depth*(.86*exp(-e*e)-.50*exp(-d*d)-.22));}
      vec4 framePose(){float poseIndex=mod(frame,7.);if(poseIndex<0.5)return vec4(-0.08,0.03,-0.016,0.01);if(poseIndex<1.5)return vec4(0.1,-0.025,0.018,-0.012);if(poseIndex<2.5)return vec4(-0.055,0.045,-0.005,0.025);if(poseIndex<3.5)return vec4(0.075,-0.035,0.012,-0.02);if(poseIndex<4.5)return vec4(-0.09,0.025,-0.02,0.014);if(poseIndex<5.5)return vec4(0.055,-0.04,0.015,-0.005);return vec4(-0.06,0.03,-0.005,0.018);}
      vec3 surface(vec2 v){
        float u=(index+.5-offset+v.x)*2./visible,q=u*curveSpan,a=(q+.50)/.44,b=(q-.64)/.94,d=(q+.88)/.62,e=(q-.28)/.83;
        vec3 tangent=normalize(vec3(aspect,wave*curveSpan*(2.10*a*exp(-a*a)/.44-.64*b*exp(-b*b)/.94-.22-.60*q*q),depth*curveSpan*(-1.72*e*exp(-e*e)/.83+1.00*d*exp(-d*d)/.62)));
        vec3 across=normalize(cross(tangent,vec3(0.,1.,0.))),up=vec3(0.,1.,0.);float r=(q+.42)/.60,t=(q-1.12)/.84,twist=-twistStrength*(1.05*exp(-r*r)-.62*exp(-t*t)-.12);
        vec3 ruling=up*cos(twist)+across*sin(twist),normal=cross(tangent,ruling);float bow=.035*band*(1.-v.y*v.y)*(1.+.25*q/sqrt(1.+q*q));vec3 p=curve(u)+v.y*band*ruling+normal*bow;
        vec4 pose=framePose();float localEdge=v.x*2.,seamWeight=pow(max(0.,1.-localEdge*localEdge),2.);p.x+=band*(v.y*pose.x+.015*localEdge*v.y)*seamWeight;p.y+=band*(pose.z+localEdge*pose.y+.025*(localEdge*localEdge-.3)*v.y)*seamWeight;p.z+=(pose.w+band*(localEdge*pose.y+.018*(1.-v.y*v.y)))*seamWeight;
        if(lift>0.){
          vec4 h=hoverPose,s=hoverShape;float peel=lift*lift*(3.-2.*lift),flex=lift*(2.-lift),edge=v.x*2.;vec3 center=curve((index+.5-offset)*2./visible);
          p+=normal*flex*(1.-peel)*band*(.08*edge*edge-.035*edge)*(.6+s.z*3.);
          vec3 target=vec3(center.x+edge*aspect/visible+band*h.z*v.y,center.y+band*(s.w*v.y+h.y*edge),center.z+band*.02*(1.-v.y*v.y));
          p=mix(p,target,peel*s.x);float lip=s.z*band*peel*edge*edge*(.55+.45*sign(s.y)*edge);
          p.y+=band*h.x*peel+lip*(.3+.7*v.y);p.z+=h.w*peel+band*s.y*edge*peel+lip;
          float compensate=(1.-(center.z+h.w*peel)/3.4)/(1.-center.z/3.4);p.xy*=compensate;
        }return p;
      }
      void main(){vec3 p=surface(position);surfaceNormal=normalize(cross(surface(position+vec2(.002,0.))-p,surface(position+vec2(0.,.002))-p));float w=1.-p.z/3.4;vec4 clip=vec4(p.x/aspect,p.y,-p.z*.18,w);clip.xy=clip.xy*bounds.xy+bounds.zw*w;gl_Position=clip;uv=vec2((mod(frame,4.)+position.x+.5)/4.,1.-(floor(frame/4.)+.5-position.y*.5)/${atlasRows}.);filmEdge=abs(position.y);}`;
    const fragment=`precision highp float;uniform sampler2D film;varying highp vec2 uv;varying vec3 surfaceNormal;varying float filmEdge;void main(){vec4 c=texture2D(film,uv);if(c.a<.01)discard;vec3 n=normalize(surfaceNormal);vec3 light=normalize(vec3(-.35,.7,1.));float diffuse=.91+.09*max(dot(n,light),0.);float sheen=.008*pow(max(dot(n,normalize(vec3(-.15,.35,1.))),0.),20.);float rim=smoothstep(.975,1.,filmEdge)*.025*max(n.z,0.);gl_FragColor=vec4(c.rgb*diffuse+vec3(sheen)+vec3(.91,.86,.78)*rim,c.a);}`;
    program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Film renderer unavailable');
    gl.useProgram(program);const vertices=[];for(let i=0;i<steps;i++){const a=-.5+i/steps,b=-.5+(i+1)/steps;for(let row=0;row<rows;row++){const low=-1+2*row/rows,high=low+2/rows;vertices.push(a,low,b,low,a,high,a,high,b,low,b,high);}}
    const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STATIC_DRAW);const pos=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    uniforms=Object.fromEntries(['band','offset','visible','total','time','index','frame','lift','wave','aspect','depth','twistStrength','curveSpan','bounds','hoverPose','hoverShape'].map(name=>[name,gl.getUniformLocation(program,name)]));texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic');if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(0,0,0,0);canvas.hidden=false;fallback.hidden=true;gallery.dataset.geometry='perspective-ribbon';
    canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();gl=null;canvas.hidden=true;fallback.hidden=false;});
  }catch{gl=null;canvas.hidden=true;fallback.hidden=false;}

  drawAtlas();
  const coverLoads=frames.filter(f=>f.cover).map(f=>new Promise(resolve=>{const image=new Image();image.decoding='async';image.onload=()=>{coverImages.set(f.id,image);resolve();};image.onerror=()=>{gallery.dataset.coverError=f.id;resolve();};image.src=f.cover;}));
  const fontLoad=document.fonts.load('42px "ReelDisplay"').then(faces=>{gallery.dataset.typeface=faces.length?'ReelDisplay':'fallback';}).catch(()=>{gallery.dataset.typeface='fallback';});
  Promise.all([...coverLoads,fontLoad]).then(()=>{requestAtlasDraw();backgroundReady=true;syncBackgroundVideo();});
  resize();new ResizeObserver(resize).observe(gallery);window.addEventListener('resize',resize);
  function pointerPosition(event){const r=gallery.getBoundingClientRect();pointer.x=event.clientX;pointer.y=event.clientY;pointer.nx=clamp((event.clientX-r.left)/r.width*2-1,-1,1);pointer.kind=event.pointerType;pointer.inside=event.pointerType==='mouse';}
  gallery.addEventListener('pointerenter',event=>{if(phase==='browse'){momentum=0;pointerPosition(event);}});gallery.addEventListener('pointerleave',()=>{clearPointer();holdAuto(800);});
  function releaseDrag(){const id=activePointerId;activePointerId=null;dragging=false;gallery.classList.remove('dragging');if(id!==null&&gallery.hasPointerCapture(id))gallery.releasePointerCapture(id);}
  function cancelDrag(){releaseDrag();dragged=false;pressedFrame=null;dragVelocity=velocity=momentum=0;target=offset;clearPointer();}
  gallery.addEventListener('pointerdown',event=>{if(event.button!==0||event.isPrimary===false||activePointerId!==null||phase!=='browse')return;holdAuto();finishEntrance();navigation=null;pressedFrame=gl?pointAt(event,true):activeAbs;lockHoverProfile(pressedFrame);pointer.kind=event.pointerType;activePointerId=event.pointerId;dragging=true;dragged=false;startX=dragX=event.clientX;startY=event.clientY;dragStamp=performance.now();dragVelocity=0;momentum=velocity=0;target=offset;clearPointer();gallery.setPointerCapture(event.pointerId);gallery.classList.add('dragging');});
  gallery.addEventListener('pointermove',event=>{if(phase!=='browse'||event.isPrimary===false)return;if(!dragging){pointerPosition(event);return;}if(event.pointerId!==activePointerId)return;const now=performance.now(),dt=Math.max((now-dragStamp)/1000,.008),dx=event.clientX-dragX;if(Math.abs(event.clientX-startX)>6)dragged=true;if(dragged){const movement=-dx/(viewWidth/visibleFrames);if(movement)pinnedFrame=null;target+=movement;dragVelocity=dragVelocity*.6+clamp(movement/dt,-3,3)*.4;if(paused)offset=target;}dragX=event.clientX;dragStamp=now;});
  gallery.addEventListener('pointerup',event=>{if(event.isPrimary===false)return;if(!dragging){if(phase==='browse')pointerPosition(event);return;}if(event.pointerId!==activePointerId)return;holdAuto();releaseDrag();if(dragged){momentum=paused?0:dragVelocity;clearPointer();}else if(Math.abs(event.clientY-startY)<8){const hit=pressedFrame!==null?pressedFrame:gl?pointAt(event):activeAbs;if(hit!==null)openDetail(hit);}pressedFrame=null;});
  gallery.addEventListener('pointercancel',event=>{if(event.pointerId===activePointerId)cancelDrag();});gallery.addEventListener('lostpointercapture',event=>{if(event.pointerId===activePointerId)cancelDrag();});
  gallery.addEventListener('wheel',event=>{if(phase!=='browse')return;event.preventDefault();holdAuto();finishEntrance();if(navigation){navigation=null;target=offset;}clearPointer();velocity=momentum=0;const delta=Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY;if(delta)pinnedFrame=null;target+=clamp(delta,-160,160)*.004;if(paused)offset=target;},{passive:false});
  window.addEventListener('blur',cancelDrag);document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelDrag();syncBackgroundVideo();last=performance.now();});
  window.addEventListener('hashchange',()=>{if(phase!=='browse')return;const i=frames.findIndex(f=>f.id===location.hash.slice(1));if(i>=0)selectFrame(nearestFrame(i));});
  const stickerLayer=$('.sticker-layer'),stickerItems=[];
  let nextStickerAt=0,stickerTick=0,stickerViewport='',stickerFrame=null;
  function overlaps(a,b,gap=14){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y;}
  function stickerPosition(w,h){
    const occupied=stickerItems.map(item=>item.box),film=[];
    // Sample the current ribbon silhouette only when placing a sticker.
    // Its empty spaces change with the curve; there are no fixed corner slots.
    for(const index of visibleIndices())for(let s=0;s<12;s++){
      const a=-.5+s/12,b=a+1/12,points=[project(index,a,-1),project(index,b,-1),project(index,a,1),project(index,b,1)];
      if(points.some(p=>p.w<=0))continue;
      const xs=points.map(p=>(p.x+1)*viewWidth/2),ys=points.map(p=>(1-p.y)*viewHeight/2);
      film.push({x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)});
    }
    for(let attempt=0;attempt<64;attempt++){
      const box={x:12+Math.random()*Math.max(0,viewWidth-w-24),y:12+Math.random()*Math.max(0,viewHeight-h-24),w,h};
      if(box.x+w>viewWidth-10||box.y+h>viewHeight-10)continue;
      if(!occupied.some(r=>overlaps(box,r,16))&&!film.some(r=>overlaps(box,r,9)))return box;
    }
    return null;
  }
  function syncStickers(now){
    if(!stickerLayer||document.hidden||phase!=='browse')return;
    if(now<stickerTick)return;stickerTick=now+160;
    const viewport=Math.round(viewWidth)+':'+Math.round(viewHeight);
    if(viewport!==stickerViewport){for(const item of stickerItems)item.node.remove();stickerItems.length=0;stickerViewport=viewport;nextStickerAt=now+300;}
    for(let i=stickerItems.length-1;i>=0;i--){const item=stickerItems[i];if(now>=item.until&&!paused){item.node.classList.remove('is-visible');if(now>=item.until+500){item.node.remove();stickerItems.splice(i,1);}}}
    const candidate=mod(browseIndex(),count);
    if(candidate!==stickerFrame){stickerFrame=candidate;nextStickerAt=Math.min(nextStickerAt,now+300+Math.random()*900);}
    stickerLayer.dataset.active=stickerItems.filter(i=>i.node.classList.contains('is-visible')).map(i=>i.asset).join(',');
    if(entrance||navigation||now<nextStickerAt||stickerItems.length>=5||paused&&stickerItems.length)return;
    nextStickerAt=now+850+Math.random()*1450;
    const assets=(window.STICKER_ASSETS||[]).filter(a=>!stickerItems.some(i=>i.asset===a.name));if(!assets.length)return;
    const asset=assets[Math.floor(Math.random()*assets.length)],narrow=portrait||innerWidth<=600;
    const w=Math.min(asset.width*(narrow?1.17:1.5),viewWidth*.32),ratio=asset.ratio.split('/').map(Number),h=w*ratio[1]/ratio[0],box=stickerPosition(w,h);if(!box)return;
    const node=document.createElement('figure'),img=new Image();node.className='sticker sticker-random';node.dataset.asset=asset.name;
    node.style.setProperty('--turn',((Math.random()-.5)*22).toFixed(1)+'deg');node.style.setProperty('--sticker-delay','0ms');
    node.style.width=w+'px';node.style.left=(box.x+w/2)+'px';node.style.top=box.y+'px';node.style.aspectRatio=asset.ratio;
    img.alt='';img.style.cssText='width:'+asset.imageWidth+'%;left:'+asset.left+'%;top:'+asset.top+'%';img.draggable=false;img.decoding='async';
    const item={node,asset:asset.name,box,until:Infinity};stickerItems.push(item);node.append(img);stickerLayer.append(node);
    img.addEventListener('load',()=>{if(!stickerItems.includes(item))return;item.until=performance.now()+4200+Math.random()*4800;node.classList.add('is-visible');},{once:true});
    img.addEventListener('error',()=>{item.until=0;},{once:true});img.src=asset.src;
  }

  function render(now){
    const motionDt=Math.min((now-last)/1000,1),dt=Math.min(motionDt,.05);last=now;
    if(!document.hidden&&(phase!=='open'||transition)){
      if(entrance){if(!paused)elapsed+=dt;updateEntrance(now);}
      else if(phase==='browse'){
        if(navigation){const t=clamp((now-navigation.start)/navigation.duration,0,1),ease=t*t*t*(t*(t*6-15)+10);offset=navigation.from+(navigation.to-navigation.from)*ease;if(t===1){offset=target=navigation.to;navigation=null;}}
        else advanceTrack(now,motionDt);
        normalizeCamera();const previousHover=hoverAbs;hoverAbs=pointer.inside&&!dragging?pointAt({clientX:pointer.x,clientY:pointer.y},true):null;hoverValid=hoverAbs!==null;if(hoverValid&&hoverAbs!==previousHover)lockHoverProfile(hoverAbs);gallery.classList.toggle('is-hovering',hoverValid);
      }
      const indices=visibleIndices();for(const i of new Set([...indices,...lifts.keys()])){const goal=phase==='browse'&&((hoverValid&&hoverAbs===i)||dragging&&!dragged&&pressedFrame===i)?(portrait?.65:1):0;let lift=getLift(i),speed=liftVelocities.get(i)||0;if(paused||pointer.kind==='touch'){lift=pointer.kind==='touch'?0:goal;speed=0;}else{const omega=goal?getHoverProfile(i).omega:8.5,decay=Math.exp(-omega*dt),delta=lift-goal,c=speed+omega*delta;lift=clamp(goal+(delta+c*dt)*decay,0,1);speed=(speed-omega*c*dt)*decay;}if(goal===0&&lift<.0001&&Math.abs(speed)<.001){lifts.delete(i);liftVelocities.delete(i);hoverProfiles.delete(i);}else{lifts.set(i,lift);liftVelocities.set(i,speed);}}
      if(transition){const t=transition.duration?clamp((now-transition.start)/transition.duration,0,1):1;progress=transition.from+(transition.to-transition.from)*t;updateTransition();if(t===1){progress=transition.to;finishTransition();}}
      const key=[offset.toFixed(5),canvas.width,canvas.height,...bounds,...indices.map(i=>getLift(i).toFixed(3))].join(',');
      if(gl&&key!==lastRenderKey){lastRenderKey=key;gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);for(const [name,value] of Object.entries({band,offset,visible:visibleFrames,total:count,time:elapsed,wave,aspect,depth,twistStrength,curveSpan}))gl.uniform1f(uniforms[name],value);gl.uniform4fv(uniforms.bounds,bounds);for(const index of indices){gl.uniform1f(uniforms.index,index);gl.uniform1f(uniforms.frame,mod(index,count));gl.uniform1f(uniforms.lift,getLift(index));const profile=getHoverProfile(index);gl.uniform4fv(uniforms.hoverPose,profile.pose);gl.uniform4fv(uniforms.hoverShape,profile.shape);gl.drawArrays(gl.TRIANGLES,0,steps*rows*6);}}
      publishStatus();syncStickers(now);
    }requestAnimationFrame(render);
  }
  setPhase('browse');setMotion();if(!paused){entrance={start:performance.now(),to:target,from:target};offset=entrance.from;updateEntrance(performance.now());}else gallery.dataset.entrance='skipped';publishStatus(true);requestAnimationFrame(render);
})();
