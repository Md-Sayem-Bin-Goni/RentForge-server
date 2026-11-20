require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const {
  client,
  db,
  ObjectId,
  usersCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
} = require('./config/db');

const userRoutes = require('./routes/userRoutes');

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

// Async DB Ping / Connection Check
async function run() {
  try {
    const uri = process.env.MONGODB_URI;
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

// User Routes
app.use('/api/users', userRoutes);
app.use('/users', userRoutes);

// Start Server (only when run directly, not during require/tests)
if (require.main === module) {
  app.listen(port, () => {
    console.log(`RentForge Server is running on port ${port}`);
  });
}

module.exports = {
  app,
  client,
  db,
  ObjectId,
  usersCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
};
