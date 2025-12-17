'use client';

import { useState } from 'react';
import { QuoteWithMatches } from '@/types';
import { MapPin, Package, Truck, DollarSign, ThumbsUp, ThumbsDown, Eye, AlertTriangle } from 'lucide-react';
import MatchesDialog from './MatchesDialog';
import FeedbackDialog from './FeedbackDialog';

interface QuoteCardProps {
  quote: QuoteWithMatches;
  onFeedbackSubmit: (quoteId: number, data: {
    rating: number;
    feedbackReason: string | null;
    feedbackNotes: string | null;
    actualPriceUsed: number | null;
  }) => Promise<void>;
}

export default function QuoteCard({ quote, onFeedbackSubmit }: QuoteCardProps) {
  const [showMatchesDialog, setShowMatchesDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<1 | -1>(1);
  const [selectedSuggestedPrice, setSelectedSuggestedPrice] = useState<number | null>(null);

  const topMatch = quote.matches?.[0];
  const suggestedPrice = quote.ai_recommended_price || quote.top_suggested_price || topMatch?.suggested_price;

  const handleThumbsUp = () => {
    if (quote.ai_recommended_price !== null) {
      setFeedbackRating(1);
      setSelectedSuggestedPrice(quote.ai_recommended_price);
      setShowFeedbackDialog(true);
    }
  };

  const handleThumbsDown = () => {
    if (quote.ai_recommended_price !== null) {
      setFeedbackRating(-1);
      setSelectedSuggestedPrice(quote.ai_recommended_price);
      setShowFeedbackDialog(true);
    }
  };

  const handleFeedbackSubmit = async (data: {
    rating: number;
    feedbackReason: string | null;
    feedbackNotes: string | null;
    actualPriceUsed: number | null;
  }) => {
    await onFeedbackSubmit(quote.quote_id, data);
  };

  return (
    <>
      <div className="border border-outlook-border rounded-lg bg-white overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-outlook-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-outlook-text">Quote #{quote.quote_id}</span>
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
          </div>
          {quote.client_company_name && (
            <span className="text-sm text-outlook-textLight">{quote.client_company_name}</span>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Route Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-outlook-textLight block">Origin</span>
                <span className="text-sm text-outlook-text">
                  {[quote.origin_city, quote.origin_state_province, quote.origin_country]
                    .filter(Boolean)
                    .join(', ') || 'Not specified'}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-outlook-textLight block">Destination</span>
                <span className="text-sm text-outlook-text">
                  {[quote.destination_city, quote.destination_state_province, quote.destination_country]
                    .filter(Boolean)
                    .join(', ') || 'Not specified'}
                </span>
              </div>
            </div>
          </div>

          {/* Cargo & Service Information */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-start gap-2">
              <Package className="w-4 h-4 text-outlook-blue mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-outlook-textLight block">Cargo</span>
                <span className="text-sm text-outlook-text">
                  {quote.cargo_description || 'Not specified'}
                  {quote.cargo_weight && (
                    <span className="text-outlook-textLight">
                      {' '}({quote.cargo_weight} {quote.weight_unit || 'kg'})
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Truck className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
              <div>
                <span className="text-xs text-outlook-textLight block">Service</span>
                <span className="text-sm text-outlook-text">
                  {quote.service_type || 'Not specified'}
                </span>
              </div>
            </div>
          </div>

          {quote.hazardous_material && (
            <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">Hazardous Material</span>
            </div>
          )}

          {/* Suggested Price Section */}
          {suggestedPrice ? (
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-outlook-textLight">AI Suggested Price</span>
                <div className="flex items-center gap-1">
                  <DollarSign className="w-5 h-5 text-outlook-blue" />
                  <span className="text-xl font-bold text-outlook-blue">
                    {suggestedPrice.toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
              {topMatch?.price_confidence && (
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex-1 bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-outlook-blue rounded-full h-2"
                      style={{ width: `${topMatch.price_confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-outlook-textLight">
                    {(topMatch.price_confidence * 100).toFixed(0)}% confidence
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMatchesDialog(true)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white border border-outlook-border rounded-lg text-sm text-outlook-text hover:bg-outlook-hover transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  View Matches ({quote.matches?.length || 0})
                </button>
                {quote.ai_recommended_price !== null && (
                  <>
                    <button
                      onClick={() => handleThumbsUp()}
                      className="p-2 bg-white border border-outlook-border rounded-lg hover:bg-green-50 hover:border-green-300 transition-colors"
                      title="Good suggestion"
                    >
                      <ThumbsUp className="w-4 h-4 text-green-600" />
                    </button>
                    <button
                      onClick={() => handleThumbsDown()}
                      className="p-2 bg-white border border-outlook-border rounded-lg hover:bg-red-50 hover:border-red-300 transition-colors"
                      title="Poor suggestion"
                    >
                      <ThumbsDown className="w-4 h-4 text-red-600" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <span className="text-sm text-outlook-textLight">No price suggestions available</span>
              <button
                onClick={() => setShowMatchesDialog(true)}
                className="mt-2 flex items-center justify-center gap-2 mx-auto px-3 py-2 bg-white border border-outlook-border rounded-lg text-sm text-outlook-text hover:bg-outlook-hover transition-colors"
              >
                <Eye className="w-4 h-4" />
                View Matches ({quote.matches?.length || 0})
              </button>
            </div>
          )}

          {/* Existing Pricing */}
          {(quote.initial_quote_amount || quote.final_agreed_price) && (
            <div className="flex items-center justify-between text-sm pt-2 border-t border-outlook-border">
              {quote.initial_quote_amount && (
                <div>
                  <span className="text-outlook-textLight">Initial Quote: </span>
                  <span className="font-medium text-outlook-text">
                    ${quote.initial_quote_amount.toLocaleString()}
                  </span>
                </div>
              )}
              {quote.final_agreed_price && (
                <div>
                  <span className="text-outlook-textLight">Final Price: </span>
                  <span className="font-medium text-green-600">
                    ${quote.final_agreed_price.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <MatchesDialog
        isOpen={showMatchesDialog}
        onClose={() => setShowMatchesDialog(false)}
        matches={quote.matches || []}
        quoteId={quote.quote_id}
      />

      {showFeedbackDialog && (
        <FeedbackDialog
          isOpen={showFeedbackDialog}
          onClose={() => {
            setShowFeedbackDialog(false);
          }}
          quoteId={quote.quote_id}
          suggestedPrice={selectedSuggestedPrice}
          rating={feedbackRating}
          onSubmit={handleFeedbackSubmit}
        />
      )}
    </>
  );
}
