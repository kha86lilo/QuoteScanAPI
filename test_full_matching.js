/**
 * Full Integration Test for Enhanced Quote Matching
 * Tests the complete flow from quote analysis to pricing suggestion
 */

import * as db from './src/config/db.js';
import {
  processEnhancedMatches,
  findEnhancedMatches,
  generatePricingPrompt,
  normalizeServiceType,
  classifyCargo,
  getUSRegion,
  getWeightRange,
} from './src/services/enhancedQuoteMatchingService.js';

async function runFullTest() {
  console.log('\n' + '='.repeat(80));
  console.log('FULL INTEGRATION TEST - ENHANCED QUOTE MATCHING');
  console.log('='.repeat(80));

  try {
    // Test Case 1: Drayage from Savannah to Midwest
    console.log('\n📦 TEST CASE 1: Drayage - Savannah to Chicago');
    console.log('-'.repeat(50));

    const testQuote1 = {
      quote_id: -1,
      origin_city: 'Savannah',
      origin_state_province: 'GA',
      origin_country: 'USA',
      destination_city: 'Chicago',
      destination_state_province: 'IL',
      destination_country: 'USA',
      service_type: 'Drayage',
      cargo_description: 'CAT 320 Excavator - 40ft flat rack',
      cargo_weight: 65000,
      weight_unit: 'lbs',
      number_of_pieces: 1,
      hazardous_material: false,
    };

    console.log('Input:');
    console.log(`  Route: ${testQuote1.origin_city}, ${testQuote1.origin_state_province} → ${testQuote1.destination_city}, ${testQuote1.destination_state_province}`);
    console.log(`  Service: ${testQuote1.service_type} → Normalized: ${normalizeServiceType(testQuote1.service_type)}`);
    console.log(`  Cargo: ${testQuote1.cargo_description} → Category: ${classifyCargo(testQuote1.cargo_description)}`);
    console.log(`  Weight: ${testQuote1.cargo_weight} ${testQuote1.weight_unit} → Range: ${getWeightRange(testQuote1.cargo_weight, testQuote1.weight_unit)?.label}`);
    console.log(`  Origin Region: ${getUSRegion(testQuote1.origin_city, testQuote1.origin_state_province)}`);
    console.log(`  Dest Region: ${getUSRegion(testQuote1.destination_city, testQuote1.destination_state_province)}`);

    // Get historical quotes
    const historicalQuotes = await db.getHistoricalQuotesForMatching([], {
      limit: 500,
      onlyWithPrice: true,
    });

    // Filter for quotes with actual pricing
    const quotesWithRealPricing = historicalQuotes.filter(q =>
      (q.initial_quote_amount && q.initial_quote_amount > 100) ||
      (q.final_agreed_price && q.final_agreed_price > 100)
    );

    console.log(`\nHistorical data: ${historicalQuotes.length} total, ${quotesWithRealPricing.length} with pricing > $100`);

    const matches1 = findEnhancedMatches(testQuote1, quotesWithRealPricing, { minScore: 0.35, maxMatches: 5 });

    console.log(`\nFound ${matches1.length} matches:`);
    matches1.forEach((m, i) => {
      console.log(`\n  ${i + 1}. Quote #${m.matchedQuoteId} - Score: ${(m.similarityScore * 100).toFixed(1)}%`);
      console.log(`     Route: ${m.matchedQuoteData.origin} → ${m.matchedQuoteData.destination}`);
      console.log(`     Service: ${m.matchedQuoteData.service}`);
      console.log(`     Cargo: ${(m.matchedQuoteData.cargo || 'N/A').substring(0, 50)}`);
      console.log(`     Initial: $${m.matchedQuoteData.initialPrice?.toLocaleString() || 'N/A'} | Final: $${m.matchedQuoteData.finalPrice?.toLocaleString() || 'N/A'}`);
      console.log(`     Suggested: $${m.suggestedPrice?.toLocaleString() || 'N/A'} (Confidence: ${(m.priceConfidence * 100).toFixed(0)}%)`);
      console.log(`     Key criteria: Origin Region=${m.matchCriteria.origin_region}, Dest Region=${m.matchCriteria.destination_region}, Service=${m.matchCriteria.service_type}`);
    });

    // Test Case 2: Ocean Freight - Houston to Asia
    console.log('\n\n📦 TEST CASE 2: Ocean Freight - Houston to Vietnam');
    console.log('-'.repeat(50));

    const testQuote2 = {
      quote_id: -2,
      origin_city: 'Houston',
      origin_state_province: 'TX',
      origin_country: 'USA',
      destination_city: 'Haiphong',
      destination_state_province: null,
      destination_country: 'Vietnam',
      service_type: 'Ocean',
      cargo_description: 'Komatsu Dozer machines',
      cargo_weight: 45000,
      weight_unit: 'lbs',
      number_of_pieces: 2,
      hazardous_material: false,
    };

    console.log('Input:');
    console.log(`  Route: ${testQuote2.origin_city}, ${testQuote2.origin_country} → ${testQuote2.destination_city}, ${testQuote2.destination_country}`);
    console.log(`  Service: ${testQuote2.service_type} → Normalized: ${normalizeServiceType(testQuote2.service_type)}`);
    console.log(`  Cargo: ${testQuote2.cargo_description} → Category: ${classifyCargo(testQuote2.cargo_description)}`);

    const matches2 = findEnhancedMatches(testQuote2, quotesWithRealPricing, { minScore: 0.35, maxMatches: 5 });

    console.log(`\nFound ${matches2.length} matches:`);
    matches2.forEach((m, i) => {
      console.log(`\n  ${i + 1}. Quote #${m.matchedQuoteId} - Score: ${(m.similarityScore * 100).toFixed(1)}%`);
      console.log(`     Route: ${m.matchedQuoteData.origin} → ${m.matchedQuoteData.destination}`);
      console.log(`     Service: ${m.matchedQuoteData.service}`);
      console.log(`     Suggested: $${m.suggestedPrice?.toLocaleString() || 'N/A'}`);
    });

    // Test Case 3: Ground FTL - Domestic
    console.log('\n\n📦 TEST CASE 3: Ground FTL - New York to Los Angeles');
    console.log('-'.repeat(50));

    const testQuote3 = {
      quote_id: -3,
      origin_city: 'Newark',
      origin_state_province: 'NJ',
      origin_country: 'USA',
      destination_city: 'Los Angeles',
      destination_state_province: 'CA',
      destination_country: 'USA',
      service_type: 'Ground',
      cargo_description: 'General freight - palletized goods',
      cargo_weight: 35000,
      weight_unit: 'lbs',
      number_of_pieces: 20,
      hazardous_material: false,
    };

    console.log('Input:');
    console.log(`  Route: ${testQuote3.origin_city}, ${testQuote3.origin_state_province} → ${testQuote3.destination_city}, ${testQuote3.destination_state_province}`);
    console.log(`  Service: ${testQuote3.service_type} → Normalized: ${normalizeServiceType(testQuote3.service_type)}`);
    console.log(`  Cargo: ${testQuote3.cargo_description} → Category: ${classifyCargo(testQuote3.cargo_description)}`);

    const matches3 = findEnhancedMatches(testQuote3, quotesWithRealPricing, { minScore: 0.35, maxMatches: 5 });

    console.log(`\nFound ${matches3.length} matches:`);
    matches3.forEach((m, i) => {
      console.log(`\n  ${i + 1}. Quote #${m.matchedQuoteId} - Score: ${(m.similarityScore * 100).toFixed(1)}%`);
      console.log(`     Route: ${m.matchedQuoteData.origin} → ${m.matchedQuoteData.destination}`);
      console.log(`     Service: ${m.matchedQuoteData.service}`);
      console.log(`     Suggested: $${m.suggestedPrice?.toLocaleString() || 'N/A'}`);
    });

    // Generate a pricing prompt for the first test case
    console.log('\n\n📝 GENERATED PRICING PROMPT (for Test Case 1):');
    console.log('-'.repeat(50));
    const prompt = generatePricingPrompt(testQuote1, matches1);
    console.log(prompt.substring(0, 1500) + '...\n[truncated]');

    // Summary statistics
    console.log('\n\n📊 HISTORICAL DATA SUMMARY');
    console.log('-'.repeat(50));

    const serviceBreakdown = {};
    quotesWithRealPricing.forEach(q => {
      const svc = normalizeServiceType(q.service_type);
      if (!serviceBreakdown[svc]) {
        serviceBreakdown[svc] = { count: 0, totalPrice: 0, prices: [] };
      }
      const price = q.final_agreed_price || q.initial_quote_amount;
      serviceBreakdown[svc].count++;
      serviceBreakdown[svc].totalPrice += price;
      serviceBreakdown[svc].prices.push(price);
    });

    console.log('\nPricing by Service Type:');
    Object.entries(serviceBreakdown).sort((a, b) => b[1].count - a[1].count).forEach(([svc, data]) => {
      const avgPrice = data.totalPrice / data.count;
      const minPrice = Math.min(...data.prices);
      const maxPrice = Math.max(...data.prices);
      console.log(`  ${svc}: ${data.count} quotes, Avg: $${Math.round(avgPrice).toLocaleString()}, Range: $${Math.round(minPrice).toLocaleString()} - $${Math.round(maxPrice).toLocaleString()}`);
    });

    console.log('\n' + '='.repeat(80));
    console.log('TESTS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await db.pool.end();
  }
}

runFullTest();
