import * as microsoftGraphService from '../src/services/mail/microsoftGraphService.js';
import dotenv from 'dotenv';
dotenv.config();

const emails = await microsoftGraphService.default.fetchEmails({
  searchQuery: 'quote OR shipping OR freight OR cargo',
  top: 100,
  startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()
});

const external = emails.filter(e => {
  const domain = (e.from?.emailAddress?.address || '').split('@')[1];
  return domain !== 'seahorseexpress.com';
});

console.log('Total emails fetched:', emails.length);
console.log('External (client) emails:', external.length);
console.log('Internal (Seahorse) emails:', emails.length - external.length);
console.log('\nFirst 15 external client emails:');
external.slice(0, 15).forEach((e, i) => {
  console.log(`${i+1}. ${e.subject?.substring(0, 70) || 'No subject'}`);
  console.log(`   From: ${e.from?.emailAddress?.address}`);
  console.log(`   Has attachments: ${e.hasAttachments ? 'Yes' : 'No'}`);
});
