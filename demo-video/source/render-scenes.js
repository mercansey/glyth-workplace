const { chromium } = require('playwright'); const { spawn } = require('child_process'); const fs=require('fs');
(async()=>{
  const [a,b,name]=[+process.argv[2],+process.argv[3],process.argv[4]];
  const br=await chromium.launch(); const pg=await br.newPage({viewport:{width:1920,height:1080}});
  await pg.goto('file://'+__dirname+'/'+(process.env.PAGE||'stage.html')); await pg.evaluate(()=>document.fonts.ready);
  const tmp=`${name}.part.mp4`;
  const ff=spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate','30','-c:v','mjpeg','-i','-','-c:v','libx264','-crf','18','-preset','veryfast','-pix_fmt','yuv420p','-r','30',tmp]);
  for(let f=Math.round(a*30); f<Math.round(b*30); f++){
    await pg.evaluate(t=>render(t), f/30);
    const buf=await pg.screenshot({type:'jpeg',quality:92});
    if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r));
  }
  ff.stdin.end(); const code=await new Promise(r=>ff.on('close',r)); await br.close();
  if(code===0) fs.renameSync(tmp,`${name}.mp4`); else { console.error('ffmpeg failed',name); process.exit(1); }
})();
