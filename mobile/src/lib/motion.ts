import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { Easing, withTiming, type AnimationCallback, type WithTimingConfig } from "react-native-reanimated";

/**
 * Motion policy of the phone app: no springs, no bounce, no pop-ins. Panels, sheets, menus and
 * modals appear and disappear instantly; the only animations left are short ease-out settles that
 * keep continuity after a gesture (a sheet released mid-drag, a pill swiped away) and the
 * toolbar/overview transitions. With "reduce motion" (system or app setting) every duration is 0.
 */
export const MOTION = {
  /** Upper bound of any animation in the app. */
  maxMs: 120,
  /** A value settling from the finger position (or any short continuity transition). */
  settleMs: 120,
  /** Press feedback of `Tap`. */
  pressMs: 80,
} as const;

/** Effective duration: clamped to `MOTION.maxMs`, 0 with reduced motion. */
export function motionDuration(ms: number, reduceMotion: boolean): number {
  "worklet";
  return reduceMotion ? 0 : Math.max(0, Math.min(ms, MOTION.maxMs));
}

/** Timing config of a settle: ease-out, never overshooting. */
export function settleConfig(reduceMotion: boolean, ms: number = MOTION.settleMs): WithTimingConfig {
  "worklet";
  return { duration: motionDuration(ms, reduceMotion), easing: Easing.out(Easing.cubic) };
}

/** Animates a shared value to `target` with a short ease-out (instant with reduced motion). */
export function settle(target: number, reduceMotion: boolean, callback?: AnimationCallback, ms: number = MOTION.settleMs): number {
  "worklet";
  return withTiming(target, settleConfig(reduceMotion, ms), callback);
}

/** OS "reduce motion" (AccessibilityInfo), kept up to date while the app runs. */
export function useSystemReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (alive) setReduce(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return reduce;
}
