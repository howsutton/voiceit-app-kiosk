const require = require('module').createRequire(import.meta.url);
const pdf = require('pdf-parse');
console.log('Type of pdf:', typeof pdf);
console.log('Keys of pdf:', Object.keys(pdf));
if (typeof pdf === 'function') {
    console.log('pdf is a function');
} else {
    console.log('pdf is NOT a function');
}
