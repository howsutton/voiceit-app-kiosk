import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");

async function test() {
  try {
    // We don't have a real PDF here, but we can check the structure
    const instance = new pdf.PDFParse(Buffer.from([]));
    console.log("Instance created");
    
    console.log("getText type:", typeof instance.getText);
    console.log("getInfo type:", typeof instance.getInfo);
    
    // Since buffer is empty, these might fail or return empty
    try {
        const text = await instance.getText();
        console.log("getText result:", text);
    } catch (e) {
        console.log("getText failed (expected with empty buffer)");
    }

    try {
        const info = await instance.getInfo();
        console.log("getInfo result:", info);
    } catch (e) {
        console.log("getInfo failed (expected with empty buffer)");
    }
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();
