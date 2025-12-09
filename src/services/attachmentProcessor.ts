/**
 * Attachment Processor Service
 * Extracts text from PDF, Excel, and image attachments
 */

import { createRequire } from 'module';
import ExcelJS from 'exceljs';
import Tesseract from 'tesseract.js';
import * as microsoftGraphService from './mail/microsoftGraphService.js';
import type { AttachmentMeta } from '../types/index.js';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
const VerbosityLevel = { ERRORS: 0 };

interface SupportedTypes {
  pdf: string[];
  excel: string[];
  image: string[];
}

interface ProcessedAttachment {
  name: string;
  type?: string;
  processed: boolean;
  textLength?: number;
  reason?: string;
  error?: string;
}

interface AttachmentProcessingResult {
  hasAttachments: boolean;
  extractedText: string;
  attachments: ProcessedAttachment[];
  processedCount?: number;
  skippedCount?: number;
  error?: string;
}

class AttachmentProcessor {
  private supportedTypes: SupportedTypes;

  constructor() {
    this.supportedTypes = {
      pdf: ['.pdf'],
      excel: ['.xlsx', '.xls', '.csv'],
      image: ['.png', '.jpg', '.jpeg'],
    };
  }

  /**
   * Process all attachments for an email
   */
  async processEmailAttachments(emailId: string): Promise<AttachmentProcessingResult> {
    try {
      const attachments = await microsoftGraphService.default.fetchAttachments(emailId);

      if (!attachments || attachments.length === 0) {
        return { hasAttachments: false, extractedText: '', attachments: [] };
      }

      console.log(`  Found ${attachments.length} attachment(s)`);

      const results: AttachmentProcessingResult = {
        hasAttachments: true,
        extractedText: '',
        attachments: [],
        processedCount: 0,
        skippedCount: 0,
      };

      for (const attachment of attachments) {
        const fileName = attachment.name || 'unknown';
        const fileType = this.getFileType(fileName);

        if (!fileType) {
          console.log(`  Skipping unsupported file: ${fileName}`);
          results.skippedCount = (results.skippedCount || 0) + 1;
          results.attachments.push({
            name: fileName,
            processed: false,
            reason: 'Unsupported file type',
          });
          continue;
        }

        try {
          console.log(`Email Id ${emailId}  Processing ${fileType.toUpperCase()}: ${fileName}`);
          const contentBytes = attachment.contentBytes;
          if (!contentBytes) {
            console.log(`  Warning: No content available for ${fileName}`);
            continue;
          }

          const buffer = Buffer.from(contentBytes, 'base64');

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
            results.processedCount = (results.processedCount || 0) + 1;
            results.attachments.push({
              name: fileName,
              type: fileType,
              processed: true,
              textLength: extractedText.length,
            });
            console.log(`  Extracted ${extractedText.length} characters from ${fileName}`);
          } else {
            console.log(`  Warning: No text extracted from ${fileName}`);
            results.attachments.push({
              name: fileName,
              type: fileType,
              processed: false,
              reason: 'No text extracted',
            });
          }
        } catch (error) {
          const err = error as Error;
          console.error(`  Error processing ${fileName}:`, err.message);
          results.attachments.push({
            name: fileName,
            processed: false,
            error: err.message,
          });
        }
      }

      console.log(`  Processed ${results.processedCount}/${attachments.length} attachments`);
      return results;
    } catch (error) {
      const err = error as Error;
      console.error(`Error fetching attachments:`, err.message);
      return { hasAttachments: false, extractedText: '', attachments: [], error: err.message };
    }
  }

  /**
   * Extract text from PDF
   */
  async extractFromPDF(buffer: Buffer): Promise<string> {
    try {
      const parser = new PDFParse({ verbosity: VerbosityLevel.ERRORS, data: buffer });
      const result = await parser.getText();
      return result.text || '';
    } catch (error) {
      const err = error as Error;
      console.error('  PDF parsing error:', err.message);
      return '';
    }
  }

  /**
   * Extract text from Excel file
   */
  async extractFromExcel(buffer: Buffer, _fileName: string): Promise<string> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      let extractedText = '';

      workbook.eachSheet((worksheet) => {
        extractedText += `\n\n[Sheet: ${worksheet.name}]\n`;

        worksheet.eachRow((row) => {
          const values = (row.values as (string | number | { text?: string } | null | undefined)[]).slice(1);
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
      const err = error as Error;
      console.error('  Excel parsing error:', err.message);
      return '';
    }
  }

  /**
   * Extract text from image using OCR
   */
  async extractFromImage(buffer: Buffer): Promise<string> {
    try {
      if (!buffer || buffer.length === 0) {
        console.error('  OCR error: Empty or invalid image buffer');
        return '';
      }

      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const jpgHeader = Buffer.from([0xff, 0xd8, 0xff]);

      const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(pngHeader);
      const isJpg = buffer.length >= 3 && buffer.subarray(0, 3).equals(jpgHeader);

      if (!isPng && !isJpg) {
        console.error('  OCR error: Invalid or corrupt image format');
        return '';
      }

      if (buffer.length < 5000) {
        console.log('  Skipping small image (likely logo/signature)');
        return '';
      }

      const worker = await Tesseract.createWorker('eng', 1, {
        logger: () => {},
        errorHandler: (err: Error) => {
          console.error('  Tesseract worker error:', err.message);
        },
      });

      try {
        const recognizePromise = worker.recognize(buffer);

        const timeoutPromise = new Promise<never>((_, reject) =>
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
      const err = error as Error;
      const errorMsg = err.message || String(error);
      if (errorMsg.includes('libpng') || errorMsg.includes('bad adaptive filter')) {
        console.error('  OCR error: Corrupt PNG image, skipping file');
      } else {
        console.error('  OCR error:', errorMsg);
      }
      return '';
    }
  }

  /**
   * Determine file type from filename
   */
  getFileType(fileName: string): string | null {
    const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));

    if (this.supportedTypes.pdf.includes(extension)) return 'pdf';
    if (this.supportedTypes.excel.includes(extension)) return 'excel';
    if (this.supportedTypes.image.includes(extension)) return 'image';

    return null;
  }

  /**
   * Check if a file is supported
   */
  isSupported(fileName: string): boolean {
    return this.getFileType(fileName) !== null;
  }

  /**
   * Get list of all supported extensions
   */
  getSupportedExtensions(): string[] {
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
