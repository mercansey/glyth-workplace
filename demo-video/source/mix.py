# usage: python3 mix.py video_only.mp4 out.mp4 [music.mp3]
import json,subprocess,sys
vid,out=sys.argv[1],sys.argv[2]; music=sys.argv[3] if len(sys.argv)>3 else None
T=json.load(open('vo/timing.json'))
ins=['-i',vid]+sum((['-i',f"vo/line_{l['n']:02}.mp3"] for l in T),[])
fl=[f"[{i+1}:a]aresample=48000,adelay={int(round(l['place']*1000))}|{int(round(l['place']*1000))}[a{i}]" for i,l in enumerate(T)]
vo=''.join(f'[a{i}]' for i in range(len(T)))+f"amix=inputs={len(T)}:normalize=0:dropout_transition=0,apad,atrim=0:180,loudnorm=I=-16:TP=-1.5:LRA=11,asplit=2[vo][sc]"
fl.append(vo)
if music:
    m=len(T)+1; ins+=['-i',music]
    fl.append(f"[{m}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=0:180,loudnorm=I=-22:TP=-3,afade=t=in:st=0:d=0.8,afade=t=out:st=177.2:d=2.8[mus]")
    fl.append("[mus][sc]sidechaincompress=threshold=0.03:ratio=6:attack=60:release=650:makeup=1[duck]")
    fl.append("[vo][duck]amix=inputs=2:normalize=0,alimiter=limit=0.89[out]")
    amap='[out]'
else: amap='[vo]'; fl[-1]=fl[-1].replace(',asplit=2[vo][sc]','[vo]')
cmd=['ffmpeg','-y','-loglevel','error']+ins+['-filter_complex',';'.join(fl),'-map','0:v','-map',amap,'-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',out]
r=subprocess.run(cmd,capture_output=True,text=True); print('exit',r.returncode,r.stderr[-400:])
