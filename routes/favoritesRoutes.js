const express = require('express');
const router = express.Router();
const { favoritesCollection, equipmentCollection, ObjectId } = require('../config/db');
const { verifyToken } = require('../middlewares/authMiddleware');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Helper to normalize email strings
 */
const normalizeEmail = (email) => (email ? email.trim().toLowerCase() : '');

/**
 * POST /api/favorites
 * Protected by verifyToken
 * Accepts { userEmail, equipmentId }
 * Checks if already favorited to prevent duplicates; inserts { userEmail, equipmentId, createdAt: new Date() }
 */
router.post(['/', '/api/favorites', '/favorites'], verifyToken, async (req, res) => {
  try {
    const authEmail = req.decoded?.email || req.user?.email;
    const { equipmentId, userEmail } = req.body || {};
    const email = normalizeEmail(userEmail || authEmail);

    if (!email) {
      return res.status(400).send({ success: false, message: 'User email is required' });
    }

    if (!equipmentId) {
      return res.status(400).send({ success: false, message: 'equipmentId is required' });
    }

    const equipIdStr = equipmentId.toString().trim();

    // Check if equipment exists in MongoDB
    let equipFilter;
    if (ObjectId.isValid(equipIdStr)) {
      equipFilter = { $or: [{ _id: new ObjectId(equipIdStr) }, { _id: equipIdStr }] };
    } else {
      equipFilter = { _id: equipIdStr };
    }
    const equipment = await equipmentCollection.findOne(equipFilter);

    // Prevent duplicate favorites for same user & equipment
    const existing = await favoritesCollection.findOne({
      userEmail: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
      $or: [
        { equipmentId: equipIdStr },
        ...(ObjectId.isValid(equipIdStr) ? [{ equipmentId: new ObjectId(equipIdStr) }] : []),
      ],
    });

    if (existing) {
      return res.status(200).send({
        success: true,
        message: 'Equipment is already in your favorites',
        favoriteId: existing._id,
        _id: existing._id,
        alreadyFavorited: true,
      });
    }

    const favoriteDoc = {
      userEmail: email,
      equipmentId: equipIdStr,
      createdAt: new Date(),
    };

    const result = await favoritesCollection.insertOne(favoriteDoc);

    res.status(201).send({
      success: true,
      message: 'Added to favorites successfully',
      favoriteId: result.insertedId,
      _id: result.insertedId,
      ...favoriteDoc,
    });
  } catch (error) {
    console.error('Error in POST /api/favorites:', error);
    res.status(500).send({ success: false, message: 'Failed to add favorite', error: error.message });
  }
});

/**
 * GET /api/favorites/:email
 * Protected by verifyToken
 * Verifies decoded token email matches :email
 * Fetches favorites for userEmail, populates equipment details, filters out deleted equipment
 */
router.get(
  ['/:email', '/api/favorites/:email', '/favorites/:email'],
  verifyToken,
  async (req, res) => {
    try {
      const paramEmail = req.params.email;
      const tokenEmail = req.decoded?.email || req.user?.email;

      if (!paramEmail) {
        return res.status(400).send({ success: false, message: 'Email parameter is required' });
      }

      const normalizedParamEmail = normalizeEmail(paramEmail);
      const normalizedTokenEmail = normalizeEmail(tokenEmail);

      // Verify decoded token email matches :email
      if (
        normalizedTokenEmail &&
        normalizedParamEmail !== normalizedTokenEmail &&
        req.currentUser?.role !== 'admin'
      ) {
        return res.status(403).send({
          success: false,
          message: 'Forbidden access: Token email does not match requested email',
        });
      }

      // Fetch favorite records for userEmail
      const favorites = await favoritesCollection
        .find({
          userEmail: { $regex: new RegExp(`^${escapeRegex(normalizedParamEmail)}$`, 'i') },
        })
        .sort({ createdAt: -1 })
        .toArray();

      // Look up full equipment details from equipment collection
      const populatedFavorites = await Promise.all(
        favorites.map(async (fav) => {
          const equipIdStr = fav.equipmentId ? fav.equipmentId.toString().trim() : '';
          let equipFilter;
          if (ObjectId.isValid(equipIdStr)) {
            equipFilter = { $or: [{ _id: new ObjectId(equipIdStr) }, { _id: equipIdStr }] };
          } else {
            equipFilter = { _id: equipIdStr };
          }

          const equip = await equipmentCollection.findOne(equipFilter);
          if (!equip) {
            // Equipment was deleted or removed from MongoDB: filter out
            return null;
          }

          const priceVal =
            equip.rentalPrice !== undefined
              ? equip.rentalPrice
              : equip.price !== undefined
              ? equip.price
              : equip.pricePerDay || 0;

          const imageVal =
            equip.image ||
            equip.equipmentImage ||
            (Array.isArray(equip.images) ? equip.images[0] : '');

          const nameVal = equip.name || equip.title || 'Equipment Item';

          return {
            _id: fav._id,
            userEmail: fav.userEmail,
            equipmentId: fav.equipmentId,
            createdAt: fav.createdAt,
            addedAt: fav.createdAt ? new Date(fav.createdAt).toISOString().split('T')[0] : '',
            // Populated equipment object
            equipment: {
              ...equip,
              _id: equip._id,
              name: nameVal,
              title: nameVal,
              image: imageVal,
              equipmentImage: imageVal,
              rentalPrice: priceVal,
              price: priceVal,
              pricePerDay: priceVal,
            },
            // Direct top-level fields for universal frontend compatibility
            name: nameVal,
            title: nameVal,
            category: equip.category || '',
            image: imageVal,
            equipmentImage: imageVal,
            rentalPrice: priceVal,
            price: priceVal,
            pricePerDay: priceVal,
            rentalType: equip.rentalType || 'Daily',
            location: equip.location || '',
            isAvailable: equip.availableQuantity > 0 || equip.isAvailable !== false,
            availableQuantity: equip.availableQuantity !== undefined ? equip.availableQuantity : 1,
            rating: equip.rating || 5.0,
          };
        })
      );

      // Filter out deleted equipment (null items)
      const validFavorites = populatedFavorites.filter(Boolean);
      res.send(validFavorites);
    } catch (error) {
      console.error('Error in GET /api/favorites/:email:', error);
      res.status(500).send({ success: false, message: 'Failed to fetch favorites', error: error.message });
    }
  }
);

/**
 * GET /api/favorites (Fallback with query param ?email=... or token email)
 */
router.get(['/', '/api/favorites', '/favorites'], verifyToken, async (req, res) => {
  try {
    const queryEmail = req.query.email || req.query.userEmail;
    const tokenEmail = req.decoded?.email || req.user?.email;
    const email = normalizeEmail(queryEmail || tokenEmail);

    if (!email) {
      return res.status(400).send({ success: false, message: 'User email is required' });
    }

    const favorites = await favoritesCollection
      .find({
        userEmail: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
      })
      .sort({ createdAt: -1 })
      .toArray();

    const populatedFavorites = await Promise.all(
      favorites.map(async (fav) => {
        const equipIdStr = fav.equipmentId ? fav.equipmentId.toString().trim() : '';
        let equipFilter;
        if (ObjectId.isValid(equipIdStr)) {
          equipFilter = { $or: [{ _id: new ObjectId(equipIdStr) }, { _id: equipIdStr }] };
        } else {
          equipFilter = { _id: equipIdStr };
        }

        const equip = await equipmentCollection.findOne(equipFilter);
        if (!equip) return null;

        const priceVal =
          equip.rentalPrice !== undefined
            ? equip.rentalPrice
            : equip.price !== undefined
            ? equip.price
            : equip.pricePerDay || 0;

        const imageVal =
          equip.image ||
          equip.equipmentImage ||
          (Array.isArray(equip.images) ? equip.images[0] : '');

        const nameVal = equip.name || equip.title || 'Equipment Item';

        return {
          _id: fav._id,
          userEmail: fav.userEmail,
          equipmentId: fav.equipmentId,
          createdAt: fav.createdAt,
          addedAt: fav.createdAt ? new Date(fav.createdAt).toISOString().split('T')[0] : '',
          equipment: {
            ...equip,
            _id: equip._id,
            name: nameVal,
            title: nameVal,
            image: imageVal,
            equipmentImage: imageVal,
            rentalPrice: priceVal,
            price: priceVal,
            pricePerDay: priceVal,
          },
          name: nameVal,
          title: nameVal,
          category: equip.category || '',
          image: imageVal,
          equipmentImage: imageVal,
          rentalPrice: priceVal,
          price: priceVal,
          pricePerDay: priceVal,
          rentalType: equip.rentalType || 'Daily',
          location: equip.location || '',
          isAvailable: equip.availableQuantity > 0 || equip.isAvailable !== false,
          availableQuantity: equip.availableQuantity !== undefined ? equip.availableQuantity : 1,
          rating: equip.rating || 5.0,
        };
      })
    );

    const validFavorites = populatedFavorites.filter(Boolean);
    res.send(validFavorites);
  } catch (error) {
    console.error('Error in GET /api/favorites:', error);
    res.status(500).send({ success: false, message: 'Failed to fetch favorites', error: error.message });
  }
});

/**
 * DELETE /api/favorites/:id
 * Protected by verifyToken
 * Deletes favorite record by its _id (or by equipmentId + userEmail query)
 */
router.delete(['/:id', '/api/favorites/:id', '/favorites/:id'], verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const authEmail = normalizeEmail(req.decoded?.email || req.user?.email);

    if (!id) {
      return res.status(400).send({ success: false, message: 'Favorite ID is required' });
    }

    const idStr = id.toString().trim();

    // Try deleting by favorite _id first
    let filter;
    if (ObjectId.isValid(idStr)) {
      filter = {
        $or: [
          { _id: new ObjectId(idStr) },
          { _id: idStr },
          // Or if equipmentId is provided
          {
            equipmentId: idStr,
            ...(authEmail ? { userEmail: { $regex: new RegExp(`^${escapeRegex(authEmail)}$`, 'i') } } : {}),
          },
        ],
      };
    } else {
      filter = {
        $or: [
          { _id: idStr },
          {
            equipmentId: idStr,
            ...(authEmail ? { userEmail: { $regex: new RegExp(`^${escapeRegex(authEmail)}$`, 'i') } } : {}),
          },
        ],
      };
    }

    const result = await favoritesCollection.deleteOne(filter);

    if (result.deletedCount === 0) {
      // Fallback check
      const fallbackResult = await favoritesCollection.deleteOne({
        equipmentId: idStr,
        ...(authEmail ? { userEmail: { $regex: new RegExp(`^${escapeRegex(authEmail)}$`, 'i') } } : {}),
      });

      if (fallbackResult.deletedCount === 0) {
        return res.status(404).send({ success: false, message: 'Favorite record not found' });
      }

      return res.send({
        success: true,
        message: 'Favorite removed successfully',
        deletedCount: fallbackResult.deletedCount,
      });
    }

    res.send({
      success: true,
      message: 'Favorite removed successfully',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error in DELETE /api/favorites/:id:', error);
    res.status(500).send({ success: false, message: 'Failed to delete favorite', error: error.message });
  }
});

module.exports = router;
