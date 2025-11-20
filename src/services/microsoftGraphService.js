/**
 * Microsoft Graph API Service
 * Handles authentication and email fetching from Microsoft 365
 */

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Token cache stored outside the class to avoid extensibility issues
let accessToken = null;
let tokenExpiry = null;

class MicrosoftGraphService {
  constructor() {}

  /**
   * Get Microsoft Graph API access token using client credentials flow
   * @returns {Promise<string>} Access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
      return accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    });

    try {
      const response = await axios.post(tokenUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      accessToken = response.data.access_token;
      // Set token expiry to 5 minutes before actual expiry
      tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      console.log('✓ Obtained Microsoft Graph API access token');
      return accessToken;
    } catch (error) {
      console.error('✗ Failed to get access token:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with Microsoft Graph API');
    }
  }

  /**
   * Fetch emails from Microsoft 365 using Graph API
   * @param {Object} options - Search options
   * @param {string} options.searchQuery - Keywords to search for
   * @param {number} options.top - Number of emails to fetch (max 100)
   * @param {string} options.startDate - Optional start date (YYYY-MM-DD)
   * @returns {Promise<Array>} Array of email objects
   */
  async fetchEmails({
    searchQuery = 'quote OR shipping OR freight OR cargo',
    top = 100,
    startDate = null,
  }) {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    };

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;

    const params = {
      $search: `"${searchQuery}"`,
      $top: top,
      $select: 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments',
      '?$orderby': 'receivedDateTime',
    };

    // Add date filter if provided
    if (startDate) {
      params['?$filter'] = `receivedDateTime ge ${startDate}`;
    }

    try {
      const response = await axios.get(baseUrl, {
        headers,
        params,
      });

      const emails = response.data.value || [];
      console.log(`✓ Fetched ${emails.length} emails from Microsoft 365`);

      return emails;
    } catch (error) {
      console.error('✗ Failed to fetch emails:', error.response?.data || error.message);
      throw new Error('Failed to fetch emails from Microsoft Graph API');
    }
  }

  /**
   * Fetch attachments for a specific email
   * @param {string} messageId - Email message ID
   * @returns {Promise<Array>} Array of attachment objects
   */
  async fetchAttachments(messageId) {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments`;

    try {
      const response = await axios.get(url, { headers });
      return response.data.value || [];
    } catch (error) {
      console.error(`✗ Failed to fetch attachments for message ${messageId}:`, error.message);
      return [];
    }
  }

  /**
   * Download attachment content
   * @param {string} messageId - Email message ID
   * @param {string} attachmentId - Attachment ID
   * @returns {Promise<Object>} Attachment data
   */
  async downloadAttachment(messageId, attachmentId) {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments/${attachmentId}`;

    try {
      const response = await axios.get(url, { headers });
      return response.data;
    } catch (error) {
      console.error(`✗ Failed to download attachment:`, error.message);
      throw error;
    }
  }

  /**
   * Search emails with advanced filters
   * @param {Object} filters - Advanced search filters
   * @returns {Promise<Array>} Array of email objects
   */
  async advancedSearch(filters) {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    };

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;

    let filterQuery = [];

    if (filters.from) {
      filterQuery.push(`from/emailAddress/address eq '${filters.from}'`);
    }

    if (filters.hasAttachments !== undefined) {
      filterQuery.push(`hasAttachments eq ${filters.hasAttachments}`);
    }

    if (filters.startDate) {
      filterQuery.push(`receivedDateTime ge ${filters.startDate}T00:00:00Z`);
    }

    if (filters.endDate) {
      filterQuery.push(`receivedDateTime le ${filters.endDate}T23:59:59Z`);
    }

    const params = {
      $top: filters.top || 100,
      $select: 'id,subject,from,receivedDateTime,bodyPreview,hasAttachments',
      $orderby: 'receivedDateTime',
    };

    if (filters.searchQuery) {
      params['$search'] = `"${filters.searchQuery}"`;
    }

    if (filterQuery.length > 0) {
      params['$filter'] = filterQuery.join(' and ');
    }

    try {
      const response = await axios.get(baseUrl, { headers, params });
      return response.data.value || [];
    } catch (error) {
      console.error('✗ Advanced search failed:', error.response?.data || error.message);
      throw error;
    }
  }
}

const microsoftGraphService = new MicrosoftGraphService();
export default microsoftGraphService;
export const { getAccessToken, fetchEmails, advancedEmailSearch } = microsoftGraphService;
