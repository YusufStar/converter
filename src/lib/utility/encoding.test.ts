import { describe, expect, it } from "vitest";
import {
  DecodeError,
  base64ToBytes,
  bytesToBase64,
  decodeBase64Text,
  encodeBase64Text,
  extForMime,
  formatBase64,
  hexToBytes,
  hexToText,
  htmlDecode,
  htmlEncode,
  parseDataUri,
  sniffMime,
  textToHex,
  toDataUri,
  urlDecode,
  urlEncode,
  urlParts,
} from "./encoding";

const bytes = (...xs: number[]) => new Uint8Array(xs);
const ascii = (s: string) => new TextEncoder().encode(s);

describe("base64", () => {
  it("encodes RFC 4648 test vectors", () => {
    expect(["", "f", "fo", "foo", "foob", "fooba", "foobar"].map((s) => encodeBase64Text(s))).toEqual(["", "Zg==", "Zm8=", "Zm9v", "Zm9vYg==", "Zm9vYmE=", "Zm9vYmFy"]);
  });

  it("is UTF-8 safe and round-trips Turkish text", () => {
    const tr = "ğüşıöç";
    expect(encodeBase64Text(tr)).toBe("xJ/DvMWfxLHDtsOn");
    expect(decodeBase64Text(encodeBase64Text(tr))).toBe(tr);
    expect(decodeBase64Text(encodeBase64Text("İstanbul 🚀 日本"))).toBe("İstanbul 🚀 日本");
  });

  it("supports the URL-safe alphabet without padding", () => {
    const b = bytes(0xfb, 0xff, 0xbf);
    expect(bytesToBase64(b)).toBe("+/+/");
    expect(formatBase64("+/+/", { urlSafe: true })).toBe("-_-_");
    expect(formatBase64("Zm8=", { urlSafe: true })).toBe("Zm8");
    expect(base64ToBytes("-_-_")).toEqual(b);
    expect(decodeBase64Text("Zm8")).toBe("fo");
  });

  it("wraps lines at 76 characters", () => {
    const wrapped = formatBase64("A".repeat(160), { wrap: true });
    expect(wrapped.split("\n").map((l) => l.length)).toEqual([76, 76, 8]);
    expect(base64ToBytes(wrapped).length).toBe(120);
  });

  it("decodes data URIs and rejects garbage", () => {
    expect(decodeBase64Text("data:text/plain;base64,aGk=")).toBe("hi");
    expect(() => base64ToBytes("abc$")).toThrow(DecodeError);
    expect(() => base64ToBytes("abcde")).toThrow(DecodeError);
    expect(() => decodeBase64Text("//79")).toThrow("utf8");
  });

  it("encodes large inputs in chunks", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});

describe("data URIs and MIME sniffing", () => {
  it("parses and builds data URIs", () => {
    expect(parseDataUri("data:image/png;base64,iVBOR")).toEqual({ mime: "image/png", base64: true, data: "iVBOR" });
    expect(parseDataUri("data:,hello")).toEqual({ mime: "text/plain", base64: false, data: "hello" });
    expect(parseDataUri("hello")).toBeNull();
    expect(toDataUri("", "AA==")).toBe("data:application/octet-stream;base64,AA==");
  });

  it("sniffs common formats from magic bytes", () => {
    expect(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a))).toBe("image/png");
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffMime(ascii("GIF89a"))).toBe("image/gif");
    expect(sniffMime(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffMime(ascii("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(bytes(0x50, 0x4b, 3, 4))).toBe("application/zip");
    expect(sniffMime(ascii("\0\0\0\x20ftypavif"))).toBe("image/avif");
    expect(sniffMime(ascii("\0\0\0\x20ftypisom"))).toBe("video/mp4");
    expect(sniffMime(ascii('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffMime(ascii('{"a": 1}'))).toBe("application/json");
    expect(sniffMime(ascii("çok güzel"))).toBe("text/plain");
    expect(sniffMime(bytes(0x00, 0x9f, 0x92, 0x96))).toBe("application/octet-stream");
  });

  it("maps MIME types to extensions", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/svg+xml")).toBe("svg");
    expect(extForMime("application/x-foo")).toBe("foo");
  });
});

describe("URL encoding", () => {
  it("encodes components vs full URIs", () => {
    expect(urlEncode("a b&c=ğ/")).toBe("a%20b%26c%3D%C4%9F%2F");
    expect(urlEncode("https://x.com/a b?q=ğ&r=1", "uri")).toBe("https://x.com/a%20b?q=%C4%9F&r=1");
    expect(urlEncode("a b", "component", true)).toBe("a+b");
  });

  it("decodes and reports malformed input", () => {
    expect(urlDecode("a%20b%26c%3D%C4%9F")).toBe("a b&c=ğ");
    expect(urlDecode("a+b", "component", true)).toBe("a b");
    expect(urlDecode("%2F%20", "uri")).toBe("%2F ");
    expect(() => urlDecode("%E0%A4%A")).toThrow("uri");
  });

  it("splits URLs into parts", () => {
    expect(urlParts("https://ex.com:8080/a%20b?q=%C3%A7ay&n=1#top")).toEqual({
      protocol: "https",
      host: "ex.com:8080",
      path: "/a b",
      params: [
        ["q", "çay"],
        ["n", "1"],
      ],
      hash: "top",
    });
    expect(urlParts("https://ex.com/s?q=fish & chips")?.params).toEqual([["q", "fish "], [" chips", ""]]);
    expect(urlParts("not a url")).toBeNull();
    expect(urlParts("https:// nope")).toBeNull();
  });
});

describe("HTML entities", () => {
  it("escapes markup characters", () => {
    expect(htmlEncode(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;");
  });

  it("optionally escapes non-ASCII", () => {
    expect(htmlEncode("çay ğ 😀", true)).toBe("&ccedil;ay &gbreve; &#128512;");
    expect(htmlEncode("çay")).toBe("çay");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlDecode("&lt;p&gt; &copy; &#231;&#x11F; &#128512; &euro;&nbsp;&unknown; &#39;")).toBe("<p> © çğ 😀 € &unknown; '");
    expect(htmlDecode(htmlEncode("İ ı ş ğ <>&\"'", true))).toBe("İ ı ş ğ <>&\"'");
    expect(htmlDecode("&#0; &#xD800;")).toBe("� �");
  });
});

describe("hex", () => {
  it("encodes UTF-8 bytes with separators", () => {
    expect(textToHex("Hi")).toBe("48 69");
    expect(textToHex("Hi", "none", true)).toBe("4869");
    expect(textToHex("Hi", "0x")).toBe("0x48 0x69");
    expect(textToHex("Hi", "\\x")).toBe("\\x48\\x69");
    expect(textToHex("ğ")).toBe("c4 9f");
  });

  it("decodes any common hex notation", () => {
    expect(hexToText("48 69")).toBe("Hi");
    expect(hexToText("0x48,0x69")).toBe("Hi");
    expect(hexToText("\\x48\\x69")).toBe("Hi");
    expect(hexToText("c4:9f")).toBe("ğ");
    expect(hexToBytes("")).toEqual(new Uint8Array());
    expect(() => hexToBytes("4")).toThrow("hexOdd");
    expect(() => hexToBytes("zz")).toThrow("hex");
  });
});
