// Uygulama ikonlarını üretir (public/icons/ ve app/icon.png).
// Çalıştırmak için: npm run icons
// İkon: mürekkep mavisi zemin üzerinde iki fiş kartı; öndeki kartta kırmızı
// başlık çizgisi ve fosforlu kalemle işaretlenmiş bir kelime.
import fs from "node:fs";
import sharp from "sharp";

const BG = "#2346A8";

function cards(scale = 1) {
  // scale < 1 → maskeli ikonlar için içerik güvenli alana küçültülür
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <g transform="rotate(-10 256 256)">
      <rect x="112" y="138" width="288" height="200" rx="20" fill="#9DB4F2"/>
    </g>
    <g transform="rotate(4 256 256)">
      <rect x="104" y="168" width="304" height="212" rx="20" fill="#FFFFFF"/>
      <rect x="104" y="212" width="304" height="7" fill="#CF3A4F"/>
      <rect x="138" y="252" width="176" height="34" rx="8" fill="#F5D84A"/>
      <rect x="148" y="262" width="138" height="14" rx="7" fill="#1B2436"/>
      <rect x="138" y="314" width="236" height="5" rx="2.5" fill="#C9D3E6"/>
      <rect x="138" y="344" width="190" height="5" rx="2.5" fill="#C9D3E6"/>
    </g>
  </g>`;
}

const svg = ({ rounded, scale }) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ""} fill="${BG}"/>
  ${cards(scale)}
</svg>`);

fs.mkdirSync("public/icons", { recursive: true });
const out = [
  ["public/icons/icon-512.png", 512, { rounded: true, scale: 1 }],
  ["public/icons/icon-192.png", 192, { rounded: true, scale: 1 }],
  ["public/icons/icon-maskable-512.png", 512, { rounded: false, scale: 0.78 }],
  ["public/icons/apple-touch-icon.png", 180, { rounded: false, scale: 0.86 }],
  ["app/icon.png", 64, { rounded: true, scale: 1 }],
];
for (const [file, size, opts] of out) {
  await sharp(svg(opts)).resize(size, size).png().toFile(file);
  console.log("✓", file);
}
