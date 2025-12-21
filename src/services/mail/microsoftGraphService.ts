/**
 * Microsoft Graph API Service
 * Handles authentication and email fetching from Microsoft 365
 */

import axios from 'axios';
import type { Email, Attachment } from '../../types/index.js';
import dotenv from 'dotenv';
dotenv.config();

let accessToken: string | null = null;
let tokenExpiry: number | null = null;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

interface FetchEmailsOptions {
  searchQuery?: string;
  top?: number;
  startDate?: string | null;
}

interface AdvancedSearchFilters {
  from?: string;
  hasAttachments?: boolean;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  top?: number;
}

interface GraphApiResponse<T> {
  value: T[];
}

interface FetchByConversationOptions {
  conversationIds: string[];
  senderNames?: string[];
}

class MicrosoftGraphService {
  /**
   * Get Microsoft Graph API access token using client credentials flow
   */
  async getAccessToken(): Promise<string> {
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
      return accessToken;
    }

    const tokenUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MS_CLIENT_ID || '',
      client_secret: process.env.MS_CLIENT_SECRET || '',
      scope: 'https://graph.microsoft.com/.default',
    });

    try {
      const response = await axios.post<TokenResponse>(tokenUrl, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      accessToken = response.data.access_token;
      tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

      console.log('Success: Obtained Microsoft Graph API access token');
      return accessToken;
    } catch (error) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error('Error: Failed to get access token:', err.response?.data || err.message);
      throw new Error('Failed to authenticate with Microsoft Graph API');
    }
  }

  /**
   * Fetch emails from Microsoft 365 using Graph API
   */
  async fetchEmails({
    searchQuery = 'quote OR shipping OR freight OR cargo',
    top = 100,
    startDate = null,
  }: FetchEmailsOptions = {}): Promise<Email[]> {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    };

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;

    const params: Record<string, string | number> = {
      $top: top,
      $select: 'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments',
      '?$orderby': 'receivedDateTime',
    };

    if (searchQuery && searchQuery.trim()) {
      params['$search'] = `"${searchQuery}"`;
    }

    if (startDate && !searchQuery) {
      params['$filter'] = `receivedDateTime ge ${startDate}`;
    }

    try {
      const response = await axios.get<GraphApiResponse<Email>>(baseUrl, {
        headers,
        params,
      });

      const emails = response.data.value || [];
      console.log(`Success: Fetched ${emails.length} emails from Microsoft 365`);

      return emails;
    } catch (error) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error('Error: Failed to fetch emails:', err.response?.data || err.message);
      throw new Error('Failed to fetch emails from Microsoft Graph API');
    }
  }

  /**
   * Fetch attachments for a specific email
   */
  async fetchAttachments(messageId: string): Promise<Attachment[]> {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments`;

    try {
      const response = await axios.get<GraphApiResponse<Attachment>>(url, { headers });
      return response.data.value || [];
    } catch (error) {
      const err = error as Error;
      console.error(`Error: Failed to fetch attachments for message ${messageId}:`, err.message);
      return [];
    }
  }

  /**
   * Download attachment content
   */
  async downloadAttachment(messageId: string, attachmentId: string): Promise<Attachment> {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    const url = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages/${messageId}/attachments/${attachmentId}`;

    try {
      const response = await axios.get<Attachment>(url, { headers });
      return response.data;
    } catch (error) {
      const err = error as Error;
      console.error(`Error: Failed to download attachment:`, err.message);
      throw error;
    }
  }

  /**
   * Search emails with advanced filters
   */
  async advancedSearch(filters: AdvancedSearchFilters): Promise<Email[]> {
    const token = await this.getAccessToken();

    const headers = {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    };

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;

    const filterQuery: string[] = [];

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

    const params: Record<string, string | number> = {
      $top: filters.top || 100,
      $select: 'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments',
      $orderby: 'receivedDateTime',
    };

    if (filters.searchQuery) {
      params['$search'] = `"${filters.searchQuery}"`;
    }

    if (filterQuery.length > 0) {
      params['$filter'] = filterQuery.join(' and ');
    }

    try {
      const response = await axios.get<GraphApiResponse<Email>>(baseUrl, { headers, params });
      return response.data.value || [];
    } catch (error) {
      const err = error as { response?: { data?: unknown }; message?: string };
      console.error('Error: Advanced search failed:', err.response?.data || err.message);
      throw error;
    }
  }

  /**
   * Fetch emails by conversation IDs filtered by sender names
   * Used to extract staff replies from email threads
   */
  async fetchEmailsByConversationIds(options: FetchByConversationOptions): Promise<Email[]> {
    const { conversationIds, senderNames = [] } = options;

    if (conversationIds.length === 0 || senderNames.length === 0) {
      return [];
    }

    const token = await this.getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      ConsistencyLevel: 'eventual',
    };

    const baseUrl = `https://graph.microsoft.com/v1.0/users/${process.env.MS_USER_EMAIL}/messages`;
    const conversationIdSet = new Set(conversationIds);
    const allEmails: Email[] = [];

    // Fetch emails for each sender name
    for (const senderName of senderNames) {
      for (const conversationId of conversationIdSet) {
        const params: Record<string, string | number> = {
          $top: 1000,
          $select: 'id,conversationId,subject,from,receivedDateTime,bodyPreview,hasAttachments',
          $filter: `conversationid eq '${conversationId}' and contains(from/emailAddress/name, '${senderName}')`,
        };

        try {
          const response = await axios.get<GraphApiResponse<Email>>(baseUrl, { headers, params });
          const emails = response.data.value || [];

          // Filter by conversation IDs client-side
          const matchingEmails = emails.filter(
            (email: Email) => email.conversationId && conversationIdSet.has(email.conversationId)
          );

          allEmails.push(...matchingEmails);
        } catch (error) {
          const err = error as { response?: { data?: unknown }; message?: string };
          console.error(
            `Error fetching emails for sender ${senderName}:`,
            err.response?.data || err.message
          );
        }
      }
    }

    // Remove duplicates by email ID
    const uniqueEmails = Array.from(new Map(allEmails.map((e) => [e.id, e])).values());

    console.log(
      `Success: Fetched ${uniqueEmails.length} emails matching ${conversationIds.length} conversations`
    );
    return uniqueEmails;
  }
}

const microsoftGraphService = new MicrosoftGraphService();
export default microsoftGraphService;
export const getAccessToken = microsoftGraphService.getAccessToken.bind(microsoftGraphService);
export const fetchEmails = microsoftGraphService.fetchEmails.bind(microsoftGraphService);
export const advancedEmailSearch = microsoftGraphService.advancedSearch.bind(microsoftGraphService);
export const fetchEmailsByConversationIds =
  microsoftGraphService.fetchEmailsByConversationIds.bind(microsoftGraphService);
