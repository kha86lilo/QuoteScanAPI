'use client';

import { useState, useEffect, useCallback } from 'react';
import { ShippingEmail, EmailWithQuotes, PaginatedEmailsResponse } from '@/types';
import EmailList from '@/components/EmailList';
import EmailDetails from '@/components/EmailDetails';
import { Mail, RefreshCw, LayoutDashboard, Filter, X, Search } from 'lucide-react';
import Dashboard from '@/components/Dashboard';

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
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [availableServiceTypes, setAvailableServiceTypes] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [serviceSearchQuery, setServiceSearchQuery] = useState('');

  const fetchEmails = useCallback(async (page: number = 1, services: string[] = selectedServices) => {
    setIsLoadingList(true);
    setError(null);
    try {
      const servicesParam = services.length > 0 ? `&services=${services.join(',')}` : '';
      const response = await fetch(`/api/emails?page=${page}&limit=${DEFAULT_PAGE_SIZE}${servicesParam}`);
      if (!response.ok) throw new Error('Failed to fetch emails');
      const data: PaginatedEmailsResponse = await response.json();
      setEmails(data.emails);
      setPagination({
        currentPage: data.currentPage,
        totalPages: data.totalPages,
        totalCount: data.totalCount,
        limit: data.limit,
      });
      setAvailableServiceTypes(data.availableServiceTypes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load emails');
    } finally {
      setIsLoadingList(false);
    }
  }, [selectedServices]);

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
    fetchEmails(page, selectedServices);
  };

  const handleServiceToggle = (service: string) => {
    const newServices = selectedServices.includes(service)
      ? selectedServices.filter(s => s !== service)
      : [...selectedServices, service];
    setSelectedServices(newServices);
    setSelectedEmailId(null);
    setSelectedEmail(null);
    fetchEmails(1, newServices);
  };

  const handleClearFilters = () => {
    setSelectedServices([]);
    setSelectedEmailId(null);
    setSelectedEmail(null);
    fetchEmails(1, []);
  };

  const handleFeedbackSubmit = async (
    quoteId: number,
    data: {
      rating: number;
      feedbackReason: string | null;
      feedbackNotes: string | null;
      actualPriceUsed: number | null;
    }
  ) => {
    const response = await fetch(`/api/quotes/${quoteId}/feedback`, {
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
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${
                selectedServices.length > 0
                  ? 'bg-white text-outlook-blue'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filter
              {selectedServices.length > 0 && (
                <span className="bg-outlook-blue text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
                  {selectedServices.length}
                </span>
              )}
            </button>
            {isFilterOpen && (
              <div className="absolute right-0 top-full mt-2 bg-white rounded-lg shadow-xl border border-gray-200 min-w-[280px] z-50">
                <div className="p-3 border-b border-gray-100">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900 text-sm">Filter by Service</span>
                    {selectedServices.length > 0 && (
                      <button
                        onClick={handleClearFilters}
                        className="text-xs text-outlook-blue hover:underline"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search services..."
                      value={serviceSearchQuery}
                      onChange={(e) => setServiceSearchQuery(e.target.value)}
                      className="w-full text-black pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-outlook-blue focus:border-outlook-blue"
                      autoFocus
                    />
                    {serviceSearchQuery && (
                      <button
                        onClick={() => setServiceSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-2">
                  {availableServiceTypes.length === 0 ? (
                    <p className="text-sm text-gray-500 p-2">No service types available</p>
                  ) : (
                    (() => {
                      const filteredServices = availableServiceTypes.filter(service =>
                        service.toLowerCase().includes(serviceSearchQuery.toLowerCase())
                      );
                      if (filteredServices.length === 0) {
                        return (
                          <p className="text-sm text-gray-500 p-2">
                            No services match &quot;{serviceSearchQuery}&quot;
                          </p>
                        );
                      }
                      return filteredServices.map(service => (
                        <label
                          key={service}
                          className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedServices.includes(service)}
                            onChange={() => handleServiceToggle(service)}
                            className="rounded border-gray-300 text-outlook-blue focus:ring-outlook-blue"
                          />
                          <span className="text-sm text-gray-700">{service}</span>
                        </label>
                      ));
                    })()
                  )}
                </div>
                <div className="p-2 border-t border-gray-100">
                  <button
                    onClick={() => {
                      setIsFilterOpen(false);
                      setServiceSearchQuery('');
                    }}
                    className="w-full text-center text-sm text-gray-600 hover:text-gray-900 py-1"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setIsDashboardOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded hover:bg-white/20 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => fetchEmails(pagination.currentPage, selectedServices)}
            disabled={isLoadingList}
            className="flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingList ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </header>

      {/* Active Filters Bar */}
      {selectedServices.length > 0 && (
        <div className="bg-blue-50 border-b border-blue-100 px-6 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-blue-700 font-medium">Filtered by:</span>
          {selectedServices.map(service => (
            <span
              key={service}
              className="inline-flex items-center gap-1 bg-white border border-blue-200 text-blue-800 text-xs px-2 py-1 rounded-full"
            >
              {service}
              <button
                onClick={() => handleServiceToggle(service)}
                className="hover:bg-blue-100 rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={handleClearFilters}
            className="text-xs text-blue-600 hover:text-blue-800 hover:underline ml-2"
          >
            Clear all
          </button>
        </div>
      )}

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

      {/* Dashboard Modal */}
      <Dashboard isOpen={isDashboardOpen} onClose={() => setIsDashboardOpen(false)} />
    </div>
  );
}
