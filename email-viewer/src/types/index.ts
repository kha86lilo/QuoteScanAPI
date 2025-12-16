export interface ShippingEmail {
  email_id: number;
  email_message_id: string;
  conversation_id: string | null;
  job_id: string | null;
  email_subject: string;
  email_received_date: string;
  email_sender_name: string;
  email_sender_email: string;
  email_body_preview: string;
  email_has_attachments: boolean;
  raw_email_body: string | null;
  processed_at: string | null;
  ai_confidence_score: number | null;
}

export interface ShippingQuote {
  quote_id: number;
  email_id: number;
  client_company_name: string | null;
  contact_person_name: string | null;
  email_address: string | null;
  phone_number: string | null;
  origin_city: string | null;
  origin_state_province: string | null;
  origin_country: string | null;
  destination_city: string | null;
  destination_state_province: string | null;
  destination_country: string | null;
  cargo_description: string | null;
  cargo_weight: number | null;
  weight_unit: string | null;
  cargo_length: number | null;
  cargo_width: number | null;
  cargo_height: number | null;
  dimension_unit: string | null;
  number_of_pieces: number | null;
  service_type: string | null;
  hazardous_material: boolean | null;
  quote_status: string | null;
  initial_quote_amount: number | null;
  final_agreed_price: number | null;
  created_at: string;
}

export interface QuoteMatch {
  match_id: number;
  source_quote_id: number;
  matched_quote_id: number;
  similarity_score: number;
  match_criteria: Record<string, number>;
  suggested_price: number | null;
  price_confidence: number | null;
  match_algorithm_version: string;
  created_at: string;
  matched_quote?: ShippingQuote;
}

export interface QuoteMatchFeedback {
  feedback_id: number;
  match_id: number;
  user_id: string | null;
  rating: number;
  feedback_reason: string | null;
  feedback_notes: string | null;
  actual_price_used: number | null;
  created_at: string;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  lastModifiedDateTime: string;
    distanceMiles?: number | null;
}

export interface EmailWithQuotes extends ShippingEmail {
  quotes: QuoteWithMatches[];
}

export interface QuoteWithMatches extends ShippingQuote {
  matches: QuoteMatch[];
  top_suggested_price: number | null;
  avg_suggested_price: number | null;
}

export interface PaginatedEmailsResponse {
  emails: ShippingEmail[];
  totalCount: number;
  totalPages: number;
  currentPage: number;
  limit: number;
  offset: number;
  minDate: string;
}
