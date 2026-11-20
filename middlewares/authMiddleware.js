const jwt = require('jsonwebtoken');
const { usersCollection } = require('../config/db');

/**
 * Middleware to verify JWT token from Authorization header.
 * Expected format: Authorization: Bearer <token>
 */
const verifyToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: 'Unauthorized access: No token provided' });
  }

  const token = authorization.startsWith('Bearer ')
    ? authorization.split(' ')[1]
    : authorization;

  if (!token) {
    return res.status(401).send({ message: 'Unauthorized access: Invalid token format' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: 'Unauthorized access: Invalid or expired token' });
    }
    req.decoded = decoded;
    req.user = decoded;
    next();
  });
};

/**
 * Middleware to check if authenticated user role === 'customer'
 */
const verifyRenter = async (req, res, next) => {
  try {
    const email = req.decoded?.email || req.user?.email;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    if (!user || user.role !== 'customer') {
      return res.status(403).send({ message: 'Forbidden access: Customer role required' });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    res.status(500).send({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Middleware to check if authenticated user role === 'owner'
 */
const verifyOwner = async (req, res, next) => {
  try {
    const email = req.decoded?.email || req.user?.email;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    if (!user || user.role !== 'owner') {
      return res.status(403).send({ message: 'Forbidden access: Owner role required' });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    res.status(500).send({ message: 'Internal server error', error: error.message });
  }
};

/**
 * Middleware to check if authenticated user role === 'admin'
 */
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded?.email || req.user?.email;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    if (!user || user.role !== 'admin') {
      return res.status(403).send({ message: 'Forbidden access: Admin role required' });
    }

    req.currentUser = user;
    next();
  } catch (error) {
    res.status(500).send({ message: 'Internal server error', error: error.message });
  }
};

module.exports = {
  verifyToken,
  verifyRenter,
  verifyOwner,
  verifyAdmin,
};
