'use client';

import { useState, useMemo } from 'react';
import { ShippingEmail } from '@/types';
import { Mail, Paperclip, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';

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

interface EmailThread {
  conversationId: string | null;
  emails: ShippingEmail[];
  latestEmail: ShippingEmail;
}

export default function EmailList({ emails, selectedEmailId, onSelectEmail, pagination, onPageChange }: EmailListProps) {
  const showPagination = pagination && pagination.totalPages > 1 && onPageChange;
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  // Group emails by conversation_id
  const threads = useMemo(() => {
    const threadMap = new Map<string, ShippingEmail[]>();

    emails.forEach(email => {
      const key = email.conversation_id || `single_${email.email_id}`;
      if (!threadMap.has(key)) {
        threadMap.set(key, []);
      }
      threadMap.get(key)!.push(email);
    });

    // Sort emails within each thread by date (newest first)
    const result: EmailThread[] = [];
    threadMap.forEach((threadEmails, conversationId) => {
      const sorted = threadEmails.sort((a, b) =>
        new Date(b.email_received_date).getTime() - new Date(a.email_received_date).getTime()
      );
      result.push({
        conversationId: conversationId.startsWith('single_') ? null : conversationId,
        emails: sorted,
        latestEmail: sorted[0],
      });
    });

    // Sort threads by latest email date
    return result.sort((a, b) =>
      new Date(b.latestEmail.email_received_date).getTime() - new Date(a.latestEmail.email_received_date).getTime()
    );
  }, [emails]);

  const toggleThread = (conversationId: string) => {
    setExpandedThreads(prev => {
      const next = new Set(prev);
      if (next.has(conversationId)) {
        next.delete(conversationId);
      } else {
        next.add(conversationId);
      }
      return next;
    });
  };

  const renderEmailItem = (email: ShippingEmail, isThreadChild: boolean = false) => (
    <div
      key={email.email_id}
      onClick={() => onSelectEmail(email.email_id)}
      className={`px-4 py-3 cursor-pointer transition-colors ${
        selectedEmailId === email.email_id
          ? 'bg-outlook-lightBlue border-l-2 border-l-outlook-blue'
          : 'hover:bg-outlook-hover'
      } ${isThreadChild ? 'pl-10 bg-gray-50/50' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className={`flex-shrink-0 ${isThreadChild ? 'w-6 h-6' : 'w-8 h-8'} rounded-full bg-outlook-blue flex items-center justify-center`}>
          <span className={`text-white ${isThreadChild ? 'text-[10px]' : 'text-xs'} font-medium`}>
            {email.email_sender_name?.charAt(0)?.toUpperCase() || 'U'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className={`${isThreadChild ? 'text-xs' : 'text-sm'} font-medium text-outlook-text truncate`}>
              {email.email_sender_name || 'Unknown Sender'}
            </span>
            <span className="text-xs text-outlook-textLight flex-shrink-0 ml-2">
              {formatDate(email.email_received_date)}
            </span>
          </div>
          {!isThreadChild && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-sm text-outlook-text truncate font-medium">
                {email.email_subject || '(No Subject)'}
              </span>
              {email.email_has_attachments && (
                <Paperclip className="w-3 h-3 text-outlook-textLight flex-shrink-0" />
              )}
            </div>
          )}
          <p className="text-xs text-outlook-textLight truncate">
            {email.email_body_preview || 'No preview available'}
          </p>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {(email as any).quote_count > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                {(email as any).quote_count} quote{(email as any).quote_count > 1 ? 's' : ''}
              </span>
            )}
            {email.ai_confidence_score !== null && email.ai_confidence_score !== undefined && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                email.ai_confidence_score >= 0.8 ? 'bg-green-100 text-green-800' :
                email.ai_confidence_score >= 0.5 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {Math.round(email.ai_confidence_score * 100)}% conf
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex-shrink-0 bg-white border-b border-outlook-border px-4 py-3 z-10">
        <h2 className="text-sm font-semibold text-outlook-text">Inbox</h2>
        <p className="text-xs text-outlook-textLight">
          {pagination ? `${pagination.totalCount} messages` : `${emails.length} messages`} in {threads.length} conversation{threads.length !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-outlook-border">
        {threads.map((thread) => {
          const isMultiEmail = thread.emails.length > 1;
          const isExpanded = thread.conversationId ? expandedThreads.has(thread.conversationId) : false;
          const threadContainsSelected = thread.emails.some(e => e.email_id === selectedEmailId);

          return (
            <div key={thread.conversationId || thread.latestEmail.email_id}>
              {/* Thread header / Single email */}
              <div
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  threadContainsSelected && !isExpanded
                    ? 'bg-outlook-lightBlue border-l-2 border-l-outlook-blue'
                    : 'hover:bg-outlook-hover'
                }`}
                onClick={() => {
                  if (isMultiEmail && thread.conversationId) {
                    toggleThread(thread.conversationId);
                  } else {
                    onSelectEmail(thread.latestEmail.email_id);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-outlook-blue flex items-center justify-center">
                    <span className="text-white text-xs font-medium">
                      {thread.latestEmail.email_sender_name?.charAt(0)?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-outlook-text truncate">
                        {thread.latestEmail.email_sender_name || 'Unknown Sender'}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        {isMultiEmail && (
                          <span className="flex items-center gap-1 text-xs text-outlook-blue bg-outlook-lightBlue px-1.5 py-0.5 rounded">
                            <MessageSquare className="w-3 h-3" />
                            {thread.emails.length}
                          </span>
                        )}
                        <span className="text-xs text-outlook-textLight">
                          {formatDate(thread.latestEmail.email_received_date)}
                        </span>
                        {isMultiEmail && (
                          isExpanded ? <ChevronUp className="w-4 h-4 text-outlook-textLight" /> : <ChevronDown className="w-4 h-4 text-outlook-textLight" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-sm text-outlook-text truncate font-medium">
                        {thread.latestEmail.email_subject || '(No Subject)'}
                      </span>
                      {thread.emails.some(e => e.email_has_attachments) && (
                        <Paperclip className="w-3 h-3 text-outlook-textLight flex-shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-outlook-textLight truncate">
                      {thread.latestEmail.email_body_preview || 'No preview available'}
                    </p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      {thread.emails.some(e => (e as any).quote_count > 0) && (
                        (() => {
                          const totalQuotes = thread.emails.reduce((sum, e) => sum + (Number((e as any).quote_count) || 0), 0);
                          return (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                              {totalQuotes} quote{totalQuotes > 1 ? 's' : ''}
                            </span>
                          );
                        })()
                      )}
                      {(() => {
                        const confidenceScores = thread.emails
                          .map(e => e.ai_confidence_score)
                          .filter((score): score is number => score !== null && score !== undefined);
                        if (confidenceScores.length === 0) return null;
                        const avgConfidence = confidenceScores.reduce((sum, s) => sum + s, 0) / confidenceScores.length;
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            avgConfidence >= 0.8 ? 'bg-green-100 text-green-800' :
                            avgConfidence >= 0.5 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {Math.round(avgConfidence * 100)}% conf
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded thread emails */}
              {isMultiEmail && isExpanded && (
                <div className="border-l-2 border-l-outlook-border ml-4">
                  {thread.emails.map((email) => renderEmailItem(email, true))}
                </div>
              )}
            </div>
          );
        })}
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
