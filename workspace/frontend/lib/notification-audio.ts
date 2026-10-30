let context: AudioContext | null = null;
let buffer: Promise<AudioBuffer> | null = null;
let lastPlayed = -Infinity;

/** Reuse an audio context unlocked by a real click or key press. */
export async function prepareNotificationAudio(): Promise<AudioContext> {
  if (!context || context.state === 'closed') context = new AudioContext();
  const audio = context;
  if (audio.state === 'suspended') await audio.resume();
  buffer ??= fetch('/notification.wav').then(response => {
    if (!response.ok) throw new Error('Notification sound unavailable');
    return response.arrayBuffer();
  }).then(data => audio.decodeAudioData(data)).catch(error => { buffer = null; throw error; });
  await buffer;
  return audio;
}

export async function playNotificationSound(force = false): Promise<boolean> {
  try {
    const audio = await prepareNotificationAudio();
    if (audio.state !== 'running') return false;
    const sound = await buffer!;
    // Check after loading so simultaneous message and inbox updates coalesce.
    if (!force && Date.now() - lastPlayed < 1200) return true;
    const source = audio.createBufferSource();
    source.buffer = sound;
    const gain = audio.createGain();
    gain.gain.value = 0.5;
    source.connect(gain).connect(audio.destination);
    source.start();
    lastPlayed = Date.now();
    return true;
  } catch { return false; }
}

export function armNotificationAudio(): () => void {
  const unlock = () => { void prepareNotificationAudio().catch(() => {}); };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  return () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
}
