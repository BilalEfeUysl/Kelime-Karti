// Her kartın altına eklenen temel stiller (not tipinin CSS'inden ÖNCE gelir,
// yani not tipi bunları ezebilir).
import { IO_CSS } from "@/lib/io";

export const BASE_CARD_CSS = `${IO_CSS}
/* Koyu temada: Word'den kopyalanmış kartlardaki gömülü siyah/koyu yazı renkleri okunmaz → yok say */
.nightMode [style*="color:black"], .nightMode [style*="color: black"], .nightMode [style*="color:#000"],
.nightMode [style*="color: #000"], .nightMode [style*="color:windowtext"], .nightMode [style*="color:#333"],
.nightMode font[color="#000000"], .nightMode font[color="black"] { color: inherit !important; }
/* Word paragraflarının boşlukları ve sabit yazı boyutları */
.MsoNormal { margin: 0; }
#qa [style*="font-size:15.0pt"], #qa [style*="font-size: 15pt"] { font-size: inherit !important; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: 20px 16px; overflow-wrap: anywhere; }
body.nightMode { color: #ddd7cc; background: #252421; }
img { max-width: 100%; height: auto; }
hr#answer { border: 0; border-top: 1px solid #c9d1de; margin: 18px 0; }
.nightMode hr#answer { border-top-color: #4a4740; }
a.hint { color: #2346a8; cursor: pointer; }
.nightMode a.hint { color: #a3b4d6; }
#typeans { font: inherit; font-size: 0.95em; width: 100%; max-width: 420px; box-sizing: border-box;
  padding: 8px 10px; margin-top: 12px; border: 1px solid #aab4c6; border-radius: 8px; background: #fff; color: #111; }
input#typeans { display: block; margin-left: auto; margin-right: auto; }
.nightMode #typeans { background: #1b1a18; color: #ddd7cc; border-color: #4a4740; }
code#typeans { font-family: ui-monospace, Menlo, monospace; display: inline-block; text-align: left; line-height: 1.6; }
.typeGood { background: #b8f0b8; color: #0b3d0b; }
.typeBad { background: #ffc4c4; color: #5c0b0b; }
.typeMissed { background: #d9dde5; color: #333; }
.nightMode .typeGood { background: #3d5a42; color: #e4eee2; }
.nightMode .typeBad { background: #6b3b38; color: #f3e4e1; }
.nightMode .typeMissed { background: #45423b; color: #ddd7cc; }
.kk-example-box { margin-top: 16px; }
.kk-pron { font-size: 0.6em; opacity: 0.7; margin-top: 4px; }
.kk-example { font-size: 0.85em; font-style: italic; }
.kk-hl { color: #2f62b8; }
.nightMode .kk-hl { color: #a9c0ec; }
.kk-example-tr, .kk-examples .kk-example-tr { font-style: normal; font-size: 0.9em; opacity: 0.75; margin-top: 2px; }
.kk-examples { text-align: left; display: inline-block; font-size: 0.85em; margin: 8px 0; padding-left: 1.2em; }
.kk-more-examples { margin-top: 10px; font-size: 0.8em; }
.kk-more-examples summary { cursor: pointer; opacity: 0.7; }
.kk-more-examples ul { text-align: left; display: inline-block; padding-left: 1.2em; }
.kk-template-error { color: #b42318; font-size: 0.8em; }
.replay-button, .soundLink { display: none; }
`;
