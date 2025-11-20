/**
 * Email Controller
 * Handles all email-related business logic
 */

import * as emailExtractor from '../services/emailExtractor.js';
import * as microsoftGraphService from '../services/microsoftGraphService.js';
import * as claudeService from '../services/ai/claudeService.js';

/**
 * Process emails with filtering
 */
export const processEmails= async (req, res) => {
  try {
    const {
      searchQuery = 'quote OR shipping OR freight OR cargo',
      maxEmails = 50,
      startDate = null,
      scoreThreshold = 30,
      previewMode = false
    } = req.body;

    const results = await emailExtractor.processEmails({
      searchQuery,
      maxEmails,
      startDate,
      scoreThreshold,
      previewMode
    });

    res.json({
      success: true,
      results
    });
  } catch (error) {
    console.error('Error processing emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}; 

/**
 * Preview emails that would be processed
 */
export const previewEmails = async (req, res) => {
  try {
    const {
      searchQuery = 'quote OR shipping OR freight OR cargo',
      maxEmails = 50,
      startDate = null,
      scoreThreshold = 30
    } = req.body;

    const preview = await emailExtractor.previewEmails({
      searchQuery,
      maxEmails,
      startDate,
      scoreThreshold
    });

    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('Error previewing emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Fetch emails from Microsoft 365
 */
export const fetchEmails = async (req, res) => {
  try {
    const {
      searchQuery = 'quote OR shipping OR freight OR cargo',
      maxEmails = 50,
      startDate = null
    } = req.body;

    const emails = await microsoftGraphService.fetchEmails({
      searchQuery,
      top: maxEmails,
      startDate
    });

    res.json({
      success: true,
      count: emails.length,
      emails
    });
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Parse a single email with Claude
 */
export const parseEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email object is required'
      });
    }

    const parsedData = await claudeService.parseEmailWithClaude(email);

    res.json({
      success: true,
      parsedData
    });
  } catch (error) {
    console.error('Error parsing email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
