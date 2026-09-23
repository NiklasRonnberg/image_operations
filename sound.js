"use strict";

const NOTE_FREQUENCIES = [
  { name: "C4", hz: 261.63 },
  { name: "C#4", hz: 277.18 },
  { name: "D4", hz: 293.66 },
  { name: "D#4", hz: 311.13 },
  { name: "E4", hz: 329.63 },
  { name: "F4", hz: 349.23 },
  { name: "F#4", hz: 369.99 },
  { name: "G4", hz: 392.00 },
  { name: "G#4", hz: 415.30 },
  { name: "A4", hz: 440.00 },
  { name: "A#4", hz: 466.16 },
  { name: "B4", hz: 493.88 },
  { name: "C5", hz: 523.25 }
];

const DEFAULT_FREQUENCIES = [261.63, 349.23, 392.00];
const FM_MODULATION_INDEX = 10.0;
const LPF_CUTOFF_FREQUENCY = 220.0;
const LPF_RESONANCE_Q = 75.0;
const PHASE_MODULATION_DEPTH = 2.0;

const SOUND_FORMULAS = [
  "Image 1\noutput = osc1",
  "Image 2\noutput = osc2",
  "Addition (1+2)\noutput = 0.5 × osc1 + 0.5 × osc2",
  "Subtraction (1-2)\noutput = 0.5 × osc1 − 0.5 × osc2",
  "Multiplication (1×2)\noutput = osc1 × osc2",
  "Division (1÷2)\ndenominator = sign(osc2) × max(|osc2|, 0.05)\noutput = tanh(osc1 ÷ denominator) × 0.1",
  "Additive (1 − FM by 2)\ninstantaneous frequency = f1 + osc2 × (f2 × FM index)\nFM index = 10",
  "Subtractive (1 − LPF)\noutput = resonantLPF(osc1)\ncutoff = 220 Hz, Q = 75",
  "Image 3\noutput = osc3",
  "Phase mod (3 by 2)\noutput = sin(phase3 + 0.75 × sin(phase2) × phase depth)\nphase depth = 2",
  "Multiplicative (1×2×3)\noutput = osc1 × osc2 × (PM osc3)"
];

const frequencySelects = [
  document.getElementById("frequency1"),
  document.getElementById("frequency2"),
  document.getElementById("frequency3")
];
const playSoundButton = document.getElementById("playSoundButton");

let soundFormulaPanel = null;
let audioContext = null;
let masterGain = null;
let oscillators = [];
let oscillatorGains = [];
let subtractionPositiveGain = null;
let subtractionNegativeGain = null;
let subtractionOutputGain = null;
let multiplicationNode = null;
let multiplicationOutputGain = null;
let divisionNode = null;
let divisionOutputGain = null;
let fmModulationDepthGain = null;
let resonantLowPassFilter = null;
let resonantLowPassOutputGain = null;
let phaseModulationNode = null;
let phaseModulationOutputGain = null;
let tripleMultiplicationNode = null;
let tripleMultiplicationOutputGain = null;
let isPlaying = false;
let selectedButton = -1;
let audioInitializationPromise = null;

function createSoundFormulaPanel() {
  soundFormulaPanel = document.getElementById("soundFormulaPanel");

  if (!soundFormulaPanel) {
    soundFormulaPanel = document.createElement("div");
    soundFormulaPanel.id = "soundFormulaPanel";
    soundFormulaPanel.className = "sound-formula-panel";
    soundFormulaPanel.setAttribute("aria-live", "polite");
    playSoundButton.insertAdjacentElement("afterend", soundFormulaPanel);
  }

  Object.assign(soundFormulaPanel.style, {
    minWidth: "360px",
    minHeight: "48px",
    maxWidth: "min(520px, calc(100vw - 620px))",
    padding: "7px 11px",
    border: "1px solid rgba(255, 255, 255, 0.88)",
    borderRadius: "5px",
    background: "rgba(35, 35, 35, 0.82)",
    color: "#fff",
    backdropFilter: "blur(3px)",
    display: "flex",
    alignItems: "center",
    fontFamily: "Consolas, 'Courier New', monospace",
    fontSize: "11px",
    lineHeight: "1.35",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere"
  });

  updateSoundFormulaPanel();
}

function updateSoundFormulaPanel() {
  if (!soundFormulaPanel) return;
  soundFormulaPanel.textContent =
    selectedButton >= 0 && selectedButton < SOUND_FORMULAS.length
      ? SOUND_FORMULAS[selectedButton]
      : "Select an image operation";
}

function populateFrequencySelects() {
  frequencySelects.forEach((select, oscillatorIndex) => {
    NOTE_FREQUENCIES.forEach(note => {
      const option = document.createElement("option");
      option.value = String(note.hz);
      option.textContent = `${note.name} - ${note.hz.toFixed(2)} Hz`;
      select.appendChild(option);
    });
    select.value = String(DEFAULT_FREQUENCIES[oscillatorIndex]);
    select.addEventListener("change", () => updateOscillatorFrequency(oscillatorIndex));
  });
}

function createAudioWorkletSource() {
  return `
    class BinaryOperatorProcessor extends AudioWorkletProcessor {
      constructor(options) {
        super();
        this.mode = options.processorOptions.mode;
      }
      process(inputs, outputs) {
        const a = inputs[0].length ? inputs[0][0] : null;
        const b = inputs[1].length ? inputs[1][0] : null;
        const output = outputs[0][0];
        for (let i = 0; i < output.length; i++) {
          const x = a ? a[i] : 0;
          const y = b ? b[i] : 0;
          if (this.mode === "multiply") {
            output[i] = x * y;
          } else if (this.mode === "divide") {
            const sign = y < 0 ? -1 : 1;
            const denominator = sign * Math.max(Math.abs(y), 0.05);
            output[i] = Math.tanh(x / denominator) * 0.1;
          } else {
            output[i] = 0;
          }
        }
        return true;
      }
    }

    class TripleMultiplicationProcessor extends AudioWorkletProcessor {
      process(inputs, outputs) {
        const a = inputs[0].length ? inputs[0][0] : null;
        const b = inputs[1].length ? inputs[1][0] : null;
        const c = inputs[2].length ? inputs[2][0] : null;
        const output = outputs[0][0];
        for (let i = 0; i < output.length; i++) {
          output[i] = (a ? a[i] : 0) * (b ? b[i] : 0) * (c ? c[i] : 0);
        }
        return true;
      }
    }

    class PhaseModulationProcessor extends AudioWorkletProcessor {
      static get parameterDescriptors() {
        return [
          { name: "frequency2", defaultValue: 349.23, minValue: 0.001, maxValue: 20000, automationRate: "k-rate" },
          { name: "frequency3", defaultValue: 392.00, minValue: 0.001, maxValue: 20000, automationRate: "k-rate" },
          { name: "phaseDepth", defaultValue: 2.0, minValue: 0, maxValue: 100, automationRate: "k-rate" }
        ];
      }
      constructor() {
        super();
        this.phase2 = 0;
        this.phase3 = 0;
      }
      process(inputs, outputs, parameters) {
        const output = outputs[0][0];
        const f2 = parameters.frequency2[0];
        const f3 = parameters.frequency3[0];
        const depth = parameters.phaseDepth[0];
        const increment2 = 2 * Math.PI * f2 / sampleRate;
        const increment3 = 2 * Math.PI * f3 / sampleRate;
        for (let i = 0; i < output.length; i++) {
          const oscillator2 = Math.sin(this.phase2) * 0.75;
          output[i] = Math.sin(this.phase3 + oscillator2 * depth) * 0.75;
          this.phase2 = (this.phase2 + increment2) % (2 * Math.PI);
          this.phase3 = (this.phase3 + increment3) % (2 * Math.PI);
        }
        return true;
      }
    }

    registerProcessor("binary-operator-processor", BinaryOperatorProcessor);
    registerProcessor("triple-multiplication-processor", TripleMultiplicationProcessor);
    registerProcessor("phase-modulation-processor", PhaseModulationProcessor);
  `;
}

async function initializeAudio() {
  if (audioContext) return;
  if (audioInitializationPromise) return audioInitializationPromise;

  audioInitializationPromise = (async () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      playSoundButton.disabled = true;
      playSoundButton.textContent = "Web Audio unavailable";
      return;
    }

    audioContext = new AudioContextClass();
    const workletBlob = new Blob([createAudioWorkletSource()], { type: "application/javascript" });
    const workletUrl = URL.createObjectURL(workletBlob);
    try {
      await audioContext.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.16;
    masterGain.connect(audioContext.destination);

    oscillators = frequencySelects.map((select, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = Number(select.value);
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start();
      oscillatorGains[index] = gain;
      return oscillator;
    });

    subtractionPositiveGain = audioContext.createGain();
    subtractionPositiveGain.gain.value = 0.5;
    subtractionNegativeGain = audioContext.createGain();
    subtractionNegativeGain.gain.value = -0.5;
    subtractionOutputGain = audioContext.createGain();
    subtractionOutputGain.gain.value = 0;
    oscillators[0].connect(subtractionPositiveGain);
    oscillators[1].connect(subtractionNegativeGain);
    subtractionPositiveGain.connect(subtractionOutputGain);
    subtractionNegativeGain.connect(subtractionOutputGain);
    subtractionOutputGain.connect(masterGain);

    multiplicationNode = new AudioWorkletNode(audioContext, "binary-operator-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { mode: "multiply" }
    });
    multiplicationOutputGain = audioContext.createGain();
    multiplicationOutputGain.gain.value = 0;
    oscillators[0].connect(multiplicationNode, 0, 0);
    oscillators[1].connect(multiplicationNode, 0, 1);
    multiplicationNode.connect(multiplicationOutputGain);
    multiplicationOutputGain.connect(masterGain);

    divisionNode = new AudioWorkletNode(audioContext, "binary-operator-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { mode: "divide" }
    });
    divisionOutputGain = audioContext.createGain();
    divisionOutputGain.gain.value = 0;
    oscillators[0].connect(divisionNode, 0, 0);
    oscillators[1].connect(divisionNode, 0, 1);
    divisionNode.connect(divisionOutputGain);
    divisionOutputGain.connect(masterGain);

    fmModulationDepthGain = audioContext.createGain();
    fmModulationDepthGain.gain.value = 0;
    oscillators[1].connect(fmModulationDepthGain);
    fmModulationDepthGain.connect(oscillators[0].frequency);

    resonantLowPassFilter = audioContext.createBiquadFilter();
    resonantLowPassFilter.type = "lowpass";
    resonantLowPassFilter.frequency.value = LPF_CUTOFF_FREQUENCY;
    resonantLowPassFilter.Q.value = LPF_RESONANCE_Q;
    resonantLowPassOutputGain = audioContext.createGain();
    resonantLowPassOutputGain.gain.value = 0;
    oscillators[0].connect(resonantLowPassFilter);
    resonantLowPassFilter.connect(resonantLowPassOutputGain);
    resonantLowPassOutputGain.connect(masterGain);

    phaseModulationNode = new AudioWorkletNode(audioContext, "phase-modulation-processor", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      parameterData: {
        frequency2: Number(frequencySelects[1].value),
        frequency3: Number(frequencySelects[2].value),
        phaseDepth: PHASE_MODULATION_DEPTH
      }
    });
    phaseModulationOutputGain = audioContext.createGain();
    phaseModulationOutputGain.gain.value = 0;
    phaseModulationNode.connect(phaseModulationOutputGain);
    phaseModulationOutputGain.connect(masterGain);

    tripleMultiplicationNode = new AudioWorkletNode(audioContext, "triple-multiplication-processor", {
      numberOfInputs: 3,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
    tripleMultiplicationOutputGain = audioContext.createGain();
    tripleMultiplicationOutputGain.gain.value = 0;
    oscillators[0].connect(tripleMultiplicationNode, 0, 0);
    oscillators[1].connect(tripleMultiplicationNode, 0, 1);
    oscillators[2].connect(tripleMultiplicationNode, 0, 2);
    tripleMultiplicationNode.connect(tripleMultiplicationOutputGain);
    tripleMultiplicationOutputGain.connect(masterGain);
  })();

  return audioInitializationPromise;
}

function updateOscillatorFrequency(index) {
  if (!audioContext || !oscillators[index]) return;
  const now = audioContext.currentTime;
  const frequency = Number(frequencySelects[index].value);
  oscillators[index].frequency.setTargetAtTime(frequency, now, 0.01);

  if (index === 1 && isPlaying && selectedButton === 6) {
    setGainSmoothly(fmModulationDepthGain, frequency * FM_MODULATION_INDEX, now);
  }

  if (phaseModulationNode) {
    if (index === 1) {
      phaseModulationNode.parameters.get("frequency2").setTargetAtTime(frequency, now, 0.01);
    } else if (index === 2) {
      phaseModulationNode.parameters.get("frequency3").setTargetAtTime(frequency, now, 0.01);
    }
  }
}

function setGainSmoothly(gainNode, value, now) {
  if (!gainNode) return;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setTargetAtTime(value, now, 0.015);
}

function updateAudibleOscillator() {
  if (!audioContext || !masterGain) return;
  const now = audioContext.currentTime;

  oscillatorGains.forEach(gainNode => setGainSmoothly(gainNode, 0, now));
  setGainSmoothly(subtractionOutputGain, 0, now);
  setGainSmoothly(multiplicationOutputGain, 0, now);
  setGainSmoothly(divisionOutputGain, 0, now);
  setGainSmoothly(fmModulationDepthGain, 0, now);
  setGainSmoothly(resonantLowPassOutputGain, 0, now);
  setGainSmoothly(phaseModulationOutputGain, 0, now);
  setGainSmoothly(tripleMultiplicationOutputGain, 0, now);

  if (!isPlaying) return;

  switch (selectedButton) {
    case 0:
      setGainSmoothly(oscillatorGains[0], 0.7, now);
      break;
    case 1:
      setGainSmoothly(oscillatorGains[1], 0.7, now);
      break;
    case 2:
      setGainSmoothly(oscillatorGains[0], 0.5, now);
      setGainSmoothly(oscillatorGains[1], 0.5, now);
      break;
    case 3:
      setGainSmoothly(subtractionOutputGain, 0.8, now);
      break;
    case 4:
      setGainSmoothly(multiplicationOutputGain, 0.8, now);
      break;
    case 5:
      setGainSmoothly(divisionOutputGain, 1.0, now);
      break;
    case 6:
      setGainSmoothly(oscillatorGains[0], 0.5, now);
      setGainSmoothly(
        fmModulationDepthGain,
        Number(frequencySelects[1].value) * FM_MODULATION_INDEX,
        now
      );
      break;
    case 7:
      resonantLowPassFilter.frequency.setTargetAtTime(LPF_CUTOFF_FREQUENCY, now, 0.01);
      resonantLowPassFilter.Q.setTargetAtTime(LPF_RESONANCE_Q, now, 0.01);
      setGainSmoothly(resonantLowPassOutputGain, 0.2, now);
      break;
    case 8:
      setGainSmoothly(oscillatorGains[2], 0.4, now);
      break;
    case 9:
      phaseModulationNode.parameters.get("frequency2").setTargetAtTime(
        Number(frequencySelects[1].value), now, 0.01
      );
      phaseModulationNode.parameters.get("frequency3").setTargetAtTime(
        Number(frequencySelects[2].value), now, 0.01
      );
      phaseModulationNode.parameters.get("phaseDepth").setTargetAtTime(
        PHASE_MODULATION_DEPTH, now, 0.01
      );
      setGainSmoothly(phaseModulationOutputGain, 0.7, now);
      break;
    case 10:
      setGainSmoothly(tripleMultiplicationOutputGain, 1.0, now);
      break;
  }
}

async function toggleSound() {
  try {
    await initializeAudio();
  } catch (error) {
    console.error("Could not initialize Web Audio:", error);
    playSoundButton.disabled = true;
    playSoundButton.textContent = "Audio initialization failed";
    return;
  }

  if (!audioContext) return;
  if (audioContext.state === "suspended") await audioContext.resume();

  isPlaying = !isPlaying;
  playSoundButton.textContent = isPlaying ? "Stop sound" : "Play sound";
  playSoundButton.classList.toggle("playing", isPlaying);
  playSoundButton.setAttribute("aria-pressed", String(isPlaying));
  updateAudibleOscillator();
}

playSoundButton.addEventListener("click", toggleSound);
document.addEventListener("imageoperationchange", event => {
  selectedButton = event.detail.selectedButton;
  updateAudibleOscillator();
  updateSoundFormulaPanel();
});

createSoundFormulaPanel();
populateFrequencySelects();
