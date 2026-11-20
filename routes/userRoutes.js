const express = require('express');
const router = express.Router();
const { usersCollection, authUserCollection, ObjectId } = require('../config/db');
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

    // Ensure Better Auth's user collection in MongoDB is also synchronized
    if (role) {
      await authUserCollection.updateMany(filter, {
        $set: { role, updatedAt: new Date() },
      });
    }

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
 * PATCH or PUT /api/users/profile/:email or /api/users/:email
 * Update name, image, phone, address, and role in MongoDB (verifyToken)
 * Synchronizes both 'users' and 'user' collections.
 */
router.all(
  [
    '/profile/:email',
    '/api/users/profile/:email',
    '/:email',
    '/api/users/:email',
    '/:email/role',
    '/api/users/:email/role',
  ],
  verifyToken,
  async (req, res, next) => {
    if (req.method !== 'PATCH' && req.method !== 'PUT') {
      return next();
    }
    try {
      const { email } = req.params;
      const { name, image, phone, address, role } = req.body || {};

      if (!email) {
        return res.status(400).send({ message: 'Email parameter is required' });
      }

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
      if (role !== undefined) updateFields.role = role;

      const updateDoc = {
        $set: updateFields,
      };

      // 1. Update/Upsert in Express 'users' collection
      const result = await usersCollection.updateOne(filter, updateDoc, { upsert: true });

      // 2. Synchronize with Better Auth's 'user' collection in MongoDB
      const authUpdateFields = { updatedAt: new Date() };
      if (role !== undefined) authUpdateFields.role = role;
      if (name !== undefined) authUpdateFields.name = name;
      if (image !== undefined) authUpdateFields.image = image;

      await authUserCollection.updateMany(filter, { $set: authUpdateFields });

      res.send({
        success: true,
        message: 'User profile and role updated successfully in MongoDB',
        result,
        role: role !== undefined ? role : undefined,
      });
    } catch (error) {
      console.error('Failed to update user profile/role:', error);
      res.status(500).send({ message: 'Failed to update user profile', error: error.message });
    }
  }
);

/**
 * PATCH /api/users/role/:id
 * Change user role by ID or Email (verifyToken)
 * Synchronizes both 'users' and 'user' collections in MongoDB.
 */
router.patch(
  ['/role/:id', '/api/users/role/:id', '/:id/role', '/api/users/:id/role'],
  verifyToken,
  async (req, res) => {
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
        filter = {
          $or: [
            { email: id.trim() },
            { email: id.trim().toLowerCase() },
            { _id: id },
          ],
        };
      }

      const updateDoc = {
        $set: {
          role,
          roleUpdatedAt: new Date(),
          updatedAt: new Date(),
        },
      };

      // 1. Update in 'users' collection
      const result = await usersCollection.updateOne(filter, updateDoc);

      // 2. Also update Better Auth's 'user' collection
      const targetUser = await usersCollection.findOne(filter);
      const targetEmail =
        targetUser?.email || (typeof id === 'string' && id.includes('@') ? id.trim() : null);

      if (targetEmail) {
        await authUserCollection.updateMany(
          {
            $or: [
              { email: targetEmail },
              { email: targetEmail.toLowerCase() },
            ],
          },
          {
            $set: {
              role,
              updatedAt: new Date(),
            },
          }
        );
      } else if (ObjectId.isValid(id)) {
        await authUserCollection.updateMany(
          { $or: [{ _id: new ObjectId(id) }, { _id: id }] },
          { $set: { role, updatedAt: new Date() } }
        );
      }

      res.send({
        success: true,
        message: `Role successfully updated to ${role} in MongoDB`,
        result,
        role,
      });
    } catch (error) {
      console.error('Failed to update user role:', error);
      res.status(500).send({ message: 'Failed to update user role', error: error.message });
    }
  }
);

module.exports = router;
