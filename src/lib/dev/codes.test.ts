import { describe, expect, it } from "vitest";
import { gtinCheckDigit, upcEToUpcA, validateBarcode } from "./barcode";
import { matrixPath, matrixSvg } from "./matrix";
import { readingOrder, webLink } from "./scan";
import { emailPayload, geoPayload, phonePayload, smsPayload, vcardPayload, wifiPayload } from "./qr-content";

describe("barcode validation", () => {
  it("computes GS1 check digits", () => {
    expect(gtinCheckDigit("590123412345")).toBe(7);
    expect(gtinCheckDigit("400638133393")).toBe(1);
    expect(gtinCheckDigit("9638507")).toBe(4);
    expect(gtinCheckDigit("03600029145")).toBe(2);
    expect(gtinCheckDigit("1234567890123")).toBe(1);
  });

  it("EAN-13 adds or checks the check digit", () => {
    expect(validateBarcode("EAN13", "590123412345")).toEqual({ ok: true, value: "5901234123457", note: "checkAdded", digit: 7 });
    expect(validateBarcode("EAN13", " 5901234123457 ")).toEqual({ ok: true, value: "5901234123457" });
    expect(validateBarcode("EAN13", "5901234123458")).toEqual({ ok: false, error: "check", expected: 7 });
    expect(validateBarcode("EAN13", "59012341234")).toMatchObject({ ok: false, error: "length", lengths: "12/13" });
    expect(validateBarcode("EAN13", "59012341234X")).toMatchObject({ ok: false, error: "digits" });
    expect(validateBarcode("EAN13", "")).toMatchObject({ ok: false, error: "empty" });
  });

  it("EAN-8, UPC-A and UPC-E", () => {
    expect(validateBarcode("EAN8", "96385074")).toEqual({ ok: true, value: "96385074" });
    expect(validateBarcode("EAN8", "9638507")).toMatchObject({ ok: true, value: "96385074" });
    expect(validateBarcode("UPCA", "036000291452")).toEqual({ ok: true, value: "036000291452" });
    expect(validateBarcode("UPCA", "036000291453")).toMatchObject({ ok: false, expected: 2 });
    expect(upcEToUpcA("0", "123456")).toBe("01234500006");
    expect(upcEToUpcA("0", "654321")).toBe("06510000432");
    expect(upcEToUpcA("0", "123453")).toBe("01230000045");
    expect(upcEToUpcA("0", "123454")).toBe("01234000005");
    expect(validateBarcode("UPCE", "01234565")).toEqual({ ok: true, value: "01234565" });
    expect(validateBarcode("UPCE", "123456")).toMatchObject({ ok: true, value: "01234565", note: "checkAdded" });
    expect(validateBarcode("UPCE", "21234565")).toMatchObject({ ok: false, error: "upceSystem" });
    expect(validateBarcode("UPCE", "01234564")).toMatchObject({ ok: false, error: "check", expected: 5 });
  });

  it("ITF pads to an even length; Code 39 upper-cases; Codabar adds start/stop", () => {
    expect(validateBarcode("ITF", "123")).toEqual({ ok: true, value: "0123", note: "padded" });
    expect(validateBarcode("ITF", "12a")).toMatchObject({ ok: false, error: "digits" });
    expect(validateBarcode("Code39", "abc-1")).toEqual({ ok: true, value: "ABC-1", note: "upper" });
    expect(validateBarcode("Code39", "A*B")).toMatchObject({ ok: false, error: "charset" });
    expect(validateBarcode("Codabar", "a123b")).toEqual({ ok: true, value: "A123B" });
    expect(validateBarcode("Codabar", "12-34")).toEqual({ ok: true, value: "A12-34A", note: "startStop" });
    expect(validateBarcode("Codabar", "A12X4B")).toMatchObject({ ok: false, error: "codabarChars" });
  });

  it("Code 128 takes Latin-1, Code 93 ASCII, 2D symbols anything", () => {
    expect(validateBarcode("Code128", "Ünïcödé ok")).toMatchObject({ ok: true });
    expect(validateBarcode("Code128", "ğ")).toMatchObject({ ok: false, error: "charset" });
    expect(validateBarcode("Code93", "é")).toMatchObject({ ok: false, error: "charset" });
    expect(validateBarcode("DataMatrix", "Çok güzel 🎉")).toMatchObject({ ok: true, value: "Çok güzel 🎉" });
  });
});

describe("QR payloads", () => {
  it("Wi-Fi escapes special characters", () => {
    expect(wifiPayload({ ssid: 'My;Net,"1"', password: "p:a\\ss", security: "WPA" })).toBe('WIFI:T:WPA;S:My\\;Net\\,\\"1\\";P:p\\:a\\\\ss;;');
    expect(wifiPayload({ ssid: "Open", security: "nopass", hidden: true })).toBe("WIFI:T:nopass;S:Open;H:true;;");
  });

  it("mailto, tel, SMSTO and geo", () => {
    expect(emailPayload({ to: " a@b.co ", subject: "Hi there", body: "1 & 2" })).toBe("mailto:a@b.co?subject=Hi%20there&body=1%20%26%202");
    expect(emailPayload({ to: "a@b.co" })).toBe("mailto:a@b.co");
    expect(phonePayload("+90 (532) 123-45-67")).toBe("tel:+905321234567");
    expect(smsPayload({ number: "+1 555 0100", message: "Hello: world" })).toBe("SMSTO:+15550100:Hello: world");
    expect(geoPayload(41.0082, 28.97835)).toBe("geo:41.0082,28.97835");
    expect(geoPayload(91, 0)).toBeNull();
    expect(geoPayload(null, 0)).toBeNull();
  });

  it("vCard 3.0 with escaping and CRLF lines", () => {
    const v = vcardPayload({ firstName: "Ayşe", lastName: "Yılmaz", org: "Acme, Inc.", phone: "+90 212 000 00 00", email: "ayse@example.com", city: "İstanbul", note: "line1\nline2" });
    expect(v.split("\r\n")).toEqual([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Yılmaz;Ayşe;;;",
      "FN:Ayşe Yılmaz",
      "ORG:Acme\\, Inc.",
      "TEL;TYPE=WORK,VOICE:+90 212 000 00 00",
      "EMAIL:ayse@example.com",
      "ADR;TYPE=WORK:;;;İstanbul;;;",
      "NOTE:line1\\nline2",
      "END:VCARD",
    ]);
  });
});

describe("matrix rendering", () => {
  // 3×2: dark run of 2 on row 0, single dark module on row 1.
  const m = { width: 3, height: 2, data: [0, 0, 255, 255, 0, 255] };

  it("merges horizontal runs into one path", () => {
    expect(matrixPath(m)).toBe("M0 0h2v1h-2zM1 1h1v1h-1z");
    expect(matrixPath(m, 4)).toBe("M4 4h2v1h-2zM5 5h1v1h-1z");
  });

  it("builds an SVG with quiet zone, colours and an escaped logo", () => {
    const svg = matrixSvg(m, { size: 300, margin: 2, fg: "#112233", bg: "#ffffff", logo: { href: 'data:image/png;base64,AA"', scale: 0.2 } });
    expect(svg).toContain('viewBox="0 0 7 6"');
    expect(svg).toContain('width="300" height="257"');
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('href="data:image/png;base64,AA&quot;"');
  });
});

describe("scan results", () => {
  const at = (x: number, y: number, s = 10) => ({ topLeft: { x, y }, topRight: { x: x + s, y }, bottomRight: { x: x + s, y: y + s }, bottomLeft: { x, y: y + s } });
  it("sorts codes in reading order, tolerating slightly uneven rows", () => {
    const codes = [
      { id: "c", position: at(0, 40) },
      { id: "b", position: at(50, 2) },
      { id: "a", position: at(0, 0) },
    ];
    expect(readingOrder(codes).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("only offers web links to open", () => {
    expect(webLink(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(webLink("javascript:alert(1)")).toBeNull();
    expect(webLink("WIFI:T:WPA;S:x;;")).toBeNull();
  });
});
