import type { ToolMeta } from "../../catalog-types";

const RASTER_IN = ["png", "jpg", "jpeg", "jfif", "webp", "avif", "gif", "bmp", "tiff", "tif", "heic", "heif"];
const EXIF_IN = ["jpg", "jpeg", "jfif", "png", "webp", "heic", "heif", "tiff", "tif", "avif"];

export const tools: ToolMeta[] = [
  {
    slug: "crop-image",
    group: "image",
    engine: "image-crop",
    name: { en: "Crop Image", tr: "Görsel Kırp", es: "Recortar imagen", de: "Bild zuschneiden", fr: "Recadrer une image", pt: "Cortar imagem" },
    desc: {
      en: "Crop photos with a drag-and-resize box, aspect presets (1:1, 16:9, 4:5…) or exact pixels — one image or a whole batch, at full resolution.",
      tr: "Fotoğrafları sürükle-boyutlandır kutusuyla, oran ön ayarlarıyla (1:1, 16:9, 4:5…) ya da tam piksel değerleriyle kırp — tek görsel ya da toplu, tam çözünürlükte.",
      es: "Recorta fotos con un recuadro que puedes mover y redimensionar, proporciones predefinidas (1:1, 16:9, 4:5…) o píxeles exactos — una imagen o un lote entero, a resolución completa.",
      de: "Schneiden Sie Fotos mit einem verschieb- und skalierbaren Rahmen, Seitenverhältnis-Vorgaben (1:1, 16:9, 4:5…) oder exakten Pixeln zu — ein Bild oder ein ganzer Stapel, in voller Auflösung.",
      fr: "Recadrez vos photos avec un cadre à déplacer et redimensionner, des proportions prédéfinies (1:1, 16:9, 4:5…) ou des pixels exacts — une image ou tout un lot, en pleine résolution.",
      pt: "Corte fotos com uma caixa que você arrasta e redimensiona, proporções prontas (1:1, 16:9, 4:5…) ou pixels exatos — uma imagem ou um lote inteiro, em resolução total.",
    },
    keywords: "crop cut trim aspect ratio square instagram 1:1 16:9 4:5 kırp kırpma kes oran kare görsel fotoğraf resim recortar imagen recorte cuadrado proporción zuschneiden beschneiden bild quadrat seitenverhältnis recadrer rogner image carré proportions cortar recortar imagem quadrado proporção",
    formats: ["PNG", "JPG", "WEBP", "AVIF", "HEIC"],
    input: RASTER_IN,
  },
  {
    slug: "exif-viewer",
    group: "image",
    engine: "image-exif-viewer",
    name: { en: "EXIF Viewer", tr: "EXIF Görüntüleyici", es: "Visor EXIF", de: "EXIF-Viewer", fr: "Visionneuse EXIF", pt: "Visualizador EXIF" },
    desc: {
      en: "See a photo's hidden metadata: camera, lens, exposure, date, colour profile and GPS location on a map — plus every raw tag, exportable as JSON.",
      tr: "Fotoğrafın gizli meta verisini gör: kamera, lens, pozlama, tarih, renk profili ve haritada GPS konumu — ayrıca tüm ham etiketler, JSON olarak dışa aktarılabilir.",
      es: "Consulta los metadatos ocultos de una foto: cámara, objetivo, exposición, fecha, perfil de color y ubicación GPS en un mapa — además de todas las etiquetas en bruto, exportables como JSON.",
      de: "Sehen Sie die versteckten Metadaten eines Fotos: Kamera, Objektiv, Belichtung, Datum, Farbprofil und GPS-Standort auf einer Karte — dazu alle Roh-Tags, als JSON exportierbar.",
      fr: "Affichez les métadonnées cachées d’une photo : appareil, objectif, exposition, date, profil colorimétrique et position GPS sur une carte — ainsi que toutes les balises brutes, exportables en JSON.",
      pt: "Veja os metadados ocultos de uma foto: câmera, lente, exposição, data, perfil de cor e localização GPS no mapa — além de todas as tags brutas, exportáveis em JSON.",
    },
    keywords: "exif metadata viewer reader photo info camera gps location xmp iptc meta veri okuyucu fotoğraf bilgisi kamera konum ver metadatos visor exif foto cámara ubicación metadaten anzeigen exif viewer kamera standort voir métadonnées lire exif appareil localisation ver metadados visualizador exif câmera localização",
    formats: ["JPG", "PNG", "WEBP", "HEIC", "TIFF"],
    input: EXIF_IN,
  },
  {
    slug: "remove-exif",
    group: "image",
    engine: "image-remove-exif",
    name: { en: "Remove EXIF Metadata", tr: "EXIF Meta Verisini Sil", es: "Eliminar metadatos EXIF", de: "EXIF-Metadaten entfernen", fr: "Supprimer les métadonnées EXIF", pt: "Remover metadados EXIF" },
    desc: {
      en: "Strip GPS location, camera details and other metadata from photos without re-compressing them. Orientation and colour profile are kept.",
      tr: "Fotoğraflardan GPS konumunu, kamera bilgilerini ve diğer meta verileri yeniden sıkıştırmadan temizle. Yön ve renk profili korunur.",
      es: "Elimina la ubicación GPS, los datos de la cámara y otros metadatos de tus fotos sin volver a comprimirlas. Se conservan la orientación y el perfil de color.",
      de: "Entfernen Sie GPS-Standort, Kameradaten und andere Metadaten aus Fotos, ohne sie neu zu komprimieren. Ausrichtung und Farbprofil bleiben erhalten.",
      fr: "Supprimez la position GPS, les infos d’appareil photo et les autres métadonnées de vos photos sans les recompresser. L’orientation et le profil colorimétrique sont conservés.",
      pt: "Remova a localização GPS, os dados da câmera e outros metadados das fotos sem comprimi-las de novo. A orientação e o perfil de cor são mantidos.",
    },
    keywords: "remove strip delete exif metadata gps location privacy clean anonymize meta veri sil temizle kaldır konum gizlilik eliminar borrar quitar metadatos exif privacidad ubicación metadaten entfernen löschen datenschutz standort supprimer effacer métadonnées confidentialité localisation remover apagar metadados privacidade localização",
    formats: ["JPG", "PNG", "WEBP", "HEIC"],
    input: EXIF_IN,
  },
  {
    slug: "image-to-svg",
    group: "image",
    engine: "image-svg-trace",
    name: { en: "Image to SVG", tr: "Görselden SVG'ye", es: "Imagen a SVG", de: "Bild in SVG", fr: "Image en SVG", pt: "Imagem para SVG" },
    desc: {
      en: "Vectorize PNG and JPG images into scalable SVG — logos, icons, line art and pixel art — with a live side-by-side preview.",
      tr: "PNG ve JPG görselleri ölçeklenebilir SVG'ye dönüştür — logo, ikon, çizim ve piksel sanatı — canlı yan yana önizlemeyle.",
      es: "Vectoriza imágenes PNG y JPG en SVG escalable — logotipos, iconos, dibujos lineales y pixel art — con vista previa en paralelo en tiempo real.",
      de: "Vektorisieren Sie PNG- und JPG-Bilder als skalierbares SVG — Logos, Icons, Strichzeichnungen und Pixel-Art — mit Live-Vorschau im direkten Vergleich.",
      fr: "Vectorisez vos images PNG et JPG en SVG redimensionnable — logos, icônes, dessins au trait et pixel art — avec un aperçu côte à côte en direct.",
      pt: "Vetorize imagens PNG e JPG em SVG escalável — logos, ícones, traços e pixel art — com prévia lado a lado em tempo real.",
    },
    keywords: "vectorize vectorise trace tracing bitmap raster png to svg jpg to svg vector logo vektör vektörel çevir izleme svg dönüştür vectorizar convertir imagen a svg png a svg vectorial vektorisieren bild in svg png in svg vektor umwandeln vectoriser image en svg png en svg vectoriel vetorizar imagem para svg png para svg vetor",
    formats: ["PNG", "JPG", "SVG"],
    input: RASTER_IN,
  },
];
