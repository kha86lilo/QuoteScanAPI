import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);

try {
  const pdfParseModule = require('pdf-parse');

  console.log('Type of module:', typeof pdfParseModule);
  console.log('Keys:', Object.keys(pdfParseModule));

  // Check if PDFParse is the function
  console.log('\nType of PDFParse:', typeof pdfParseModule.PDFParse);
  console.log('Is function:', typeof pdfParseModule.PDFParse === 'function');

  // The actual parser might be the default export or the module itself
  // pdf-parse typically exports a function directly
  // Let's check if the module itself is callable
  console.log('\nChecking different export patterns...');

  // Pattern 1: Named export PDFParse
  if (typeof pdfParseModule.PDFParse === 'function') {
    console.log('✓ Found as PDFParse named export');
  }

  // Pattern 2: Module itself (this is the old CommonJS way)
  // When you require('pdf-parse'), it might return the function directly in older versions
  // But in newer versions with wrapper, we need to check further

  console.log('\nActual module structure suggests we should use the module directly.');
  console.log('In CommonJS, pdf-parse exports the parser function as module.exports');

} catch (error) {
  console.error('Error:', error.message);
}
