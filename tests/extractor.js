import { getLatestLastReceivedDateTime } from "../src/config/db.js";
import emailExtractorService from "../src/services/mail/emailExtractor.js";

const extractMails = async () => {
  const startDate = await getLatestLastReceivedDateTime();
  console.log(`Starting extraction at ${new Date().toISOString()}`);
  // Build job data with incremental processing parameters
  const jobData = {
    maxEmails: 500,
    startDate: startDate ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    scoreThreshold: 30,
    previewMode: false,
  }; 

  const results = await emailExtractorService.processEmails(jobData);
  console.log(`Extraction completed at ${new Date().toISOString()}`);
  console.log(`Processed ${results.processed} emails, fetched ${results.fetched} emails.`);
};

for (let index = 0; index < 10; index++) {
  await extractMails();
}
