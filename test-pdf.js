const { createRequire } = require('module');
const requireCustom = createRequire(__filename);
const pdf = requireCustom('pdf-parse');
console.log('Keys:', Object.keys(pdf));
console.log('Type of pdf:', typeof pdf);
if (typeof pdf === 'function') {
    console.log('pdf is a function');
} else if (pdf.PDFParse) {
    console.log('pdf.PDFParse exists');
}
