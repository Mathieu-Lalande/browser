import { describe, expect, it, vi } from "vitest";
import {
  arrayOf,
  bool,
  bounds,
  defineHandlers,
  handle,
  handleUi,
  int,
  intIn,
  maxStr,
  nullable,
  num,
  on,
  oneOf,
  opt,
  record,
  registerHandlers,
  str,
  text,
  validArgs,
  type Entry,
} from "./registry";

describe("validators", () => {
  it("reject values of the wrong type", () => {
    expect(str(1)).toBe(false);
    expect(bool("true")).toBe(false);
    expect(num(Number.NaN)).toBe(false);
    expect(num(Infinity)).toBe(false);
    expect(int(1.5)).toBe(false);
    expect(intIn(1, 3)(4)).toBe(false);
    expect(maxStr(3)("abcd")).toBe(false);
    expect(text(3)("")).toBe(false);
    expect(oneOf("a", "b")("c")).toBe(false);
    expect(arrayOf(str, 2)(["a", "b", "c"])).toBe(false);
    expect(arrayOf(str, 2)(["a", 1])).toBe(false);
    expect(record()([])).toBe(false);
    expect(record()(null)).toBe(false);
    expect(record(10)({ long: "x".repeat(20) })).toBe(false);
    expect(bounds({ x: 0, y: 0, width: 1 })).toBe(false);
    expect(opt(str)(null)).toBe(false);
    expect(nullable(str)(undefined)).toBe(false);
  });

  it("accept valid values", () => {
    expect(str("")).toBe(true);
    expect(intIn(1, 3)(3)).toBe(true);
    expect(opt(str)(undefined)).toBe(true);
    expect(nullable(str)(null)).toBe(true);
    expect(oneOf("a", "b")("b")).toBe(true);
    expect(record(100)({ a: 1 })).toBe(true);
    expect(bounds({ x: 0, y: 0, width: 1, height: 2 })).toBe(true);
  });

  it("validArgs refuses missing, invalid and extra arguments", () => {
    expect(validArgs([str, num], ["a", 1])).toBe(true);
    expect(validArgs([str, opt(num)], ["a"])).toBe(true);
    expect(validArgs([str, num], ["a"])).toBe(false);
    expect(validArgs([str, num], ["a", "1"])).toBe(false);
    expect(validArgs([str], ["a", "extra"])).toBe(false);
  });
});

describe("handler tables", () => {
  it("refuse an entry whose handler takes more parameters than validated", () => {
    // @ts-expect-error: the third parameter has no validator.
    const tooMany = on([str], (_c, _a, _b) => undefined);
    expect(() => defineHandlers({ "tab:close": tooMany })).toThrow(/tab:close/);
    // @ts-expect-error: a UI handler gets no window.
    const ui = handleUi([], (_a) => undefined);
    expect(() => defineHandlers({ "settings:get": ui })).toThrow();
    expect(() => defineHandlers({ "tab:close": on([str], (_c, _id) => undefined) })).not.toThrow();
    // @ts-expect-error: parameter types come from the validators (a number has no toUpperCase).
    on([num, opt(str)], (_c, n, s) => n.toUpperCase() + s);
  });

  type Listener = (event: { sender: string }, ...args: unknown[]) => unknown;
  function harness(table: Record<string, Entry>) {
    const listeners = new Map<string, Listener>();
    const ipc = { on: (channel: string, l: Listener) => listeners.set(channel, l), handle: (channel: string, l: Listener) => listeners.set(channel, l) };
    const windows: Record<string, { isPrivate: boolean } | undefined> = { chrome: { isPrivate: false }, overlay: { isPrivate: false }, priv: { isPrivate: true } };
    registerHandlers(ipc, {
      fromUi: (s: string) => windows[s],
      fromChrome: (s: string) => (s === "chrome" || s === "priv" ? windows[s] : undefined),
      isPrivate: (c: { isPrivate: boolean }) => c.isPrivate,
    }, table);
    return (channel: string, sender: string, ...args: unknown[]) => listeners.get(channel)!({ sender }, ...args);
  }

  it("check the sender and the arguments before running", () => {
    const run = vi.fn((_c: unknown, id: string) => id.length);
    const call = harness({ "tab:close": on([str], run), "reader:article": handle([str], run) });
    call("tab:close", "page", "a");
    call("tab:close", "chrome", 1);
    expect(run).not.toHaveBeenCalled();
    call("tab:close", "overlay", "a");
    expect(run).toHaveBeenCalledTimes(1);
    expect(call("reader:article", "chrome", "abc")).toBe(3);
    expect(() => call("reader:article", "page", "abc")).toThrow("Rejected reader:article");
    expect(() => call("reader:article", "chrome", "abc", "extra")).toThrow();
  });

  it("apply the sender options and the fallback", () => {
    const call = harness({
      "browser:get-state": handle([], () => "state", { fallback: null }),
      "sync:pair": handle([], () => "ok", { privateRefused: true }),
      "window:is-maximized": handle([], () => true, { from: "chrome", fallback: false }),
    });
    expect(call("browser:get-state", "page")).toBeNull();
    expect(() => call("sync:pair", "priv")).toThrow();
    expect(call("sync:pair", "chrome")).toBe("ok");
    expect(call("window:is-maximized", "overlay")).toBe(false);
    expect(call("window:is-maximized", "chrome")).toBe(true);
  });
});
