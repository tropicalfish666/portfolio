/* Preserve native media controls; repair hosts which ignore byte-range requests. */
window.createProjectSeekability=function(video,status){
  let source='',generation=0,checked=false,aborter=null,blobUrl=null,metadataListener=null,job=null;
  function message(text,retry=false){status.textContent=text;status.hidden=!text;status.disabled=!retry;}
  function revoke(){if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}}
  function cancel(){generation++;aborter?.abort();aborter=null;job=null;checked=false;if(metadataListener){video.removeEventListener('loadedmetadata',metadataListener);metadataListener=null;}message('');}
  function reset(url){cancel();revoke();source=url||'';delete video.dataset.seekTransport;}
  function prepare(){
    if(!source||checked||job)return job;
    if(Number.isFinite(video.duration)&&video.duration>0&&video.seekable.length&&video.seekable.end(video.seekable.length-1)>=video.duration-.1){checked=true;video.dataset.seekTransport='stream';return;}
    const currentGeneration=generation,requestedSource=source;aborter=new AbortController();const signal=aborter.signal;
    checked=true;
    job=(async()=>{
      try{
        let response=await fetch(requestedSource,{headers:{Range:'bytes=0-1'},signal});
        if(currentGeneration!==generation){await response.body?.cancel();return;}
        if(response.status===206&&/^bytes 0-1\/\d+$/i.test(response.headers.get('Content-Range')||'')){await response.body?.cancel();video.dataset.seekTransport='stream';return;}
        if(response.status===206){await response.body?.cancel();response=await fetch(requestedSource,{signal});}
        if(response.status!==200||!response.ok||!response.headers.get('Content-Type')?.startsWith('video/')){await response.body?.cancel();throw Error('Video unavailable');}
        const length=Number(response.headers.get('Content-Length')||0);if(length>32*1024*1024){await response.body?.cancel();throw Error('Video too large');}
        message('正在加载可拖动视频…');
        const file=await response.blob();if(currentGeneration!==generation)return;
        if(file.size>32*1024*1024)throw Error('Video too large');
        const time=video.currentTime,resume=!video.paused,rate=video.playbackRate;
        revoke();blobUrl=URL.createObjectURL(file.type.startsWith('video/')?file:new Blob([file],{type:'video/mp4'}));
        metadataListener=()=>{
          metadataListener=null;if(currentGeneration!==generation)return;
          if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(time,video.duration-.05));
          video.playbackRate=rate;video.dataset.seekTransport='local';message('');
          if(resume){const play=video.play();play?.catch(()=>{});}
        };
        video.addEventListener('loadedmetadata',metadataListener,{once:true});video.src=blobUrl;video.load();
      }catch(error){if(currentGeneration!==generation||error.name==='AbortError')return;checked=false;message('跳转加载失败，点击重试',true);}
      finally{if(currentGeneration===generation){job=null;aborter=null;}}
    })();return job;
  }
  video.addEventListener('play',prepare);status.addEventListener('click',prepare);
  window.addEventListener('pagehide',event=>{cancel();if(!event.persisted)revoke();});
  return {reset,cancel,prepare};
};
