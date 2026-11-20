const express = require('express');
const router = express.Router();
const { usersCollection, ObjectId } = require('../config/db');
const {
  verifyToken,
  verifyRenter,
  verifyOwner,
  verifyAdmin,
} = require('../middlewares/authMiddleware');

/**
 * POST /api/users
 * Upsert user on registration/login (default role 'customer', createdAt)
 */
router.post(['/', '/api/users'], async (req, res) => {
  try {
    const { email, name, image, phone, address, role } = req.body || {};
    if (!email) {
      return res.status(400).send({ message: 'Email is required' });
    }

    const normalizedEmail = email.trim();
    const filter = {
      $or: [
        { email: normalizedEmail },
        { email: normalizedEmail.toLowerCase() },
      ],
    };

    const updateFields = {
      lastLogin: new Date(),
    };
    if (name !== undefined) updateFields.name = name;
    if (image !== undefined) updateFields.image = image;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;

    const updateDoc = {
      $set: updateFields,
      $setOnInsert: {
        email: normalizedEmail,
        role: role || 'customer',
        createdAt: new Date(),
      },
    };

    const result = await usersCollection.updateOne(filter, updateDoc, { upsert: true });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to upsert user', error: error.message });
  }
});

/**
 * GET /api/users
 * Get all users (verifyToken, verifyAdmin)
 */
router.get(['/', '/api/users'], verifyToken, verifyAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send(users);
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch users', error: error.message });
  }
});

/**
 * GET /api/users/:email
 * Get user profile and role (protected by verifyToken)
 */
router.get(['/:email', '/api/users/:email'], verifyToken, async (req, res) => {
  try {
    const { email } = req.params;
    if (!email) {
      return res.status(400).send({ message: 'Email parameter is required' });
    }

    const normalizedEmail = email.trim();
    const user = await usersCollection.findOne({
      $or: [
        { email: normalizedEmail },
        { email: normalizedEmail.toLowerCase() },
      ],
    });

    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send(user);
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch user', error: error.message });
  }
});

/**
 * PATCH /api/users/profile/:email
 * Update name, image, phone, address (verifyToken)
 */
router.patch(['/profile/:email', '/api/users/profile/:email'], verifyToken, async (req, res) => {
  try {
    const { email } = req.params;
    const { name, image, phone, address } = req.body || {};

    const normalizedEmail = email.trim();
    const filter = {
      $or: [
        { email: normalizedEmail },
        { email: normalizedEmail.toLowerCase() },
      ],
    };

    const updateFields = {
      updatedAt: new Date(),
    };
    if (name !== undefined) updateFields.name = name;
    if (image !== undefined) updateFields.image = image;
    if (phone !== undefined) updateFields.phone = phone;
    if (address !== undefined) updateFields.address = address;

    const updateDoc = {
      $set: updateFields,
    };

    const result = await usersCollection.updateOne(filter, updateDoc);
    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to update user profile', error: error.message });
  }
});

/**
 * PATCH /api/users/role/:id
 * Change user role (verifyToken, verifyAdmin)
 */
router.patch(['/role/:id', '/api/users/role/:id'], verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};

    if (!role) {
      return res.status(400).send({ message: 'Role is required' });
    }

    let filter;
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
    } else {
      filter = { _id: id };
    }

    const updateDoc = {
      $set: {
        role,
        roleUpdatedAt: new Date(),
      },
    };

    const result = await usersCollection.updateOne(filter, updateDoc);
    if (result.matchedCount === 0) {
      return res.status(404).send({ message: 'User not found' });
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to update user role', error: error.message });
  }
});

module.exports = router;
