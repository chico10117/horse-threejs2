import * as THREE from "three";
import { GAITS, gait, pressed, requestJump, state } from "./horse/motion.js";

export const cruiseLabel = document.getElementById("paceValue");
export const paceInput = document.getElementById("paceInput");
export const paceOutput = document.getElementById("paceOutput");
export const gaitValue = document.getElementById("gaitValue");
export const wanderButton = document.getElementById("wanderButton");
export const soundButton = document.getElementById("soundButton");
export const gallopButton = document.getElementById("gallopButton");
export const themeAudio = document.getElementById("themeAudio");
themeAudio.volume = 0.42;

export function syncMusicState() {
  const playing = !themeAudio.paused;
  soundButton.setAttribute("aria-pressed", String(playing));
  soundButton.setAttribute("aria-label", playing ? "Pause music" : "Play music");
}

soundButton.addEventListener("click", async () => {
  if (!themeAudio.paused) {
    themeAudio.pause();
    return;
  }

  try {
    await themeAudio.play();
  } catch {
    syncMusicState();
  }
});

themeAudio.addEventListener("play", syncMusicState);
themeAudio.addEventListener("pause", syncMusicState);
syncMusicState();

export function updatePaceFill() {
  const min = Number(paceInput.min);
  const max = Number(paceInput.max);
  const fill = ((Number(paceInput.value) - min) / (max - min)) * 100;
  paceInput.style.setProperty("--fill", `${fill}%`);
}

export function setAuto(enabled) {
  state.auto = enabled;
  wanderButton.setAttribute("aria-pressed", String(enabled));
}

wanderButton.setAttribute("aria-pressed", String(state.auto));

wanderButton.addEventListener("click", () => {
  setAuto(!state.auto);
});

/* Gallop without holding Shift */
export function setGallop(enabled) {
  state.gallop = enabled;
  gallopButton.setAttribute("aria-pressed", String(enabled));
}

gallopButton.addEventListener("click", () => {
  setGallop(!state.gallop);
});

paceInput.value = String(state.cruise);
paceOutput.textContent = state.cruise.toFixed(1);
paceInput.addEventListener("input", () => {
  state.cruise = Number(paceInput.value);
  paceOutput.textContent = state.cruise.toFixed(1);
  updatePaceFill();
});
updatePaceFill();

export function isTextEntry(target) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

window.addEventListener("keydown", (event) => {
  if (isTextEntry(event.target)) return;

  if (event.code === "Space") {
    if (event.target instanceof Element && event.target.closest("button, a[href]")) return;
    event.preventDefault();
    if (!event.repeat) requestJump();
    return;
  }

  if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
    pressed.add(event.code);
    return;
  }

  const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!movementKeys.includes(event.code)) return;

  event.preventDefault();
  setAuto(false);
  pressed.add(event.code);
});

for (const control of [wanderButton, gallopButton, soundButton, paceInput]) {
  control.addEventListener("pointerup", (event) => {
    if (event.detail > 0) control.blur();
  });
}

window.addEventListener("keyup", (event) => {
  pressed.delete(event.code);
});

window.addEventListener("blur", () => pressed.clear());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pressed.clear();
});

export let gaitText = "";
export let paceText = "";


export function updateReadout() {
  const speed = Math.abs(state.speed);
  const nextGait = state.jump === "air"
    ? "jump"
    : speed < 0.12
      ? "standing"
      : state.speed < 0
        ? "backing"
        : GAITS[gait.dominant].name;
  if (nextGait !== gaitText) {
    gaitText = nextGait;
    gaitValue.textContent = nextGait;
  }
  const nextPace = speed.toFixed(1);
  if (nextPace !== paceText) {
    paceText = nextPace;
    cruiseLabel.textContent = nextPace;
  }
}
