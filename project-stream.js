window.createProjectStreaming=function(video,status){
  let hls=null,source='',retry=0;
  const message=text=>{status.hidden=!text;status.disabled=false;status.textContent=text;};
  function cancel(){if(hls){hls.destroy();hls=null;}video.pause();video.removeAttribute('src');video.load();source='';message('');}
  function load(url){
    cancel();source=url||'';retry=0;if(!source)return;
    if(!source.endsWith('.m3u8')||video.canPlayType('application/vnd.apple.mpegurl')){video.src=source;video.dataset.seekTransport=source.endsWith('.m3u8')?'native-hls':'mp4';return;}
    if(!window.Hls?.isSupported()){message('此浏览器不支持分段视频，请使用 Safari、Chrome 或 Edge。');return;}
    hls=new Hls({maxBufferLength:12,maxMaxBufferLength:20,backBufferLength:10,capLevelToPlayerSize:true});
    video.dataset.seekTransport='hls';hls.loadSource(source);hls.attachMedia(video);
    hls.on(Hls.Events.ERROR,(_,data)=>{if(!data.fatal)return;if(data.type===Hls.ErrorTypes.MEDIA_ERROR&&retry++<1){hls.recoverMediaError();return;}hls.stopLoad();message('视频片段加载失败，点击重试');});
    hls.on(Hls.Events.FRAG_BUFFERED,()=>message(''));
  }
  status.addEventListener('click',()=>{if(hls){message('');hls.startLoad(video.currentTime);}else if(source){const time=video.currentTime;video.load();video.addEventListener('loadedmetadata',()=>{video.currentTime=time;video.play()?.catch(()=>{});},{once:true});}});
  video.addEventListener('error',()=>{if(source&&!hls)message('视频加载失败，点击重试');});
  window.addEventListener('pagehide',cancel);
  return {load,cancel};
};
