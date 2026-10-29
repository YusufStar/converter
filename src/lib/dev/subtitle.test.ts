import { describe, expect, it } from "vitest";
import {
  balanceTags,
  convertSubtitle,
  decodeText,
  detectEncoding,
  detectFormat,
  formatTime,
  parseAss,
  parseSbv,
  parseSrt,
  parseSub,
  parseTime,
  parseVtt,
  retimeCues,
  writeSubtitles,
} from "./subtitle";

const enc = (s: string) => new TextEncoder().encode(s);

/** Windows-1254 bytes for a string of Latin-1 + Turkish letters. */
function cp1254(s: string): Uint8Array {
  const map: Record<string, number> = { Ğ: 0xd0, İ: 0xdd, Ş: 0xde, ğ: 0xf0, ı: 0xfd, ş: 0xfe };
  return Uint8Array.from([...s], (c) => map[c] ?? c.charCodeAt(0));
}

describe("times", () => {
  it("parses every flavour", () => {
    expect(parseTime("01:02:03,456")).toBe(3_723_456);
    expect(parseTime("01:02:03.456")).toBe(3_723_456);
    expect(parseTime("0:00:01.50")).toBe(1500); // ASS centiseconds
    expect(parseTime("02:03.4")).toBe(123_400);
    expect(parseTime("00:00:05")).toBe(5000);
    expect(parseTime("nope")).toBeNull();
  });

  it("formats with comma or dot", () => {
    expect(formatTime(3_723_456, ",")).toBe("01:02:03,456");
    expect(formatTime(1500, ".", 1)).toBe("0:00:01.500");
    expect(formatTime(-5, ",")).toBe("00:00:00,000");
    expect(formatTime(100 * 3_600_000, ".")).toBe("100:00:00.000");
  });
});

describe("SRT", () => {
  it("reads normal files, CRLF, BOM, extra blank lines and keeps i/b/u only", () => {
    const srt = "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Merhaba</i> <font color=\"#ff0\">dünya</font>\r\n{\\an8}ikinci satır\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000 X1:10 Y1:20\r\nSon\r\n";
    expect(parseSrt(srt)).toEqual([
      { start: 1000, end: 2500, text: "<i>Merhaba</i> dünya\nikinci satır" },
      { start: 3000, end: 4000, text: "Son" },
    ]);
  });

  it("copes with missing blank lines and dot separators", () => {
    const srt = "1\n00:00:01.000 --> 00:00:02.000\nA\n2\n00:00:03.000 --> 00:00:04.000\nB";
    expect(parseSrt(srt).map((c) => c.text)).toEqual(["A", "B"]);
  });

  it("writes numbered cues and drops empty ones", () => {
    const out = writeSubtitles(
      [
        { start: 0, end: 1000, text: "<b>Hi</b>\nthere" },
        { start: 1000, end: 2000, text: "  " },
        { start: 2000, end: 3000, text: "Bye" },
      ],
      "srt",
    );
    expect(out).toBe("1\n00:00:00,000 --> 00:00:01,000\n<b>Hi</b>\nthere\n\n2\n00:00:02,000 --> 00:00:03,000\nBye\n");
  });
});

describe("WebVTT", () => {
  const vtt = `WEBVTT - title
Kind: captions

NOTE a comment
with --> arrows inside

STYLE
::cue { color: yellow }

intro
00:01.000 --> 00:04.000 align:start position:10%
<v Roger>Hello &amp; <c.loud>welcome</c></v>
<i>second</i> line

00:00:05.500 --> 00:00:07.000
Tom &lt;3 Jerry&nbsp;!
`;

  it("skips header, NOTE and STYLE blocks, ids and settings; decodes entities", () => {
    expect(parseVtt(vtt)).toEqual([
      { start: 1000, end: 4000, text: "Hello & welcome\n<i>second</i> line" },
      { start: 5500, end: 7000, text: "Tom <3 Jerry !" },
    ]);
  });

  it("writes escaped text with a WEBVTT header", () => {
    expect(writeSubtitles([{ start: 1000, end: 2500, text: "<i>A</i> & B <3 -->" }], "vtt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.500\n<i>A</i> &amp; B &lt;3 --&gt;\n");
  });

  it("round-trips SRT → VTT → SRT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\n<i>x</i> & y\n\n2\n00:10:00,123 --> 01:00:00,000\nz\n";
    const vttOut = writeSubtitles(parseSrt(srt), "vtt");
    expect(writeSubtitles(parseVtt(vttOut), "srt")).toBe(srt);
  });
});

describe("ASS / SSA", () => {
  const ass = `[Script Info]
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname
Style: Default,Arial

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ignored
Dialogue: 0,0:00:05.00,0:00:06.50,Default,,0,0,0,,Later, with a comma
Dialogue: 0,0:00:01.20,0:00:03.00,Default,Bob,0,0,0,,{\\an8\\pos(10,20)}{\\i1}Hello{\\i0}\\Nworld\\hagain
Dialogue: 0,0:00:02.00,0:00:04.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}
Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0,0,0,,{\\b1}open bold
`;

  it("keeps text and timing, converts italics, drops styling, drawings and comments, sorts by time", () => {
    expect(parseAss(ass)).toEqual([
      { start: 1200, end: 3000, text: "<i>Hello</i>\nworld again" },
      { start: 5000, end: 6500, text: "Later, with a comma" },
      { start: 7000, end: 8000, text: "<b>open bold</b>" },
    ]);
    expect(detectFormat(ass)).toBe("ass");
  });

  it("reads SSA (Marked field) with its own Format line", () => {
    const ssa = `[Script Info]\nScriptType: v4.00\n\n[V4 Styles]\nFormat: Name\n\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,NTP,0000,0000,0000,!Effect,Old style\n`;
    expect(detectFormat(ssa)).toBe("ssa");
    expect(parseAss(ssa)).toEqual([{ start: 1000, end: 2000, text: "Old style" }]);
  });
});

describe("SBV and MicroDVD", () => {
  it("SBV both ways", () => {
    const sbv = "0:00:01.000,0:00:02.500\nOne\ntwo\n\n0:00:03.000,0:00:04.000\nThree\n";
    expect(parseSbv(sbv)).toEqual([
      { start: 1000, end: 2500, text: "One\ntwo" },
      { start: 3000, end: 4000, text: "Three" },
    ]);
    expect(writeSubtitles(parseSbv(sbv), "sbv")).toBe(sbv);
    expect(detectFormat(sbv)).toBe("sbv");
  });

  it("SubViewer [br] line breaks", () => {
    expect(parseSbv("[INFORMATION]\n00:00:01.00,00:00:02.00\nA[br]B\n")).toEqual([{ start: 1000, end: 2000, text: "A\nB" }]);
  });

  it("MicroDVD honours the declared frame rate, | and {y:i}", () => {
    const { cues, fps } = parseSub("{1}{1}25\n{25}{50}{y:i}Hello|world\n{75}{100}Plain\n");
    expect(fps).toBe(25);
    expect(cues).toEqual([
      { start: 1000, end: 2000, text: "<i>Hello\nworld</i>" },
      { start: 3000, end: 4000, text: "Plain" },
    ]);
    expect(parseSub("{24}{48}x\n", 24).cues[0]).toEqual({ start: 1000, end: 2000, text: "x" });
    expect(writeSubtitles(cues, "sub", 25)).toBe("{25}{50}Hello|world\n{75}{100}Plain\n");
  });
});

describe("retiming", () => {
  const cues = [
    { start: 500, end: 1500, text: "a" },
    { start: 10_000, end: 12_000, text: "b" },
  ];
  it("shifts and drops cues that end before zero", () => {
    expect(retimeCues(cues, { shiftMs: -1000 })).toEqual([
      { start: 0, end: 500, text: "a" },
      { start: 9000, end: 11_000, text: "b" },
    ]);
    expect(retimeCues(cues, { shiftMs: -2000 })).toHaveLength(1);
    expect(retimeCues(cues, { shiftMs: 250 })[1]).toMatchObject({ start: 10_250, end: 12_250 });
  });

  it("converts frame rates (25 → 23.976 stretches times)", () => {
    expect(retimeCues(cues, { fromFps: 25, toFps: 23.976 })[1]).toMatchObject({ start: 10_427, end: 12_513 });
    expect(retimeCues(cues, { fromFps: 23.976, toFps: 25, shiftMs: 100 })[1]).toMatchObject({ start: 9690, end: 11_608 });
  });
});

describe("encodings", () => {
  const turkish = "Çağrı şimdi İstanbul'da, ılık bir gün.";
  it("detects UTF-8 (with or without BOM) and UTF-16", () => {
    expect(detectEncoding(enc(turkish))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("utf-8");
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toBe("utf-16le");
    const le = new Uint8Array(Buffer.from("plain ascii subtitle", "utf16le"));
    expect(detectEncoding(le)).toBe("utf-16le");
    expect(decodeText(le).text).toBe("plain ascii subtitle");
  });

  it("tells Windows-1254 (Turkish) from Windows-1252", () => {
    const bytes = cp1254(turkish.replace("Ç", "Ç"));
    expect(detectEncoding(bytes)).toBe("windows-1254");
    expect(decodeText(bytes).text).toBe(turkish);
    expect(detectEncoding(Uint8Array.from("Café déjà vu", (c) => c.charCodeAt(0)))).toBe("windows-1252");
    // A manual override wins.
    expect(decodeText(bytes, "windows-1252").text).toContain("ð");
  });
});

describe("convertSubtitle", () => {
  it("SRT in Windows-1254 → UTF-8 VTT with a shift", () => {
    const src = cp1254("1\r\n00:00:01,000 --> 00:00:02,000\r\nŞişli'de ığdır\r\n");
    const out = convertSubtitle(src, "srt", { to: "vtt", shiftMs: 500 });
    expect(out).toEqual({ from: "srt", encoding: "windows-1254", cues: 1, text: "WEBVTT\n\n00:00:01.500 --> 00:00:02.500\nŞişli'de ığdır\n" });
  });

  it("explains unusable input", () => {
    expect(() => convertSubtitle(new Uint8Array([0, 0, 1, 0xba, 0]), "sub", { to: "srt" })).toThrow("Image-based");
    expect(() => convertSubtitle(enc("hello world"), "txt", { to: "srt" })).toThrow("Unrecognised");
    expect(() => convertSubtitle(enc(""), "srt", { to: "vtt" })).toThrow("No subtitles");
    expect(() => convertSubtitle(enc("WEBVTT\n\n"), "vtt", { to: "srt" })).toThrow("No subtitles");
  });

  it("balances stray tags", () => {
    expect(balanceTags("</i>a<i>b<i>c")).toBe("a<i>bc</i>");
  });
});
