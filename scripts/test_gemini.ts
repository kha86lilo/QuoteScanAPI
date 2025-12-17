import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

async function testGemini() {
  console.log('Testing Gemini API...');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  
  // List available models first
  const apiKey = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json() as { models: Array<{ name: string; displayName: string }> };
  console.log('Available models:');
  for (const m of json.models.slice(0, 10)) {
    console.log(`  - ${m.name} (${m.displayName})`);
  }
  
  // Use gemini-2.0-flash which is available
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  
  try {
    const result = await model.generateContent('Say hello in 5 words or less');
    console.log('Response:', result.response.text());
    console.log('Gemini API is working!');
  } catch (err) {
    console.error('Error:', err);
  }
  
  process.exit(0);
}

testGemini();
