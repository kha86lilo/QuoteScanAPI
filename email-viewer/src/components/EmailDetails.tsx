'use client';

import { EmailWithQuotes } from '@/types';
import { Mail, Calendar, User, Paperclip, Building } from 'lucide-react';
import QuoteCard from './QuoteCard';

interface EmailDetailsProps {
  email: EmailWithQuotes | null;
  isLoading: boolean;
  onFeedbackSubmit: (matchId: number, data: {
    rating: number;
    feedbackReason: string | null;
    feedbackNotes: string | null;
    actualPriceUsed: number | null;
  }) => Promise<void>;
}

function formatFullDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function EmailDetails({ email, isLoading, onFeedbackSubmit }: EmailDetailsProps) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-outlook-blue mx-auto mb-3"></div>
          <p className="text-sm text-outlook-textLight">Loading email details...</p>
        </div>
      </div>
    );
  }

  if (!email) {
    return (
      <div className="h-full flex items-center justify-center bg-white">
        <div className="text-center">
          <Mail className="w-16 h-16 text-outlook-border mx-auto mb-4" />
          <h3 className="text-lg font-medium text-outlook-text mb-1">Select an email</h3>
          <p className="text-sm text-outlook-textLight">
            Choose an email from the list to view its details and quotes
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-white">
      {/* Email Header */}
      <div className="sticky top-0 bg-white border-b border-outlook-border z-10">
        <div className="px-6 py-4">
          <h1 className="text-xl font-semibold text-outlook-text mb-3">
            {email.email_subject || '(No Subject)'}
          </h1>
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-outlook-blue flex items-center justify-center">
              <span className="text-white text-sm font-medium">
                {email.email_sender_name?.charAt(0)?.toUpperCase() || 'U'}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-outlook-text">
                  {email.email_sender_name || 'Unknown Sender'}
                </span>
                <span className="text-sm text-outlook-textLight">
                  &lt;{email.email_sender_email}&gt;
                </span>
              </div>
              <div className="flex items-center gap-4 mt-1 text-sm text-outlook-textLight">
                <div className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {formatFullDate(email.email_received_date)}
                </div>
                {email.email_has_attachments && (
                  <div className="flex items-center gap-1">
                    <Paperclip className="w-4 h-4" />
                    Has attachments
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email Body Preview */}
      <div className="px-6 py-4 border-b border-outlook-border">
        <p className="text-sm text-outlook-text whitespace-pre-wrap">
          {email.email_body_preview || 'No content available'}
        </p>
        {email.raw_email_body && email.raw_email_body !== email.email_body_preview && (
          <details className="mt-3">
            <summary className="text-sm text-outlook-blue cursor-pointer hover:underline">
              Show full email body
            </summary>
            <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm text-outlook-text whitespace-pre-wrap max-h-96 overflow-y-auto">
              {email.raw_email_body}
            </div>
          </details>
        )}
      </div>

      {/* Quotes Section */}
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-outlook-text flex items-center gap-2">
            <Building className="w-5 h-5 text-outlook-blue" />
            Related Quotes
          </h2>
          <span className="text-sm text-outlook-textLight">
            {email.quotes?.length || 0} quote{(email.quotes?.length || 0) !== 1 ? 's' : ''}
          </span>
        </div>

        {email.quotes && email.quotes.length > 0 ? (
          <div className="space-y-4">
            {email.quotes.map((quote) => (
              <QuoteCard
                key={quote.quote_id}
                quote={quote}
                onFeedbackSubmit={onFeedbackSubmit}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <Building className="w-12 h-12 text-outlook-border mx-auto mb-3" />
            <p className="text-sm text-outlook-textLight">No quotes extracted from this email</p>
          </div>
        )}
      </div>

      {/* AI Confidence Score */}
      {email.ai_confidence_score !== null && (
        <div className="px-6 py-4 border-t border-outlook-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-outlook-textLight">AI Extraction Confidence</span>
            <div className="flex items-center gap-2">
              <div className="w-24 bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    email.ai_confidence_score >= 0.8
                      ? 'bg-green-500'
                      : email.ai_confidence_score >= 0.5
                      ? 'bg-yellow-500'
                      : 'bg-red-500'
                  }`}
                  style={{ width: `${email.ai_confidence_score * 100}%` }}
                />
              </div>
              <span className="font-medium text-outlook-text">
                {(email.ai_confidence_score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
