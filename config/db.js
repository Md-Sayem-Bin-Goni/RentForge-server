const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = process.env.MONGODB_URI;

// Cached / Singleton MongoClient across serverless invocations
let client;
if (uri && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://'))) {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      maxPoolSize: 10,
    });
  }
  client = global._mongoClient;
} else {
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient('mongodb://localhost:27017');
  }
  client = global._mongoClient;
}

// Database & Collections
const db = client.db('rentforgeDB');
const usersCollection = db.collection('users');
const authUserCollection = db.collection('user');
const equipmentCollection = db.collection('equipment');
const bookingsCollection = db.collection('bookings');
const paymentsCollection = db.collection('payments');
const favoritesCollection = db.collection('favorites');

let cachedDb = null;
let clientPromise = null;

/**
 * Cached/singleton connectDB helper using MongoClient.
 * Awaits the active MongoDB connection and reuses across serverless invocations.
 */
async function connectDB() {
  if (cachedDb && client && client.topology && !client.topology.isDestroyed()) {
    return { client, db: cachedDb };
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri || (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://'))) {
    return { client, db };
  }

  if (!client || (client.topology && client.topology.isDestroyed())) {
    client = new MongoClient(mongoUri, {
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

  if (!clientPromise) {
    clientPromise = client.connect().then((c) => {
      cachedDb = c.db('rentforgeDB');
      return c;
    }).catch((err) => {
      clientPromise = null;
      throw err;
    });
  }

  const c = await clientPromise;
  cachedDb = c.db('rentforgeDB');
  return { client: c, db: cachedDb };
}

module.exports = {
  client,
  db,
  connectDB,
  ObjectId,
  usersCollection,
  authUserCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
};
