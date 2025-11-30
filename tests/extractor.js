const extractMails = async () => {
  const startDate = await getLatestLastReceivedDateTime();

  // Build job data with incremental processing parameters
  const jobData = {
    maxEmails: 1000,
    startDate: startDate ?? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    scoreThreshold: 30,
    previewMode: false,
  };
  
  const results = await emailExtractor.processEmails(jobData);
};
