/**
 * Attachment Processor Service
 * Extracts text from PDF, Excel, and image attachments
 */

import { createRequire } from 'module';
const { PDFParse } = createRequire(import.meta.url)('pdf-parse');
const VerbosityLevel = { ERRORS: 0 };

import ExcelJS from 'exceljs';
import Tesseract from 'tesseract.js';
import * as microsoftGraphService from './mail/microsoftGraphService.js';

class AttachmentProcessor {
  constructor() {
    // Supported file types for processing
    this.supportedTypes = {
      pdf: ['.pdf'],
      excel: ['.xlsx', '.xls', '.csv'],
      image: ['.png', '.jpg', '.jpeg'],
    };
  }

  /**
   * Process all attachments for an email
   * @param {string} emailId - Email message ID
   * @returns {Promise<Object>} Extracted text and metadata
   */
  async processEmailAttachments(emailId) {
    try {
      // Fetch attachments from Microsoft Graph
      const attachments = await microsoftGraphService.default.fetchAttachments(emailId);

      if (!attachments || attachments.length === 0) {
        return { hasAttachments: false, extractedText: '', attachments: [] };
      }

      console.log(`  📎 Found ${attachments.length} attachment(s)`);

      const results = {
        hasAttachments: true,
        extractedText: '',
        attachments: [],
        processedCount: 0,
        skippedCount: 0,
      };

      // Process each attachment
      for (const attachment of attachments) {
        const fileName = attachment.name || 'unknown';
        const fileType = this.getFileType(fileName);

        if (!fileType) {
          console.log(`  ⊘ Skipping unsupported file: ${fileName}`);
          results.skippedCount++;
          results.attachments.push({
            name: fileName,
            processed: false,
            reason: 'Unsupported file type',
          });
          continue;
        }

        try {
          console.log(`Email Id ${emailId}  📄 Processing ${fileType.toUpperCase()}: ${fileName}`);
          const contentBytes = attachment.contentBytes;
          if (!contentBytes) {
            console.log(`  ⚠ No content available for ${fileName}`);
            continue;
          }

          // Convert base64 to buffer
          const buffer = Buffer.from(contentBytes, 'base64');

          // Extract text based on file type
          let extractedText = '';

          switch (fileType) {
            case 'pdf':
              extractedText = await this.extractFromPDF(buffer);
              break;
            case 'excel':
              extractedText = await this.extractFromExcel(buffer, fileName);
              break;
            case 'image':
              extractedText = await this.extractFromImage(buffer);
              break;
          }

          if (extractedText && extractedText.trim()) {
            results.extractedText += `\n\n--- Content from ${fileName} ---\n${extractedText}\n`;
            results.processedCount++;
            results.attachments.push({
              name: fileName,
              type: fileType,
              processed: true,
              textLength: extractedText.length,
            });
            console.log(`  ✓ Extracted ${extractedText.length} characters from ${fileName}`);
          } else {
            console.log(`  ⚠ No text extracted from ${fileName}`);
            results.attachments.push({
              name: fileName,
              type: fileType,
              processed: false,
              reason: 'No text extracted',
            });
          }
        } catch (error) {
          console.error(`  ✗ Error processing ${fileName}:`, error.message);
          results.attachments.push({
            name: fileName,
            processed: false,
            error: error.message,
          });
        }
      }

      console.log(`  ✓ Processed ${results.processedCount}/${attachments.length} attachments`);
      return results;
    } catch (error) {
      console.error(`✗ Error fetching attachments:`, error.message);
      return { hasAttachments: false, extractedText: '', error: error.message };
    }
  }

  /**
   * Extract text from PDF
   * @param {Buffer} buffer - PDF file buffer
   * @returns {Promise<string>} Extracted text
   */
  async extractFromPDF(buffer) {
    try {
      const parser = new PDFParse({ verbosity: VerbosityLevel.ERRORS, data: buffer });
      const result = await parser.getText();
      return result.text || '';
    } catch (error) {
      console.error('  ✗ PDF parsing error:', error.message);
      return '';
    }
  }

  /**
   * Extract text from Excel file
   * @param {Buffer} buffer - Excel file buffer
   * @param {string} fileName - Original file name for format detection
   * @returns {Promise<string>} Extracted text
   */
  async extractFromExcel(buffer, fileName) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      let extractedText = '';

      // Process each sheet
      workbook.eachSheet((worksheet, sheetId) => {
        extractedText += `\n\n[Sheet: ${worksheet.name}]\n`;

        worksheet.eachRow((row, rowNumber) => {
          const values = row.values.slice(1); // Skip index 0 which is undefined
          const rowText = values
            .map((cell) => {
              if (cell === null || cell === undefined) return '';
              if (typeof cell === 'object' && cell.text) return cell.text;
              return String(cell);
            })
            .join(',');

          if (rowText.trim()) {
            extractedText += rowText + '\n';
          }
        });
      });

      return extractedText.trim();
    } catch (error) {
      console.error('  ✗ Excel parsing error:', error.message);
      return '';
    }
  }

  /**
   * Extract text from image using OCR
   * @param {Buffer} buffer - Image file buffer
   * @returns {Promise<string>} Extracted text
   */
  async extractFromImage(buffer) {
    try {
      // Validate buffer before processing to catch corrupt images early
      if (!buffer || buffer.length === 0) {
        console.error('  ✗ OCR error: Empty or invalid image buffer');
        return '';
      }

      // Check for valid PNG header (first 8 bytes)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const jpgHeader = Buffer.from([0xff, 0xd8, 0xff]);

      const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(pngHeader);
      const isJpg = buffer.length >= 3 && buffer.subarray(0, 3).equals(jpgHeader);

      if (!isPng && !isJpg) {
        console.error('  ✗ OCR error: Invalid or corrupt image format');
        return '';
      }

      // Skip small images that are likely logos/signatures (< 5KB)
      if (buffer.length < 5000) {
        console.log('  ⊘ Skipping small image (likely logo/signature)');
        return '';
      }

      // Create a worker for better error isolation
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {}, // Suppress tesseract logs
        errorHandler: (err) => {
          console.error('  ✗ Tesseract worker error:', err.message);
        },
      });

      try {
        // Use a timeout to prevent hanging on corrupt images
        const recognizePromise = worker.recognize(buffer);
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OCR timeout after 15 seconds')), 15000)
        );

        const result = await Promise.race([recognizePromise, timeoutPromise]);
        await worker.terminate();
        
        return result.data.text || '';
      } catch (workerError) {
        await worker.terminate();
        throw workerError;
      }
    } catch (error) {
      // Handle various image processing errors including libpng errors
      const errorMsg = error.message || String(error);
      if (errorMsg.includes('libpng') || errorMsg.includes('bad adaptive filter')) {
        console.error('  ✗ OCR error: Corrupt PNG image, skipping file');
      } else {
        console.error('  ✗ OCR error:', errorMsg);
      }
      return '';
    }
  }

  /**
   * Determine file type from filename
   * @param {string} fileName - Name of the file
   * @returns {string|null} File type category or null
   */
  getFileType(fileName) {
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    if (this.supportedTypes.pdf.includes(extension)) return 'pdf';
    if (this.supportedTypes.excel.includes(extension)) return 'excel';
    if (this.supportedTypes.image.includes(extension)) return 'image';

    return null;
  }

  /**
   * Check if a file is supported
   * @param {string} fileName - Name of the file
   * @returns {boolean} True if supported
   */
  isSupported(fileName) {
    return this.getFileType(fileName) !== null;
  }

  /**
   * Get list of all supported extensions
   * @returns {Array<string>} Array of supported extensions
   */
  getSupportedExtensions() {
    return [...this.supportedTypes.pdf, ...this.supportedTypes.excel, ...this.supportedTypes.image];
  }
}

const attachmentProcessor = new AttachmentProcessor();
export default attachmentProcessor;
export const processEmailAttachments =
  attachmentProcessor.processEmailAttachments.bind(attachmentProcessor);
export const isSupported = attachmentProcessor.isSupported.bind(attachmentProcessor);
export const getSupportedExtensions =
  attachmentProcessor.getSupportedExtensions.bind(attachmentProcessor);
