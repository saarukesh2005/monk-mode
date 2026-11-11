// Original synthesized cues via Web Audio — no bundled audio assets.
export const SOUNDS = [
  { id: 'bowl', label: 'Singing bowl' },
  { id: 'chime', label: 'Soft chime' },
  { id: 'wood', label: 'Wood block' },
  { id: 'none', label: 'Silent' },
] as const;

let ctx: AudioContext | null = null;

export function playCue(id: string, volume = 0.6): void {
  if (id === 'none' || volume <= 0) return;
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = Math.min(1, volume) * 0.35;
    master.connect(ctx.destination);
    const partials = id === 'bowl' ? [220, 440 * 1.01, 660 * 0.995, 1320] : id === 'chime' ? [880, 1320, 1760] : [520, 1040];
    const decay = id === 'bowl' ? 4.5 : id === 'chime' ? 2.2 : 0.25;
    partials.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const g = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(1 / (i + 1), now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay / (1 + i * 0.4));
      osc.connect(g).connect(master);
      osc.start(now);
      osc.stop(now + decay);
    });
  } catch {
    // Audio is optional; ignore devices without output.
  }
}
