import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdf = require("pdf-parse");
console.log("Keys:", Object.keys(pdf));
console.log("Type of pdf:", typeof pdf);
if (typeof pdf === "function") {
  console.log("pdf is a function");
} else {
  console.log("pdf is not a function");
}
