/**
 * The signup proof-of-work search in plain TypeScript, for the web app's worker: the smallest
 * counter, as an 8-byte big-endian nonce, whose
 * `SHA-256("rim.pow.v1\0" || server id || "\0" || inception payload || nonce)` starts with
 * `bits` zero bits. Everything before the nonce is hashed once; each try then compresses only
 * the last one or two blocks, with no allocation and no WebCrypto call.
 */

/** Context bytes the hash starts with. */
const POW_CONTEXT = "rim.pow.v1\0";

/** Highest difficulty a server may ask for. */
export const MAX_POW_BITS = 40;

const TWO_32 = 0x1_0000_0000;

// prettier-ignore
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

// prettier-ignore
const IV = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** One SHA-256 compression of the 16 words of `m` at `at` into `state`. */
function compress(state: Int32Array, m: Int32Array, at: number, w: Int32Array): void {
  for (let i = 0; i < 16; i++) w[i] = m[at + i];
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15];
    const y = w[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];
  let e = state[4];
  let f = state[5];
  let g = state[6];
  let h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
  state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0;
  state[7] = (state[7] + h) | 0;
}

function readWords(bytes: Uint8Array, into: Int32Array, from: number, to: number): void {
  for (let i = from; i < to; i++) {
    const j = i * 4;
    into[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }
}

/** How many zero bits a hash, as big-endian words, starts with. */
function leadingZeroBits(words: Int32Array): number {
  let bits = 0;
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 0) return bits + Math.clz32(words[i]);
    bits += 32;
  }
  return bits;
}

/** The bytes hashed before the nonce. */
export function powPrefix(serverId: string, inceptionPayload: string): Uint8Array {
  return new TextEncoder().encode(`${POW_CONTEXT}${serverId}\0${inceptionPayload}`);
}

/** A counter as the 8-byte big-endian nonce, in unpadded base64url. */
export function nonceText(counter: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(counter));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hashes one prefix with many nonces. */
export class PowHasher {
  private readonly mid = new Int32Array(8);
  private readonly tail: Uint8Array;
  private readonly words: Int32Array;
  private readonly nonceAt: number;
  private readonly w = new Int32Array(64);
  private readonly state = new Int32Array(8);

  constructor(prefix: Uint8Array) {
    const whole = prefix.length - (prefix.length % 64);
    this.mid.set(IV);
    const head = new Int32Array(16);
    for (let at = 0; at < whole; at += 64) {
      readWords(prefix.subarray(at, at + 64), head, 0, 16);
      compress(this.mid, head, 0, this.w);
    }
    const rest = prefix.length - whole;
    this.nonceAt = rest;
    // The rest of the prefix, the nonce, 0x80 and the 8-byte bit length, in one or two blocks.
    this.tail = new Uint8Array(rest + 8 + 9 <= 64 ? 64 : 128);
    this.tail.set(prefix.subarray(whole));
    this.tail[rest + 8] = 0x80;
    const bitLength = (prefix.length + 8) * 8;
    const view = new DataView(this.tail.buffer);
    view.setUint32(this.tail.length - 8, Math.floor(bitLength / TWO_32));
    view.setUint32(this.tail.length - 4, bitLength >>> 0);
    this.words = new Int32Array(this.tail.length / 4);
    readWords(this.tail, this.words, 0, this.words.length);
  }

  private setCounter(counter: number): void {
    const view = new DataView(this.tail.buffer);
    view.setUint32(this.nonceAt, Math.floor(counter / TWO_32));
    view.setUint32(this.nonceAt + 4, counter >>> 0);
    readWords(this.tail, this.words, this.nonceAt >> 2, (this.nonceAt + 11) >> 2);
  }

  private run(): Int32Array {
    this.state.set(this.mid);
    compress(this.state, this.words, 0, this.w);
    if (this.words.length === 32) compress(this.state, this.words, 16, this.w);
    return this.state;
  }

  /** The hash with `counter` as the nonce. */
  digest(counter: number): Uint8Array {
    this.setCounter(counter);
    const state = this.run();
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) view.setInt32(i * 4, state[i]);
    return out;
  }

  /** The first counter in `[from, from + count)` whose hash meets `bits`, or -1. */
  firstMeeting(bits: number, from: number, count: number): number {
    const end = from + count;
    for (let counter = from; counter < end; counter++) {
      this.setCounter(counter);
      if (leadingZeroBits(this.run()) >= bits) return counter;
    }
    return -1;
  }
}

/** A search to run: the relay's id, the inception payload the signup sends, the difficulty. */
export interface PowJob {
  serverId: string;
  inceptionPayload: string;
  bits: number;
}

/** What the worker answers: the nonce, or why there is none. */
export type PowAnswer = { nonce: string } | { error: string };

/** Run one search for the worker. */
export function answerPowJob(job: PowJob): PowAnswer {
  if (!Number.isInteger(job.bits) || job.bits < 1 || job.bits > MAX_POW_BITS) {
    return { error: `a proof-of-work of ${job.bits} bits is not one this app computes` };
  }
  const counter = searchPow(job.serverId, job.inceptionPayload, job.bits);
  return counter >= 0 ? { nonce: nonceText(counter) } : { error: "no nonce was found" };
}

/** Counters tried between checks for a stop. */
export const POW_CHUNK = 1 << 16;

/**
 * The smallest counter that meets `bits`, tried in order. `keepGoing` is asked between chunks;
 * when it answers false the search ends with -1.
 */
export function searchPow(
  serverId: string,
  inceptionPayload: string,
  bits: number,
  keepGoing: () => boolean = () => true,
): number {
  const hasher = new PowHasher(powPrefix(serverId, inceptionPayload));
  for (let from = 0; from < Number.MAX_SAFE_INTEGER; from += POW_CHUNK) {
    const found = hasher.firstMeeting(bits, from, POW_CHUNK);
    if (found >= 0) return found;
    if (!keepGoing()) return -1;
  }
  return -1;
}
