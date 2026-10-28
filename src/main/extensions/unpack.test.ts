import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnpackError, crxToZip, readZip, unpackExtension } from "./unpack";

/** Minimal ZIP writer (stored or deflated entries), enough to build test archives. */
function zip(files: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const body = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function crx3(body: Buffer, headerSize = 10): Buffer {
  const head = Buffer.alloc(12);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(headerSize, 8);
  return Buffer.concat([head, Buffer.alloc(headerSize, 0xaa), body]);
}

const MANIFEST = JSON.stringify({ manifest_version: 3, name: "Test", version: "1.0" });

describe("crxToZip", () => {
  it("strips a CRX3 header", () => {
    const body = zip({ "manifest.json": MANIFEST });
    expect(crxToZip(crx3(body)).equals(body)).toBe(true);
  });

  it("strips a CRX2 header", () => {
    const body = zip({ "manifest.json": MANIFEST });
    const head = Buffer.alloc(16);
    head.write("Cr24", 0, "latin1");
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(5, 8);
    head.writeUInt32LE(7, 12);
    expect(crxToZip(Buffer.concat([head, Buffer.alloc(12), body])).equals(body)).toBe(true);
  });

  it("passes a plain ZIP through and refuses anything else", () => {
    const body = zip({ "manifest.json": MANIFEST });
    expect(crxToZip(body)).toBe(body);
    expect(() => crxToZip(Buffer.from("not an extension"))).toThrow(UnpackError);
    const future = crx3(body);
    future.writeUInt32LE(4, 4);
    expect(() => crxToZip(future)).toThrow(/version 4/);
    expect(() => crxToZip(crx3(Buffer.alloc(0), 1000).subarray(0, 40))).toThrow(/tronqué/);
  });
});

describe("readZip", () => {
  it("reads stored and deflated entries", () => {
    for (const deflate of [true, false]) {
      const entries = readZip(zip({ "manifest.json": MANIFEST, "./js/content.js": "x = 1;" }, deflate));
      expect(entries.map((entry) => [entry.path, entry.data.toString()])).toEqual([
        ["manifest.json", MANIFEST],
        ["js/content.js", "x = 1;"],
      ]);
    }
  });

  it("refuses paths escaping the folder", () => {
    expect(() => readZip(zip({ "../evil.js": "x" }))).toThrow(/chemin refusé/);
    expect(() => readZip(zip({ "/etc/evil": "x" }))).toThrow(/chemin refusé/);
    expect(() => readZip(zip({ "a\\..\\..\\evil": "x" }))).toThrow(/chemin refusé/);
  });

  it("detects corrupted data", () => {
    const archive = zip({ "manifest.json": MANIFEST }, false);
    archive[32 + "manifest.json".length - 2] ^= 0xff;
    expect(() => readZip(archive)).toThrow(UnpackError);
    expect(() => readZip(Buffer.from("garbage that is long enough to scan"))).toThrow(UnpackError);
  });
});

describe("unpackExtension", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "unpack-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes a .crx's files into the target folder", () => {
    const target = join(dir, "ext");
    unpackExtension(crx3(zip({ "manifest.json": MANIFEST, "js/c.js": "1" })), target);
    expect(readFileSync(join(target, "manifest.json"), "utf8")).toBe(MANIFEST);
    expect(readFileSync(join(target, "js/c.js"), "utf8")).toBe("1");
  });

  it("unpacks from a single top-level folder", () => {
    const target = join(dir, "ext");
    unpackExtension(zip({ "my-ext/manifest.json": MANIFEST, "my-ext/c.js": "1" }), target);
    expect(existsSync(join(target, "manifest.json"))).toBe(true);
    expect(existsSync(join(target, "my-ext"))).toBe(false);
  });

  it("refuses an archive without a manifest", () => {
    expect(() => unpackExtension(zip({ "readme.txt": "hi" }), join(dir, "ext"))).toThrow(/manifest\.json/);
  });
});
