/**
 * Quote Analysis Script
 * Analyzes the last 20 quotes to assess AI parsing accuracy and confidence
 */

import * as db from './src/config/db.js';
import dotenv from 'dotenv';

dotenv.config();

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
};

async function analyzeLast20Quotes() {
  console.log(`\n${colors.bright}${colors.cyan}========================================`);
  console.log('📊 QUOTE PARSING ANALYSIS REPORT');
  console.log(`========================================${colors.reset}\n`);

  try {
    const client = await db.pool.connect();

    try {
      // Query last 20 quotes with email details
      const result = await client.query(`
        SELECT
          q.*,
          e.email_message_id,
          e.email_subject,
          e.email_received_date,
          e.email_sender_name,
          e.email_sender_email,
          e.email_body_preview,
          e.email_has_attachments,
          e.processed_at,
          e.ai_confidence_score,
          e.conversation_id,
          e.job_id
        FROM shipping_quotes q
        INNER JOIN shipping_emails e ON q.email_id = e.email_id
        ORDER BY q.created_at DESC
        LIMIT 20
      `);

      const quotes = result.rows;

      if (quotes.length === 0) {
        console.log(`${colors.yellow}⚠ No quotes found in database.${colors.reset}\n`);
        console.log('Run the email processing first to generate quotes.\n');
        return;
      }

      console.log(`${colors.green}✓ Found ${quotes.length} quotes${colors.reset}\n`);

      // Calculate statistics
      const stats = calculateStatistics(quotes);
      displayStatistics(stats);

      // Analyze individual quotes
      console.log(`\n${colors.bright}${colors.cyan}DETAILED QUOTE ANALYSIS:${colors.reset}\n`);
      analyzeQuotes(quotes);

      // Field population analysis
      console.log(`\n${colors.bright}${colors.cyan}FIELD POPULATION ANALYSIS:${colors.reset}\n`);
      analyzeFieldPopulation(quotes);

      // Recommendations
      console.log(`\n${colors.bright}${colors.cyan}RECOMMENDATIONS:${colors.reset}\n`);
      provideRecommendations(stats, quotes);

    } finally {
      client.release();
    }

    // Close the pool
    await db.pool.end();
    console.log(`\n${colors.green}✓ Analysis complete${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}✗ Error analyzing quotes:${colors.reset}`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

function calculateStatistics(quotes) {
  const confidenceScores = quotes
    .map((q) => q.ai_confidence_score)
    .filter((score) => score !== null && score !== undefined);

  const avgConfidence =
    confidenceScores.length > 0
      ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      : 0;

  const minConfidence = confidenceScores.length > 0 ? Math.min(...confidenceScores) : 0;
  const maxConfidence = confidenceScores.length > 0 ? Math.max(...confidenceScores) : 0;

  // Confidence distribution
  const highConfidence = confidenceScores.filter((s) => s >= 0.8).length;
  const mediumConfidence = confidenceScores.filter((s) => s >= 0.5 && s < 0.8).length;
  const lowConfidence = confidenceScores.filter((s) => s < 0.5).length;

  // Quote status distribution
  const statusCounts = {};
  quotes.forEach((q) => {
    const status = q.quote_status || 'Unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  // Has attachments
  const withAttachments = quotes.filter((q) => q.email_has_attachments).length;

  // Measurement units
  const metricUnits = quotes.filter(
    (q) =>
      q.weight_unit?.toLowerCase().includes('kg') ||
      q.weight_unit?.toLowerCase().includes('tonne') ||
      q.dimension_unit?.toLowerCase().includes('m')
  ).length;
  const imperialUnits = quotes.filter(
    (q) =>
      q.weight_unit?.toLowerCase().includes('lb') ||
      q.weight_unit?.toLowerCase().includes('ton') ||
      q.dimension_unit?.toLowerCase().includes('ft') ||
      q.dimension_unit?.toLowerCase().includes('in')
  ).length;

  // Overweight/Oversized
  const overweight = quotes.filter((q) => q.is_overweight === true).length;
  const oversized = quotes.filter((q) => q.is_oversized === true).length;

  return {
    total: quotes.length,
    avgConfidence: avgConfidence.toFixed(2),
    minConfidence: minConfidence.toFixed(2),
    maxConfidence: maxConfidence.toFixed(2),
    highConfidence,
    mediumConfidence,
    lowConfidence,
    statusCounts,
    withAttachments,
    metricUnits,
    imperialUnits,
    overweight,
    oversized,
  };
}

function displayStatistics(stats) {
  console.log(`${colors.bright}OVERALL STATISTICS:${colors.reset}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`Total Quotes Analyzed:     ${colors.bright}${stats.total}${colors.reset}`);
  console.log(`\n${colors.bright}CONFIDENCE SCORES:${colors.reset}`);
  console.log(`Average Confidence:        ${getConfidenceColor(stats.avgConfidence)}${(stats.avgConfidence * 100).toFixed(0)}%${colors.reset}`);
  console.log(`Min Confidence:            ${getConfidenceColor(stats.minConfidence)}${(stats.minConfidence * 100).toFixed(0)}%${colors.reset}`);
  console.log(`Max Confidence:            ${getConfidenceColor(stats.maxConfidence)}${(stats.maxConfidence * 100).toFixed(0)}%${colors.reset}`);
  console.log(`\n${colors.bright}CONFIDENCE DISTRIBUTION:${colors.reset}`);
  console.log(`High (≥80%):               ${colors.green}${stats.highConfidence} quotes${colors.reset}`);
  console.log(`Medium (50-79%):           ${colors.yellow}${stats.mediumConfidence} quotes${colors.reset}`);
  console.log(`Low (<50%):                ${colors.red}${stats.lowConfidence} quotes${colors.reset}`);

  console.log(`\n${colors.bright}QUOTE STATUS BREAKDOWN:${colors.reset}`);
  Object.entries(stats.statusCounts).forEach(([status, count]) => {
    console.log(`${status.padEnd(25)} ${count} quotes`);
  });

  console.log(`\n${colors.bright}ADDITIONAL INSIGHTS:${colors.reset}`);
  console.log(`Emails with Attachments:   ${stats.withAttachments}/${stats.total} (${((stats.withAttachments / stats.total) * 100).toFixed(0)}%)`);
  console.log(`Metric System:             ${stats.metricUnits} quotes`);
  console.log(`Imperial System:           ${stats.imperialUnits} quotes`);
  console.log(`Overweight Cargo:          ${colors.yellow}${stats.overweight} quotes${colors.reset}`);
  console.log(`Oversized Cargo:           ${colors.yellow}${stats.oversized} quotes${colors.reset}`);
}

function getConfidenceColor(score) {
  if (score >= 0.8) return colors.green;
  if (score >= 0.5) return colors.yellow;
  return colors.red;
}

function analyzeQuotes(quotes) {
  quotes.slice(0, 10).forEach((quote, index) => {
    console.log(`${colors.bright}Quote #${index + 1}${colors.reset} (ID: ${quote.quote_id})`);
    console.log(`${'─'.repeat(50)}`);
    console.log(`Subject:           ${quote.email_subject?.substring(0, 50) || 'N/A'}...`);
    console.log(`Sender:            ${quote.email_sender_name || 'N/A'} <${quote.email_sender_email || 'N/A'}>`);
    console.log(`Client:            ${quote.client_company_name || 'Not extracted'}`);
    console.log(`Confidence:        ${getConfidenceColor(quote.ai_confidence_score)}${((quote.ai_confidence_score || 0) * 100).toFixed(0)}%${colors.reset}`);
    console.log(`Quote Status:      ${quote.quote_status || 'Not set'}`);

    // Route
    const origin = [quote.origin_city, quote.origin_state_province, quote.origin_country]
      .filter(Boolean)
      .join(', ');
    const dest = [quote.destination_city, quote.destination_state_province, quote.destination_country]
      .filter(Boolean)
      .join(', ');
    console.log(`Route:             ${origin || 'N/A'} → ${dest || 'N/A'}`);

    // Cargo details
    const dimensions =
      quote.cargo_length && quote.cargo_width && quote.cargo_height
        ? `${quote.cargo_length} × ${quote.cargo_width} × ${quote.cargo_height} ${quote.dimension_unit || ''}`
        : 'Not provided';
    const weight = quote.cargo_weight
      ? `${quote.cargo_weight} ${quote.weight_unit || ''}`
      : 'Not provided';

    console.log(`Cargo:             ${quote.cargo_description?.substring(0, 40) || 'N/A'}...`);
    console.log(`Dimensions:        ${dimensions}`);
    console.log(`Weight:            ${weight}`);

    // Flags
    const flags = [];
    if (quote.is_overweight) flags.push('🔴 Overweight');
    if (quote.is_oversized) flags.push('📏 Oversized');
    if (quote.hazardous_material) flags.push('☢️ Hazmat');
    if (quote.requires_permits) flags.push('📋 Permits');
    if (flags.length > 0) {
      console.log(`Flags:             ${flags.join(', ')}`);
    }

    // Pricing
    if (quote.initial_quote_amount) {
      console.log(
        `Pricing:           $${quote.initial_quote_amount} ${quote.final_agreed_price ? `→ $${quote.final_agreed_price} (final)` : ''}`
      );
    }

    console.log('');
  });

  if (quotes.length > 10) {
    console.log(
      `${colors.cyan}... and ${quotes.length - 10} more quotes (showing first 10)${colors.reset}\n`
    );
  }
}

function analyzeFieldPopulation(quotes) {
  const criticalFields = [
    'client_company_name',
    'contact_person_name',
    'email_address',
    'origin_city',
    'origin_state_province',
    'destination_city',
    'destination_state_province',
    'cargo_weight',
    'weight_unit',
    'cargo_length',
    'cargo_width',
    'cargo_height',
    'dimension_unit',
    'quote_status',
    'service_type',
  ];

  const fieldStats = {};

  criticalFields.forEach((field) => {
    const populated = quotes.filter(
      (q) => q[field] !== null && q[field] !== undefined && q[field] !== ''
    ).length;
    const percentage = ((populated / quotes.length) * 100).toFixed(0);
    fieldStats[field] = { populated, percentage };
  });

  // Sort by population rate
  const sorted = Object.entries(fieldStats).sort((a, b) => b[1].percentage - a[1].percentage);

  console.log(`${colors.bright}Critical Field Population Rates:${colors.reset}`);
  console.log(`${'─'.repeat(60)}`);

  sorted.forEach(([field, stats]) => {
    const color = stats.percentage >= 80 ? colors.green : stats.percentage >= 50 ? colors.yellow : colors.red;
    const bar = '█'.repeat(Math.floor(stats.percentage / 5));
    console.log(
      `${field.padEnd(30)} ${color}${stats.percentage}%${colors.reset} ${bar} (${stats.populated}/${quotes.length})`
    );
  });
}

function provideRecommendations(stats, quotes) {
  const recommendations = [];

  if (parseFloat(stats.avgConfidence) < 0.7) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset} Average confidence is below 70%. Consider:\n  - Reviewing the AI prompt for clarity\n  - Checking if emails contain sufficient information\n  - Verifying email body retrieval is working (not just preview)`
    );
  }

  if (stats.lowConfidence > stats.total * 0.3) {
    recommendations.push(
      `${colors.red}✗${colors.reset} ${((stats.lowConfidence / stats.total) * 100).toFixed(0)}% of quotes have low confidence (<50%).\n  - Manually review these quotes for accuracy\n  - Identify common patterns in low-confidence quotes\n  - Consider improving pre-filtering to exclude unclear emails`
    );
  }

  if (stats.highConfidence > stats.total * 0.5) {
    recommendations.push(
      `${colors.green}✓${colors.reset} ${((stats.highConfidence / stats.total) * 100).toFixed(0)}% of quotes have high confidence (≥80%)! AI is performing well.`
    );
  }

  // Check for quotes with status "Pending"
  const pendingCount = stats.statusCounts['Pending'] || 0;
  if (pendingCount > 0) {
    recommendations.push(
      `${colors.cyan}ℹ${colors.reset} ${pendingCount} quotes are marked as "Pending". These may need follow-up.`
    );
  }

  // Check measurement systems
  if (stats.metricUnits > 0) {
    recommendations.push(
      `${colors.cyan}ℹ${colors.reset} ${stats.metricUnits} quotes use metric units. Verify these are stored correctly without conversion.`
    );
  }

  // Check overweight/oversized
  if (stats.overweight > 0 || stats.oversized > 0) {
    recommendations.push(
      `${colors.yellow}⚠${colors.reset} ${stats.overweight} overweight and ${stats.oversized} oversized shipments detected. Verify permit requirements are captured.`
    );
  }

  if (recommendations.length === 0) {
    recommendations.push(`${colors.green}✓${colors.reset} No major issues detected. System is performing well!`);
  }

  recommendations.forEach((rec) => console.log(rec + '\n'));
}

// Run the analysis
analyzeLast20Quotes().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
