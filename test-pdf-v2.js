import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

async function test() {
  try {
    console.log("pdf keys:", Object.keys(pdf));
    if (pdf.PDFParse) {
      console.log("PDFParse is available");
      // We can't really test with a real PDF easily without a file, 
      // but let's see if we can find where the page count might be.
    }
  } catch (e) {
    console.error(e);
  }
}
test();
