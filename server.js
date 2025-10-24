require('dotenv').config();

const express = require('express');
const app = express();

// Middleware
app.use(express.json());

// Routes
const authRoutes = require('./routes/auth');       // Auth: register, login, logout
const searchRoutes = require('./routes/search');   // Search: save/search
const testRoute = require('./routes/test');        // Optional test route
const userRoutes = require('./routes/user');       // User: profile, api-key, usage

// Mount routes
app.use('/api/auth', authRoutes);     // /api/auth/login, /api/auth/register, etc.
app.use('/api/search', searchRoutes); // /api/search/save, /api/search/saved, etc.
app.use('/api/test', testRoute);      // /api/test or whatever test endpoints you have
app.use('/api/user', userRoutes);     // /api/user/profile, /api/user/api-key, etc.

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
