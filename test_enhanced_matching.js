/**
 * Test script for Enhanced Quote Matching Service
 * Run: node test_enhanced_matching.js
 */

import * as enhancedService from './src/services/enhancedQuoteMatchingService.js';
import * as db from './src/config/db.js';

async function testEnhancedMatching() {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING ENHANCED QUOTE MATCHING SERVICE');
  console.log('='.repeat(70));

  try {
    // Test 1: Service Type Normalization
    console.log('\n📋 TEST 1: Service Type Normalization');
    console.log('-'.repeat(40));

    const serviceTests = [
      'Ground',
      'Drayage',
      'Ocean',
      'Ground/Drayage',
      'Intermodal (Ocean + Ground)',
      'Drayage, Transloading',
      'Ground, Transloading, Drayage, Ocean',
      'FTL trucking',
      'Container pickup',
    ];

    for (const svc of serviceTests) {
      console.log(`  "${svc}" → ${enhancedService.normalizeServiceType(svc)}`);
    }

    // Test 2: Cargo Classification
    console.log('\n📦 TEST 2: Cargo Classification');
    console.log('-'.repeat(40));

    const cargoTests = [
      'Excavator CAT 320',
      'JLG 1200 SJP Boom Lift',
      '40ft flat rack container with steel coils',
      'General freight on pallets',
      'Hazardous chemicals IMO class 3',
      'Farm equipment - John Deere tractor',
    ];

    for (const cargo of cargoTests) {
      console.log(`  "${cargo.substring(0, 40)}..." → ${enhancedService.classifyCargo(cargo)}`);
    }

    // Test 3: Region Detection
    console.log('\n🌍 TEST 3: Region Detection');
    console.log('-'.repeat(40));

    const locationTests = [
      { city: 'Savannah', state: 'GA', country: 'USA' },
      { city: 'Long Beach', state: 'CA', country: 'USA' },
      { city: 'Houston', state: 'TX', country: 'USA' },
      { city: 'Chicago', state: 'IL', country: 'USA' },
      { city: 'Shanghai', state: null, country: 'China' },
      { city: 'Antwerp', state: null, country: 'Belgium' },
    ];

    for (const loc of locationTests) {
      const usRegion = enhancedService.getUSRegion(loc.city, loc.state);
      const intlRegion = enhancedService.getIntlRegion(loc.country);
      console.log(`  ${loc.city}, ${loc.country} → US: ${usRegion || 'N/A'}, Intl: ${intlRegion}`);
    }

    // Test 4: Weight Range Classification
    console.log('\n⚖️ TEST 4: Weight Range Classification');
    console.log('-'.repeat(40));

    const weightTests = [
      { weight: 500, unit: 'lbs' },
      { weight: 5000, unit: 'kg' },
      { weight: 20, unit: 'tons' },
      { weight: 44000, unit: 'lbs' },
    ];

    for (const w of weightTests) {
      const range = enhancedService.getWeightRange(w.weight, w.unit);
      console.log(`  ${w.weight} ${w.unit} → ${range?.label || 'UNKNOWN'}`);
    }

    // Test 5: Actual Database Matching
    console.log('\n🔄 TEST 5: Database Matching Test');
    console.log('-'.repeat(40));

    // Get a sample of recent quotes to test matching
    const recentQuotes = await db.getHistoricalQuotesForMatching([], { limit: 10, onlyWithPrice: true });

    if (recentQuotes.length > 0) {
      console.log(`\nFound ${recentQuotes.length} quotes with pricing. Testing match on first quote...`);

      const testQuote = recentQuotes[0];
      console.log(`\nTest Quote #${testQuote.quote_id}:`);
      console.log(`  Route: ${testQuote.origin_city} → ${testQuote.destination_city}`);
      console.log(`  Service: ${testQuote.service_type}`);
      console.log(`  Cargo: ${(testQuote.cargo_description || 'N/A').substring(0, 50)}`);
      console.log(`  Price: $${testQuote.initial_quote_amount || testQuote.final_agreed_price}`);

      // Get other quotes excluding this one
      const otherQuotes = recentQuotes.filter(q => q.quote_id !== testQuote.quote_id);

      if (otherQuotes.length > 0) {
        const matches = enhancedService.findEnhancedMatches(testQuote, otherQuotes, { minScore: 0.3 });

        console.log(`\nFound ${matches.length} matches:`);
        matches.slice(0, 5).forEach((m, i) => {
          console.log(`\n  ${i + 1}. Quote #${m.matchedQuoteId} (Score: ${(m.similarityScore * 100).toFixed(1)}%)`);
          console.log(`     Route: ${m.matchedQuoteData.origin} → ${m.matchedQuoteData.destination}`);
          console.log(`     Service: ${m.matchedQuoteData.service}`);
          console.log(`     Suggested Price: $${m.suggestedPrice?.toLocaleString() || 'N/A'}`);
          console.log(`     Price Range: $${m.priceRange?.low?.toLocaleString()} - $${m.priceRange?.high?.toLocaleString()}`);
          console.log(`     Confidence: ${(m.priceConfidence * 100).toFixed(0)}%`);
          console.log(`     Match Criteria:`, JSON.stringify(m.matchCriteria, null, 2).split('\n').map(l => '     ' + l).join('\n'));
        });
      }
    } else {
      console.log('No quotes with pricing found in database.');
    }

    // Test 6: Generate Pricing Prompt
    console.log('\n📝 TEST 6: Pricing Prompt Generation');
    console.log('-'.repeat(40));

    const sampleQuote = {
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

    const sampleMatches = [
      {
        similarityScore: 0.85,
        matchedQuoteData: {
          origin: 'Savannah, USA',
          destination: 'Atlanta, USA',
          cargo: 'Excavator equipment',
          service: 'Drayage',
          initialPrice: 2500,
          finalPrice: 2200,
          quoteDate: new Date().toISOString(),
          status: 'Won',
        },
      },
    ];

    const prompt = enhancedService.generatePricingPrompt(sampleQuote, sampleMatches);
    console.log('\nGenerated Prompt Preview (first 500 chars):');
    console.log(prompt.substring(0, 500) + '...');

    console.log('\n' + '='.repeat(70));
    console.log('ALL TESTS COMPLETED');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await db.pool.end();
  }
}

testEnhancedMatching();
