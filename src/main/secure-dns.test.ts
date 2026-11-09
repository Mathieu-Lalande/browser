import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from "@shared/settings";
import type { HostResolverConfig } from "@shared/secure-dns";
import { SecureDnsService } from "./secure-dns";

describe("SecureDnsService", () => {
  it("applies the choice at startup and on change, only when it changes", () => {
    let current: Settings = DEFAULT_SETTINGS;
    const listeners: ((settings: Settings) => void)[] = [];
    const applied: HostResolverConfig[] = [];
    const service = new SecureDnsService({
      configure: (config) => applied.push(config),
      settings: () => current,
      onSettingsChanged: (listener) => listeners.push(listener),
    });
    service.start();
    expect(applied).toEqual([{ secureDnsMode: "automatic", secureDnsServers: [] }]);

    const change = (patch: unknown) => {
      current = mergeSettings(current, patch);
      for (const listener of listeners) listener(current);
    };
    change({ appearance: { mode: "dark" } });
    expect(applied).toHaveLength(1);
    change({ privacy: { secureDns: "quad9" } });
    expect(service.current()).toEqual({ secureDnsMode: "secure", secureDnsServers: ["https://dns.quad9.net/dns-query"] });
    change({ privacy: { secureDns: "custom", secureDnsCustomUrl: "https://doh.example/dns-query" } });
    expect(applied.at(-1)).toEqual({ secureDnsMode: "secure", secureDnsServers: ["https://doh.example/dns-query"] });
    expect(applied).toHaveLength(3);
  });
});
