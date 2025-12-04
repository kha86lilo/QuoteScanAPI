'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShippingEmail, EmailWithQuotes, PaginatedEmailsResponse } from '@/types';
import EmailList from '@/components/EmailList';
import EmailDetails from '@/components/EmailDetails';
import { Mail, RefreshCw } from 'lucide-react';

const DEFAULT_PAGE_SIZE = 20;

export default function Home() {
  const [emails, setEmails] = useState<ShippingEmail[]>([]);
  const [selectedEmailId, setSelectedEmailId] = useState<number | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailWithQuotes | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pagination, setPagination] = useState({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: DEFAULT_PAGE_SIZE,
  });

  const fetchEmails = useCallback(async (page: number = 1) => {
    setIsLoadingList(true);
    setError(null);
    try {
      const response = await fetch(`/api/emails?page=${page}&limit=${DEFAULT_PAGE_SIZE}`);
      if (!response.ok) throw new Error('Failed to fetch emails');
      const data: PaginatedEmailsResponse = await response.json();
      setEmails(data.emails);
      setPagination({
        currentPage: data.currentPage,
        totalPages: data.totalPages,
        totalCount: data.totalCount,
        limit: data.limit,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  const fetchEmailDetails = useCallback(async (emailId: number) => {
    setIsLoadingDetails(true);
    try {
      const response = await fetch(`/api/emails/${emailId}`);
      if (!response.ok) throw new Error('Failed to fetch email details');
      const data = await response.json();
      setSelectedEmail(data);
    } catch (err) {
      console.error('Error fetching email details:', err);
      setSelectedEmail(null);
    } finally {
      setIsLoadingDetails(false);
    }
  }, []);

  useEffect(() => {
    fetchEmails(1);
  }, [fetchEmails]);

  useEffect(() => {
    if (selectedEmailId) {
      fetchEmailDetails(selectedEmailId);
    } else {
      setSelectedEmail(null);
    }
  }, [selectedEmailId, fetchEmailDetails]);

  const handleSelectEmail = (emailId: number) => {
    setSelectedEmailId(emailId);
  };

  const handlePageChange = (page: number) => {
    setSelectedEmailId(null);
    setSelectedEmail(null);
    fetchEmails(page);
  };

  const handleFeedbackSubmit = async (
    matchId: number,
    data: {
      rating: number;
      feedbackReason: string | null;
      feedbackNotes: string | null;
      actualPriceUsed: number | null;
    }
  ) => {
    const response = await fetch(`/api/matches/${matchId}/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to submit feedback');
    }

    // Refresh email details to show updated state
    if (selectedEmailId) {
      fetchEmailDetails(selectedEmailId);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-outlook-hover">
      {/* Header */}
      <header className="bg-outlook-blue text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Mail className="w-6 h-6" />
          <h1 className="text-lg font-semibold">Shipping Emails</h1>
        </div>
        <button
          onClick={() => fetchEmails(pagination.currentPage)}
          disabled={isLoadingList}
          className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded hover:bg-white/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Email List Panel */}
        <div className="w-80 lg:w-96 flex-shrink-0 border-r border-outlook-border bg-white overflow-hidden">
          {error ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="text-center">
                <p className="text-red-600 mb-2">{error}</p>
                <button
                  onClick={() => fetchEmails(pagination.currentPage)}
                  className="text-sm text-outlook-blue hover:underline"
                >
                  Try again
                </button>
              </div>
            </div>
          ) : isLoadingList ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-outlook-blue mx-auto mb-3"></div>
                <p className="text-sm text-outlook-textLight">Loading emails...</p>
              </div>
            </div>
          ) : (
            <EmailList
              emails={emails}
              selectedEmailId={selectedEmailId}
              onSelectEmail={handleSelectEmail}
              pagination={pagination}
              onPageChange={handlePageChange}
            />
          )}
        </div>

        {/* Email Details Panel */}
        <div className="flex-1 overflow-hidden">
          <EmailDetails
            email={selectedEmail}
            isLoading={isLoadingDetails}
            onFeedbackSubmit={handleFeedbackSubmit}
          />
        </div>
      </div>
    </div>
  );
}
