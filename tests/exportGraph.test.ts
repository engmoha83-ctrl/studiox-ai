import { describe, expect, it } from "vitest";
import { produce } from "immer";
import * as ops from "../src/engine/timelineOps";
import { buildExport, atempoChain } from "../src/engine/exportGraph";
import { defaultExportSettings } from "../src/engine/presets";
import { detectDirection, localiseDigits } from "../src/engine/textRender";
import { evalLayer, videoLayers } from "../src/engine/segments";
import { makeMediaClip, makeTextClip, setup } from "./helpers";

describe("export graph", () => {
  it("builds inputs, overlays and audio mix", () => {
    const { p, v1, a1, t1 } = setup();
    const a = makeMediaClip(p.media[0], v1, 0, 30);
    a.duration = 4;
    const b = makeMediaClip(p.media[0], v1, 4, 30);
    b.duration = 4;
    b.in = 6;
    b.transitionIn = { type: "dissolve", duration: 1 };
    const txt = makeTextClip(t1, 1, "مرحبا بالعالم");
    const au = makeMediaClip(p.media[2], a1, 0.5, 30);
    au.duration = 5;
    const q = produce(p, (d) => { [a, b, txt, au].forEach((c) => ops.addClip(d, c)); });
    const plan = buildExport(q, defaultExportSettings(1280, 720, 30), { [txt.id]: "/tmp/t.png" });
    expect(plan.duration).toBeCloseTo(8);
    expect(plan.filterGraph).toContain("overlay=");
    expect(plan.filterGraph).toContain("amix=inputs=3");
    expect(plan.inputArgs.filter((x) => x === "-i")).toHaveLength(4);
    // previous clip is extended under the dissolve
    const la = videoLayers(q).find((l) => l.clip.id === a.id)!;
    expect(la.windowEnd).toBeCloseTo(5);
    const lb = videoLayers(q).find((l) => l.clip.id === b.id)!;
    expect(evalLayer(lb, 4.5).alpha).toBeCloseTo(0.5);
  });

  it("chains atempo for extreme speeds", () => {
    expect(atempoChain(4)).toEqual(["atempo=2.0", "atempo=2"]);
    expect(atempoChain(0.25)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(atempoChain(3)).toEqual(["atempo=2.0", "atempo=1.5"]);
    expect(atempoChain(1)).toEqual([]);
  });

  it("detects Arabic direction and digits", () => {
    expect(detectDirection("مرحبا Hello")).toBe("rtl");
    expect(detectDirection("Hello مرحبا")).toBe("ltr");
    expect(detectDirection("2024 عام")).toBe("rtl");
    expect(localiseDigits("2024", true)).toBe("٢٠٢٤");
  });
});
