const SPRITE_MIME = "image/webp";
const MAX_SPRITE_BYTES = 5 * 1024 * 1024;
const MIN_FRAME_DIMENSION = 32;
const MAX_FRAME_DIMENSION = 512;
const MAX_FRAMES = 16;
const MAX_SPRITE_PIXELS = MAX_FRAME_DIMENSION * MAX_FRAME_DIMENSION * MAX_FRAMES;

function readWebpDimensions(bytes) {
  if (bytes.length < 12 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") throw new Error(`expected ${SPRITE_MIME} bytes`);
  if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error("invalid WebP RIFF length");
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const end = dataOffset + size;
    if (end > bytes.length) throw new Error(`invalid WebP ${type} chunk length`);
    if (type === "VP8X") {
      if (size < 10) throw new Error("invalid WebP VP8X chunk");
      return { width: 1 + bytes.readUIntLE(dataOffset + 4, 3), height: 1 + bytes.readUIntLE(dataOffset + 7, 3) };
    }
    if (type === "VP8 ") {
      if (size < 10 || bytes[dataOffset + 3] !== 0x9d || bytes[dataOffset + 4] !== 0x01 || bytes[dataOffset + 5] !== 0x2a) throw new Error("invalid WebP VP8 frame header");
      return { width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff, height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff };
    }
    if (type === "VP8L") {
      if (size < 5 || bytes[dataOffset] !== 0x2f) throw new Error("invalid WebP VP8L frame header");
      const bits = bytes.readUInt32LE(dataOffset + 1);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    offset = end + (size & 1);
  }
  throw new Error("WebP image data is missing");
}

export function validateSpriteAssetBytes(sprite, bytes, label) {
  if (!sprite || typeof sprite !== "object" || Array.isArray(sprite)) throw new Error(`${label}: sprite metadata must be an object`);
  const { path, frameWidth, frameHeight, frames } = sprite;
  if (typeof path !== "string" || !path.toLowerCase().endsWith(".webp")) throw new Error(`${label}: sprite path must be a .webp file`);
  for (const [field, value, min, max] of [["frameWidth", frameWidth, MIN_FRAME_DIMENSION, MAX_FRAME_DIMENSION], ["frameHeight", frameHeight, MIN_FRAME_DIMENSION, MAX_FRAME_DIMENSION], ["frames", frames, 1, MAX_FRAMES]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label}: ${field} must be an integer between ${min} and ${max}`);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error(`${label}: sprite file is empty`);
  if (bytes.length > MAX_SPRITE_BYTES) throw new Error(`${label}: sprite file exceeds ${MAX_SPRITE_BYTES} bytes`);
  const { width, height } = readWebpDimensions(bytes);
  const expectedWidth = frameWidth * frames;
  if (width !== expectedWidth || height !== frameHeight) throw new Error(`${label}: decoded ${SPRITE_MIME} dimensions ${width}x${height} must equal frameWidth*frames by frameHeight (${expectedWidth}x${frameHeight})`);
  if (width * height > MAX_SPRITE_PIXELS) throw new Error(`${label}: decoded sprite exceeds ${MAX_SPRITE_PIXELS} pixels`);
}
