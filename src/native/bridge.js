// Native bridge facade. On web every native capability reports
// unsupported/unavailable — never fake success. Inside Capacitor iOS the
// GlythNative Swift plugin (ios-native/GlythNative) provides the real thing.
export function nativePlatform() {
  const cap = globalThis.Capacitor;
  return { platform: cap?.getPlatform?.() || 'web', isNative: Boolean(cap?.isNativePlatform?.()) };
}
export async function nativeCapabilities() {
  const { platform, isNative } = nativePlatform();
  if (!isNative) return { platform, healthKit: false, calendar: false, push: false, backgroundRefresh: false, secureStorage: false };
  try { const r = await globalThis.Capacitor?.Plugins?.GlythNative?.capabilities(); return { platform, healthKit: Boolean(r?.healthKit), calendar: Boolean(r?.calendar), push: Boolean(r?.push), backgroundRefresh: Boolean(r?.backgroundRefresh), secureStorage: true }; }
  catch { return { platform, healthKit: false, calendar: false, push: false, backgroundRefresh: false, secureStorage: false }; }
}
async function call(method, args) {
  const plugin = globalThis.Capacitor?.Plugins?.GlythNative;
  if (!plugin?.[method]) throw Object.assign(new Error('This capability needs the iOS app'), { code: 'unavailable_web' });
  return plugin[method](args);
}
export const HealthBridge = {
  isAvailable: async () => (await nativeCapabilities()).healthKit,
  authorizationStatus: () => call('healthAuthorizationStatus'),
  requestAuthorization: () => call('healthRequestAuthorization'),
  syncSleep: () => call('healthSyncSleep'), syncRecoverySignals: () => call('healthSyncRecovery'), syncWorkouts: () => call('healthSyncWorkouts'),
};
export const CalendarBridge = {
  authorizationStatus: () => call('calendarAuthorizationStatus'),
  requestReadAccess: () => call('calendarRequestFullAccess'), requestWriteAccess: () => call('calendarRequestWriteOnlyAccess'),
  syncEvents: (range) => call('calendarSyncEvents', range), createEvent: (e) => call('calendarCreateEvent', e),
};
export const SecureStorageBridge = { set: (k, v) => call('secureSet', { key: k, value: v }), get: (k) => call('secureGet', { key: k }), remove: (k) => call('secureRemove', { key: k }) };

export const SpeechBridge = {
  isAvailable: async () => { const { isNative } = nativePlatform(); if (isNative && globalThis.Capacitor?.Plugins?.GlythNative?.speechSpeak) return true; return typeof globalThis.speechSynthesis !== 'undefined'; },
  speak: (text, rate=0.92) => call('speechSpeak', { text, rate }),
  stop: () => call('speechStop', {}),
};
