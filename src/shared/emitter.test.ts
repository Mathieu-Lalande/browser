import { describe, expect, it, vi } from "vitest";
import { Emitter } from "./emitter";

describe("Emitter", () => {
  it("calls listeners in order until they unsubscribe", () => {
    const emitter = new Emitter<number>();
    const calls: string[] = [];
    const offA = emitter.on((n) => calls.push(`a${n}`));
    emitter.on((n) => calls.push(`b${n}`));
    emitter.emit(1);
    offA();
    emitter.emit(2);
    expect(calls).toEqual(["a1", "b1", "b2"]);
    expect(emitter.size).toBe(1);
  });

  it("emits to the listeners present when it starts", () => {
    const emitter = new Emitter();
    const late = vi.fn();
    const off = emitter.on(() => {
      off();
      emitter.on(late);
    });
    emitter.emit();
    expect(late).not.toHaveBeenCalled();
    emitter.emit();
    expect(late).toHaveBeenCalledTimes(1);
  });
});
