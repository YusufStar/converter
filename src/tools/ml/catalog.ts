import type { ToolMeta } from "../../catalog-types";

const IMAGES = ["png", "jpg", "jpeg", "jfif", "webp", "avif", "gif", "bmp", "tif", "tiff", "heic", "heif", "jxl"];

export const tools: ToolMeta[] = [
  {
    slug: "image-to-text",
    group: "image",
    engine: "ml-ocr",
    name: {
      en: "Image to Text (OCR)",
      tr: "Görselden Metne (OCR)",
      es: "Imagen a texto (OCR)",
      de: "Bild zu Text (OCR)",
      fr: "Image en texte (OCR)",
      pt: "Imagem para texto (OCR)",
    },
    desc: {
      en: "Pull the text out of photos, scans and screenshots in 16 languages, Turkish included. Copy it or save it as .txt — OCR runs on your device.",
      tr: "Fotoğraf, tarama ve ekran görüntülerindeki metni Türkçe dahil 16 dilde çıkar. Kopyala ya da .txt olarak kaydet — OCR cihazında çalışır.",
      es: "Extrae el texto de fotos, escaneos y capturas de pantalla en 16 idiomas, incluido el español. Cópialo o guárdalo como .txt — el OCR se ejecuta en tu dispositivo.",
      de: "Extrahieren Sie Text aus Fotos, Scans und Screenshots in 16 Sprachen, auch auf Deutsch. Kopieren Sie ihn oder speichern Sie ihn als .txt – die OCR läuft auf Ihrem Gerät.",
      fr: "Extrayez le texte de photos, de scans et de captures d’écran dans 16 langues, dont le français. Copiez-le ou enregistrez-le en .txt — l’OCR s’exécute sur votre appareil.",
      pt: "Extraia o texto de fotos, digitalizações e capturas de tela em 16 idiomas, incluindo português. Copie ou salve como .txt — o OCR roda no seu dispositivo.",
    },
    keywords:
      "ocr text recognition extract text image to text photo to text picture to text screenshot scan tesseract copy text " +
      "metin tanıma resimden yazıya görselden metin fotoğraftan yazı metin çıkar yazıya çevir ekran görüntüsü tarama " +
      "reconocimiento de texto imagen a texto extraer texto de imagen foto a texto convertir imagen a texto " +
      "texterkennung bild zu text text aus bild extrahieren foto in text umwandeln " +
      "reconnaissance de texte image en texte extraire texte d’une image photo en texte " +
      "reconhecimento de texto imagem para texto extrair texto de imagem foto para texto converter imagem em texto",
    formats: ["PNG", "JPG", "WEBP", "HEIC", "TXT"],
    input: IMAGES,
  },
  {
    slug: "pdf-ocr",
    group: "pdf",
    engine: "ml-pdf-ocr",
    name: {
      en: "OCR PDF (Searchable PDF)",
      tr: "PDF OCR (Aranabilir PDF)",
      es: "OCR PDF (PDF buscable)",
      de: "OCR-PDF (durchsuchbares PDF)",
      fr: "OCR PDF (PDF interrogeable)",
      pt: "OCR em PDF (PDF pesquisável)",
    },
    desc: {
      en: "Turn scanned PDFs into searchable, copyable PDFs with an invisible text layer — or pull their text out as .txt.",
      tr: "Taranmış PDF'leri görünmez bir metin katmanıyla aranabilir ve kopyalanabilir hale getir — ya da metnini .txt olarak al.",
      es: "Convierte PDF escaneados en PDF buscables y copiables con una capa de texto invisible, o extrae su texto como .txt.",
      de: "Machen Sie gescannte PDFs mit einer unsichtbaren Textebene durchsuchbar und kopierbar – oder extrahieren Sie den Text als .txt.",
      fr: "Transformez vos PDF scannés en PDF interrogeables et copiables grâce à une couche de texte invisible — ou extrayez leur texte en .txt.",
      pt: "Transforme PDFs digitalizados em PDFs pesquisáveis e copiáveis com uma camada de texto invisível — ou extraia o texto como .txt.",
    },
    keywords:
      "ocr pdf searchable pdf scanned pdf to text scan text layer tesseract make pdf searchable " +
      "aranabilir pdf taranmış pdf metin tanıma pdf metne çevir pdf ocr tarama metin katmanı " +
      "pdf buscable pdf escaneado a texto reconocimiento de texto pdf convertir pdf escaneado " +
      "durchsuchbares pdf gescanntes pdf texterkennung pdf durchsuchbar machen " +
      "pdf interrogeable pdf scanné en texte reconnaissance de texte pdf rendre un pdf interrogeable " +
      "pdf pesquisável pdf digitalizado para texto reconhecimento de texto tornar pdf pesquisável",
    formats: ["PDF", "TXT"],
    input: ["pdf"],
  },
  {
    slug: "remove-background",
    group: "image",
    engine: "ml-remove-bg",
    popular: true,
    name: {
      en: "Remove Background",
      tr: "Arka Plan Kaldırıcı",
      es: "Quitar fondo",
      de: "Hintergrund entfernen",
      fr: "Supprimer l’arrière-plan",
      pt: "Remover fundo",
    },
    desc: {
      en: "Cut out people, products and objects with on-device AI: transparent PNG/WebP, a new colour, a blurred backdrop or just the mask.",
      tr: "Kişileri, ürünleri ve nesneleri cihazında çalışan yapay zekâ ile kes: şeffaf PNG/WebP, yeni bir renk, bulanık arka plan ya da yalnızca maske.",
      es: "Recorta personas, productos y objetos con IA en tu dispositivo: PNG/WebP transparente, un color nuevo, un fondo desenfocado o solo la máscara.",
      de: "Stellen Sie Personen, Produkte und Objekte mit KI direkt auf Ihrem Gerät frei: transparentes PNG/WebP, neue Farbe, unscharfer Hintergrund oder nur die Maske.",
      fr: "Détourez personnes, produits et objets avec une IA qui tourne sur votre appareil : PNG/WebP transparent, nouvelle couleur, arrière-plan flou ou masque seul.",
      pt: "Recorte pessoas, produtos e objetos com IA no seu dispositivo: PNG/WebP transparente, uma nova cor, um fundo desfocado ou só a máscara.",
    },
    keywords:
      "remove background background remover transparent background cutout cut out erase background remove bg ai product photo " +
      "arka plan kaldır arka plan silme dekupe şeffaf arka plan fon kaldırma yapay zeka ürün fotoğrafı " +
      "quitar fondo eliminar fondo fondo transparente recortar imagen borrar fondo " +
      "hintergrund entfernen freistellen transparenter hintergrund bild freistellen " +
      "supprimer arrière-plan détourer image fond transparent enlever le fond " +
      "remover fundo tirar fundo fundo transparente recortar imagem apagar fundo",
    formats: ["PNG", "WEBP", "JPG", "HEIC"],
    input: IMAGES,
  },
];
