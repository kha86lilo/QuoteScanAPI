import { processEnhancedMatches } from '../src/services/enhancedQuoteMatchingService.js';
import * as db from '../src/config/db.js';

async function test() {
  const quoteIdRaw = process.argv[2];
  const quoteId = Number(quoteIdRaw ?? '469');
  const useAI = !process.argv.includes('--no-ai');
  const maxMatchesArg = process.argv.find(a => a.startsWith('--maxMatches='));
  const maxMatches = maxMatchesArg ? Number(maxMatchesArg.split('=')[1]) : 10;

  if (!Number.isFinite(quoteId) || quoteId <= 0) {
    console.error('Usage: npx tsx scripts/test_single_quote.ts <quoteId> [--no-ai] [--maxMatches=10]');
    process.exit(1);
  }

  console.log(`Testing Quote ${quoteId}...`);

  // Print structured quote fields (helps diagnose pricing outliers)
  try {
    const quote = await db.getQuoteForMatching(quoteId);
    if (quote) {
      console.log('\n=== QUOTE DATA ===');
      console.log({
        quote_id: quote.quote_id,
        service_type: quote.service_type,
        service_level: quote.service_level,
        origin: [quote.origin_city, quote.origin_state_province, quote.origin_country].filter(Boolean).join(', '),
        destination: [quote.destination_city, quote.destination_state_province, quote.destination_country].filter(Boolean).join(', '),
        cargo_description: quote.cargo_description,
        cargo_weight: quote.cargo_weight,
        weight_unit: quote.weight_unit,
        cargo_length: quote.cargo_length,
        cargo_width: quote.cargo_width,
        cargo_height: quote.cargo_height,
        dimension_unit: quote.dimension_unit,
        number_of_pieces: quote.number_of_pieces,
        packaging_type: quote.packaging_type,
        hazardous_material: quote.hazardous_material,
      });
    }
  } catch (e) {
    console.log('Quote data lookup failed:', (e as Error).message);
  }

  const result = await processEnhancedMatches([quoteId], { useAI, minScore: 0.3, maxMatches });

  const detail = result.matchDetails?.[0];
  console.log('\n=== RESULT ===');
  console.log('Processed:', result.processed);
  console.log('Matches created:', result.matchesCreated);
  console.log('Suggested Price:', detail?.suggestedPrice);
  console.log('Best Score:', detail?.bestScore);
  console.log('AI Pricing:', detail?.aiPricing);

  try {
    const matches = await db.getMatchesForQuote(quoteId, { limit: maxMatches, minScore: 0 });
    if (matches.length) {
      console.log(`\n=== TOP ${Math.min(maxMatches, matches.length)} MATCHES ===`);
      for (const m of matches) {
        console.log({
          matched_quote_id: m.matched_quote_id,
          similarity_score: Number(m.similarity_score).toFixed(4),
          suggested_price: m.suggested_price,
          matched_service_type: m.service_type,
          matched_cargo: (m.cargo_description || '').toString().slice(0, 80),
          matched_weight: m.cargo_weight,
          matched_weight_unit: m.weight_unit,
          matched_initial_quote_amount: m.initial_quote_amount,
          matched_final_agreed_price: m.final_agreed_price,
          feedback_count: m.feedback_count,
          avg_rating: m.avg_rating,
        });
      }
    }
  } catch (e) {
    console.log('Match lookup failed:', (e as Error).message);
  }

  process.exit(0);
}

test().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
