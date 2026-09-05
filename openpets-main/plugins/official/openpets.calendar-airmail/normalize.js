import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharp = createRequire(import.meta.url)("../../../web/node_modules/sharp");

export const COURIER_SOURCES = Object.freeze({
  "courier-airdog": "call_Gf4IiKlgGesVoo7J4J1WUbKl.png",
  "courier-owl": "call_5gGA0u55RaKEFbnGFlGI33zr.png",
  "courier-dragon": "call_ShHY4XO36gg0ObwIrkru0K5c.png",
  "courier-cloud": "call_ta5ayF64kxnBvWANR5UO7bb2.png",
  "courier-bat": "call_kk7FK3D4vAQYInkEjvkqZA3q.png",
  "courier-bee": "call_ncPbM3mf8EchBUh3Whfm1CKf.png",
  "courier-bear-balloon": "call_R7YIF7oK4eo2KVeMCl2iUnLV.png",
  "courier-pig-plane": "exec-51e4263f-296a-409a-893d-3186ac2e780d.png",
  "courier-owl-scout": "exec-55f29d11-4a41-4f2e-9b3b-99fd33fc238c.png",
  "courier-firefly": "exec-8846cac8-bbdc-446a-a2f6-972cfa947b19.png",
  "courier-duck-glider": "exec-8e424ac4-4465-4429-b77a-c4af5c77bf36.png",
  "courier-dog-helicopter": "exec-a3fe6ce9-b9cc-43ac-b7ec-31381c8a0224.png",
  "courier-cat-balloon": "exec-aa759e39-0c5d-47e5-81ca-2b3f86a13312.png",
  "courier-pigeon": "exec-eb381953-adb4-46e2-bed7-9031563ad500.png"
});

const srcDir = join(__dirname, "..", "..", "..", "air");
const destDir = join(__dirname, "assets", "couriers");
const FRAME_COUNT = 8;
const MIN_COMPONENT_PIXELS = 512;
const FRAME_PADDING = 8;
export const CHROMA_KEY_THRESHOLD = 90;
export const SHARED_CROP_BASELINE = Object.freeze({ frames: FRAME_COUNT, frameSize: 256, padding: FRAME_PADDING });

function chromaKey(data, background) {
  const output = Buffer.alloc(data.length / 3 * 4);
  for (let input = 0, pixel = 0; input < data.length; input += 3, pixel += 1) {
    const distance = Math.abs(data[input] - background[0]) + Math.abs(data[input + 1] - background[1]) + Math.abs(data[input + 2] - background[2]);
    if (distance > CHROMA_KEY_THRESHOLD) {
      const offset = pixel * 4;
      output[offset] = data[input]; output[offset + 1] = data[input + 1]; output[offset + 2] = data[input + 2]; output[offset + 3] = 255;
    }
  }
  return output;
}

export function findSubstantialAlphaComponents(data, width, height, minimumPixels = MIN_COMPONENT_PIXELS) {
  const visited = new Uint8Array(width * height); const components = [];
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] || data[start * 4 + 3] === 0) continue;
    const queue = [start]; visited[start] = 1;
    let cursor = 0; let minX = width; let maxX = 0; let minY = height; let maxY = 0;
    while (cursor < queue.length) {
      const pixel = queue[cursor++]; const x = pixel % width; const y = Math.floor(pixel / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const neighbor of [pixel - 1, pixel + 1, pixel - width, pixel + width]) {
        if (neighbor < 0 || neighbor >= visited.length || visited[neighbor]) continue;
        if ((neighbor === pixel - 1 || neighbor === pixel + 1) && Math.abs(neighbor % width - x) !== 1) continue;
        if (data[neighbor * 4 + 3] === 0) continue;
        visited[neighbor] = 1; queue.push(neighbor);
      }
    }
    if (queue.length >= minimumPixels) components.push({ minX, maxX, minY, maxY });
  }
  return components;
}

function cropComponent(alpha, component, sourceWidth) {
  const width = component.maxX - component.minX + 1; const height = component.maxY - component.minY + 1;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) alpha.copy(pixels, y * width * 4, ((component.minY + y) * sourceWidth + component.minX) * 4, ((component.minY + y) * sourceWidth + component.maxX + 1) * 4);
  return { pixels, width, height };
}

function removeChromaSpill(data, background) {
  for (let offset = 0; offset < data.length; offset += 4) {
    const distance = Math.abs(data[offset] - background[0]) + Math.abs(data[offset + 1] - background[1]) + Math.abs(data[offset + 2] - background[2]);
    if (distance <= CHROMA_KEY_THRESHOLD) data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 0;
  }
  return data;
}

export async function inspectSource(file) {
  const { data: raw, info } = await sharp(join(srcDir, file)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const background = [raw[0], raw[1], raw[2]];
  const alpha = chromaKey(raw, background);
  return { width: info.width, height: info.height, background, alpha, components: findSubstantialAlphaComponents(alpha, info.width, info.height).sort((a, b) => a.minX - b.minX) };
}

export async function normalize() {
  await fs.mkdir(destDir, { recursive: true });
  for (const [name, file] of Object.entries(COURIER_SOURCES)) {
    const outputPath = join(destDir, `${name}.webp`);
    const { width: sourceWidth, alpha, background, components } = await inspectSource(file);
    if (components.length !== FRAME_COUNT) throw new Error(`Expected ${FRAME_COUNT} substantial courier components in ${file}, found ${components.length}`);
    const maxWidth = Math.max(...components.map(({ minX, maxX }) => maxX - minX + 1));
    const maxHeight = Math.max(...components.map(({ minY, maxY }) => maxY - minY + 1));
    const scale = Math.min((SHARED_CROP_BASELINE.frameSize - FRAME_PADDING * 2) / maxWidth, (SHARED_CROP_BASELINE.frameSize - FRAME_PADDING * 2) / maxHeight);
    const composites = await Promise.all(components.map(async (component, index) => {
      const image = cropComponent(alpha, component, sourceWidth); const width = Math.round(image.width * scale); const height = Math.round(image.height * scale);
      let pipeline = sharp(image.pixels, { raw: { width: image.width, height: image.height, channels: 4 } });
      if (name === "courier-airdog") pipeline = pipeline.flop();
      const { data } = await pipeline.resize(width, height, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const input = await sharp(removeChromaSpill(data, background), { raw: { width, height, channels: 4 } }).png().toBuffer();
      return { input, left: Math.round((SHARED_CROP_BASELINE.frameSize - width) / 2) + index * SHARED_CROP_BASELINE.frameSize, top: SHARED_CROP_BASELINE.frameSize - FRAME_PADDING - height };
    }));
    const outputWidth = SHARED_CROP_BASELINE.frameSize * FRAME_COUNT;
    const { data: strip } = await sharp({ create: { width: outputWidth, height: SHARED_CROP_BASELINE.frameSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    await sharp(removeChromaSpill(strip, background), { raw: { width: outputWidth, height: SHARED_CROP_BASELINE.frameSize, channels: 4 } }).webp({ lossless: true, effort: 6, alphaQuality: 100 }).toFile(outputPath);
    console.log(`Saved ${FRAME_COUNT}-frame courier strip: ${name}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) normalize().catch((error) => { console.error(error); process.exit(1); });
