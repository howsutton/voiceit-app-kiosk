import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

console.log("PDFParse class:", pdf.PDFParse);
if (pdf.PDFParse) {
  const instance = new pdf.PDFParse(Buffer.from([])); // Empty buffer just to check methods
  console.log("Instance methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(instance)));
}
