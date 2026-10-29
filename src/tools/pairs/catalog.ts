import type { GroupId, L10n, ToolMeta } from "../../catalog-types";

// "X to Y" landing pages: each is a preset of an existing tool (its `parent`), so they add
// no code — only a page people search for, linked from the parent tool.

interface Fmt {
  /** Display name. */
  n: string;
  /** Turkish "from X" / "to X" with the right suffix ("PNG'den", "JPG'ye"). */
  from: string;
  to: string;
  /** Input extensions. */
  ext: string[];
}

const F: Record<string, Fmt> = {
  png: { n: "PNG", from: "PNG'den", to: "PNG'ye", ext: ["png"] },
  jpg: { n: "JPG", from: "JPG'den", to: "JPG'ye", ext: ["jpg", "jpeg", "jfif"] },
  webp: { n: "WebP", from: "WebP'den", to: "WebP'ye", ext: ["webp"] },
  heic: { n: "HEIC", from: "HEIC'ten", to: "HEIC'e", ext: ["heic", "heif"] },
  avif: { n: "AVIF", from: "AVIF'ten", to: "AVIF'e", ext: ["avif"] },
  svg: { n: "SVG", from: "SVG'den", to: "SVG'ye", ext: ["svg"] },
  gif: { n: "GIF", from: "GIF'ten", to: "GIF'e", ext: ["gif"] },
  bmp: { n: "BMP", from: "BMP'den", to: "BMP'ye", ext: ["bmp"] },
  tiff: { n: "TIFF", from: "TIFF'ten", to: "TIFF'e", ext: ["tiff", "tif"] },
  ico: { n: "ICO", from: "ICO'dan", to: "ICO'ya", ext: ["ico"] },
  pdf: { n: "PDF", from: "PDF'ten", to: "PDF'e", ext: ["pdf"] },
  mp4: { n: "MP4", from: "MP4'ten", to: "MP4'e", ext: ["mp4", "m4v"] },
  webm: { n: "WebM", from: "WebM'den", to: "WebM'e", ext: ["webm"] },
  mov: { n: "MOV", from: "MOV'dan", to: "MOV'a", ext: ["mov"] },
  avi: { n: "AVI", from: "AVI'den", to: "AVI'ye", ext: ["avi"] },
  wmv: { n: "WMV", from: "WMV'den", to: "WMV'ye", ext: ["wmv"] },
  flv: { n: "FLV", from: "FLV'den", to: "FLV'ye", ext: ["flv"] },
  mp3: { n: "MP3", from: "MP3'ten", to: "MP3'e", ext: ["mp3"] },
  wav: { n: "WAV", from: "WAV'dan", to: "WAV'a", ext: ["wav"] },
  flac: { n: "FLAC", from: "FLAC'tan", to: "FLAC'a", ext: ["flac"] },
  ogg: { n: "OGG", from: "OGG'den", to: "OGG'ye", ext: ["ogg", "oga"] },
  aac: { n: "AAC", from: "AAC'den", to: "AAC'ye", ext: ["aac"] },
  opus: { n: "Opus", from: "Opus'tan", to: "Opus'a", ext: ["opus"] },
  wma: { n: "WMA", from: "WMA'dan", to: "WMA'ya", ext: ["wma"] },
  aiff: { n: "AIFF", from: "AIFF'ten", to: "AIFF'e", ext: ["aiff", "aif"] },
  jxl: { n: "JXL", from: "JXL'den", to: "JXL'ye", ext: ["jxl"] },
  psd: { n: "PSD", from: "PSD'den", to: "PSD'ye", ext: ["psd"] },
  dng: { n: "DNG", from: "DNG'den", to: "DNG'ye", ext: ["dng"] },
  cr2: { n: "CR2", from: "CR2'den", to: "CR2'ye", ext: ["cr2"] },
  cr3: { n: "CR3", from: "CR3'ten", to: "CR3'e", ext: ["cr3"] },
  nef: { n: "NEF", from: "NEF'ten", to: "NEF'e", ext: ["nef"] },
  arw: { n: "ARW", from: "ARW'den", to: "ARW'ye", ext: ["arw"] },
};

type Kind = "image" | "pdf" | "video" | "gif" | "extract" | "audio";

type Text = Required<L10n>;

const BLURB: Record<Kind, Text> = {
  image: {
    en: "in bulk, with quality, resize and background options",
    tr: "toplu olarak, kalite, boyut ve arka plan ayarlarıyla",
    es: "por lotes, con opciones de calidad, tamaño y fondo",
    de: "im Stapel, mit Optionen für Qualität, Größe und Hintergrund",
    fr: "par lots, avec réglages de qualité, de taille et d’arrière-plan",
    pt: "em lote, com opções de qualidade, tamanho e fundo",
  },
  pdf: {
    en: "one page per image or one PDF per file, with page size and margins",
    tr: "her görsel bir sayfa ya da her dosya ayrı PDF, sayfa boyutu ve kenar boşluklarıyla",
    es: "una página por imagen o un PDF por archivo, con tamaño de página y márgenes",
    de: "eine Seite pro Bild oder ein PDF pro Datei, mit Seitenformat und Rändern",
    fr: "une page par image ou un PDF par fichier, avec format de page et marges",
    pt: "uma página por imagem ou um PDF por arquivo, com tamanho de página e margens",
  },
  video: {
    en: "with quality, resolution and audio options",
    tr: "kalite, çözünürlük ve ses ayarlarıyla",
    es: "con opciones de calidad, resolución y audio",
    de: "mit Optionen für Qualität, Auflösung und Ton",
    fr: "avec réglages de qualité, de résolution et d’audio",
    pt: "com opções de qualidade, resolução e áudio",
  },
  gif: {
    en: "pick the part, frame rate and width for a small, smooth GIF",
    tr: "bölümü, kare hızını ve genişliği seçerek küçük ve akıcı bir GIF yap",
    es: "elige el fragmento, los fotogramas por segundo y el ancho para un GIF ligero y fluido",
    de: "wählen Sie Ausschnitt, Bildrate und Breite für ein kleines, flüssiges GIF",
    fr: "choisissez l’extrait, la cadence et la largeur pour un GIF léger et fluide",
    pt: "escolha o trecho, a taxa de quadros e a largura para um GIF leve e fluido",
  },
  extract: {
    en: "extract the soundtrack with the bitrate you choose",
    tr: "ses kanalını istediğin bit hızıyla çıkar",
    es: "extrae la pista de audio con la tasa de bits que elijas",
    de: "extrahieren Sie die Tonspur mit der gewünschten Bitrate",
    fr: "extrayez la piste audio avec le débit de votre choix",
    pt: "extraia a trilha de áudio com a taxa de bits que você escolher",
  },
  audio: {
    en: "with bitrate, sample rate and channel options, many files at once",
    tr: "bit hızı, örnekleme hızı ve kanal ayarlarıyla, birçok dosyayı aynı anda",
    es: "con opciones de tasa de bits, frecuencia de muestreo y canales, muchos archivos a la vez",
    de: "mit Optionen für Bitrate, Abtastrate und Kanäle, viele Dateien auf einmal",
    fr: "avec réglages de débit, de fréquence d’échantillonnage et de canaux, plusieurs fichiers à la fois",
    pt: "com opções de taxa de bits, taxa de amostragem e canais, vários arquivos de uma vez",
  },
};

const GROUP: Record<Kind, GroupId> = { image: "image", pdf: "pdf", video: "media", gif: "media", extract: "media", audio: "media" };

type Note = Text;

function pair(from: string, to: string, kind: Kind, parent: string, engine: string, preset: Record<string, unknown>, note?: Note): ToolMeta {
  const a = F[from];
  const b = F[to];
  const blurb = BLURB[kind];
  const n = (lang: keyof Text) => (note ? ` ${note[lang]}` : "");
  return {
    slug: `${from}-to-${to}`,
    group: GROUP[kind],
    engine,
    parent,
    preset,
    input: a.ext,
    name: {
      en: `${a.n} to ${b.n}`,
      tr: `${a.from} ${b.to}`,
      es: `${a.n} a ${b.n}`,
      de: `${a.n} in ${b.n}`,
      fr: `${a.n} en ${b.n}`,
      pt: `${a.n} para ${b.n}`,
    },
    desc: {
      en: `Convert ${a.n} to ${b.n} right in your browser — ${blurb.en}.${n("en")} No uploads, no sign-up.`,
      tr: `${a.n} dosyalarını tarayıcında ${b.n} formatına çevir — ${blurb.tr}.${n("tr")} Yükleme yok, kayıt yok.`,
      es: `Convierte ${a.n} a ${b.n} directamente en tu navegador: ${blurb.es}.${n("es")} Sin subir archivos ni registrarte.`,
      de: `Konvertieren Sie ${a.n} in ${b.n} direkt im Browser – ${blurb.de}.${n("de")} Ohne Upload, ohne Anmeldung.`,
      fr: `Convertissez ${a.n} en ${b.n} directement dans votre navigateur : ${blurb.fr}.${n("fr")} Sans envoi de fichiers, sans inscription.`,
      pt: `Converta ${a.n} para ${b.n} direto no seu navegador: ${blurb.pt}.${n("pt")} Sem upload e sem cadastro.`,
    },
    keywords: `${from} to ${to} ${from}2${to} ${a.from} ${b.to} çevir dönüştür convert convertir umwandeln konvertieren converter ${from} a ${to} ${from} in ${to} ${from} en ${to} ${from} para ${to}`,
    formats: [a.n.toUpperCase(), b.n.toUpperCase()],
  };
}

const image = (from: string, to: string, parent: string, preset: Record<string, unknown>, note?: Note) =>
  pair(from, to, "image", parent, "image", preset, note);

const RAW: Note = {
  en: "Uses the full sensor data where your browser allows it, or the camera's own embedded preview.",
  tr: "Tarayıcın izin verdiğinde tam sensör verisini, vermezse kameranın gömülü önizlemesini kullanır.",
  es: "Usa los datos completos del sensor cuando tu navegador lo permite, o la vista previa que incrusta la cámara.",
  de: "Nutzt die vollständigen Sensordaten, wo der Browser es erlaubt, sonst die eingebettete Vorschau der Kamera.",
  fr: "Utilise les données complètes du capteur quand votre navigateur le permet, sinon l’aperçu intégré par l’appareil.",
  pt: "Usa os dados completos do sensor quando o navegador permite, ou a prévia incorporada pela própria câmera.",
};
const IPHONE: Note = {
  en: "Opens iPhone photos everywhere.",
  tr: "iPhone fotoğraflarını her yerde açılır hale getirir.",
  es: "Abre las fotos del iPhone en cualquier lugar.",
  de: "Macht iPhone-Fotos überall lesbar.",
  fr: "Vos photos d’iPhone s’ouvrent partout.",
  pt: "Abre as fotos do iPhone em qualquer lugar.",
};
const VECTOR: Note = {
  en: "The SVG is re-rendered as vectors at the size you pick, so edges stay sharp.",
  tr: "SVG seçtiğin boyutta vektör olarak yeniden çizilir, kenarlar keskin kalır.",
  es: "El SVG se vuelve a dibujar como vector al tamaño que elijas, así los bordes quedan nítidos.",
  de: "Das SVG wird in der gewählten Größe als Vektor neu gezeichnet, damit die Kanten scharf bleiben.",
  fr: "Le SVG est redessiné en vectoriel à la taille choisie, les contours restent nets.",
  pt: "O SVG é redesenhado como vetor no tamanho que você escolher, então as bordas ficam nítidas.",
};
const TRANSPARENT: Note = {
  en: "Transparent areas get the background colour you choose.",
  tr: "Şeffaf alanlara seçtiğin arka plan rengi verilir.",
  es: "Las zonas transparentes toman el color de fondo que elijas.",
  de: "Transparente Bereiche erhalten die gewählte Hintergrundfarbe.",
  fr: "Les zones transparentes prennent la couleur de fond de votre choix.",
  pt: "As áreas transparentes recebem a cor de fundo que você escolher.",
};
const HEIC_ACCEPT = ".heic,.heif,image/heic,image/heif";
const SVG_PRESET = { svg: true, resize: { mode: "percent", percent: 200 } };

export const tools: ToolMeta[] = [
  image("png", "jpg", "jpg-converter", { format: "jpg", quality: 88 }, TRANSPARENT),
  image("jpg", "png", "png-converter", { format: "png" }),
  image("webp", "png", "png-converter", { format: "png" }),
  image("webp", "jpg", "jpg-converter", { format: "jpg", quality: 88 }),
  image("png", "webp", "webp-converter", { format: "webp", quality: 82 }),
  image("jpg", "webp", "webp-converter", { format: "webp", quality: 82 }),
  image("heic", "jpg", "heic-converter", { format: "jpg", quality: 90, accept: HEIC_ACCEPT }, IPHONE),
  image("heic", "png", "heic-converter", { format: "png", accept: HEIC_ACCEPT }, IPHONE),
  image("heic", "webp", "heic-converter", { format: "webp", quality: 85, accept: HEIC_ACCEPT }, IPHONE),
  image("avif", "jpg", "jpg-converter", { format: "jpg", quality: 88 }),
  image("avif", "png", "png-converter", { format: "png" }),
  image("png", "avif", "avif-converter", { format: "avif", quality: 60 }),
  image("jpg", "avif", "avif-converter", { format: "avif", quality: 60 }),
  image("svg", "png", "svg-converter", { ...SVG_PRESET, format: "png" }, VECTOR),
  image("svg", "jpg", "svg-converter", { ...SVG_PRESET, format: "jpg", quality: 92 }, VECTOR),
  image("svg", "webp", "svg-converter", { ...SVG_PRESET, format: "webp", quality: 90 }, VECTOR),
  image("gif", "png", "png-converter", { format: "png" }),
  image("gif", "jpg", "jpg-converter", { format: "jpg", quality: 88 }),
  image("bmp", "png", "png-converter", { format: "png" }),
  image("bmp", "jpg", "jpg-converter", { format: "jpg", quality: 90 }),
  image("tiff", "jpg", "jpg-converter", { format: "jpg", quality: 90 }),
  image("tiff", "png", "png-converter", { format: "png" }),
  image("png", "ico", "image-converter", { format: "ico" }),
  image("jxl", "jpg", "jpg-converter", { format: "jpg", quality: 90 }),
  image("jxl", "png", "png-converter", { format: "png" }),
  image("jpg", "jxl", "jxl-converter", { format: "jxl", quality: 80 }),
  image("png", "jxl", "jxl-converter", { format: "jxl", quality: 80 }),
  image("psd", "png", "psd-converter", { format: "png", accept: ".psd,image/vnd.adobe.photoshop" }),
  image("psd", "jpg", "psd-converter", { format: "jpg", quality: 90, accept: ".psd,image/vnd.adobe.photoshop" }),
  ...["dng", "cr2", "cr3", "nef", "arw"].map((raw) => image(raw, "jpg", "raw-converter", { format: "jpg", quality: 92, accept: `.${raw}` }, RAW)),
  image("jpg", "ico", "image-converter", { format: "ico" }),
  pair("jpg", "pdf", "pdf", "images-to-pdf", "image-pdf", {}),
  pair("png", "pdf", "pdf", "images-to-pdf", "image-pdf", {}),
  pair("heic", "pdf", "pdf", "images-to-pdf", "image-pdf", {}, IPHONE),
  pair("tiff", "pdf", "pdf", "images-to-pdf", "image-pdf", {}),
  pair("webp", "pdf", "pdf", "images-to-pdf", "image-pdf", {}),

  pair("mp4", "webm", "video", "video-converter", "media-video", { format: "webm" }),
  pair("avi", "mp4", "video", "video-converter", "media-video", { format: "mp4" }),
  pair("wmv", "mp4", "video", "video-converter", "media-video", { format: "mp4" }),
  pair("flv", "mp4", "video", "video-converter", "media-video", { format: "mp4" }),
  pair("mp4", "mov", "video", "video-converter", "media-video", { format: "mov" }),
  pair("mp4", "gif", "gif", "video-to-gif", "media-video", { format: "gif", focus: "gif" }),
  pair("mov", "gif", "gif", "video-to-gif", "media-video", { format: "gif", focus: "gif" }),
  pair("webm", "gif", "gif", "video-to-gif", "media-video", { format: "gif", focus: "gif" }),
  pair("mov", "mp3", "extract", "video-to-mp3", "media-audio", { format: "mp3", source: "video" }),
  pair("webm", "mp3", "extract", "video-to-mp3", "media-audio", { format: "mp3", source: "video" }),
  pair("mp4", "wav", "extract", "video-to-mp3", "media-audio", { format: "wav", source: "video" }),
  pair("mp3", "wav", "audio", "audio-converter", "media-audio", { format: "wav" }),
  pair("flac", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("ogg", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("aac", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("opus", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("wma", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("aiff", "mp3", "audio", "audio-converter", "media-audio", { format: "mp3" }),
  pair("wav", "flac", "audio", "audio-converter", "media-audio", { format: "flac" }),
];
