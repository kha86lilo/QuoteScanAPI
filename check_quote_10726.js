const sql = require('mssql');

const config = {
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'Banana123',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'CHABORERN',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};

async function checkQuote() {
  try {
    const pool = await sql.connect(config);
    
    // Get the quote details
    console.log('=== QUOTE DETAILS ===');
    const quote = await pool.request()
      .input('quoteId', sql.Int, 10726)
      .query(`SELECT * FROM shipping_quotes WHERE id = @quoteId`);
    console.log(JSON.stringify(quote.recordset[0], null, 2));
    
    // Get the matches
    console.log('\n=== QUOTE MATCHES ===');
    const matches = await pool.request()
      .input('quoteId', sql.Int, 10726)
      .query(`SELECT * FROM quote_matches WHERE quote_id = @quoteId ORDER BY similarity_score DESC`);
    console.log(JSON.stringify(matches.recordset, null, 2));
    
    // Get the feedback
    console.log('\n=== QUOTE FEEDBACK ===');
    const feedback = await pool.request()
      .input('quoteId', sql.Int, 10726)
      .query(`SELECT * FROM quote_feedback WHERE quote_id = @quoteId`);
    console.log(JSON.stringify(feedback.recordset, null, 2));
    
    // Get AI pricing if exists
    console.log('\n=== AI PRICING ===');
    const aiPricing = await pool.request()
      .input('quoteId', sql.Int, 10726)
      .query(`SELECT * FROM ai_pricing WHERE quote_id = @quoteId`);
    console.log(JSON.stringify(aiPricing.recordset, null, 2));
    
    await pool.close();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkQuote();
