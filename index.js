const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { ServerApiVersion } = require('mongodb');

let {
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

// Cached / Singleton connection state across Vercel serverless requests
let cachedDb = null;
let clientPromise = null;
let hasCheckedSeed = false;

/**
 * Cached/singleton connectDB() async helper using MongoClient.
 * Awaits the active MongoDB connection before querying any collection.
 * Reconnects automatically if topology was closed or destroyed.
 */
async function connectDB() {
  // If active connection already established and healthy, return cached instance immediately
  if (cachedDb && client && client.topology && !client.topology.isDestroyed()) {
    return { client, db: cachedDb };
  }

  const uri = process.env.MONGODB_URI;
  if (!uri || (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://'))) {
    console.warn('MongoDB URI is not configured or has an invalid scheme');
    return { client, db };
  }

  // If client does not exist or topology was destroyed, recreate client
  if (!client || (client.topology && client.topology.isDestroyed())) {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      maxPoolSize: 10,
    });
    global._mongoClient = client;
    clientPromise = null;
  }

  // Ensure singleton connection promise
  if (!clientPromise) {
    clientPromise = client.connect().then(async (connectedClient) => {
      console.log('Successfully connected to MongoDB database: rentforgeDB');
      cachedDb = connectedClient.db('rentforgeDB');

      // Update local collection references to active DB
      db = cachedDb;
      usersCollection = db.collection('users');
      authUserCollection = db.collection('user');
      equipmentCollection = db.collection('equipment');
      bookingsCollection = db.collection('bookings');
      paymentsCollection = db.collection('payments');
      favoritesCollection = db.collection('favorites');

      if (!hasCheckedSeed) {
        hasCheckedSeed = true;
        try {
          await seedEquipmentIfNeeded();
        } catch (seedErr) {
          console.warn('Seed equipment check notice:', seedErr.message);
        }
      }

      return connectedClient;
    }).catch((err) => {
      clientPromise = null;
      cachedDb = null;
      throw err;
    });
  }

  const connectedClient = await clientPromise;
  cachedDb = connectedClient.db('rentforgeDB');
  return { client: connectedClient, db: cachedDb };
}

// CORS configuration (allowing client origins with credentials)
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://rent-forge-client.vercel.app',
  'https://rentforge-client.vercel.app',
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.includes('localhost') ||
        origin.endsWith('.vercel.app') ||
        origin === 'https://rent-forge-client.vercel.app'
      ) {
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

// Normalize double slashes in incoming URLs (e.g. //api/equipment -> /api/equipment)
app.use((req, res, next) => {
  if (req.url && req.url.includes('//')) {
    req.url = req.url.replace(/\/{2,}/g, '/');
  }
  next();
});

// Middleware: Every incoming API request awaits the active MongoDB connection before querying any collection
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection error on incoming request:', error.message);
    if (req.path === '/' || req.path === '/favicon.ico') {
      return next();
    }
    return res.status(500).json({
      message: 'Failed to establish database connection',
      error: error.message,
    });
  }
});

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

// Start Server (only when run directly, not during require/tests/vercel)
if (require.main === module) {
  app.listen(port, () => {
    console.log(`RentForge Server is running on port ${port}`);
  });
}

// Export app at the bottom
module.exports = app;

// Attach helper references for backwards compatibility with tests and tooling
module.exports.app = app;
module.exports.connectDB = connectDB;
module.exports.client = client;
module.exports.db = db;
module.exports.ObjectId = ObjectId;
module.exports.usersCollection = usersCollection;
module.exports.authUserCollection = authUserCollection;
module.exports.equipmentCollection = equipmentCollection;
module.exports.bookingsCollection = bookingsCollection;
module.exports.paymentsCollection = paymentsCollection;
module.exports.favoritesCollection = favoritesCollection;
