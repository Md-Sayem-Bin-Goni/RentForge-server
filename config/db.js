const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

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
const authUserCollection = db.collection('user');
const equipmentCollection = db.collection('equipment');
const bookingsCollection = db.collection('bookings');
const paymentsCollection = db.collection('payments');
const favoritesCollection = db.collection('favorites');

module.exports = {
  client,
  db,
  ObjectId,
  usersCollection,
  authUserCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
  favoritesCollection,
};
