/**
 * Quick test to verify PDF parsing works
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParseModule = require('pdf-parse');
const pdfParse = pdfParseModule.PDFParse || pdfParseModule;

console.log('PDF Parse function type:', typeof pdfParse);
console.log('Is function:', typeof pdfParse === 'function');

if (typeof pdfParse === 'function') {
  console.log('✓ PDF parsing function loaded successfully!');
  console.log('✓ Ready to process PDF attachments');
} else {
  console.log('✗ PDF parsing function not loaded correctly');
  console.log('Module exports:', Object.keys(pdfParseModule));
}
