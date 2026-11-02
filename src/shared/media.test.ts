import { describe, expect, it } from "vitest";
import {
  MEDIA_RECENT_MS,
  buildSource,
  currentPosition,
  formatMediaTime,
  isMediaAction,
  miniPlayerSources,
  mostRecentPlayer,
  parseMediaProbe,
  pickArtwork,
  progressOf,
  sameSource,
  type MediaSource,
} from "./media";

const source = (patch: Partial<MediaSource> = {}): MediaSource => ({
  tabId: "t1",
  spaceId: "s1",
  title: "Titre",
  subtitle: "Artiste",
  artwork: null,
  playing: true,
  muted: false,
  duration: 100,
  position: 10,
  positionAt: 1000,
  video: false,
  controllable: true,
  changedAt: 1000,
  ...patch,
});

describe("parseMediaProbe", () => {
  it("keeps validated metadata and element state", () => {
    const probe = parseMediaProbe({
      title: " Morceau\n un ",
      artist: "Ada",
      album: 3,
      artwork: [{ src: "https://cdn.test/a.png", sizes: "512x512" }],
      hasSession: true,
      element: { duration: Infinity, position: 12.5, paused: false, video: true },
    });
    expect(probe).toEqual({
      title: "Morceau un",
      artist: "Ada",
      album: "",
      artwork: "https://cdn.test/a.png",
      hasSession: true,
      element: { duration: null, position: 12.5, paused: false, video: true },
    });
  });

  it("refuses garbage and caps strings", () => {
    expect(parseMediaProbe(null)).toBeNull();
    expect(parseMediaProbe("x")).toBeNull();
    const probe = parseMediaProbe({ title: "a".repeat(5000), element: { position: -4, duration: NaN } });
    expect(probe?.title.length).toBe(300);
    expect(probe?.element).toEqual({ duration: null, position: 0, paused: true, video: false });
  });
});

describe("pickArtwork", () => {
  it("prefers the smallest image at least 96 px, else the largest", () => {
    const list = [
      { src: "https://a.test/48.png", sizes: "48x48" },
      { src: "https://a.test/512.png", sizes: "512x512" },
      { src: "https://a.test/128.png", sizes: "128x128" },
    ];
    expect(pickArtwork(list)).toBe("https://a.test/128.png");
    expect(pickArtwork(list.slice(0, 1))).toBe("https://a.test/48.png");
  });

  it("only takes http(s) and raster data: URLs", () => {
    expect(pickArtwork([{ src: "javascript:alert(1)" }, { src: "blob:https://a.test/x" }])).toBeNull();
    expect(pickArtwork([{ src: "data:image/svg+xml;base64,PHN2Zz4=" }])).toBeNull();
    expect(pickArtwork([{ src: "data:image/png;base64,iVBORw0KGgo=" }])).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(pickArtwork("nope")).toBeNull();
  });
});

describe("positions and times", () => {
  it("extrapolates while playing, capped at the duration", () => {
    expect(currentPosition(source(), 3000)).toBe(12);
    expect(currentPosition(source({ playing: false }), 3000)).toBe(10);
    expect(currentPosition(source(), 1_000_000)).toBe(100);
    expect(progressOf(source(), 1000)).toBe(0.1);
    expect(progressOf(source({ duration: null }), 1000)).toBeNull();
  });

  it("formats times", () => {
    expect(formatMediaTime(65)).toBe("1:05");
    expect(formatMediaTime(3723)).toBe("1:02:03");
    expect(formatMediaTime(null)).toBe("En direct");
  });
});

describe("mini-player selection", () => {
  it("leaves out the tabs on screen and stale paused sources, most recent first", () => {
    const now = 10 * MEDIA_RECENT_MS;
    const list = [
      source({ tabId: "a", playing: false, changedAt: now - 1000 }),
      source({ tabId: "b", playing: true, changedAt: now - 5000 }),
      source({ tabId: "c", playing: false, changedAt: now - MEDIA_RECENT_MS - 1 }),
      source({ tabId: "d", playing: true, changedAt: now }),
    ];
    expect(miniPlayerSources(list, ["d"], now).map((s) => s.tabId)).toEqual(["b", "a"]);
    expect(mostRecentPlayer(list)?.tabId).toBe("d");
    expect(mostRecentPlayer([source({ playing: false })])).toBeNull();
  });
});

describe("buildSource", () => {
  const tab = { title: "Onglet", url: "https://www.radio.test/live", favicon: "data:image/png;base64,AA==", isMuted: true };

  it("falls back to the tab's title, host and favicon", () => {
    const built = buildSource({ tabId: "t", spaceId: "s", tab, probe: null, artwork: null, playing: true, now: 5 });
    expect(built).toMatchObject({ title: "Onglet", subtitle: "radio.test", artwork: tab.favicon, muted: true, controllable: false, changedAt: 5 });
  });

  it("keeps changedAt while the play state holds, and compares sources", () => {
    const probe = parseMediaProbe({ title: "Chanson", artist: "Ada", element: { duration: 60, position: 4, paused: false } })!;
    const first = buildSource({ tabId: "t", spaceId: "s", tab, probe, artwork: "data:image/png;base64,BB==", playing: true, now: 1000 });
    expect(first).toMatchObject({ title: "Chanson", subtitle: "Ada", artwork: "data:image/png;base64,BB==", duration: 60, controllable: true });
    const later = buildSource({ ...{ tabId: "t", spaceId: "s", tab, artwork: "data:image/png;base64,BB==" }, probe: { ...probe, element: { ...probe.element!, position: 5 } }, playing: true, now: 2000, previous: first });
    expect(later.changedAt).toBe(1000);
    expect(sameSource(first, later, 2000)).toBe(true);
    const paused = buildSource({ tabId: "t", spaceId: "s", tab, probe, artwork: null, playing: false, now: 3000, previous: later });
    expect(paused.changedAt).toBe(3000);
    expect(sameSource(later, paused, 3000)).toBe(false);
  });
});

describe("isMediaAction", () => {
  it("accepts the controls only", () => {
    for (const action of ["toggle", "play", "pause", "rewind", "forward", { seek: 12 }]) expect(isMediaAction(action)).toBe(true);
    for (const action of ["stop", { seek: -1 }, { seek: NaN }, { seek: 1, extra: 1 }, null, 3]) expect(isMediaAction(action)).toBe(false);
  });
});
