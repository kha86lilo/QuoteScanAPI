/**
 * TypeScript Type Definitions
 * Centralized type definitions for the Shipping Quote Email Extractor API
 */

import type { Request, Response, NextFunction } from 'express';

// =============================================================================
// EMAIL TYPES
// =============================================================================

export interface EmailAddress {
  name?: string;
  address?: string;
}

export interface EmailFrom {
  emailAddress?: EmailAddress;
}

export interface EmailBody {
  content?: string;
  contentType?: 'text' | 'html';
}

export interface Email {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: EmailFrom;
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: EmailBody;
  hasAttachments?: boolean;
  attachmentText?: string;
  attachmentMeta?: AttachmentMeta[];
  filterScore?: number;
  filterReason?: string;
}

export interface AttachmentMeta {
  name: string;
  type?: string;
  processed: boolean;
  textLength?: number;
  reason?: string;
  error?: string;
}

export interface Attachment {
  id?: string;
  name?: string;
  contentBytes?: string;
  contentType?: string;
  size?: number;
}

// =============================================================================
// QUOTE TYPES
// =============================================================================

export interface ClientInfo {
  client_company_name?: string | null;
  contact_person_name?: string | null;
  contact_title?: string | null;
  email_address?: string | null;
  phone_number?: string | null;
  company_address?: string | null;
  client_type?: string | null;
  industry_business_type?: string | null;
  client_location_country?: string | null;
}

export interface EmailThreadSummary {
  thread_type?: string;
  number_of_exchanges?: number;
  missing_information_requested?: string[];
  conversation_summary?: string;
}

export interface Quote {
  quote_id?: number;
  email_id?: number;
  quote_identifier?: string | null;
  quote_sequence_number?: number;

  // Origin
  origin_full_address?: string | null;
  origin_city?: string | null;
  origin_state_province?: string | null;
  origin_country?: string | null;
  origin_postal_code?: string | null;
  origin_facility_type?: string | null;
  requested_pickup_date?: string | null;
  pickup_time_window?: string | null;
  pickup_special_requirements?: string | null;

  // Destination
  destination_full_address?: string | null;
  destination_city?: string | null;
  destination_state_province?: string | null;
  destination_country?: string | null;
  destination_postal_code?: string | null;
  destination_facility_type?: string | null;
  requested_delivery_date?: string | null;
  delivery_time_window?: string | null;
  delivery_special_requirements?: string | null;

  // Distance/Transit
  total_distance_miles?: number | null;
  estimated_transit_days?: number | null;
  transit_time_quoted?: string | null;

  // Cargo
  cargo_length?: number | null;
  cargo_width?: number | null;
  cargo_height?: number | null;
  dimension_unit?: string | null;
  cargo_weight?: number | null;
  weight_unit?: string | null;
  number_of_pieces?: number | null;
  cargo_description?: string | null;
  cargo_type?: string | null;
  commodity_code?: string | null;

  // Oversize/Overweight
  is_overweight?: boolean;
  is_oversized?: boolean;
  requires_permits?: boolean;
  permit_type?: string | null;
  requires_pilot_car?: boolean;
  requires_tarping?: boolean;
  stackable?: boolean;

  // Hazmat
  hazardous_material?: boolean;
  hazmat_class?: string | null;
  hazmat_un_number?: string | null;
  temperature_controlled?: boolean;
  temperature_range?: string | null;
  declared_value?: number | null;
  declared_value_currency?: string | null;
  packaging_type?: string | null;

  // Equipment
  equipment_type_requested?: string | null;
  equipment_type_quoted?: string | null;
  trailer_length_required?: string | null;
  load_type?: string | null;

  // Service
  service_type?: string | null;
  service_level?: string | null;
  incoterms?: string | null;
  insurance_required?: boolean;
  insurance_amount?: number | null;
  customs_clearance_needed?: boolean;
  customs_broker?: string | null;

  // Pricing
  quote_request_date?: string | null;
  quote_provided_date?: string | null;
  quote_valid_until?: string | null;
  quote_date?: string | null;
  initial_quote_amount?: number | null;
  initial_quote_currency?: string | null;
  revised_quote_1?: number | null;
  revised_quote_1_date?: string | null;
  revised_quote_2?: number | null;
  revised_quote_2_date?: string | null;
  final_agreed_price?: number | null;
  discount_given?: number | null;
  discount_reason?: string | null;
  additional_charges?: string | null;
  payment_terms?: string | null;

  // Status
  quote_status?: string | null;
  job_won?: boolean | null;
  acceptance_date?: string | null;
  rejection_reason?: string | null;
  competitor_mentioned?: string | null;
  client_response_sentiment?: string | null;
  follow_up_required?: boolean;
  follow_up_reason?: string | null;

  // Meta
  sales_representative?: string | null;
  client_account_manager?: string | null;
  lead_source?: string | null;
  urgency_level?: string | null;
  special_requirements?: string | null;
  internal_notes?: string | null;

  // Database timestamps
  created_at?: string;
}

export interface ParsedEmailData {
  email_thread_summary?: EmailThreadSummary;
  client_info?: ClientInfo;
  quotes: Quote[];
  ai_confidence_score?: number;
}

export interface QuoteWithEmail extends Quote {
  email_message_id?: string;
  email_subject?: string;
  email_received_date?: string;
  email_sender_name?: string;
  email_sender_email?: string;
  email_body_preview?: string;
  email_has_attachments?: boolean;
  raw_email_body?: string;
  processed_at?: string;
  ai_confidence_score?: number;
  conversation_id?: string;
  job_id?: string;
}

// =============================================================================
// JOB TYPES
// =============================================================================

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface JobProgress {
  current: number;
  total: number;
  percentage: number;
}

export interface JobData {
  searchQuery?: string;
  maxEmails?: number;
  startDate?: string | null;
  scoreThreshold?: number;
  previewMode?: boolean;
  matchingOptions?: MatchingOptions;
}

export interface JobResult {
  fetched?: number;
  filtered?: FilteredResults;
  processed?: ProcessedResults;
  estimatedCost?: number;
  estimatedSavings?: number;
  actualCost?: number;
  lastReceivedDateTime?: string | null;
  newQuoteIds?: number[];
  preview?: FilterPreview;
  summary?: ProcessingSummary;
  extraction?: ExtractionResult;
  matching?: MatchingResult;
  learning?: LearningResult | null;
}

export interface JobError {
  message: string;
  stack?: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  data: JobData;
  result: JobResult | null;
  error: JobError | null;
  progress: JobProgress;
  lastReceivedDateTime?: string | null;
}

export interface JobStatistics {
  total_jobs: string;
  completed_jobs: string;
  failed_jobs: string;
  total_emails_fetched: string;
  total_emails_processed: string;
  total_cost: string;
  total_savings: string;
}

// =============================================================================
// PROCESSING TYPES
// =============================================================================

export interface FilteredResults {
  toProcess: number;
  toSkip: number;
}

export interface ProcessedResults {
  successful: number;
  skipped: number;
  failed: number;
}

export interface ProcessingError {
  emailId?: string;
  quoteId?: number;
  subject?: string;
  error: string;
  stack?: string;
}

export interface ProcessingSummary {
  fetched: number;
  filtered: FilteredResults;
  processed: ProcessedResults;
  newQuoteIds: number[];
  estimatedCost: number;
  estimatedSavings: number;
  actualCost: number;
  aiProvider: string;
  model: string;
  searchQuery: string;
  scoreThreshold: number;
  completedAt: string;
  lastReceivedDateTime: string | null;
}

export interface FilterPreview {
  threshold: number;
  summary: FilterSummary;
  toProcess: FilteredEmailPreview[];
  toSkip: FilteredEmailPreview[];
}

export interface FilterSummary {
  total: number;
  toProcess: number;
  toSkip: number;
  processPercentage: string | number;
  estimatedCost: number;
  estimatedSavings: number;
}

export interface FilteredEmailPreview {
  id: string;
  subject?: string;
  from?: string;
  score: number;
  reason: string;
  receivedDateTime?: string;
  hasAttachments?: boolean;
  attachmentMeta?: AttachmentMeta[] | null;
}

export interface ExtractionResult {
  fetched: number;
  filtered: FilteredResults | number;
  processed: ProcessedResults | number;
  newQuoteIds: number[];
  lastReceivedDateTime?: string | null;
}

// =============================================================================
// MATCHING TYPES
// =============================================================================

export interface MatchingOptions {
  minScore?: number;
  maxMatches?: number;
  useAI?: boolean;
}

export interface MatchCriteria {
  origin_region?: number;
  origin_city?: number;
  destination_region?: number;
  destination_city?: number;
  service_type?: number;
  service_compatibility?: number;
  cargo_category?: number;
  cargo_weight_range?: number;
  number_of_pieces?: number;
  hazmat?: number;
  container_type?: number;
  recency?: number;
  distance_similarity?: number;
}

export interface MatchedQuoteData {
  origin: string;
  destination: string;
  cargo?: string;
  service?: string;
  weight?: number;
  finalPrice?: number | null;
  initialPrice?: number | null;
  quoteDate?: string;
  status?: string;
}

export interface PriceRange {
  low: number;
  high: number;
}

export interface QuoteMatch {
  match_id?: number;
  source_quote_id: number;
  matched_quote_id: number;
  similarity_score: number;
  match_criteria: MatchCriteria;
  suggested_price?: number | null;
  price_confidence?: number;
  price_range?: PriceRange | null;
  match_algorithm_version?: string;
  ai_pricing_details?: AIPricingDetails | null;
  created_at?: string;
  matchedQuoteData?: MatchedQuoteData;
  priceSource?: string;
  jobWon?: boolean | null;
  metadata?: MatchMetadata;
}

export interface MatchMetadata {
  sourceService?: string;
  histService?: string;
  sourceCargoCat?: string;
  histCargoCat?: string;
  sourceOriginRegion?: string | null;
  sourceDestRegion?: string | null;
}

export interface AIPricingDetails {
  recommended_price?: number;
  floor_price?: number;
  target_price?: number;
  ceiling_price?: number;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  reasoning?: string;
  price_breakdown?: PriceBreakdown;
  market_factors?: string[];
  negotiation_room_percent?: number;
}

export interface PriceBreakdown {
  linehaul?: number;
  fuel_surcharge?: number;
  accessorials?: number;
  margin?: number;
  port_fees?: number;
  handling?: number;
}

export interface MatchResult {
  processed: number;
  matchesCreated: number;
  errors: ProcessingError[];
  matchDetails: MatchDetail[];
}

export interface MatchingResult extends MatchResult {
  quotesProcessed?: number;
}

export interface MatchDetail {
  quoteId: number;
  matchCount: number;
  bestScore: number;
  suggestedPrice?: number | null;
  priceRange?: PriceRange | null;
  aiPricing?: AIPricingDetails | null;
}

// =============================================================================
// FEEDBACK TYPES
// =============================================================================

export type FeedbackReason =
  | 'good_match'
  | 'excellent_suggestion'
  | 'wrong_route'
  | 'different_cargo'
  | 'price_outdated'
  | 'weight_mismatch'
  | 'service_mismatch'
  | 'different_client_type'
  | 'other';

export interface MatchFeedback {
  feedback_id?: number;
  match_id: number;
  user_id?: string | null;
  rating: 1 | -1;
  feedback_reason?: FeedbackReason | null;
  feedback_notes?: string | null;
  actual_price_used?: number | null;
  created_at?: string;
}

export interface FeedbackStatistics {
  total_feedback: string;
  thumbs_up: string;
  thumbs_down: string;
  avg_rating: string;
  avg_similarity_score: string;
  approval_rate: number;
  avg_price_error: string;
  price_feedback_count: string;
}

export interface FeedbackByReason {
  feedback_reason: FeedbackReason | null;
  rating: number;
  count: string;
}

export interface CriteriaPerformance {
  rating: number;
  avg_origin_score: string;
  avg_destination_score: string;
  avg_cargo_type_score: string;
  avg_weight_score: string;
  avg_service_type_score: string;
  avg_overall_score: string;
  sample_count: string;
}

export interface LearningResult {
  success: boolean;
  message?: string;
  adjustments?: number;
  error?: string;
}

// =============================================================================
// AI SERVICE TYPES
// =============================================================================

export interface AIProviderInfo {
  current: string;
  available: string[];
  configured: {
    gemini: boolean;
    claude: boolean;
    chatgpt: boolean;
  };
  models: {
    gemini: string;
    claude: string;
    chatgpt: string;
  };
}

export interface AIProviderValidation {
  valid: boolean;
  provider: string;
  message: string;
}

// =============================================================================
// DATABASE TYPES
// =============================================================================

export interface DatabaseSaveResult {
  email_id: number;
  quote_ids: number[];
  quotes_count: number;
}

export interface ProcessingStats {
  total_emails: string;
  total_quotes: string;
  approved_quotes: string;
  jobs_won: string;
  avg_confidence: string;
  last_processed: string;
}

export interface ShippingEmail {
  email_id: number;
  email_message_id: string;
  conversation_id?: string;
  job_id?: string;
  email_subject?: string;
  email_received_date?: string;
  email_sender_name?: string;
  email_sender_email?: string;
  email_body_preview?: string;
  email_has_attachments?: boolean;
  raw_email_body?: string;
  processed_at?: string;
  ai_confidence_score?: number;
  quote_count?: number;
}

export interface Spammer {
  spammer_id: number;
  email_address: string;
  reason?: string;
  added_by?: string;
  created_at?: string;
}

// =============================================================================
// WEIGHT RANGE TYPES
// =============================================================================

export interface WeightRange {
  min: number;
  max: number;
  label: string;
  multiplier: number;
}

// =============================================================================
// LANE PRICING TYPES
// =============================================================================

export interface LanePricingStats {
  origin_region: string;
  destination_region: string;
  service_type: string;
  avg_price: number;
  quote_count: number;
  win_rate: number;
  total_quotes: number;
}

export interface SmartPricing {
  suggestedPrice: number;
  matchBasedPrice: number;
  priceRange: PriceRange;
  confidence: number;
  matchCount: number;
  laneStats: {
    avgPrice: number;
    quoteCount: number;
    winRate: number;
  } | null;
  adjustments: string[];
}

// =============================================================================
// EXPRESS TYPES
// =============================================================================

export interface TypedRequest<TBody = unknown, TQuery = unknown, TParams = unknown>
  extends Request {
  body: TBody;
  query: TQuery & Record<string, string | undefined>;
  params: TParams & Record<string, string>;
}

export type AsyncRequestHandler<
  TBody = unknown,
  TQuery = unknown,
  TParams = unknown
> = (
  req: TypedRequest<TBody, TQuery, TParams>,
  res: Response,
  next: NextFunction
) => Promise<void | Response>;

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export interface PaginatedResponse<T> extends ApiResponse<T> {
  pagination?: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface AppErrorDetails {
  statusCode: number;
  status: string;
  isOperational: boolean;
  service?: string;
  operation?: string;
  originalError?: string;
}
