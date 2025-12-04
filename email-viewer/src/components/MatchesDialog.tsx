'use client';

import { QuoteMatch } from '@/types';
import { X, MapPin, Package, Truck, DollarSign } from 'lucide-react';

interface MatchesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  matches: QuoteMatch[];
  quoteId: number;
}

export default function MatchesDialog({ isOpen, onClose, matches, quoteId }: MatchesDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-black bg-opacity-30" onClick={onClose} />
        <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden">
          <div className="sticky top-0 bg-white border-b border-outlook-border px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-outlook-text">Quote Matches</h2>
              <p className="text-sm text-outlook-textLight">
                {matches.length} similar historical quotes found for Quote #{quoteId}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-outlook-hover rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-outlook-textLight" />
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(80vh-80px)] p-6">
            {matches.length === 0 ? (
              <div className="text-center py-8 text-outlook-textLight">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No matches found for this quote</p>
              </div>
            ) : (
              <div className="space-y-4">
                {matches.map((match) => (
                  <div
                    key={match.match_id}
                    className="border border-outlook-border rounded-lg p-4 hover:border-outlook-blue transition-colors"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-outlook-text">
                          Match #{match.matched_quote_id}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                          {(match.similarity_score * 100).toFixed(1)}% match
                        </span>
                      </div>
                      {match.suggested_price && (
                        <div className="text-right">
                          <div className="flex items-center gap-1 text-outlook-blue font-semibold">
                            <DollarSign className="w-4 h-4" />
                            {match.suggested_price.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                          {match.price_confidence && (
                            <span className="text-xs text-outlook-textLight">
                              {(match.price_confidence * 100).toFixed(0)}% confidence
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {match.matched_quote && (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-outlook-textLight block">Origin</span>
                              <span className="text-outlook-text">
                                {match.matched_quote.origin_city || 'N/A'}
                                {match.matched_quote.origin_country && `, ${match.matched_quote.origin_country}`}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <MapPin className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-outlook-textLight block">Destination</span>
                              <span className="text-outlook-text">
                                {match.matched_quote.destination_city || 'N/A'}
                                {match.matched_quote.destination_country && `, ${match.matched_quote.destination_country}`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-start gap-2">
                            <Package className="w-4 h-4 text-outlook-blue mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-outlook-textLight block">Cargo</span>
                              <span className="text-outlook-text">
                                {match.matched_quote.cargo_description || 'N/A'}
                                {match.matched_quote.cargo_weight && (
                                  <span className="text-outlook-textLight">
                                    {' '}({match.matched_quote.cargo_weight} {match.matched_quote.weight_unit || 'kg'})
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <Truck className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                            <div>
                              <span className="text-xs text-outlook-textLight block">Service</span>
                              <span className="text-outlook-text">
                                {match.matched_quote.service_type || 'N/A'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {match.match_criteria && (
                      <div className="mt-3 pt-3 border-t border-outlook-border">
                        <span className="text-xs text-outlook-textLight block mb-2">Match Criteria Scores</span>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(match.match_criteria).map(([key, value]) => (
                            <span
                              key={key}
                              className="inline-flex items-center px-2 py-1 rounded text-xs bg-gray-100"
                            >
                              <span className="text-outlook-textLight capitalize">
                                {key.replace(/_/g, ' ')}:
                              </span>
                              <span className="ml-1 font-medium text-outlook-text">
                                {((value as number) * 100).toFixed(0)}%
                              </span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {match.matched_quote && (
                      <div className="mt-3 pt-3 border-t border-outlook-border flex items-center justify-between text-xs">
                        <span className="text-outlook-textLight">
                          Historical Price:{' '}
                          <span className="font-medium text-outlook-text">
                            ${(match.matched_quote.final_agreed_price || match.matched_quote.initial_quote_amount || 0).toLocaleString()}
                          </span>
                        </span>
                        <span className={`px-2 py-0.5 rounded ${
                          match.matched_quote.quote_status === 'Approved' ? 'bg-green-100 text-green-800' :
                          match.matched_quote.quote_status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {match.matched_quote.quote_status || 'Unknown'}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
