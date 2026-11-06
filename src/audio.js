import { state } from "./horse/motion.js";
import { legs } from "./horse/legs.js";

const profiles = {
  walk: { rate: 1.1, volume: 0.22 },
  trot: { rate: 1.0, volume: 0.32 },
  gallop: { rate: 0.9, volume: 0.44 },
};

let context = null;
let master = null;
let hoofBuffers = null;
let lastStance = null;

function createHoofBuffer(audioContext) {
  const sampleRate = audioContext.sampleRate;
  const length = Math.floor(sampleRate * 0.18);
  const buffer = audioContext.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const partials = [
    [1720, 0.5, 40],
    [2490, 0.4, 48],
    [3670, 0.32, 55],
    [4980, 0.22, 64],
    [6410, 0.14, 74],
    [8230, 0.08, 90],
  ].map(([frequency, amplitude, decay]) => ({
    frequency: frequency * (1 + (Math.random() - 0.5) * 0.04),
    amplitude,
    decay,
    phase: Math.random() * Math.PI * 2,
  }));

  const filterFrequency = 2 * Math.sin((Math.PI * 3100) / sampleRate);
  let previousNoise = 0;
  let highpassed = 0;
  let lowpassed = 0;
  let bandpassed = 0;
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.0015);
    const noise = Math.random() * 2 - 1;
    highpassed = 0.92 * (highpassed + noise - previousNoise);
    previousNoise = noise;
    lowpassed += filterFrequency * bandpassed;
    const high = noise - lowpassed - 0.35 * bandpassed;
    bandpassed += filterFrequency * high;

    let sample = Math.sin(2 * Math.PI * 118 * t) * Math.exp(-t * 45) * 0.3;
    sample += highpassed * Math.exp(-t * 220) * 0.45;
    sample += bandpassed * Math.exp(-t * 50) * 0.14;
    for (const partial of partials) {
      sample += Math.sin(2 * Math.PI * partial.frequency * t + partial.phase)
        * Math.exp(-t * partial.decay)
        * partial.amplitude;
    }
    sample *= attack;
    data[i] = sample;
    peak = Math.max(peak, Math.abs(sample));
  }

  const scale = peak > 0 ? 0.92 / peak : 1;
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
    hoofBuffers = [createHoofBuffer(context), createHoofBuffer(context), createHoofBuffer(context)];
  }
  if (context.state === "suspended") context.resume();
}

window.addEventListener("pointerdown", unlockAudio, { capture: true, passive: true });
window.addEventListener("keydown", unlockAudio, { capture: true });

function playHoof(leg, profile, intensity) {
  if (!context || context.state !== "running" || !hoofBuffers) return;

  const now = context.currentTime + 0.001;
  const source = context.createBufferSource();
  source.buffer = hoofBuffers[Math.floor(Math.random() * hoofBuffers.length)];
  source.playbackRate.value = profile.rate * (0.95 + Math.random() * 0.1);

  const gain = context.createGain();
  gain.gain.value = profile.volume
    * (0.55 + intensity * 0.65)
    * (0.9 + Math.random() * 0.2)
    * (leg.front ? 0.92 : 1);

  const pan = -leg.side * (leg.front ? 0.18 : 0.3);
  let panner = null;
  if (context.createStereoPanner) {
    panner = context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(gain).connect(panner).connect(master);
  } else {
    source.connect(gain).connect(master);
  }

  source.onended = () => {
    source.disconnect();
    gain.disconnect();
    if (panner) panner.disconnect();
  };
  source.start(now);
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
