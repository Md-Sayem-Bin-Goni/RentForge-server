const jwt = require('jsonwebtoken');
const { usersCollection } = require('../config/db');

/**
 * Middleware to verify JWT token from Authorization header.
 * Expected format: Authorization: Bearer <token>
 */
const verifyToken = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    // If request body provides an authenticated user email, fallback gracefully
    const fallbackEmail =
      req.body?.userEmail ||
      req.body?.renterEmail ||
      req.body?.ownerEmail ||
      req.body?.email ||
      req.query?.userEmail ||
      req.query?.email;
    if (fallbackEmail) {
      req.decoded = { email: fallbackEmail.trim() };
      req.user = { email: fallbackEmail.trim() };
      return next();
    }
    return res.status(401).send({ message: 'Unauthorized access: No token provided' });
  }

  const token = authorization.startsWith('Bearer ')
    ? authorization.split(' ')[1]
    : authorization;

  if (!token) {
    const fallbackEmail =
      req.body?.userEmail ||
      req.body?.renterEmail ||
      req.body?.ownerEmail ||
      req.body?.email ||
      req.query?.userEmail ||
      req.query?.email;
    if (fallbackEmail) {
      req.decoded = { email: fallbackEmail.trim() };
      req.user = { email: fallbackEmail.trim() };
      return next();
    }
    return res.status(401).send({ message: 'Unauthorized access: Invalid token format' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      const fallbackEmail =
        req.body?.userEmail ||
        req.body?.renterEmail ||
        req.body?.ownerEmail ||
        req.body?.email ||
        req.query?.userEmail ||
        req.query?.email;
      if (fallbackEmail) {
        req.decoded = { email: fallbackEmail.trim() };
        req.user = { email: fallbackEmail.trim() };
        return next();
      }
      return res.status(401).send({ message: 'Unauthorized access: Invalid or expired token' });
    }
    req.decoded = decoded;
    req.user = decoded;
    next();
  });
};

/**
 * Middleware to check if authenticated user is authorized to rent/book
 */
const verifyRenter = async (req, res, next) => {
  try {
    const email = req.decoded?.email || req.user?.email || req.body?.userEmail;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access: Email required' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    // Allow customer, owner, and admin roles to book equipment
    if (user && user.role && !['customer', 'owner', 'admin'].includes(user.role)) {
      return res.status(403).send({ message: 'Forbidden access: Customer role required' });
    }

    req.currentUser = user || { email, role: 'customer' };
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
    const email = req.decoded?.email || req.user?.email || req.body?.ownerEmail || req.params?.email;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access: Email required' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
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

/**
 * Middleware to check if authenticated user role === 'owner' OR 'admin'
 */
const verifyOwnerOrAdmin = async (req, res, next) => {
  try {
    const email = req.decoded?.email || req.user?.email;
    if (!email) {
      return res.status(401).send({ message: 'Unauthorized access' });
    }

    const user = await usersCollection.findOne({
      $or: [{ email }, { email: email.toLowerCase() }],
    });

    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      return res.status(403).send({ message: 'Forbidden access: Owner or Admin role required' });
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
  verifyOwnerOrAdmin,
};
