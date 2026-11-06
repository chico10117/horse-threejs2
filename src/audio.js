import { state } from "./horse/motion.js";
import { legs } from "./horse/legs.js";

const profiles = {
  walk: { duration: 0.12, volume: 0.18, frequency: 128, noiseFrequency: 680, noiseVolume: 0.45, noiseQ: 0.5, pitchDrop: 0.65, frontPitch: 1.04, hindPitch: 0.96, frontNoisePitch: 1.03, hindNoisePitch: 0.97 },
  trot: { duration: 0.14, volume: 0.32, frequency: 122, noiseFrequency: 740, noiseVolume: 0.6 },
  gallop: { duration: 0.17, volume: 0.48, frequency: 96, noiseFrequency: 560, noiseVolume: 0.75 },
};

let context = null;
let master = null;
let noiseBuffer = null;
let lastStance = null;

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
  const pitch = leg.front ? profile.frontPitch ?? 1.12 : profile.hindPitch ?? 0.9;
  const frequency = profile.frequency * pitch * (0.94 + Math.random() * 0.12);
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * (profile.pitchDrop ?? 0.55), now + profile.duration);

  const noise = context.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  const noisePitch = leg.front ? profile.frontNoisePitch ?? 1.1 : profile.hindNoisePitch ?? 0.9;
  filter.frequency.value = profile.noiseFrequency * noisePitch;
  filter.Q.value = profile.noiseQ ?? 0.7;
  const noiseGain = context.createGain();
  noiseGain.gain.value = profile.noiseVolume;

  const hit = context.createGain();
  hit.gain.setValueAtTime(0.0001, now);
  hit.gain.exponentialRampToValueAtTime(level, now + 0.004);
  hit.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);

  oscillator.connect(hit);
  noise.connect(filter).connect(noiseGain).connect(hit);

  let panner = null;
  if (context.createStereoPanner) {
    panner = context.createStereoPanner();
    panner.pan.value = pan;
    hit.connect(panner).connect(master);
  } else {
    hit.connect(master);
  }

  oscillator.onended = () => {
    oscillator.disconnect();
    noise.disconnect();
    filter.disconnect();
    noiseGain.disconnect();
    hit.disconnect();
    if (panner) panner.disconnect();
  };

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
