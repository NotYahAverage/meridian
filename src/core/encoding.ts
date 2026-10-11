/** Typed-array ⇄ base64 helpers that work in browsers and Node. */

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeTyped(a: Int32Array | Float32Array | Uint8Array, length?: number): string {
  const n = length ?? a.length;
  const view = new Uint8Array(a.buffer, a.byteOffset, n * a.BYTES_PER_ELEMENT);
  return bytesToBase64(view);
}

export function decodeInt32(b64: string): Int32Array {
  const bytes = base64ToBytes(b64);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function decodeFloat32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

export function decodeUint8(b64: string): Uint8Array {
  return base64ToBytes(b64);
}

/** Run-length encodes a byte grid as (value, count-lo, count-hi) triples. */
export function rleEncode(a: Uint8Array): string {
  const out: number[] = [];
  let i = 0;
  while (i < a.length) {
    const v = a[i];
    let n = 1;
    while (i + n < a.length && a[i + n] === v && n < 65535) n++;
    out.push(v, n & 255, n >> 8);
    i += n;
  }
  return bytesToBase64(Uint8Array.from(out));
}

export function rleDecode(b64: string, length: number): Uint8Array {
  const src = base64ToBytes(b64);
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 2 < src.length; i += 3) {
    const v = src[i];
    const n = src[i + 1] | (src[i + 2] << 8);
    out.fill(v, o, Math.min(length, o + n));
    o += n;
  }
  return out;
}
