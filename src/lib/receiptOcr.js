let tesseractPromise;

function loadTesseract() {
  if (typeof window !== "undefined" && window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;

  tesseractPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-hostelsplit-ocr]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Tesseract), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load the receipt OCR engine.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.async = true;
    script.dataset.hostelsplitOcr = "true";
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error("Receipt OCR engine did not initialize."));
    script.onerror = () => reject(new Error("Could not load the receipt OCR engine. Check your internet connection and try again."));
    document.head.appendChild(script);
  });
  return tesseractPromise;
}

export async function readReceipt(file, onProgress) {
  const tesseract = await loadTesseract();
  const result = await tesseract.recognize(file, "eng", {
    logger: (event) => {
      if (event && event.status === "recognizing text" && typeof onProgress === "function") {
        onProgress(Math.round((event.progress || 0) * 100));
      }
    },
  });
  const text = String(result && result.data && result.data.text || "").trim();
  if (!text) throw new Error("No readable text was found. Try a sharper, well-lit receipt image.");

  const amounts = text.match(/(?:₹|Rs\.?\s?|INR\s*)\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/g) || [];
  const parsed = amounts
    .map((candidate) => Number(candidate.replace(/[^0-9.]/g, "")))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100000000);
  const suggestedAmount = parsed.length ? Math.max(...parsed) : null;
  return { text, suggestedAmount };
}

export async function compressReceiptImage(file, maxEdge = 1440, quality = 0.74) {
  if (!file || !file.type.startsWith("image/")) throw new Error("Choose an image file for the receipt.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Receipt images must be 12 MB or smaller.");
  const source = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("This image could not be opened."));
      img.src = source;
    });
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image compression is not available in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Could not compress the receipt image.");
    return new File([blob], (file.name || "receipt").replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not save the receipt image locally."));
    reader.readAsDataURL(file);
  });
}
