'use client';

import { useState } from 'react';
import { X, ThumbsUp, ThumbsDown, DollarSign } from 'lucide-react';

interface FeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
  matchId: number;
  suggestedPrice: number | null;
  rating: 1 | -1;
  onSubmit: (data: {
    rating: number;
    feedbackReason: string | null;
    feedbackNotes: string | null;
    actualPriceUsed: number | null;
  }) => Promise<void>;
}

const FEEDBACK_REASONS = {
  positive: [
    { value: 'good_match', label: 'Good match' },
    { value: 'excellent_suggestion', label: 'Excellent price suggestion' },
    { value: 'accurate_route', label: 'Accurate route match' },
  ],
  negative: [
    { value: 'wrong_route', label: 'Wrong route' },
    { value: 'different_cargo', label: 'Different cargo type' },
    { value: 'price_outdated', label: 'Price is outdated' },
    { value: 'weight_mismatch', label: 'Weight mismatch' },
    { value: 'service_mismatch', label: 'Service type mismatch' },
    { value: 'different_client_type', label: 'Different client type' },
  ],
};

export default function FeedbackDialog({
  isOpen,
  onClose,
  matchId,
  suggestedPrice,
  rating,
  onSubmit,
}: FeedbackDialogProps) {
  const [feedbackReason, setFeedbackReason] = useState<string | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [actualPrice, setActualPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const reasons = rating === 1 ? FEEDBACK_REASONS.positive : FEEDBACK_REASONS.negative;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit({
        rating,
        feedbackReason,
        feedbackNotes: feedbackNotes.trim() || null,
        actualPriceUsed: actualPrice ? parseFloat(actualPrice) : null,
      });
      onClose();
    } catch (error) {
      console.error('Error submitting feedback:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setFeedbackReason(null);
    setFeedbackNotes('');
    setActualPrice('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-30" onClick={handleClose} />
        <div className="relative bg-white rounded-lg shadow-xl max-w-md w-full">
          <div className="border-b border-outlook-border px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {rating === 1 ? (
                <div className="p-2 bg-green-100 rounded-full">
                  <ThumbsUp className="w-5 h-5 text-green-600" />
                </div>
              ) : (
                <div className="p-2 bg-red-100 rounded-full">
                  <ThumbsDown className="w-5 h-5 text-red-600" />
                </div>
              )}
              <div>
                <h2 className="text-lg font-semibold text-outlook-text">
                  {rating === 1 ? 'Positive Feedback' : 'Negative Feedback'}
                </h2>
                <p className="text-sm text-outlook-textLight">Match #{matchId}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-outlook-hover rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-outlook-textLight" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {suggestedPrice && (
              <div className="bg-blue-50 rounded-lg p-3">
                <span className="text-sm text-outlook-textLight">Suggested Price:</span>
                <span className="ml-2 font-semibold text-outlook-blue">
                  ${suggestedPrice.toLocaleString('en-US', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-outlook-text mb-2">
                Actual Price Used (optional)
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outlook-textLight" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={actualPrice}
                  onChange={(e) => setActualPrice(e.target.value)}
                  placeholder="Enter actual price"
                  className="w-full pl-9 pr-4 py-2 border border-outlook-border rounded-lg focus:outline-none focus:ring-2 focus:ring-outlook-blue focus:border-transparent"
                />
              </div>
              <p className="mt-1 text-xs text-outlook-textLight">
                Help improve our suggestions by providing the actual price used
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-outlook-text mb-2">
                Reason (optional)
              </label>
              <div className="space-y-2">
                {reasons.map((reason) => (
                  <label
                    key={reason.value}
                    className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                      feedbackReason === reason.value
                        ? 'border-outlook-blue bg-outlook-lightBlue'
                        : 'border-outlook-border hover:bg-outlook-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="feedbackReason"
                      value={reason.value}
                      checked={feedbackReason === reason.value}
                      onChange={(e) => setFeedbackReason(e.target.value)}
                      className="sr-only"
                    />
                    <span className="text-sm text-outlook-text">{reason.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-outlook-text mb-2">
                Additional Notes (optional)
              </label>
              <textarea
                value={feedbackNotes}
                onChange={(e) => setFeedbackNotes(e.target.value)}
                placeholder="Any additional details..."
                rows={3}
                className="w-full px-4 py-2 border border-outlook-border rounded-lg focus:outline-none focus:ring-2 focus:ring-outlook-blue focus:border-transparent resize-none"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 px-4 py-2 border border-outlook-border rounded-lg text-outlook-text hover:bg-outlook-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`flex-1 px-4 py-2 rounded-lg text-white transition-colors ${
                  rating === 1
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-red-600 hover:bg-red-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
