/**
 * Main Router Index
 * Aggregates and exports all route modules
 */

import express from 'express';
import emailRoutes from './email.routes.js';
import quoteRoutes from './quote.routes.js';
import healthRoutes from './health.routes.js';

const router = express.Router();

// Mount routes
router.use('/emails', emailRoutes);
router.use('/quotes', quoteRoutes);
router.use('/health', healthRoutes);

export default router;
