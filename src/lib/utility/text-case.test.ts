import { describe, expect, it } from "vitest";
import { CASES, convertCase, textStats, toAscii, words } from "./text-case";

const all = (s: string, opts?: Parameters<typeof convertCase>[2]) => Object.fromEntries(CASES.map((c) => [c, convertCase(s, c, opts)]));

describe("convertCase", () => {
  it("converts English text to every case", () => {
    expect(all("hello world. this is XMLHttpRequest v2")).toEqual({
      upper: "HELLO WORLD. THIS IS XMLHTTPREQUEST V2",
      lower: "hello world. this is xmlhttprequest v2",
      title: "Hello World. This Is Xmlhttprequest V2",
      sentence: "Hello world. This is xmlhttprequest v2",
      camel: "helloWorldThisIsXmlHttpRequestV2",
      pascal: "HelloWorldThisIsXmlHttpRequestV2",
      snake: "hello_world_this_is_xml_http_request_v2",
      kebab: "hello-world-this-is-xml-http-request-v2",
      constant: "HELLO_WORLD_THIS_IS_XML_HTTP_REQUEST_V2",
      dot: "hello.world.this.is.xml.http.request.v2",
      alternating: "hElLo WoRlD. tHiS iS xMlHtTpReQuEsT v2",
    });
  });

  it("re-splits existing identifiers", () => {
    expect(convertCase("user_id", "camel")).toBe("userId");
    expect(convertCase("someVariableName", "snake")).toBe("some_variable_name");
    expect(convertCase("API-key-2", "pascal")).toBe("ApiKey2");
    expect(convertCase("first name\nlast name", "camel")).toBe("firstName\nlastName");
  });

  it("applies Turkish i/İ and ı/I rules", () => {
    const tr = { turkish: true };
    expect(convertCase("istanbul ılık", "upper", tr)).toBe("İSTANBUL ILIK");
    expect(convertCase("İSTANBUL ILIK", "lower", tr)).toBe("istanbul ılık");
    expect(convertCase("istanbul ılık", "upper")).toBe("ISTANBUL ILIK");
    expect(convertCase("İSTANBUL", "lower")).toBe("i̇stanbul");
    expect(convertCase("ılık iklim", "title", tr)).toBe("Ilık İklim");
    expect(convertCase("İYİ GÜNLER. NASILSIN?", "sentence", tr)).toBe("İyi günler. Nasılsın?");
    expect(convertCase("işçi ücreti", "constant", tr)).toBe("İŞÇİ_ÜCRETİ");
  });

  it("transliterates identifiers to ASCII on request", () => {
    expect(convertCase("Günlük ışık şiddeti", "camel", { turkish: true, ascii: true })).toBe("gunlukIsikSiddeti");
    expect(convertCase("Çağrı Özgür", "kebab", { ascii: true })).toBe("cagri-ozgur");
    expect(toAscii("İstanbul Straße café")).toBe("Istanbul Strasse cafe");
  });

  it("keeps punctuation and emoji in prose cases", () => {
    expect(convertCase("don't stop—now! 🚀", "title")).toBe("Don't Stop—Now! 🚀");
    expect(convertCase("", "camel")).toBe("");
  });
});

describe("words", () => {
  it("splits on case changes and separators", () => {
    expect(words("XMLHttpRequest")).toEqual(["XML", "Http", "Request"]);
    expect(words("  foo--bar__baz  ")).toEqual(["foo", "bar", "baz"]);
    expect(words("çalışmaSaati")).toEqual(["çalışma", "Saati"]);
  });
});

describe("textStats", () => {
  it("counts characters, words, sentences, lines and bytes", () => {
    expect(textStats("Merhaba dünya! Nasılsın?\nİyiyim.")).toEqual({ characters: 32, noSpaces: 29, words: 4, sentences: 3, lines: 2, bytes: 36 });
    expect(textStats("")).toEqual({ characters: 0, noSpaces: 0, words: 0, sentences: 0, lines: 0, bytes: 0 });
  });

  it("counts emoji and combined characters as one", () => {
    expect(textStats("👍🏽 é").characters).toBe(3);
  });
});
