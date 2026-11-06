import { state } from "./horse/motion.js";
import { legs } from "./horse/legs.js";

const profiles = {
  walk: { duration: 0.13, volume: 0.2, frequency: 150, noiseFrequency: 900, noiseVolume: 0.5, metalVolume: 0.1, metalRate: 1.06 },
  trot: { duration: 0.14, volume: 0.32, frequency: 122, noiseFrequency: 740, noiseVolume: 0.6, metalVolume: 0.14, metalRate: 1.0 },
  gallop: { duration: 0.17, volume: 0.48, frequency: 96, noiseFrequency: 560, noiseVolume: 0.75, metalVolume: 0.18, metalRate: 0.94 },
};

let context = null;
let master = null;
let noiseBuffer = null;
let metalBuffers = null;
let lastStance = null;

function createMetalBuffer(audioContext) {
  const length = Math.floor(audioContext.sampleRate * 0.12);
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  const partials = [
    [3100, 0.5, 0.05],
    [4600, 0.32, 0.055],
    [6200, 0.16, 0.06],
  ].map(([frequency, amplitude, decay]) => ({
    frequency: frequency * (1 + (Math.random() - 0.5) * 0.04),
    amplitude,
    decay,
    phase: Math.random() * Math.PI * 2,
  }));

  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / audioContext.sampleRate;
    const attack = Math.min(1, t / 0.0015);
    const ring = attack * Math.exp(-t / 0.035);
    let sample = 0;
    for (const partial of partials) {
      sample += Math.sin(2 * Math.PI * partial.frequency * t + partial.phase)
        * partial.amplitude
        * Math.exp(-t / partial.decay);
    }
    sample *= ring;
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const scale = peak > 0 ? 0.8 / peak : 1;
  for (let i = 0; i < length; i += 1) data[i] *= scale;
  return buffer;
}

function unlockAudio() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0.32;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 20;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    master.connect(compressor).connect(context.destination);

    const length = Math.floor(context.sampleRate);
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    metalBuffers = [createMetalBuffer(context), createMetalBuffer(context), createMetalBuffer(context)];
  }
  if (context.state === "suspended") context.resume();
}

window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
window.addEventListener("keydown", unlockAudio, { capture: true });

function playHoof(leg, profile, intensity) {
  if (!context || context.state !== "running" || !noiseBuffer) return;

  const now = context.currentTime + 0.001;
  const level = profile.volume * (0.55 + intensity * 0.65) * (0.9 + Math.random() * 0.2) * (leg.front ? 0.9 : 1);
  const pan = -leg.side * (leg.front ? 0.18 : 0.3);
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  const frequency = profile.frequency * (leg.front ? 1.12 : 0.9) * (0.94 + Math.random() * 0.12);
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.55, now + profile.duration);

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = profile.noiseFrequency * (leg.front ? 1.1 : 0.9);
  filter.Q.value = 0.7;
  const noiseGain = context.createGain();
  noiseGain.gain.value = profile.noiseVolume;

  const hit = context.createGain();
  hit.gain.setValueAtTime(0.0001, now);
  hit.gain.exponentialRampToValueAtTime(level, now + 0.004);
  hit.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);

  oscillator.connect(hit);
  noise.connect(filter).connect(noiseGain).connect(hit);

  let metalSource = null;
  let metalGain = null;
  if (metalBuffers) {
    metalSource = context.createBufferSource();
    metalSource.buffer = metalBuffers[Math.floor(Math.random() * metalBuffers.length)];
    metalSource.playbackRate.value = profile.metalRate * (0.97 + Math.random() * 0.06);
    metalGain = context.createGain();
    metalGain.gain.value = profile.metalVolume * (0.6 + intensity * 0.6) * (0.9 + Math.random() * 0.2);
  }

  let panner = null;
  if (context.createStereoPanner) {
    panner = context.createStereoPanner();
    panner.pan.value = pan;
    hit.connect(panner);
    if (metalGain) metalGain.connect(panner);
    panner.connect(master);
  } else {
    hit.connect(master);
    if (metalGain) metalGain.connect(master);
  }

  oscillator.onended = () => {
    oscillator.disconnect();
    noise.disconnect();
    filter.disconnect();
    noiseGain.disconnect();
    hit.disconnect();
    if (panner) panner.disconnect();
  };

  if (metalSource && metalGain) {
    metalSource.connect(metalGain);
    metalSource.onended = () => {
      metalSource.disconnect();
      metalGain.disconnect();
    };
    metalSource.start(now);
  }

  oscillator.start(now);
  oscillator.stop(now + profile.duration + 0.02);
  noise.start(now, Math.random() * 0.8, profile.duration);
  noise.stop(now + profile.duration + 0.02);
}

export function updateHoofbeats() {
  if (!lastStance) lastStance = legs.map((leg) => leg.stance);

  const speed = Math.abs(state.speed);
  const moving = state.jump !== "air" && speed > 0.12;
  const profile = speed >= 3.7 ? profiles.gallop : speed >= 1.9 ? profiles.trot : profiles.walk;
  const intensity = Math.min(1, speed / 5.8);

  legs.forEach((leg, index) => {
    if (moving && leg.stance && !lastStance[index]) playHoof(leg, profile, intensity);
    lastStance[index] = leg.stance;
  });
}
