
const fs = require('fs');
const pdf = require('pdf-parse');

async function test() {
  try {
    console.log("pdf-parse type:", typeof pdf);
    console.log("pdf-parse keys:", Object.keys(pdf));
    // Create a dummy PDF buffer if possible, or just check if it's a function
    if (typeof pdf === 'function') {
      console.log("pdf-parse is a function");
    } else {
      console.log("pdf-parse is NOT a function, it is:", typeof pdf);
    }
  } catch (e) {
    console.error("Test failed:", e);
  }
}

test();
