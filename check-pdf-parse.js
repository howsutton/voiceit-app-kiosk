import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
import fs from 'fs';

async function check() {
  if (typeof pdf.PDFParse === 'function') {
    console.log("PDFParse is a function");
    const pdfPath = "/mnt/data/Act 1 of 2025.pdf";
    if (fs.existsSync(pdfPath)) {
      const buffer = fs.readFileSync(pdfPath);
      const instance = new pdf.PDFParse(new Uint8Array(buffer));
      console.log("getText type:", typeof instance.getText);
      try {
        const result = await instance.getText();
        console.log("getText result type:", typeof result);
        console.log("getText result keys:", Object.keys(result));
        console.log("getText result.text length:", result.text?.length);
        console.log("getText result.text preview:", result.text?.substring(0, 100));
      } catch (err) {
        console.log("getText failed:", err.message);
      }
    } else {
      console.log("PDF file not found at:", pdfPath);
    }
  } else {
    console.log("PDFParse is NOT a function");
    console.log("pdf type:", typeof pdf);
    const pdfParser = typeof pdf === 'function' ? pdf : pdf.default;
    console.log("pdfParser type:", typeof pdfParser);
  }
}

check();
