'use client';

import { useState } from 'react';
import { EmailWithQuotes, QuoteWithMatches } from '@/types';
import { Mail, Calendar, Paperclip, Building, Eye, ThumbsUp, ThumbsDown, AlertTriangle, FileDown } from 'lucide-react';
import { jsPDF } from 'jspdf';
import Attachments from './Attachments';
import MatchesDialog from './MatchesDialog';
import FeedbackDialog from './FeedbackDialog';

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
  const [showMatchesDialog, setShowMatchesDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<1 | -1>(1);
  const [selectedQuote, setSelectedQuote] = useState<QuoteWithMatches | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedSuggestedPrice, setSelectedSuggestedPrice] = useState<number | null>(null);

  const handleViewMatches = (quote: QuoteWithMatches) => {
    setSelectedQuote(quote);
    setShowMatchesDialog(true);
  };

  const handleThumbsUp = (quote: QuoteWithMatches) => {
    const topMatch = quote.matches?.[0];
    if (topMatch) {
      setFeedbackRating(1);
      setSelectedMatchId(topMatch.match_id);
      setSelectedSuggestedPrice(topMatch.suggested_price);
      setShowFeedbackDialog(true);
    }
  };

  const handleThumbsDown = (quote: QuoteWithMatches) => {
    const topMatch = quote.matches?.[0];
    if (topMatch) {
      setFeedbackRating(-1);
      setSelectedMatchId(topMatch.match_id);
      setSelectedSuggestedPrice(topMatch.suggested_price);
      setShowFeedbackDialog(true);
    }
  };

  const handleFeedbackSubmit = async (data: {
    rating: number;
    feedbackReason: string | null;
    feedbackNotes: string | null;
    actualPriceUsed: number | null;
  }) => {
    if (selectedMatchId) {
      await onFeedbackSubmit(selectedMatchId, data);
    }
  };

  const formatLocation = (city: string | null, state: string | null, country: string | null) => {
    return [city, state, country].filter(Boolean).join(', ') || '-';
  };

  const formatPrice = (price: number | null) => {
    if (price === null) return '-';
    return '$' + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const exportProforma = (quote: QuoteWithMatches) => {
    const suggestedPrice = quote.top_suggested_price || quote.matches?.[0]?.suggested_price;
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    let y = 20;

    // Header
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('PROFORMA INVOICE', pageWidth / 2, y, { align: 'center' });
    y += 15;

    // Quote info line
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${today}`, 20, y);
    doc.text(`Quote #${quote.quote_id}`, pageWidth - 20, y, { align: 'right' });
    y += 6;
    doc.text(`Status: ${quote.quote_status || 'Pending'}`, 20, y);
    y += 15;

    // Client Information Section
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, pageWidth - 30, 8, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('CLIENT INFORMATION', 20, y);
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Company: ${quote.client_company_name || 'N/A'}`, 20, y);
    y += 6;
    doc.text(`Contact: ${quote.contact_person_name || 'N/A'}`, 20, y);
    y += 6;
    doc.text(`Email: ${quote.email_address || 'N/A'}`, 20, y);
    y += 6;
    doc.text(`Phone: ${quote.phone_number || 'N/A'}`, 20, y);
    y += 15;

    // Shipment Details Section
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, pageWidth - 30, 8, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('SHIPMENT DETAILS', 20, y);
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const origin = [quote.origin_city, quote.origin_state_province, quote.origin_country].filter(Boolean).join(', ') || 'N/A';
    const destination = [quote.destination_city, quote.destination_state_province, quote.destination_country].filter(Boolean).join(', ') || 'N/A';
    doc.text(`Origin: ${origin}`, 20, y);
    y += 6;
    doc.text(`Destination: ${destination}`, 20, y);
    y += 15;

    // Cargo Information Section
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, pageWidth - 30, 8, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('CARGO INFORMATION', 20, y);
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Description: ${quote.cargo_description || 'N/A'}`, 20, y);
    y += 6;
    doc.text(`Weight: ${quote.cargo_weight ? `${quote.cargo_weight} ${quote.weight_unit || 'kg'}` : 'N/A'}`, 20, y);
    y += 6;
    const dimensions = quote.cargo_length && quote.cargo_width && quote.cargo_height
      ? `${quote.cargo_length} x ${quote.cargo_width} x ${quote.cargo_height} ${quote.dimension_unit || 'cm'}`
      : 'N/A';
    doc.text(`Dimensions: ${dimensions}`, 20, y);
    y += 6;
    doc.text(`Number of Pieces: ${quote.number_of_pieces || 'N/A'}`, 20, y);
    y += 6;
    if (quote.hazardous_material) {
      doc.setTextColor(255, 100, 0);
      doc.text('⚠ Hazardous Material: Yes', 20, y);
      doc.setTextColor(0, 0, 0);
    } else {
      doc.text('Hazardous Material: No', 20, y);
    }
    y += 15;

    // Service & Pricing Section
    doc.setFillColor(240, 240, 240);
    doc.rect(15, y - 5, pageWidth - 30, 8, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('SERVICE & PRICING', 20, y);
    y += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Service Type: ${quote.service_type || 'N/A'}`, 20, y);
    y += 10;

    // Pricing table
    if (suggestedPrice || quote.initial_quote_amount || quote.final_agreed_price) {
      doc.setDrawColor(200, 200, 200);
      doc.line(20, y, pageWidth - 20, y);
      y += 8;

      if (suggestedPrice) {
        doc.text('AI Suggested Price:', 20, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 100, 180);
        doc.text(`$${suggestedPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth - 20, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        y += 8;
      }
      if (quote.initial_quote_amount) {
        doc.text('Initial Quote:', 20, y);
        doc.text(`$${quote.initial_quote_amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth - 20, y, { align: 'right' });
        y += 8;
      }
      if (quote.final_agreed_price) {
        doc.text('Final Agreed Price:', 20, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 150, 0);
        doc.text(`$${quote.final_agreed_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pageWidth - 20, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        y += 8;
      }
    }

    // Footer
    y = doc.internal.pageSize.getHeight() - 20;
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text('This is a proforma invoice and not a final invoice. Terms and conditions apply.', pageWidth / 2, y, { align: 'center' });

    doc.save(`proforma_quote_${quote.quote_id}.pdf`);
  };
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

      {/* Attachments Section */}
      <Attachments
        emailId={email.email_id}
        hasAttachments={email.email_has_attachments}
      />

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
          <div className="overflow-x-auto border border-outlook-border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-outlook-border">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text hidden">ID</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Status</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Client</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Origin</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Destination</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Cargo</th>
                  <th className="px-3 py-2 text-left font-semibold text-outlook-text">Service</th>
                  <th className="px-3 py-2 text-right font-semibold text-outlook-text">AI Price</th>
                  <th className="px-3 py-2 text-center font-semibold text-outlook-text">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outlook-border">
                {email.quotes.map((quote) => {
                  const suggestedPrice = quote.top_suggested_price || quote.matches?.[0]?.suggested_price;
                  const topMatch = quote.matches?.[0];
                  return (
                    <tr key={quote.quote_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-outlook-text font-medium hidden">#{quote.quote_id}</td>
                      <td className="px-3 py-2">
                        {quote.quote_status && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            quote.quote_status === 'Approved' ? 'bg-green-100 text-green-800' :
                            quote.quote_status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                            quote.quote_status === 'Rejected' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {quote.quote_status}
                          </span>
                        )}
                        {quote.hazardous_material && (
                          <span title="Hazardous Material">
                            <AlertTriangle className="w-4 h-4 text-amber-500 inline ml-1" />
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-outlook-text">{quote.client_company_name || '-'}</td>
                      <td className="px-3 py-2 text-outlook-text">{formatLocation(quote.origin_city, quote.origin_state_province, quote.origin_country)}</td>
                      <td className="px-3 py-2 text-outlook-text">{formatLocation(quote.destination_city, quote.destination_state_province, quote.destination_country)}</td>
                      <td className="px-3 py-2 text-outlook-text">
                        {quote.cargo_description || '-'}
                        {quote.cargo_weight && <span className="text-outlook-textLight text-xs ml-1">({quote.cargo_weight} {quote.weight_unit || 'kg'})</span>}
                      </td>
                      <td className="px-3 py-2 text-outlook-text">{quote.service_type || '-'}</td>
                      <td className="px-3 py-2 text-right">
                        {suggestedPrice ? (
                          <span className="font-semibold text-outlook-blue">{formatPrice(suggestedPrice)}</span>
                        ) : (
                          <span className="text-outlook-textLight">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => exportProforma(quote)}
                            className="p-1 hover:bg-outlook-hover rounded transition-colors"
                            title="Export Proforma"
                          >
                            <FileDown className="w-4 h-4 text-outlook-blue" />
                          </button>
                          <button
                            onClick={() => handleViewMatches(quote)}
                            className="p-1 hover:bg-outlook-hover rounded transition-colors"
                            title={`View Matches (${quote.matches?.length || 0})`}
                          >
                            <Eye className="w-4 h-4 text-outlook-blue" />
                          </button>
                          {topMatch && (
                            <>
                              <button
                                onClick={() => handleThumbsUp(quote)}
                                className="p-1 hover:bg-green-50 rounded transition-colors"
                                title="Good suggestion"
                              >
                                <ThumbsUp className="w-4 h-4 text-green-600" />
                              </button>
                              <button
                                onClick={() => handleThumbsDown(quote)}
                                className="p-1 hover:bg-red-50 rounded transition-colors"
                                title="Poor suggestion"
                              >
                                <ThumbsDown className="w-4 h-4 text-red-600" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 bg-gray-50 rounded-lg">
            <Building className="w-12 h-12 text-outlook-border mx-auto mb-3" />
            <p className="text-sm text-outlook-textLight">No quotes extracted from this email</p>
          </div>
        )}
      </div>

      {/* Dialogs */}
      {selectedQuote && (
        <MatchesDialog
          isOpen={showMatchesDialog}
          onClose={() => {
            setShowMatchesDialog(false);
            setSelectedQuote(null);
          }}
          matches={selectedQuote.matches || []}
          quoteId={selectedQuote.quote_id}
        />
      )}

      {selectedMatchId && (
        <FeedbackDialog
          isOpen={showFeedbackDialog}
          onClose={() => {
            setShowFeedbackDialog(false);
            setSelectedMatchId(null);
          }}
          matchId={selectedMatchId}
          suggestedPrice={selectedSuggestedPrice}
          rating={feedbackRating}
          onSubmit={handleFeedbackSubmit}
        />
      )}

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
