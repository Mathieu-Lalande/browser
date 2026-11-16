import { voicesFor } from "@shared/read-aloud";
import { readerBlocks } from "./reader";
import { deviceVoices, speechBlocks } from "./readAloud";

describe("read aloud on the phone (ADR-058)", () => {
  it("reads the title then the text blocks, keyed by block index", () => {
    const blocks = readerBlocks([
      { tag: "h2", children: ["Partie"] },
      { tag: "p", children: ["Un. ", { tag: "strong", children: ["Deux."] }] },
      { tag: "hr", children: [] },
      { tag: "ul", children: [{ tag: "li", children: ["Point"] }] },
    ]);
    const paragraphs = speechBlocks("Titre", blocks);
    expect(paragraphs.map((p) => [p.key, p.chunks])).toEqual([
      ["title", ["Titre"]],
      ["0", ["Partie"]],
      ["1", ["Un.", "Deux."]],
      [String(blocks.findIndex((block) => block.kind === "item")), ["Point"]],
    ]);
  });

  it("offers the device voices of the article language", () => {
    const voices = deviceVoices([
      { identifier: "com.apple.voice.fr", name: "Thomas", language: "fr-FR" },
      { identifier: "en-us-x-sfg", name: "en-us-x-sfg", language: "en-US" },
    ]);
    expect(voicesFor(voices, "fr", "en").map((voice) => voice.id)).toEqual(["com.apple.voice.fr"]);
    expect(voicesFor(voices, null, "en").map((voice) => voice.id)).toEqual(["en-us-x-sfg"]);
  });
});
