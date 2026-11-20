require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// CORS configuration (allowing CLIENT_URL with credentials)
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : [process.env.CLIENT_URL || 'http://localhost:3000'],
    credentials: true,
  })
);

app.use(express.json());

// MongoDB Connection
const uri = process.env.MONGODB_URI;

const client = new MongoClient(
  uri && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'))
    ? uri
    : 'mongodb://localhost:27017',
  {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  }
);

// Database & Collections
const db = client.db('rentforgeDB');
const usersCollection = db.collection('users');
const equipmentCollection = db.collection('equipment');
const bookingsCollection = db.collection('bookings');
const paymentsCollection = db.collection('payments');
const favoritesCollection = db.collection('favorites');

async function run() {
  try {
    if (uri && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'))) {
      await client.connect();
      console.log('Successfully connected to MongoDB database: rentforgeDB');
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

// Start Server
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`RentForge Server is running on port ${port}`);
  });
}

module.exports = {
  app,
  client,
  db,
  usersCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
};
