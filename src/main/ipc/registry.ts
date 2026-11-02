import type { Channels } from "@shared/ipc";
import type { BrowserController } from "../window";
import type { Guard, Guarded } from "./validators";

export * from "./validators";

/**
 * IPC tables (ADR-018 rules in one place): every channel names its argument validators and a
 * handler whose parameters are inferred from them. The sender check is done here once: only a
 * known browser UI (chrome or overlay) may call, with exactly the validated arguments.
 *
 * - `on` / `handle`: fire-and-forget / request-response, the handler gets the sender's window;
 * - `onUi` / `handleUi`: same sender check, the handler does not need the window.
 *
 * A rejected `handle` throws (the renderer's promise rejects), a rejected `on` is dropped.
 */

export type ChannelName = (typeof Channels)[keyof typeof Channels];

type Guards = readonly Guard<unknown>[];
export type ArgsOf<G extends Guards> = { -readonly [K in keyof G]: Guarded<G[K]> };

export interface EntryOptions<R = unknown> {
  /** Which UI may call: any of the window's (default) or only its chrome (not the overlay). */
  from?: "ui" | "chrome";
  /** Private windows are refused (default: allowed, the handler decides). */
  privateRefused?: boolean;
  /** `handle` only: answered instead of throwing when the sender is unknown. */
  fallback?: R;
}

export interface Entry {
  readonly kind: "on" | "handle";
  readonly controller: boolean;
  readonly args: Guards;
  readonly run: (...args: never[]) => unknown;
  readonly options: EntryOptions;
}

type Run<G extends Guards, R> = (controller: BrowserController, ...args: ArgsOf<G>) => R;
type RunUi<G extends Guards, R> = (...args: ArgsOf<G>) => R;

const entry = (kind: Entry["kind"], controller: boolean, args: Guards, run: Entry["run"], options: EntryOptions = {}): Entry => ({
  kind,
  controller,
  args,
  run,
  options,
});

export const on = <const G extends Guards>(args: G, run: Run<G, unknown>, options?: Omit<EntryOptions, "fallback">): Entry =>
  entry("on", true, args, run, options);
export const handle = <const G extends Guards, R>(args: G, run: Run<G, R>, options?: EntryOptions<R>): Entry =>
  entry("handle", true, args, run, options);
export const onUi = <const G extends Guards>(args: G, run: RunUi<G, unknown>): Entry => entry("on", false, args, run);
export const handleUi = <const G extends Guards, R>(args: G, run: RunUi<G, R>): Entry => entry("handle", false, args, run);

export type HandlerTable = { readonly [C in ChannelName]?: Entry };

/**
 * Declares a feature's table. Checks at startup that no handler takes more parameters than its
 * validators describe (the compiler already refuses it; this also catches untyped callers).
 */
export function defineHandlers<const T extends HandlerTable>(table: T): T {
  for (const [channel, value] of Object.entries(table)) {
    const e = value as Entry;
    const expected = e.args.length + (e.controller ? 1 : 0);
    if (e.run.length > expected) throw new Error(`IPC ${channel}: handler takes ${e.run.length} parameters, ${expected} validated`);
  }
  return table;
}

/** True when `args` has no more values than validators and each one passes. */
export function validArgs(guards: Guards, args: readonly unknown[]): boolean {
  return args.length <= guards.length && guards.every((guard, i) => guard(args[i]));
}

export interface IpcLike<Sender> {
  on(channel: string, listener: (event: { sender: Sender }, ...args: unknown[]) => void): unknown;
  handle(channel: string, listener: (event: { sender: Sender }, ...args: unknown[]) => unknown): unknown;
}

export interface SenderLookup<Sender, C> {
  /** Window of any browser UI webContents (chrome or overlay). */
  fromUi(sender: Sender): C | undefined;
  /** Window whose chrome is this webContents. */
  fromChrome(sender: Sender): C | undefined;
  isPrivate(controller: C): boolean;
}

/** Registers every entry of `table` on `ipc`, with the sender check and argument validation. */
export function registerHandlers<Sender, C>(ipc: IpcLike<Sender>, lookup: SenderLookup<Sender, C>, table: HandlerTable): void {
  for (const [channel, value] of Object.entries(table)) {
    const e = value as Entry;
    const run = e.run as (...args: unknown[]) => unknown;
    const { from = "ui", privateRefused = false } = e.options;
    const sender = (s: Sender) => {
      const controller = from === "chrome" ? lookup.fromChrome(s) : lookup.fromUi(s);
      return controller && !(privateRefused && lookup.isPrivate(controller)) ? controller : undefined;
    };
    const call = (controller: C, args: unknown[]) => (e.controller ? run(controller, ...args) : run(...args));
    if (e.kind === "on") {
      ipc.on(channel, (event, ...args) => {
        const controller = sender(event.sender);
        if (controller && validArgs(e.args, args)) call(controller, args);
      });
    } else {
      ipc.handle(channel, (event, ...args) => {
        const controller = sender(event.sender);
        if (!controller && "fallback" in e.options) return e.options.fallback;
        if (!controller || !validArgs(e.args, args)) throw new Error(`Rejected ${channel}`);
        return call(controller, args);
      });
    }
  }
}
