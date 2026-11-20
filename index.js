require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const {
  client,
  db,
  ObjectId,
  usersCollection,
  authUserCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
} = require('./config/db');

const { seedEquipmentIfNeeded } = require('./config/seedEquipment');

const userRoutes = require('./routes/userRoutes');
const equipmentRoutes = require('./routes/equipmentRoutes');
const favoritesRoutes = require('./routes/favoritesRoutes');
const bookingPaymentRoutes = require('./routes/bookingPaymentRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');

const app = express();
const port = process.env.PORT || 5000;

// CORS configuration (allowing client origins with credentials)
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 || allowedOrigins.includes(origin) || origin.includes('localhost')) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);

app.use(express.json());

// Async DB Connection & Auto-Seed Check
async function run() {
  try {
    const uri = process.env.MONGODB_URI;
    if (uri && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'))) {
      await client.connect();
      console.log('Successfully connected to MongoDB database: rentforgeDB');
      // Auto seed equipment catalog if empty
      await seedEquipmentIfNeeded();
    } else {
      console.log('MongoDB client initialized for database: rentforgeDB');
    }
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
  }
}
run().catch(console.dir);

// Root Health Check Route
app.get('/', (req, res) => {
  res.send('RentForge Server is running');
});

// JWT Authentication Route
app.post('/api/jwt', (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).send({ message: 'Email is required' });
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: '7d',
    });

    res.send({ token });
  } catch (error) {
    res.status(500).send({ message: 'Failed to generate token', error: error.message });
  }
});

// User Routes
app.use('/api/users', userRoutes);
app.use('/users', userRoutes);

// Equipment & Admin Equipment Routes
app.use('/api/equipment', equipmentRoutes);
app.use('/equipment', equipmentRoutes);
app.use('/api/admin', equipmentRoutes);

// Dedicated Favorites Routes
app.use('/api/favorites', favoritesRoutes);
app.use('/favorites', favoritesRoutes);

// Booking & Payment Routes
app.use('/api/bookings', bookingPaymentRoutes);
app.use('/api/payments', bookingPaymentRoutes);
app.use('/bookings', bookingPaymentRoutes);
app.use('/payments', bookingPaymentRoutes);

// Analytics Routes
app.use('/api/analytics', analyticsRoutes);
app.use('/analytics', analyticsRoutes);

// Start Server (only when run directly, not during require/tests)
if (require.main === module) {
  app.listen(port, () => {
    console.log(`RentForge Server is running on port ${port}`);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.client = client;
module.exports.db = db;
module.exports.ObjectId = ObjectId;
module.exports.usersCollection = usersCollection;
module.exports.authUserCollection = authUserCollection;
module.exports.equipmentCollection = equipmentCollection;
module.exports.bookingsCollection = bookingsCollection;
module.exports.paymentsCollection = paymentsCollection;
module.exports.favoritesCollection = favoritesCollection;
