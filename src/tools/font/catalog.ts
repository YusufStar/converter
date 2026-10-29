import type { ToolMeta } from "../../catalog-types";

const FONT_INPUT = ["ttf", "otf", "woff", "woff2", "eot"];

interface Pair {
  from: string;
  to: "ttf" | "woff" | "woff2";
  /** Turkish "from X" / "to X" with the right suffix. */
  trFrom: string;
  trTo: string;
  en: string;
  tr: string;
  es: string;
  de: string;
  fr: string;
  pt: string;
}

const TR_FROM: Record<string, string> = { ttf: "TTF'den", otf: "OTF'den", woff: "WOFF'tan", woff2: "WOFF2'den" };
const TR_TO: Record<string, string> = { ttf: "TTF'ye", woff: "WOFF'a", woff2: "WOFF2'ye" };

const PAIRS: Pair[] = [
  { from: "ttf", to: "woff2", trFrom: TR_FROM.ttf, trTo: TR_TO.woff2, en: "Shrink TrueType fonts for the web — about 40% smaller than TTF, every table kept as is.", tr: "TrueType fontlarını web için küçült: TTF'den yaklaşık %40 küçük, tüm tablolar olduğu gibi korunur.", es: "Reduce fuentes TrueType para la web: un 40 % más ligeras que TTF, con todas las tablas intactas.", de: "Verkleinern Sie TrueType-Schriften fürs Web – rund 40 % kleiner als TTF, alle Tabellen bleiben unverändert.", fr: "Allégez vos polices TrueType pour le web — environ 40 % plus légères qu'en TTF, toutes les tables conservées telles quelles.", pt: "Reduza fontes TrueType para a web — cerca de 40% menores que TTF, com todas as tabelas intactas." },
  { from: "otf", to: "woff2", trFrom: TR_FROM.otf, trTo: TR_TO.woff2, en: "Turn OpenType (CFF) fonts into WOFF2 web fonts without touching the outlines.", tr: "OpenType (CFF) fontlarını, çizimlere dokunmadan WOFF2 web fontuna çevir.", es: "Convierte fuentes OpenType (CFF) en fuentes web WOFF2 sin tocar los contornos.", de: "Wandeln Sie OpenType-Schriften (CFF) in WOFF2-Webfonts um, ohne die Konturen zu verändern.", fr: "Transformez vos polices OpenType (CFF) en polices web WOFF2 sans toucher aux contours.", pt: "Transforme fontes OpenType (CFF) em fontes web WOFF2 sem mexer nos contornos." },
  { from: "woff2", to: "ttf", trFrom: TR_FROM.woff2, trTo: TR_TO.ttf, en: "Unpack WOFF2 web fonts into TTF files you can install on Windows, macOS or Linux.", tr: "WOFF2 web fontlarını Windows, macOS ya da Linux'a kurabileceğin TTF dosyalarına aç.", es: "Descomprime fuentes web WOFF2 en archivos TTF que puedes instalar en Windows, macOS o Linux.", de: "Entpacken Sie WOFF2-Webfonts zu TTF-Dateien, die Sie unter Windows, macOS oder Linux installieren können.", fr: "Décompressez vos polices web WOFF2 en fichiers TTF à installer sous Windows, macOS ou Linux.", pt: "Descompacte fontes web WOFF2 em arquivos TTF para instalar no Windows, macOS ou Linux." },
  { from: "woff", to: "ttf", trFrom: TR_FROM.woff, trTo: TR_TO.ttf, en: "Turn WOFF web fonts back into installable TTF desktop fonts.", tr: "WOFF web fontlarını yeniden kurulabilir TTF masaüstü fontlarına çevir.", es: "Convierte de nuevo fuentes web WOFF en fuentes de escritorio TTF instalables.", de: "Wandeln Sie WOFF-Webfonts wieder in installierbare TTF-Desktop-Schriften um.", fr: "Retransformez vos polices web WOFF en polices de bureau TTF installables.", pt: "Converta fontes web WOFF de volta em fontes de desktop TTF instaláveis." },
  { from: "ttf", to: "woff", trFrom: TR_FROM.ttf, trTo: TR_TO.woff, en: "Make WOFF web fonts from TTF — the fallback format for older browsers.", tr: "TTF'den WOFF web fontu yap; eski tarayıcılar için yedek biçim.", es: "Crea fuentes web WOFF a partir de TTF — el formato alternativo para navegadores antiguos.", de: "Erstellen Sie WOFF-Webfonts aus TTF – das Fallback-Format für ältere Browser.", fr: "Créez des polices web WOFF à partir de TTF — le format de repli pour les anciens navigateurs.", pt: "Gere fontes web WOFF a partir de TTF — o formato alternativo para navegadores antigos." },
  { from: "otf", to: "ttf", trFrom: TR_FROM.otf, trTo: TR_TO.ttf, en: "Convert OpenType CFF fonts to TrueType outlines for apps that only take TTF.", tr: "OpenType CFF fontlarını yalnızca TTF kabul eden uygulamalar için TrueType'a çevir.", es: "Convierte fuentes OpenType CFF a contornos TrueType para apps que solo aceptan TTF.", de: "Konvertieren Sie OpenType-CFF-Schriften in TrueType-Konturen für Apps, die nur TTF akzeptieren.", fr: "Convertissez vos polices OpenType CFF en contours TrueType pour les applications qui n'acceptent que le TTF.", pt: "Converta fontes OpenType CFF em contornos TrueType para apps que só aceitam TTF." },
];

export const tools: ToolMeta[] = [
  {
    slug: "font-converter",
    group: "font",
    engine: "font-convert",
    popular: true,
    name: { en: "Font Converter", tr: "Font Dönüştürücü", es: "Convertidor de fuentes", de: "Schriftarten-Konverter", fr: "Convertisseur de polices", pt: "Conversor de fontes" },
    desc: {
      en: "Convert TTF, OTF, WOFF, WOFF2, EOT and SVG fonts in bulk, preview them live, subset them for the web and get the @font-face CSS.",
      tr: "TTF, OTF, WOFF, WOFF2, EOT ve SVG fontlarını toplu dönüştür, canlı önizle, web için alt kümeye indir ve @font-face CSS'ini al.",
      es: "Convierte fuentes TTF, OTF, WOFF, WOFF2, EOT y SVG por lotes, previsualízalas en vivo, redúcelas para la web y obtén el CSS @font-face.",
      de: "Konvertieren Sie TTF-, OTF-, WOFF-, WOFF2-, EOT- und SVG-Schriften im Stapel – mit Live-Vorschau, Subsetting fürs Web und fertigem @font-face-CSS.",
      fr: "Convertissez vos polices TTF, OTF, WOFF, WOFF2, EOT et SVG par lots, prévisualisez-les en direct, allégez-les pour le web et obtenez le CSS @font-face.",
      pt: "Converta fontes TTF, OTF, WOFF, WOFF2, EOT e SVG em lote, veja a prévia ao vivo, reduza-as para a web e gere o CSS @font-face.",
    },
    keywords:
      "font converter webfont web font generator ttf otf woff woff2 eot svg font subset subsetting font-face css typeface glyph font dönüştürücü yazı tipi web fontu alt küme font çevirici convertidor de fuentes convertir fuente tipografía schriftart konvertieren schrift umwandeln webfont konverter convertisseur de police convertir police conversor de fontes converter fonte",
    formats: ["TTF", "OTF", "WOFF", "WOFF2", "EOT", "SVG"],
    input: FONT_INPUT,
  },
  ...PAIRS.map<ToolMeta>((p) => ({
    slug: `${p.from}-to-${p.to}`,
    group: "font",
    engine: "font-convert",
    parent: "font-converter",
    preset: { format: p.to },
    name: {
      en: `${p.from.toUpperCase()} to ${p.to.toUpperCase()}`,
      tr: `${p.trFrom} ${p.trTo}`,
      es: `${p.from.toUpperCase()} a ${p.to.toUpperCase()}`,
      de: `${p.from.toUpperCase()} in ${p.to.toUpperCase()}`,
      fr: `${p.from.toUpperCase()} en ${p.to.toUpperCase()}`,
      pt: `${p.from.toUpperCase()} para ${p.to.toUpperCase()}`,
    },
    desc: { en: p.en, tr: p.tr, es: p.es, de: p.de, fr: p.fr, pt: p.pt },
    keywords: `${p.from} ${p.to} ${p.from} to ${p.to} convert font webfont ${p.from} ${p.to} dönüştür çevir font yazı tipi convertir convertidor fuente umwandeln konvertieren schriftart convertisseur police converter fonte`,
    formats: [p.from.toUpperCase(), p.to.toUpperCase()],
    input: [p.from],
  })),
];
