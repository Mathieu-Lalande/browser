import { JsonFileWriter, readJsonFile } from "./json-file";
import { Emitter } from "@shared/emitter";

/** Hostnames where the user turned protections off, persisted as `{ "disabledHosts": [...] }`. */
export class ShieldsAllowList {
  private readonly hosts: Set<string>;
  private readonly writer: JsonFileWriter;
  private readonly changes = new Emitter();

  constructor(file: string) {
    this.writer = new JsonFileWriter(file);
    const data = readJsonFile(file) as { disabledHosts?: unknown } | undefined;
    const hosts: unknown[] = Array.isArray(data?.disabledHosts) ? data.disabledHosts : [];
    this.hosts = new Set(hosts.filter((host): host is string => typeof host === "string" && host.length > 0));
  }

  isEnabled(host: string): boolean {
    return !this.hosts.has(host.toLowerCase());
  }

  setEnabled(host: string, enabled: boolean): Promise<void> {
    const key = host.toLowerCase();
    if (enabled) this.hosts.delete(key);
    else this.hosts.add(key);
    this.changes.emit();
    return this.writer.save({ disabledHosts: [...this.hosts].sort() });
  }

  onChange(listener: () => void): () => void {
    return this.changes.on(listener);
  }
}
