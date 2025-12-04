'use client';

import { ShippingEmail } from '@/types';
import { Mail, Paperclip, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationInfo {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
}

interface EmailListProps {
  emails: ShippingEmail[];
  selectedEmailId: number | null;
  onSelectEmail: (emailId: number) => void;
  pagination?: PaginationInfo;
  onPageChange?: (page: number) => void;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

export default function EmailList({ emails, selectedEmailId, onSelectEmail, pagination, onPageChange }: EmailListProps) {
  const showPagination = pagination && pagination.totalPages > 1 && onPageChange;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex-shrink-0 bg-white border-b border-outlook-border px-4 py-3 z-10">
        <h2 className="text-sm font-semibold text-outlook-text">Inbox</h2>
        <p className="text-xs text-outlook-textLight">
          {pagination ? `${pagination.totalCount} messages` : `${emails.length} messages`}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-outlook-border">
        {emails.map((email) => (
          <div
            key={email.email_id}
            onClick={() => onSelectEmail(email.email_id)}
            className={`px-4 py-3 cursor-pointer transition-colors ${
              selectedEmailId === email.email_id
                ? 'bg-outlook-lightBlue border-l-2 border-l-outlook-blue'
                : 'hover:bg-outlook-hover'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-outlook-blue flex items-center justify-center">
                <span className="text-white text-xs font-medium">
                  {email.email_sender_name?.charAt(0)?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-outlook-text truncate">
                    {email.email_sender_name || 'Unknown Sender'}
                  </span>
                  <span className="text-xs text-outlook-textLight flex-shrink-0 ml-2">
                    {formatDate(email.email_received_date)}
                  </span>
                </div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-sm text-outlook-text truncate font-medium">
                    {email.email_subject || '(No Subject)'}
                  </span>
                  {email.email_has_attachments && (
                    <Paperclip className="w-3 h-3 text-outlook-textLight flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-outlook-textLight truncate">
                  {email.email_body_preview || 'No preview available'}
                </p>
                {(email as any).quote_count > 0 && (
                  <div className="mt-1">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      {(email as any).quote_count} quote{(email as any).quote_count > 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {emails.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-outlook-textLight">
            <Mail className="w-12 h-12 mb-3 opacity-50" />
            <p className="text-sm">No emails found</p>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      {showPagination && (
        <div className="flex-shrink-0 border-t border-outlook-border px-4 py-2 bg-white">
          <div className="flex items-center justify-between">
            <span className="text-xs text-outlook-textLight">
              Page {pagination.currentPage} of {pagination.totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange(1)}
                disabled={pagination.currentPage === 1}
                className="p-1 rounded hover:bg-outlook-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="First page"
              >
                <ChevronsLeft className="w-4 h-4 text-outlook-text" />
              </button>
              <button
                onClick={() => onPageChange(pagination.currentPage - 1)}
                disabled={pagination.currentPage === 1}
                className="p-1 rounded hover:bg-outlook-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous page"
              >
                <ChevronLeft className="w-4 h-4 text-outlook-text" />
              </button>
              <span className="px-2 text-sm text-outlook-text font-medium">
                {pagination.currentPage}
              </span>
              <button
                onClick={() => onPageChange(pagination.currentPage + 1)}
                disabled={pagination.currentPage === pagination.totalPages}
                className="p-1 rounded hover:bg-outlook-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next page"
              >
                <ChevronRight className="w-4 h-4 text-outlook-text" />
              </button>
              <button
                onClick={() => onPageChange(pagination.totalPages)}
                disabled={pagination.currentPage === pagination.totalPages}
                className="p-1 rounded hover:bg-outlook-hover disabled:opacity-30 disabled:cursor-not-allowed"
                title="Last page"
              >
                <ChevronsRight className="w-4 h-4 text-outlook-text" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
