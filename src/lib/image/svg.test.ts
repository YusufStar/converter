// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { parseLength, sizeSvg, svgIntrinsicSize } from "./svg";

describe("svg sizing", () => {
  it("parses lengths in CSS units", () => {
    expect(parseLength("64")).toBe(64);
    expect(parseLength("1in")).toBe(96);
    expect(parseLength("72pt")).toBe(96);
    expect(parseLength("25.4mm")).toBeCloseTo(96);
    expect(parseLength("50%")).toBeNull();
    expect(parseLength("auto")).toBeNull();
    expect(parseLength(null)).toBeNull();
  });
  it("finds the intrinsic size from attributes, viewBox or defaults", () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"/>')).toEqual({ width: 64, height: 32 });
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"/>')).toEqual({ width: 120, height: 60 });
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="240" viewBox="0 0 120 60"/>')).toEqual({ width: 240, height: 120 });
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>')).toEqual({ width: 300, height: 150 });
  });
  it("rewrites width/height and adds a viewBox so the vector scales", () => {
    const out = sizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle r="10"/></svg>', 512, 512);
    expect(out).toContain('width="512"');
    expect(out).toContain('height="512"');
    expect(out).toContain('viewBox="0 0 64 64"');
    expect(out).not.toContain("preserveAspectRatio");
    expect(out).toContain("<circle");
  });
  it("keeps an existing viewBox and stretches only on a different ratio", () => {
    const out = sizeSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60"/>', 300, 300);
    expect(out).toContain('viewBox="0 0 120 60"');
    expect(out).toContain('preserveAspectRatio="none"');
  });
  it("rejects broken markup", () => {
    expect(() => svgIntrinsicSize("<html></html>")).toThrow("Invalid SVG");
  });
});
