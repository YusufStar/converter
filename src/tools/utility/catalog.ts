import type { ToolMeta } from "../../catalog-types";

export const utilityTools: ToolMeta[] = [
  {
    slug: "unit-converter",
    group: "utility",
    engine: "util-units",
    popular: true,
    name: { en: "Unit Converter", tr: "Birim Çevirici" },
    desc: {
      en: "Convert length, weight, temperature, area, volume, speed, time, data size and rate, pressure, energy, power, angle, frequency, fuel economy and cooking units — with every unit in a live table.",
      tr: "Uzunluk, ağırlık, sıcaklık, alan, hacim, hız, zaman, veri boyutu ve hızı, basınç, enerji, güç, açı, frekans, yakıt tüketimi ve mutfak ölçülerini çevir — tüm birimler canlı bir tabloda.",
    },
    keywords:
      "unit measure metric imperial km mile kg lb pound celsius fahrenheit inch cm feet foot gallon litre liter mph kmh mb gb mib gib mbps mpg psi bar kwh calorie hp cup tablespoon birim ölçü çevir dönüştür metre mil kilo derece inç litre galon dönüm beygir bardak kaşık",
  },
  {
    slug: "color-converter",
    group: "utility",
    engine: "util-color",
    popular: true,
    name: { en: "Color Converter", tr: "Renk Dönüştürücü" },
    desc: {
      en: "Convert colours between HEX, RGB, HSL, HSV, HWB, CMYK, LAB, LCH, OKLCH and CSS names — with a picker and a WCAG contrast check.",
      tr: "Renkleri HEX, RGB, HSL, HSV, HWB, CMYK, LAB, LCH, OKLCH ve CSS adları arasında çevir — renk seçici ve WCAG kontrast denetimiyle.",
    },
    keywords: "color colour hex rgb rgba hsl hsv hsb hwb cmyk lab lch oklab oklch css picker contrast wcag renk seçici kontrast",
    formats: ["HEX", "RGB", "HSL", "CMYK", "OKLCH"],
  },
  {
    slug: "base64-converter",
    group: "utility",
    engine: "util-encoding",
    preset: { mode: "text" },
    name: { en: "Base64 Encoder & Decoder", tr: "Base64 Kodlayıcı ve Çözücü" },
    desc: {
      en: "Encode and decode Base64 (UTF-8 safe, URL-safe), turn files into data URIs and back, plus URL encoding, HTML entities and hex.",
      tr: "Base64 kodla ve çöz (UTF-8 uyumlu, URL-güvenli), dosyaları data URI'ye ve geri çevir; URL kodlama, HTML varlıkları ve hex de cabası.",
    },
    keywords: "base64 encode decode data uri url encode html entities hex kodla çöz şifrele",
    formats: ["BASE64", "DATA URI", "URL", "HEX"],
  },
  {
    slug: "image-to-base64",
    group: "utility",
    engine: "util-encoding",
    preset: { mode: "file" },
    name: { en: "Image to Base64", tr: "Görselden Base64'e" },
    desc: {
      en: "Turn an image or any file into Base64, a data URI, a CSS background or an <img> tag — and decode Base64 back into a file.",
      tr: "Bir görseli ya da herhangi bir dosyayı Base64'e, data URI'ye, CSS arka planına veya <img> etiketine çevir — Base64'ü yeniden dosyaya dönüştür.",
    },
    keywords: "image to base64 file to base64 data uri png jpg svg inline css background img görsel resim dosya",
    formats: ["PNG", "JPG", "SVG", "DATA URI"],
  },
  {
    slug: "url-encoder",
    group: "utility",
    engine: "util-encoding",
    preset: { mode: "url" },
    name: { en: "URL Encoder & Decoder", tr: "URL Kodlayıcı ve Çözücü" },
    desc: {
      en: "Percent-encode or decode URLs and query strings, as a component or a full URL, and read every query parameter at a glance.",
      tr: "URL'leri ve sorgu dizelerini yüzde kodlamasıyla kodla ya da çöz (bileşen veya tam URL); tüm sorgu parametrelerini tek bakışta gör.",
    },
    keywords: "url encode decode percent encoding query string urlencode uri component kodla çöz",
    formats: ["URL"],
  },
  {
    slug: "number-base-converter",
    group: "utility",
    engine: "util-base",
    name: { en: "Number Base Converter", tr: "Sayı Tabanı Çevirici" },
    desc: {
      en: "Convert between binary, octal, decimal, hexadecimal and any base from 2 to 36 — numbers of any length, two's complement included.",
      tr: "İkilik, sekizlik, onluk, onaltılık ve 2–36 arası her taban arasında çevir — her uzunlukta sayı, ikiye tümleyen dahil.",
    },
    keywords: "binary octal decimal hex hexadecimal base radix two's complement bin dec ikilik onaltılık taban ikiye tümleyen",
    formats: ["BIN", "OCT", "DEC", "HEX"],
  },
  {
    slug: "timestamp-converter",
    group: "utility",
    engine: "util-timestamp",
    name: { en: "Unix Timestamp Converter", tr: "Unix Zaman Damgası Çevirici" },
    desc: {
      en: "Convert Unix timestamps in seconds or milliseconds to ISO 8601, UTC, your local time and any time zone — and dates back to epoch time.",
      tr: "Saniye ya da milisaniye cinsinden Unix zaman damgalarını ISO 8601'e, UTC'ye, yerel saatine ve dilediğin saat dilimine çevir — tarihleri de epoch zamanına.",
    },
    keywords: "unix timestamp epoch time date iso 8601 utc gmt time zone milliseconds zaman damgası tarih saat dilimi",
    formats: ["UNIX", "ISO 8601", "UTC"],
  },
  {
    slug: "text-case-converter",
    group: "utility",
    engine: "util-case",
    name: { en: "Text Case Converter", tr: "Büyük-Küçük Harf Dönüştürücü" },
    desc: {
      en: "Switch text between UPPER, lower, Title, Sentence case, camelCase, PascalCase, snake_case, kebab-case and more — with Turkish i/İ rules and live counts.",
      tr: "Metni BÜYÜK, küçük, başlık ve cümle düzeni, camelCase, PascalCase, snake_case, kebab-case ve dahasına çevir — Türkçe i/İ kurallarıyla, canlı sayaçlarla.",
    },
    keywords: "case upper lower title sentence camel pascal snake kebab constant word count character count büyük küçük harf kelime sayacı karakter",
  },
  {
    slug: "roman-numeral-converter",
    group: "utility",
    engine: "util-roman",
    name: { en: "Roman Numeral Converter", tr: "Roma Rakamı Çevirici" },
    desc: {
      en: "Convert numbers from 1 to 3,999 into Roman numerals and back, with a step-by-step breakdown.",
      tr: "1 ile 3.999 arasındaki sayıları Roma rakamlarına ve geri çevir; adım adım açılımıyla.",
    },
    keywords: "roman numerals mcmxc xiv year roma rakamı rakamları",
  },
  {
    slug: "number-to-words",
    group: "utility",
    engine: "util-words",
    name: { en: "Number to Words", tr: "Sayıyı Yazıya Çevir" },
    desc: {
      en: "Spell out numbers in English or Turkish — decimals, negatives and amounts in dollars or Turkish lira for cheques and invoices.",
      tr: "Sayıları İngilizce ya da Türkçe yazıyla yaz — ondalıklar, negatifler, çek ve faturalar için dolar ya da Türk lirası tutarlar.",
    },
    keywords: "number to words spell out cheque check amount in words sayı yazıyla rakam yazı çek fatura tutar lira kuruş",
  },
  {
    slug: "percentage-calculator",
    group: "utility",
    engine: "util-percent",
    name: { en: "Percentage Calculator", tr: "Yüzde Hesaplama" },
    desc: {
      en: "Work out X% of a number, what percent one number is of another, the percentage change between two values, and add or remove a percentage.",
      tr: "Bir sayının %X'ini, bir sayının diğerinin yüzde kaçı olduğunu, iki değer arasındaki yüzde değişimi hesapla; bir yüzdeyi ekle ya da çıkar.",
    },
    keywords: "percent percentage change increase decrease discount vat yüzde hesapla artış azalış indirim kdv",
  },
];
