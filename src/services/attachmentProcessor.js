/**
 * Attachment Processor Service
 * Extracts text from PDF, Excel, and image attachments
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

import ExcelJS from 'exceljs';
import Tesseract from 'tesseract.js';
import * as microsoftGraphService from './microsoftGraphService.js';

class AttachmentProcessor {
  constructor() {
    // Supported file types for processing
    this.supportedTypes = {
      pdf: ['.pdf'],
      excel: ['.xlsx', '.xls', '.csv'],
      image: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff']
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
        skippedCount: 0
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
            reason: 'Unsupported file type'
          });
          continue;
        }

        try {
          console.log(`  📄 Processing ${fileType.toUpperCase()}: ${fileName}`);
          
          // Get attachment content (base64 encoded)
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
              textLength: extractedText.length
            });
            console.log(`  ✓ Extracted ${extractedText.length} characters from ${fileName}`);
          } else {
            console.log(`  ⚠ No text extracted from ${fileName}`);
            results.attachments.push({
              name: fileName,
              type: fileType,
              processed: false,
              reason: 'No text extracted'
            });
          }

        } catch (error) {
          console.error(`  ✗ Error processing ${fileName}:`, error.message);
          results.attachments.push({
            name: fileName,
            processed: false,
            error: error.message
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
      const parser = new PDFParse({ data: buffer });
      const data = await parser.getText();
      return data.text || '';
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
          const rowText = values.map(cell => {
            if (cell === null || cell === undefined) return '';
            if (typeof cell === 'object' && cell.text) return cell.text;
            return String(cell);
          }).join(',');
          
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
      const result = await Tesseract.recognize(buffer, 'eng', {
        logger: () => {} // Suppress tesseract logs
      });
      
      return result.data.text || '';
    } catch (error) {
      console.error('  ✗ OCR error:', error.message);
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
    return [
      ...this.supportedTypes.pdf,
      ...this.supportedTypes.excel,
      ...this.supportedTypes.image
    ];
  }
}

const attachmentProcessor = new AttachmentProcessor();
export default attachmentProcessor;
export const processEmailAttachments = attachmentProcessor.processEmailAttachments.bind(attachmentProcessor);
export const isSupported = attachmentProcessor.isSupported.bind(attachmentProcessor);
export const getSupportedExtensions = attachmentProcessor.getSupportedExtensions.bind(attachmentProcessor);
