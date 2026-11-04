// Media provider interfaces. Capability is discovered from configuration,
// never assumed: Meta image/audio providers report configured=false unless
// an explicit model id + key are present, and the MVP falls back to system
// TTS (Web Speech / native AVSpeechSynthesizer via Capacitor) for audio and
// abstract gradient artwork for images. Sessions in the library
// carry recorded guided audio (generationSource:'guided-audio'), so audio
// generation is not needed for playback.
export class SystemTTSProvider {
  constructor(){ this.name='system-tts'; this.configured=true; this.kind='audio-fallback'; }
  describe(){ return { provider:this.name, kind:this.kind, configured:true, note:'Fallback only: sessions shipped with the app play their recorded guided audio; device speech is used only for a session without a recording.' }; }
}
export class MetaImageProvider {
  constructor(env=process.env){ this.name='meta-image'; this.model=env.META_IMAGE_MODEL||null; this.apiKey=env.MODEL_API_KEY||''; }
  get configured(){ return Boolean(this.apiKey && this.model); }
  async generateSessionArtwork(spec){ if(!this.configured) throw new Error('Muse Image not configured for this account (set META_IMAGE_MODEL after capability discovery)'); throw new Error('Meta image generation not wired: no verified endpoint for this account'); }
  describe(){ return { provider:this.name, model:this.model, configured:this.configured, note:this.configured?'Configured':'Not configured — sessions use abstract gradient artwork' }; }
}
export class MetaAudioProvider {
  constructor(env=process.env){ this.name='meta-audio'; this.model=env.META_AUDIO_MODEL||null; this.apiKey=env.MODEL_API_KEY||''; }
  get configured(){ return Boolean(this.apiKey && this.model); }
  async generateGuidedAudio(script, voiceConfig={}){ if(!this.configured) throw new Error('Meta speech synthesis not confirmed for this account'); throw new Error('Meta audio generation not wired: no verified endpoint for this account'); }
  describe(){ return { provider:this.name, model:this.model, configured:this.configured, note:this.configured?'Configured':'Not confirmed — SystemTTSProvider fallback is used; no Meta audio generation is claimed' }; }
}
export function mediaStatus(env=process.env){ return { image:new MetaImageProvider(env).describe(), audio:new MetaAudioProvider(env).describe(), audioFallback:new SystemTTSProvider().describe() }; }
