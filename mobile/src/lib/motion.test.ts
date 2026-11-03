jest.mock("react-native-reanimated", () => ({
  Easing: { cubic: (t: number) => t * t * t, out: (easing: (t: number) => number) => (t: number) => 1 - easing(1 - t) },
  withTiming: (toValue: number, config: unknown, callback?: unknown) => ({ toValue, config, callback }),
}));

import { MOTION, motionDuration, settle, settleConfig } from "./motion";

describe("motion", () => {
  it("clamps every duration to the maximum and drops it with reduced motion", () => {
    expect(motionDuration(80, false)).toBe(80);
    expect(motionDuration(360, false)).toBe(MOTION.maxMs);
    expect(motionDuration(-5, false)).toBe(0);
    expect(motionDuration(80, true)).toBe(0);
    expect(MOTION.settleMs).toBeLessThanOrEqual(120);
  });

  it("settles with an ease-out that never overshoots", () => {
    const config = settleConfig(false);
    expect(config.duration).toBe(MOTION.settleMs);
    const easing = config.easing as (t: number) => number;
    for (let t = 0; t <= 1; t += 0.05) {
      expect(easing(t)).toBeGreaterThanOrEqual(0);
      expect(easing(t)).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(settleConfig(true).duration).toBe(0);
  });

  it("settle is a timing animation, instant with reduced motion", () => {
    const done = () => {};
    const animation = settle(0, true, done) as unknown as { toValue: number; config: { duration: number }; callback: unknown };
    expect(animation.toValue).toBe(0);
    expect(animation.config.duration).toBe(0);
    expect(animation.callback).toBe(done);
  });
});
