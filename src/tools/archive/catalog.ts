import type { ToolMeta } from "../../catalog-types";

export const archiveTools: ToolMeta[] = [
  {
    slug: "zip-creator",
    group: "archive",
    engine: "archive-zip",
    popular: true,
    name: { en: "Create ZIP", tr: "ZIP Oluştur" },
    desc: {
      en: "Bundle any number of files into one .zip right in your browser — choose store, fast or maximum compression.",
      tr: "İstediğin kadar dosyayı tarayıcında tek bir .zip'te topla — sıkıştırmasız, hızlı ya da en yüksek sıkıştırma.",
    },
    keywords: "zip create compress files archive make zip zip oluştur sıkıştır dosyaları birleştir arşivle",
    formats: ["ZIP"],
  },
  {
    slug: "unzip",
    group: "archive",
    engine: "archive-extract",
    popular: true,
    name: { en: "Unzip Files", tr: "ZIP Aç" },
    desc: {
      en: "Open ZIP archives online: see every file with its size and folder, download one by one or all at once.",
      tr: "ZIP arşivlerini çevrim içi aç: her dosyayı boyutu ve klasörüyle gör, tek tek ya da hepsini birden indir.",
    },
    keywords: "unzip extract zip open zip decompress zip aç çıkar arşivi aç",
    formats: ["ZIP", "TAR", "TGZ", "GZ"],
  },
  {
    slug: "tar-extractor",
    group: "archive",
    engine: "archive-extract",
    name: { en: "TAR / TGZ Extractor", tr: "TAR / TGZ Çıkarıcı" },
    desc: {
      en: "Extract .tar, .tar.gz and .tgz archives without installing anything — long file names and folders included.",
      tr: ".tar, .tar.gz ve .tgz arşivlerini hiçbir şey kurmadan aç — uzun dosya adları ve klasörler dahil.",
    },
    keywords: "tar tgz tar.gz untar extract linux tarball aç çıkar",
    formats: ["TAR", "TAR.GZ", "TGZ"],
  },
  {
    slug: "gzip-compress",
    group: "archive",
    engine: "archive-gzip",
    preset: { mode: "compress" },
    name: { en: "GZIP Compress", tr: "GZIP Sıkıştır" },
    desc: {
      en: "Compress files to .gz with adjustable level — in bulk, each file on its own.",
      tr: "Dosyaları ayarlanabilir düzeyde .gz olarak sıkıştır — toplu ve her dosya ayrı ayrı.",
    },
    keywords: "gzip gz compress gzip sıkıştır",
    formats: ["GZ"],
  },
  {
    slug: "gzip-decompress",
    group: "archive",
    engine: "archive-gzip",
    preset: { mode: "decompress" },
    name: { en: "GZIP Decompress", tr: "GZIP Aç" },
    desc: {
      en: "Decompress .gz files back to the original, with the stored file name restored.",
      tr: ".gz dosyalarını açıp orijinal hâline döndür; saklanan dosya adı geri gelir.",
    },
    keywords: "gunzip gz decompress extract gzip aç çıkar",
    formats: ["GZ"],
  },
];
