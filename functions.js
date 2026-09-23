"use strict";

// ==================================================
// LABELS, FORMULAS, AND PARAMETERS
// ==================================================

const BUTTON_LABELS = [
  "Image 1",
  "Image 2",
  "Addition (1+2)",
  "Subtraction (1-2)",
  "Multiplication (1*2)",
  "Division (1/2)",
  "Additive (1 FM by 2)",
  "Subtractive (1 -> RLPF)",
  "Image 3",
  "Phase mod (3 by 2)",
  "Multiplicative (1*2*3)"
];

const FORMULAS = [
`Source image

Output = Image 1`,

`Source image

Output = Image 2`,

`Addition

R = (R1 + R2) × scale
G = (G1 + G2) × scale
B = (B1 + B2) × scale

scale prevents clipping above 255.`,

`Signed subtraction

R = (R1 - R2 + offset) × scale
G = (G1 - G2 + offset) × scale
B = (B1 - B2 + offset) × scale

offset shifts the most negative value to 0.`,

`Multiplication

R = R1 × R2 × scale
G = G1 × G2 × scale
B = B1 × B2 × scale

scale maps the largest product into 0–255.`,

`Division

R = R1 / max(R2 / 255, 1 / 255)
G = G1 / max(G2 / 255, 1 / 255)
B = B1 / max(B2 / 255, 1 / 255)

normalized = (value / maximum)^0.35
output = normalized × source brightness`,

`FM-style synthesis

carrier = Image 1
modulator = Image 2
index = 5.0

output = sin(
  carrier phase +
  index × sin(modulator phase)
)

Applied independently to R, G, and B.`,

`Resonant low-pass filtering

Output = zeroPhaseLPF(Image 1)

cutoff = 0.025
resonance Q = 6.0

Each channel is filtered horizontally and vertically. Each pass runs forward and backward to reduce phase displacement.`,

`Source image

Output = Image 3`,

`Phase modulation

carrier = Image 3
modulator = Image 2
index = 5.0

output = sin(
  Image 3 phase +
  index × sin(Image 2 phase)
)

Applied independently to R, G, and B.`,

`Multiplicative synthesis

P3 = phaseMod(Image 3, Image 2)

R = (R1/255) × (R2/255) × (P3R/255)
G = (G1/255) × (G2/255) × (P3G/255)
B = (B1/255) × (B2/255) × (P3B/255)

normalized = (value / maximum)^0.35
output = normalized × source brightness`
];

const FM_INDEX = 5.0;
const PHASE_INDEX = 5.0;
const LPF_CUTOFF = 0.025;
const LPF_RESONANCE = 6.0;
const RESIZE_DEBOUNCE_MS = 180;
const TWO_PI = Math.PI * 2;

// ==================================================
// STATE AND CANVASES
// ==================================================

const state = {
  originals: [null, null, null],
  sourceNames: ["1.png", "2.png", "3.png"],
  sources: [null, null, null],
  results: new Array(BUTTON_LABELS.length).fill(null),
  selectedButton: -1,
  selectedImage: null,
  processedWidth: 0,
  processedHeight: 0,
  resizeTimer: 0,
  processingToken: 0
};

const displayCanvas = document.getElementById("displayCanvas");
const displayContext = displayCanvas.getContext("2d", { alpha: false });
const operationButtons = document.getElementById("operationButtons");
const emptyMessage = document.getElementById("emptyMessage");
const busyIndicator = document.getElementById("busyIndicator");
const formulaTitle = document.getElementById("formulaTitle");
const formulaText = document.getElementById("formulaText");

const resizeCanvas = document.createElement("canvas");
const resizeContext = resizeCanvas.getContext("2d", {
  alpha: false,
  willReadFrequently: true
});

const imageCanvas = document.createElement("canvas");
const imageContext = imageCanvas.getContext("2d", { alpha: false });

// ==================================================
// INITIALIZATION AND DEFAULT IMAGES
// ==================================================

async function initialize() {
  createOperationButtons();

  document.getElementById("file1").addEventListener("change", event => loadSelectedFile(event, 0));
  document.getElementById("file2").addEventListener("change", event => loadSelectedFile(event, 1));
  document.getElementById("file3").addEventListener("change", event => loadSelectedFile(event, 2));
  window.addEventListener("resize", scheduleWindowRebuild);

  resizeDisplayCanvas();
  state.processedWidth = displayCanvas.width;
  state.processedHeight = displayCanvas.height;
  updateControls();
  drawSelectedImage();

  await loadDefaultImages();
}

function createOperationButtons() {
  const fragment = document.createDocumentFragment();

  BUTTON_LABELS.forEach((label, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "operation-button";
    button.textContent = label;
    button.dataset.index = String(index);
    button.addEventListener("click", () => selectOperation(index));
    fragment.appendChild(button);
  });

  operationButtons.appendChild(fragment);
}

async function loadDefaultImages() {
  setBusy(true);
  formulaTitle.textContent = "Loading default images";
  formulaText.textContent = `1.png
2.png
3.png`;

  try {
    const loaded = await Promise.all([
      loadImageFromUrl("1.png"),
      loadImageFromUrl("2.png"),
      loadImageFromUrl("3.png")
    ]);

    state.originals = loaded;
    state.sourceNames = ["1.png", "2.png", "3.png"];
    updateAllFileNames();
    await rebuildAllImages();
    state.selectedButton = 0;
    updateSelectedImage();
    updateControls();
    drawSelectedImage();
  } catch (error) {
    console.error("Default image loading failed:", error);
    state.selectedButton = -1;
    updateSelectedImage();
    updateControls();
    emptyMessage.hidden = false;
    emptyMessage.querySelector("strong").textContent = "Default images could not be loaded";
    emptyMessage.querySelector("span").textContent = "Place 1.png, 2.png and 3.png beside index.html and run the folder through a local web server, or choose the files above.";
    formulaTitle.textContent = "Default images unavailable";
    formulaText.textContent = `Expected files:
1.png
2.png
3.png`;
  } finally {
    setBusy(false);
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

// ==================================================
// USER FILE SELECTION
// ==================================================

async function loadSelectedFile(event, imageIndex) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const previousButton = state.selectedButton;
  setBusy(true);

  try {
    state.originals[imageIndex] = await decodeImageFile(file);
    state.sourceNames[imageIndex] = file.name;
    updateFileName(imageIndex, file.name);
    await rebuildAllImages();

    state.selectedButton = operationIsAvailable(previousButton)
      ? previousButton
      : imageIndex === 0 ? 0 : imageIndex === 1 ? 1 : 8;

    updateSelectedImage();
    updateControls();
    drawSelectedImage();
  } catch (error) {
    console.error(error);
    window.alert(`Could not load ${file.name}.`);
  } finally {
    event.target.value = "";
    setBusy(false);
  }
}

async function decodeImageFile(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    return await loadImageFromUrl(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function updateAllFileNames() {
  state.sourceNames.forEach((name, index) => updateFileName(index, name));
}

function updateFileName(index, name) {
  document.getElementById(`fileName${index + 1}`).textContent = name || "Choose file...";
}

// ==================================================
// RESIZING AND SOURCE REBUILDING
// ==================================================

function scheduleWindowRebuild() {
  resizeDisplayCanvas();
  drawSelectedImage();
  window.clearTimeout(state.resizeTimer);

  state.resizeTimer = window.setTimeout(async () => {
    if (displayCanvas.width === state.processedWidth && displayCanvas.height === state.processedHeight) return;

    setBusy(true);
    try {
      const previousButton = state.selectedButton;
      await rebuildAllImages();
      state.selectedButton = operationIsAvailable(previousButton) ? previousButton : firstAvailableButton();
      updateSelectedImage();
      updateControls();
      drawSelectedImage();
    } catch (error) {
      console.error(error);
    } finally {
      setBusy(false);
    }
  }, RESIZE_DEBOUNCE_MS);
}

function resizeDisplayCanvas() {
  displayCanvas.width = Math.max(1, Math.round(window.innerWidth));
  displayCanvas.height = Math.max(1, Math.round(window.innerHeight));
}

async function rebuildAllImages() {
  await new Promise(resolve => requestAnimationFrame(resolve));

  const width = displayCanvas.width;
  const height = displayCanvas.height;
  const token = ++state.processingToken;

  state.sources = state.originals.map(original =>
    original ? resizeOriginalToWindow(original, width, height) : null
  );

  if (token !== state.processingToken) return;
  recalculateAllImages();
  state.processedWidth = width;
  state.processedHeight = height;
}

function resizeOriginalToWindow(source, targetWidth, targetHeight) {
  resizeCanvas.width = targetWidth;
  resizeCanvas.height = targetHeight;
  resizeContext.clearRect(0, 0, targetWidth, targetHeight);
  resizeContext.imageSmoothingEnabled = true;
  resizeContext.imageSmoothingQuality = "high";

  const scale = Math.max(targetWidth / source.width, targetHeight / source.height);
  const scaledWidth = source.width * scale;
  const scaledHeight = source.height * scale;
  const x = (targetWidth - scaledWidth) * 0.5;
  const y = (targetHeight - scaledHeight) * 0.5;

  resizeContext.drawImage(source, x, y, scaledWidth, scaledHeight);
  return resizeContext.getImageData(0, 0, targetWidth, targetHeight);
}

// ==================================================
// RESULT RECALCULATION
// ==================================================

function recalculateAllImages() {
  state.results.fill(null);
  const img1 = state.sources[0];
  const img2 = state.sources[1];
  const img3 = state.sources[2];

  state.results[0] = img1;
  state.results[1] = img2;
  state.results[8] = img3;

  if (img1) state.results[7] = createResonantLPFImage(img1);

  if (img1 && img2) {
    state.results[2] = createAdditiveImage(img1, img2);
    state.results[3] = createSubtractiveImage(img1, img2);
    state.results[4] = createMultiplicativeImage(img1, img2);
    state.results[5] = createDivisionImage(img1, img2);
    state.results[6] = createFMImage(img1, img2, FM_INDEX);
  }

  if (img2 && img3) state.results[9] = createFMImage(img3, img2, PHASE_INDEX);
  if (img1 && img2 && state.results[9]) {
    state.results[10] = createMultiplicativeSynthesisImage(img1, img2, state.results[9]);
  }
}

// ==================================================
// PIXEL HELPERS
// ==================================================

function createOutputLike(image) {
  return new ImageData(image.width, image.height);
}

function clampByte(value) {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

function writePixel(data, index, r, g, b) {
  data[index] = clampByte(r);
  data[index + 1] = clampByte(g);
  data[index + 2] = clampByte(b);
  data[index + 3] = 255;
}

function findBrightestValue(image) {
  if (!image) return 0;
  let brightest = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    brightest = Math.max(brightest, image.data[i], image.data[i + 1], image.data[i + 2]);
  }
  return brightest;
}

// ==================================================
// ADDITION, SUBTRACTION, MULTIPLICATION, DIVISION
// ==================================================

function createAdditiveImage(img1, img2) {
  const out = createOutputLike(img1);
  const a = img1.data, b = img2.data, d = out.data;
  let maximum = 0;

  for (let i = 0; i < a.length; i += 4) {
    maximum = Math.max(maximum, a[i] + b[i], a[i + 1] + b[i + 1], a[i + 2] + b[i + 2]);
  }

  const scale = maximum > 255 ? 255 / maximum : 1;
  for (let i = 0; i < a.length; i += 4) {
    writePixel(d, i, (a[i] + b[i]) * scale, (a[i + 1] + b[i + 1]) * scale, (a[i + 2] + b[i + 2]) * scale);
  }
  return out;
}

function createSubtractiveImage(img1, img2) {
  const out = createOutputLike(img1);
  const a = img1.data, b = img2.data, d = out.data;
  let minimum = 0, maximum = 0;

  for (let i = 0; i < a.length; i += 4) {
    const r = a[i] - b[i], g = a[i + 1] - b[i + 1], bl = a[i + 2] - b[i + 2];
    minimum = Math.min(minimum, r, g, bl);
    maximum = Math.max(maximum, r, g, bl);
  }

  const offset = -minimum;
  const shiftedMaximum = maximum + offset;
  const scale = shiftedMaximum > 255 ? 255 / shiftedMaximum : 1;

  for (let i = 0; i < a.length; i += 4) {
    writePixel(d, i, (a[i] - b[i] + offset) * scale, (a[i + 1] - b[i + 1] + offset) * scale, (a[i + 2] - b[i + 2] + offset) * scale);
  }
  return out;
}

function createMultiplicativeImage(img1, img2) {
  const out = createOutputLike(img1);
  const a = img1.data, b = img2.data, d = out.data;
  let maximum = 0;

  for (let i = 0; i < a.length; i += 4) {
    maximum = Math.max(maximum, a[i] * b[i], a[i + 1] * b[i + 1], a[i + 2] * b[i + 2]);
  }

  const scale = maximum > 255 ? 255 / maximum : 1;
  for (let i = 0; i < a.length; i += 4) {
    writePixel(d, i, a[i] * b[i] * scale, a[i + 1] * b[i + 1] * scale, a[i + 2] * b[i + 2] * scale);
  }
  return out;
}

function createDivisionImage(img1, img2) {
  const out = createOutputLike(img1);
  const a = img1.data, b = img2.data, d = out.data;
  const count = img1.width * img1.height;
  const vr = new Float32Array(count), vg = new Float32Array(count), vb = new Float32Array(count);
  const target = Math.max(findBrightestValue(img1), findBrightestValue(img2));
  let maximum = 0;

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    vr[p] = a[i] / Math.max(b[i] / 255, 1 / 255);
    vg[p] = a[i + 1] / Math.max(b[i + 1] / 255, 1 / 255);
    vb[p] = a[i + 2] / Math.max(b[i + 2] / 255, 1 / 255);
    maximum = Math.max(maximum, vr[p], vg[p], vb[p]);
  }

  const curve = 0.35;
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    writePixel(
      d, i,
      maximum ? Math.pow(vr[p] / maximum, curve) * target : 0,
      maximum ? Math.pow(vg[p] / maximum, curve) * target : 0,
      maximum ? Math.pow(vb[p] / maximum, curve) * target : 0
    );
  }
  return out;
}

// ==================================================
// FM AND PHASE MODULATION
// ==================================================

function createFMImage(carrier, modulator, modulationIndex) {
  const out = createOutputLike(carrier);
  const c = carrier.data, m = modulator.data, d = out.data;

  for (let i = 0; i < c.length; i += 4) {
    const r = Math.sin(c[i] / 255 * TWO_PI + modulationIndex * Math.sin(m[i] / 255 * TWO_PI));
    const g = Math.sin(c[i + 1] / 255 * TWO_PI + modulationIndex * Math.sin(m[i + 1] / 255 * TWO_PI));
    const b = Math.sin(c[i + 2] / 255 * TWO_PI + modulationIndex * Math.sin(m[i + 2] / 255 * TWO_PI));
    writePixel(d, i, (r + 1) * 127.5, (g + 1) * 127.5, (b + 1) * 127.5);
  }
  return out;
}

// ==================================================
// MULTIPLICATIVE SYNTHESIS
// ==================================================

function createMultiplicativeSynthesisImage(img1, img2, phase3) {
  const out = createOutputLike(img1);
  const a = img1.data, b = img2.data, c = phase3.data, d = out.data;
  const count = img1.width * img1.height;
  const vr = new Float32Array(count), vg = new Float32Array(count), vb = new Float32Array(count);
  const target = Math.max(findBrightestValue(img1), findBrightestValue(img2), findBrightestValue(phase3));
  let maximum = 0;

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    vr[p] = (a[i] / 255) * (b[i] / 255) * (c[i] / 255);
    vg[p] = (a[i + 1] / 255) * (b[i + 1] / 255) * (c[i + 1] / 255);
    vb[p] = (a[i + 2] / 255) * (b[i + 2] / 255) * (c[i + 2] / 255);
    maximum = Math.max(maximum, vr[p], vg[p], vb[p]);
  }

  const curve = 0.35;
  for (let p = 0, i = 0; p < count; p++, i += 4) {
    writePixel(
      d, i,
      maximum ? Math.pow(vr[p] / maximum, curve) * target : 0,
      maximum ? Math.pow(vg[p] / maximum, curve) * target : 0,
      maximum ? Math.pow(vb[p] / maximum, curve) * target : 0
    );
  }
  return out;
}

// ==================================================
// RESONANT ZERO-PHASE LOW-PASS FILTER
// ==================================================

function createResonantLPFImage(img1) {
  const width = img1.width, height = img1.height, count = width * height;
  const channels = [new Float32Array(count), new Float32Array(count), new Float32Array(count)];

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    channels[0][p] = img1.data[i];
    channels[1][p] = img1.data[i + 1];
    channels[2][p] = img1.data[i + 2];
  }

  const filtered = channels.map(channel => filterImageChannel(channel, width, height, LPF_CUTOFF, LPF_RESONANCE));
  let minimum = Infinity, maximum = -Infinity;

  for (let p = 0; p < count; p++) {
    minimum = Math.min(minimum, filtered[0][p], filtered[1][p], filtered[2][p]);
    maximum = Math.max(maximum, filtered[0][p], filtered[1][p], filtered[2][p]);
  }

  const offset = minimum < 0 ? -minimum : 0;
  const shiftedMaximum = maximum + offset;
  const scale = shiftedMaximum > 255 ? 255 / shiftedMaximum : 1;
  const out = new ImageData(width, height);

  for (let p = 0, i = 0; p < count; p++, i += 4) {
    writePixel(out.data, i, (filtered[0][p] + offset) * scale, (filtered[1][p] + offset) * scale, (filtered[2][p] + offset) * scale);
  }
  return out;
}

function filterImageChannel(source, width, height, cutoff, resonance) {
  const horizontal = new Float32Array(width * height);
  const vertical = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const start = y * width;
    horizontal.set(zeroPhaseLowPass(source.slice(start, start + width), cutoff, resonance), start);
  }

  const column = new Float32Array(height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) column[y] = horizontal[x + y * width];
    const filtered = zeroPhaseLowPass(column, cutoff, resonance);
    for (let y = 0; y < height; y++) vertical[x + y * width] = filtered[y];
  }
  return vertical;
}

function zeroPhaseLowPass(input, cutoff, resonance) {
  const forward = resonantLowPass(input, cutoff, resonance);
  reverseInPlace(forward);
  const backward = resonantLowPass(forward, cutoff, resonance);
  reverseInPlace(backward);
  return backward;
}

function resonantLowPass(input, cutoff, resonance) {
  const output = new Float32Array(input.length);
  if (!input.length) return output;

  cutoff = Math.min(0.4999, Math.max(0.0001, cutoff));
  resonance = Math.max(0.01, resonance);

  const omega = TWO_PI * cutoff;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * resonance);
  const a0 = 1 + alpha;
  const b0 = ((1 - cosine) * 0.5) / a0;
  const b1 = (1 - cosine) / a0;
  const b2 = ((1 - cosine) * 0.5) / a0;
  const a1 = (-2 * cosine) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = input[0], x2 = input[0], y1 = input[0], y2 = input[0];
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return output;
}

function reverseInPlace(array) {
  for (let left = 0, right = array.length - 1; left < right; left++, right--) {
    const value = array[left];
    array[left] = array[right];
    array[right] = value;
  }
}

// ==================================================
// SELECTION, FORMULA PANEL, AND DISPLAY
// ==================================================

function operationIsAvailable(index) {
  return Boolean(state.results[index]);
}

function firstAvailableButton() {
  if (state.sources[0]) return 0;
  if (state.sources[1]) return 1;
  if (state.sources[2]) return 8;
  return -1;
}

function selectOperation(index) {
  if (!operationIsAvailable(index)) return;
  state.selectedButton = index;
  updateSelectedImage();
  updateControls();
  drawSelectedImage();
}

function updateSelectedImage() {
  state.selectedImage = state.selectedButton >= 0 ? state.results[state.selectedButton] : null;
  document.title = state.selectedButton >= 0 ? BUTTON_LABELS[state.selectedButton] : "Image operations";
  updateFormulaPanel();
  document.dispatchEvent(new CustomEvent("imageoperationchange", {
    detail: { selectedButton: state.selectedButton }
  }));
}

function updateFormulaPanel() {
  if (state.selectedButton < 0 || state.selectedButton >= FORMULAS.length) {
    formulaTitle.textContent = "No operation selected";
    formulaText.textContent = "Select an available image or operation.";
    return;
  }

  formulaTitle.textContent = BUTTON_LABELS[state.selectedButton];
  formulaText.textContent = FORMULAS[state.selectedButton];
}

function updateControls() {
  operationButtons.querySelectorAll(".operation-button").forEach((button, index) => {
    button.disabled = !operationIsAvailable(index);
    button.classList.toggle("selected", index === state.selectedButton);
    button.setAttribute("aria-pressed", String(index === state.selectedButton));
  });
  emptyMessage.hidden = Boolean(state.selectedImage);
}

function drawSelectedImage() {
  const width = displayCanvas.width, height = displayCanvas.height;
  displayContext.fillStyle = "#121212";
  displayContext.fillRect(0, 0, width, height);

  const image = state.selectedImage;
  emptyMessage.hidden = Boolean(image);
  if (!image) return;

  imageCanvas.width = image.width;
  imageCanvas.height = image.height;
  imageContext.putImageData(image, 0, 0);

  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) * 0.5;
  const y = (height - drawHeight) * 0.5;

  displayContext.imageSmoothingEnabled = true;
  displayContext.imageSmoothingQuality = "high";
  displayContext.drawImage(imageCanvas, x, y, drawWidth, drawHeight);
}

function setBusy(busy) {
  busyIndicator.hidden = !busy;
}

initialize();
