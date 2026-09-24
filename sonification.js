"use strict";

const playSonificationButton = document.getElementById(
  "playSonificationButton"
);

const sonificationStatus = document.getElementById(
  "sonificationStatus"
);

const sonificationPlayhead = document.createElement("div");

sonificationPlayhead.id = "sonificationPlayhead";
sonificationPlayhead.setAttribute("aria-hidden", "true");

Object.assign(
  sonificationPlayhead.style,
  {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "0",
    width: "2px",
    background: "rgba(255, 255, 255, 0.98)",
    boxShadow: "0 0 0 6px rgba(255, 255, 255, 0.10)",
    pointerEvents: "none",
    zIndex: "2",
    transform: "translateX(0px)",
    display: "none"
  }
);

document.getElementById("app").appendChild(
  sonificationPlayhead
);

const DURATION = 8;
const BANDS = 32;
const STEPS = 180;
const LOW = 55;
const HIGH = 1760;

// Blue moves operator 1 from 1x to 4x the band's base frequency.
const BLUE_FREQUENCY_MULTIPLIER = 3;

// Green sets the FM index. A moderate value keeps pure green audible.
const MAX_FM_INDEX = 1.5;

// Sawtooth has more energy than sine, so attenuate its side of the mix.
const SAW_LEVEL = 0.35;

// Final level for the sum of all bands.
const MASTER_LEVEL = 0.08;

let ctx = null;
let master = null;
let activeNodes = [];
let timer = 0;
let playing = false;
let run = 0;
let sonificationPlayheadFrame = 0;
let sonificationPlayheadStart = 0;

function hideSonificationPlayhead() {
  cancelAnimationFrame(
    sonificationPlayheadFrame
  );

  sonificationPlayheadFrame = 0;
  sonificationPlayhead.style.display = "none";
}

function animateSonificationPlayhead() {
  if (!playing || !ctx) {
    hideSonificationPlayhead();
    return;
  }

  const elapsed =
    ctx.currentTime -
    sonificationPlayheadStart;

  const position = Math.max(
    0,
    Math.min(
      1,
      elapsed / DURATION
    )
  );

  const width = Math.max(
    1,
    document.getElementById("app").clientWidth
  );

  const x =
    position *
    (width - 2);

  sonificationPlayhead.style.transform =
    `translateX(${x}px)`;

  if (position < 1) {
    sonificationPlayheadFrame =
      requestAnimationFrame(
        animateSonificationPlayhead
      );
  }
}

function startSonificationPlayhead(audioStartTime) {
  hideSonificationPlayhead();

  sonificationPlayheadStart = audioStartTime;
  sonificationPlayhead.style.transform =
    "translateX(0px)";
  sonificationPlayhead.style.display = "block";

  sonificationPlayheadFrame =
    requestAnimationFrame(
      animateSonificationPlayhead
    );
}

function image() {
  return typeof window.getSelectedImageData === "function"
    ? window.getSelectedImageData()
    : null;
}

function refresh() {
  const ok = Boolean(image());

  playSonificationButton.disabled = !ok;

  if (!playing) {
    playSonificationButton.textContent = "Play sonification";
    playSonificationButton.classList.remove("playing");
    playSonificationButton.setAttribute("aria-pressed", "false");

    sonificationStatus.textContent = ok
  ? "Left → right scan\nTop = high frequencies\nBottom = low frequencies\nRed = sine↔saw timbre\nGreen = FM depth\nBlue = modulator frequency\nBrightness = loudness"
  : "Select an image or operation";
  }
}

function analyse(im) {
  const steps = Math.max(1, Math.min(STEPS, im.width));
  const bands = Math.max(1, Math.min(BANDS, im.height));

  const red = Array.from(
    { length: bands },
    () => new Float32Array(steps)
  );

  const green = Array.from(
    { length: bands },
    () => new Float32Array(steps)
  );

  const blue = Array.from(
    { length: bands },
    () => new Float32Array(steps)
  );

  const level = Array.from(
    { length: bands },
    () => new Float32Array(steps)
  );

  for (let t = 0; t < steps; t++) {
    const x0 = Math.floor(t * im.width / steps);
    const x1 = Math.max(
      x0 + 1,
      Math.floor((t + 1) * im.width / steps)
    );

    for (let b = 0; b < bands; b++) {
      // b = 0 is the bottom image band and therefore the lowest frequency.
      const imageBand = bands - 1 - b;
      const y0 = Math.floor(imageBand * im.height / bands);
      const y1 = Math.max(
        y0 + 1,
        Math.floor((imageBand + 1) * im.height / bands)
      );

      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let count = 0;

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * im.width + x) * 4;

          redSum += im.data[i] / 255;
          greenSum += im.data[i + 1] / 255;
          blueSum += im.data[i + 2] / 255;
          count++;
        }
      }

      const r = count ? redSum / count : 0;
      const g = count ? greenSum / count : 0;
      const bl = count ? blueSum / count : 0;

      red[b][t] = r;
      green[b][t] = g;
      blue[b][t] = bl;

      // Any isolated channel must produce sound.
      // Pure red, pure green, and pure blue all yield level = 1.
      const colourLevel = Math.max(r, g, bl);

      level[b][t] = colourLevel < 0.005
        ? 0
        : Math.pow(colourLevel, 1.15);
    }
  }

  return {
    red,
    green,
    blue,
    level,
    bands,
    steps
  };
}

async function audio() {
  if (!ctx) {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Web Audio unavailable");
    }

    ctx = new AudioContextClass();

    master = ctx.createGain();
    master.gain.value = MASTER_LEVEL;
    master.connect(ctx.destination);
  }

  if (ctx.state === "suspended") {
    await ctx.resume();
  }
}

function scheduleValue(parameter, value, at, ramp) {
  parameter.linearRampToValueAtTime(
    value,
    at + ramp
  );
}

function stop(msg = "Sonification stopped") {
  run++;
  clearTimeout(timer);
  hideSonificationPlayhead();

  for (const node of activeNodes) {
    try {
      if (typeof node.stop === "function") {
        node.stop();
      }
    } catch (error) {
      // The oscillator may already have stopped.
    }

    try {
      node.disconnect();
    } catch (error) {
      // The node may already be disconnected.
    }
  }

  activeNodes = [];
  playing = false;

  playSonificationButton.textContent = "Play sonification";
  playSonificationButton.classList.remove("playing");
  playSonificationButton.setAttribute("aria-pressed", "false");
  sonificationStatus.textContent = msg;

  refresh();
}

async function toggle() {
  if (playing) {
    stop();
    return;
  }

  const im = image();

  if (!im) {
    refresh();
    return;
  }

  try {
    await audio();
  } catch (error) {
    sonificationStatus.textContent = error.message;
    return;
  }

  const id = ++run;
  const data = analyse(im);
  const start = ctx.currentTime + 0.05;
  const dt = DURATION / data.steps;
  const ramp = Math.min(0.02, dt * 0.4);

  playing = true;
  playSonificationButton.textContent = "Stop sonification";
  playSonificationButton.classList.add("playing");
  playSonificationButton.setAttribute("aria-pressed", "true");

  startSonificationPlayhead(start);

  for (let b = 0; b < data.bands; b++) {
    const bandPosition = data.bands > 1
      ? b / (data.bands - 1)
      : 0;

    const baseFrequency =
      LOW *
      Math.pow(
        HIGH / LOW,
        bandPosition
      );

    const bassBoost =
      1 +
      (1 - bandPosition) * 3;

    // Operator 1 is the modulator. Two parallel oscillators allow a
    // continuously controlled sine-to-saw crossfade from the red channel.
    const op1Sine = ctx.createOscillator();
    const op1Saw = ctx.createOscillator();
    const op1SineGain = ctx.createGain();
    const op1SawGain = ctx.createGain();
    const fmDepth = ctx.createGain();

    op1Sine.type = "sine";
    op1Saw.type = "sawtooth";

    // Operator 2 is the audible carrier. It also uses a red-controlled
    // sine-to-saw crossfade.
    const op2Sine = ctx.createOscillator();
    const op2Saw = ctx.createOscillator();
    const op2SineGain = ctx.createGain();
    const op2SawGain = ctx.createGain();
    const bandOutput = ctx.createGain();

    op2Sine.type = "sine";
    op2Saw.type = "sawtooth";

    op1Sine.frequency.setValueAtTime(baseFrequency, start);
    op1Saw.frequency.setValueAtTime(baseFrequency, start);
    op2Sine.frequency.setValueAtTime(baseFrequency, start);
    op2Saw.frequency.setValueAtTime(baseFrequency, start);

    op1SineGain.gain.setValueAtTime(1, start);
    op1SawGain.gain.setValueAtTime(0, start);
    op2SineGain.gain.setValueAtTime(1, start);
    op2SawGain.gain.setValueAtTime(0, start);
    fmDepth.gain.setValueAtTime(0, start);
    bandOutput.gain.setValueAtTime(0, start);

    // Operator 1 is audible only through frequency modulation.
    op1Sine.connect(op1SineGain);
    op1Saw.connect(op1SawGain);
    op1SineGain.connect(fmDepth);
    op1SawGain.connect(fmDepth);
    fmDepth.connect(op2Sine.frequency);
    fmDepth.connect(op2Saw.frequency);

    // Operator 2 always reaches the output whenever colour level is nonzero.
    op2Sine.connect(op2SineGain);
    op2Saw.connect(op2SawGain);
    op2SineGain.connect(bandOutput);
    op2SawGain.connect(bandOutput);
    bandOutput.connect(master);

    for (let t = 0; t < data.steps; t++) {
      const at = start + t * dt;
      const r = data.red[b][t];
      const g = data.green[b][t];
      const bl = data.blue[b][t];

      // Red: equal-power sine-to-saw crossfade.
      const sineMix = Math.cos(r * Math.PI * 0.5);
      const sawMix = Math.sin(r * Math.PI * 0.5) * SAW_LEVEL;

      // Blue: operator 1 rises from 1x to 4x the band frequency.
      const op1Frequency =
        baseFrequency *
        (1 + bl * BLUE_FREQUENCY_MULTIPLIER);

      // Green: FM index. Pure green keeps a full audible carrier and adds FM.
      const requestedFmDepth =
        g *
        baseFrequency *
        MAX_FM_INDEX;

      // Keep frequency excursions below the useful Nyquist region.
      const safeFmDepth = Math.max(
        0,
        ctx.sampleRate * 0.45 - baseFrequency
      );

      const modulationDepth = Math.min(
        requestedFmDepth,
        safeFmDepth
      );

      // Overall loudness comes from the strongest RGB component, not from
      // weighted luminance. This guarantees sound for a pure-green image.
      const amplitude =
        data.level[b][t] *
        bassBoost /
        Math.sqrt(data.bands);

      scheduleValue(
        op1Sine.frequency,
        op1Frequency,
        at,
        ramp
      );

      scheduleValue(
        op1Saw.frequency,
        op1Frequency,
        at,
        ramp
      );

      scheduleValue(
        op1SineGain.gain,
        sineMix,
        at,
        ramp
      );

      scheduleValue(
        op1SawGain.gain,
        sawMix,
        at,
        ramp
      );

      scheduleValue(
        op2SineGain.gain,
        sineMix,
        at,
        ramp
      );

      scheduleValue(
        op2SawGain.gain,
        sawMix,
        at,
        ramp
      );

      scheduleValue(
        fmDepth.gain,
        modulationDepth,
        at,
        ramp
      );

      scheduleValue(
        bandOutput.gain,
        amplitude,
        at,
        ramp
      );
    }

    bandOutput.gain.linearRampToValueAtTime(
      0,
      start + DURATION
    );

    const stopTime = start + DURATION + 0.05;

    op1Sine.start(start);
    op1Saw.start(start);
    op2Sine.start(start);
    op2Saw.start(start);

    op1Sine.stop(stopTime);
    op1Saw.stop(stopTime);
    op2Sine.stop(stopTime);
    op2Saw.stop(stopTime);

    activeNodes.push(
      op1Sine,
      op1Saw,
      op1SineGain,
      op1SawGain,
      fmDepth,
      op2Sine,
      op2Saw,
      op2SineGain,
      op2SawGain,
      bandOutput
    );
  }

  timer = setTimeout(
    () => {
      if (id === run) {
        stop("Sonification complete");
      }
    },
    (DURATION + 0.15) * 1000
  );
}

playSonificationButton.addEventListener(
  "click",
  toggle
);

document.addEventListener(
  "imageoperationchange",
  () => {
    if (playing) {
      stop("Image changed");
    }

    refresh();
  }
);

refresh();
