import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatDms, formatExposure, formatValue, metadataJson, osmUrl, readGroups, summarize } from "./exif";
import { jpegWithMetadata, makePng, pngMetadataChunks } from "./test-images";

const photo = new Uint8Array(readFileSync(new URL("../../../e2e/fixtures/photo.jpg", import.meta.url)));

describe("formatting", () => {
  it("formats exposure times", () => {
    expect(formatExposure(0.004)).toBe("1/250 s");
    expect(formatExposure(1 / 3)).toBe("1/3 s");
    expect(formatExposure(2)).toBe("2 s");
    expect(formatExposure(1.25)).toBe("1.3 s");
  });

  it("formats coordinates as degrees, minutes, seconds", () => {
    expect(formatDms(41.015, "N", "S")).toBe("41° 0′ 54″ N");
    expect(formatDms(-0.5, "E", "W")).toBe("0° 30′ 0″ W");
  });

  it("links to OpenStreetMap", () => {
    expect(osmUrl({ lat: 41.015, lon: 28.974999999 })).toBe("https://www.openstreetmap.org/?mlat=41.015&mlon=28.975#map=16/41.015/28.975");
  });

  it("formats raw values", () => {
    expect(formatValue(new Uint8Array(12))).toBe("12 bytes");
    expect(formatValue([41, 0, 54])).toBe("41, 0, 54");
    expect(formatValue(0.1 + 0.2)).toBe("0.3");
    expect(formatValue(new Date(2024, 4, 1, 10, 0, 0))).toBe("2024-05-01 10:00:00");
  });
});

describe("summary", () => {
  it("summarises a camera photo", async () => {
    const s = summarize(await readGroups(jpegWithMetadata(photo, 6)));
    expect(s).toMatchObject({
      camera: "Canon EOS R5",
      lens: "RF50mm F1.8 STM",
      exposure: "1/250 s · f/2.8 · ISO 400",
      focal: "50 mm",
      date: "2024-05-01 10:00:00",
      software: "Test Suite 1.0",
      author: "Jane Doe",
      orientation: "Rotate 90 CW",
    });
    expect(s.gps?.lat).toBeCloseTo(41.015, 5);
    expect(s.gps?.lon).toBeCloseTo(28.975, 5);
    expect(s.gps?.alt).toBe(40);
    expect(s.colorProfile).toBe("RGB (ICC)");
  });

  it("reads PNG text chunks and eXIf", async () => {
    const g = await readGroups(makePng(2, 2, () => [0, 0, 0, 255], pngMetadataChunks(1)));
    expect(g.ihdr?.Author).toBe("Jane Doe");
    expect(summarize(g).camera).toBe("Canon EOS R5");
  });

  it("is empty for a file without metadata", async () => {
    const g = await readGroups(makePng(2, 2, () => [0, 0, 0, 255]));
    expect(Object.keys(g)).toEqual(["ihdr"]);
    expect(summarize(g).gps).toBeUndefined();
  });

  it("exports JSON with the map link and no raw binary", async () => {
    const json = JSON.parse(metadataJson("a.jpg", await readGroups(jpegWithMetadata(photo, 6))));
    expect(json.file).toBe("a.jpg");
    expect(json.summary.gps.map).toContain("mlat=41.015");
    expect(json.tags.exif.DateTimeOriginal).toBe("2024-05-01 10:00:00");
    expect(json.tags.gps.GPSLatitude).toEqual([41, 0, 54]);
  });
});
