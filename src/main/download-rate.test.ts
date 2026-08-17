import { expect, test } from "vite-plus/test";
import { sampleRate, startRate } from "./download-rate";

test("a transfer starts with a mark and no rate", () => {
  const state = startRate(0, 1000);
  expect(state).toEqual({ bytes: 0, at: 1000, rate: 0 });
});

test("the first accepted sample stands as the rate", () => {
  const state = sampleRate(startRate(0, 0), 1024, 1000);
  expect(state.rate).toBe(1024);
  expect(state.bytes).toBe(1024);
  expect(state.at).toBe(1000);
});

test("samples inside the minimum interval are held, not measured", () => {
  const first = sampleRate(startRate(0, 0), 1024, 1000);
  // `updated` fires per chunk; a 10 ms delta measures scheduling, not speed.
  const held = sampleRate(first, 1030, 1010);
  expect(held).toBe(first);
  // The next accepted sample spans the whole gap rather than only its tail.
  const next = sampleRate(held, 2048, 2000);
  expect(next.bytes).toBe(2048);
});

test("later samples are smoothed rather than replacing the rate", () => {
  const first = sampleRate(startRate(0, 0), 1000, 1000);
  const second = sampleRate(first, 3000, 2000);
  // 1000 + 0.3 * (2000 - 1000)
  expect(second.rate).toBeCloseTo(1300);
});

test("a stalled transfer decays towards zero", () => {
  let state = sampleRate(startRate(0, 0), 10_000, 1000);
  expect(state.rate).toBe(10_000);
  for (let n = 0; n < 20; n++) {
    state = sampleRate(state, 10_000, state.at + 500);
  }
  expect(state.rate).toBeLessThan(10);
});

test("a byte count that goes backwards cannot produce a negative rate", () => {
  const first = sampleRate(startRate(0, 0), 5000, 1000);
  const second = sampleRate(first, 1000, 2000);
  expect(second.rate).toBeGreaterThanOrEqual(0);
});
