const express = require('express');
const router = express.Router();
const { equipmentCollection, ObjectId } = require('../config/db');
const {
  verifyToken,
  verifyOwner,
  verifyAdmin,
  verifyOwnerOrAdmin,
} = require('../middlewares/authMiddleware');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * GET /api/equipment/featured
 * Return 6 Approved equipment items using .limit(6)
 */
router.get(['/featured', '/api/equipment/featured', '/equipment/featured'], async (req, res) => {
  try {
    const featured = await equipmentCollection
      .find({ status: 'Approved' })
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.send(featured);
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch featured equipment', error: error.message });
  }
});

/**
 * GET /api/equipment/owner/:email
 * Get all equipment listed by a specific owner (verifyToken, verifyOwner)
 */
router.get(
  ['/owner/:email', '/api/equipment/owner/:email', '/equipment/owner/:email'],
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res.status(400).send({ message: 'Owner email is required' });
      }

      const normalizedEmail = email.trim();
      const query = {
        $or: [
          { ownerEmail: normalizedEmail },
          { ownerEmail: normalizedEmail.toLowerCase() },
          { 'owner.email': normalizedEmail },
          { 'owner.email': normalizedEmail.toLowerCase() },
        ],
      };

      const items = await equipmentCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(items);
    } catch (error) {
      res.status(500).send({ message: "Failed to fetch owner's equipment", error: error.message });
    }
  }
);

/**
 * GET /api/admin/equipment
 * Admin gets all equipment (verifyToken, verifyAdmin)
 */
router.get(
  ['/api/admin/equipment', '/admin/equipment', '/equipment', '/admin'],
  (req, res, next) => {
    // Prevent collision if mounted at /api/equipment with path /
    if (req.baseUrl === '/api/equipment' && req.path === '/') return next();
    next();
  },
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const items = await equipmentCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(items);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch admin equipment list', error: error.message });
    }
  }
);

/**
 * PATCH /api/admin/equipment/status/:id
 * Admin updates equipment status (Approved or Rejected) (verifyToken, verifyAdmin)
 */
router.patch(
  [
    '/api/admin/equipment/status/:id',
    '/admin/equipment/status/:id',
    '/equipment/status/:id',
    '/admin/status/:id',
    '/status/:id',
  ],
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body || {};

      if (!status) {
        return res.status(400).send({ message: 'Status is required' });
      }

      const allowedStatuses = ['Approved', 'Rejected', 'Pending'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).send({
          message: `Status must be one of: ${allowedStatuses.join(', ')}`,
        });
      }

      let filter;
      if (ObjectId.isValid(id)) {
        filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
      } else {
        filter = { _id: id };
      }

      const updateDoc = {
        $set: {
          status,
          statusUpdatedAt: new Date(),
        },
      };

      const result = await equipmentCollection.updateOne(filter, updateDoc);
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'Equipment not found' });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to update equipment status', error: error.message });
    }
  }
);

/**
 * GET /api/equipment
 * Public route returning Approved equipment supporting query params:
 * search (regex on name or location), category, rentalType, minPrice, maxPrice,
 * availability (availableQuantity > 0), sort (price_asc, price_desc, newest),
 * and pagination (page, limit). Return { data, totalCount, totalPages }.
 */
router.get(['/', '/api/equipment', '/equipment'], async (req, res) => {
  try {
    const {
      search,
      category,
      rentalType,
      minPrice,
      maxPrice,
      availability,
      sort,
      page,
      limit,
    } = req.query;

    const filter = { status: 'Approved' };

    // Search: regex on name or location (and title)
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchRegex = { $regex: escapeRegex(search.trim()), $options: 'i' };
      filter.$or = [
        { name: searchRegex },
        { title: searchRegex },
        { location: searchRegex },
      ];
    }

    // Category filter
    if (category && category !== 'all' && category !== 'All') {
      filter.category = { $regex: `^${escapeRegex(category.trim())}$`, $options: 'i' };
    }

    // Rental Type filter
    if (rentalType && rentalType !== 'all' && rentalType !== 'All') {
      filter.rentalType = { $regex: `^${escapeRegex(rentalType.trim())}$`, $options: 'i' };
    }

    // Price range filter (minPrice, maxPrice)
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    if (!isNaN(min) || !isNaN(max)) {
      const priceFilter = {};
      if (!isNaN(min)) priceFilter.$gte = min;
      if (!isNaN(max)) priceFilter.$lte = max;

      filter.price = priceFilter;
    }

    // Availability filter (availableQuantity > 0)
    if (availability !== undefined && availability !== null && availability !== '' && availability !== 'all') {
      if (availability === 'true' || availability === true || availability === 'available') {
        filter.availableQuantity = { $gt: 0 };
      } else if (availability === 'false' || availability === false || availability === 'unavailable') {
        filter.availableQuantity = { $lte: 0 };
      } else if (availability) {
        filter.availableQuantity = { $gt: 0 };
      }
    }

    // Sort options: price_asc, price_desc, newest
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') {
      sortOption = { price: 1 };
    } else if (sort === 'price_desc') {
      sortOption = { price: -1 };
    } else if (sort === 'newest') {
      sortOption = { createdAt: -1 };
    }

    // Pagination: page, limit
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 9);
    const skip = (pageNum - 1) * limitNum;

    const totalCount = await equipmentCollection.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limitNum) || (totalCount === 0 ? 0 : 1);

    const data = await equipmentCollection
      .find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.send({
      data,
      totalCount,
      totalPages,
    });
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch equipment', error: error.message });
  }
});

/**
 * GET /api/equipment/:id
 * Get single equipment details (verifyToken)
 */
router.get(['/:id', '/api/equipment/:id', '/equipment/:id'], verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    let filter;
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
    } else {
      filter = { _id: id };
    }

    const item = await equipmentCollection.findOne(filter);
    if (!item) {
      return res.status(404).send({ message: 'Equipment not found' });
    }

    res.send(item);
  } catch (error) {
    res.status(500).send({ message: 'Failed to fetch equipment details', error: error.message });
  }
});

/**
 * POST /api/equipment
 * Owner adds new equipment with default status: 'Pending' (verifyToken, verifyOwner)
 */
router.post(['/', '/api/equipment', '/equipment'], verifyToken, verifyOwner, async (req, res) => {
  try {
    const ownerEmail = req.decoded?.email || req.user?.email;
    const {
      name,
      title,
      description,
      category,
      rentalType,
      price,
      pricePerDay,
      availableQuantity,
      quantity,
      location,
      images,
      image,
    } = req.body || {};

    if (!name && !title) {
      return res.status(400).send({ message: 'Equipment name is required' });
    }

    const parsedPrice = price !== undefined ? parseFloat(price) : (pricePerDay !== undefined ? parseFloat(pricePerDay) : 0);
    const parsedQuantity = availableQuantity !== undefined ? parseInt(availableQuantity, 10) : (quantity !== undefined ? parseInt(quantity, 10) : 1);

    const equipmentDoc = {
      ...req.body,
      name: name || title,
      price: isNaN(parsedPrice) ? 0 : parsedPrice,
      availableQuantity: isNaN(parsedQuantity) ? 1 : parsedQuantity,
      ownerEmail: req.body?.ownerEmail || ownerEmail,
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await equipmentCollection.insertOne(equipmentDoc);
    res.status(201).send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to create equipment', error: error.message });
  }
});

/**
 * PATCH /api/equipment/:id
 * Update equipment (verifyToken, owner or admin)
 */
router.patch(['/:id', '/api/equipment/:id', '/equipment/:id'], verifyToken, verifyOwnerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const requesterEmail = req.decoded?.email || req.user?.email;
    const requesterRole = req.currentUser?.role;

    let filter;
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
    } else {
      filter = { _id: id };
    }

    const existing = await equipmentCollection.findOne(filter);
    if (!existing) {
      return res.status(404).send({ message: 'Equipment not found' });
    }

    // If not admin, verify ownership
    if (requesterRole !== 'admin') {
      const isOwner =
        existing.ownerEmail?.toLowerCase() === requesterEmail?.toLowerCase() ||
        existing.owner?.email?.toLowerCase() === requesterEmail?.toLowerCase();

      if (!isOwner) {
        return res.status(403).send({ message: 'Forbidden access: You can only modify your own equipment' });
      }
    }

    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.createdAt;

    // Only admin can change status directly via equipment update
    if (requesterRole !== 'admin') {
      delete updateData.status;
    }

    if (updateData.price !== undefined) {
      updateData.price = parseFloat(updateData.price);
    }
    if (updateData.availableQuantity !== undefined) {
      updateData.availableQuantity = parseInt(updateData.availableQuantity, 10);
    }

    updateData.updatedAt = new Date();

    const result = await equipmentCollection.updateOne(filter, { $set: updateData });
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to update equipment', error: error.message });
  }
});

/**
 * DELETE /api/equipment/:id
 * Delete equipment (verifyToken, owner or admin)
 */
router.delete(['/:id', '/api/equipment/:id', '/equipment/:id'], verifyToken, verifyOwnerOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const requesterEmail = req.decoded?.email || req.user?.email;
    const requesterRole = req.currentUser?.role;

    let filter;
    if (ObjectId.isValid(id)) {
      filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
    } else {
      filter = { _id: id };
    }

    const existing = await equipmentCollection.findOne(filter);
    if (!existing) {
      return res.status(404).send({ message: 'Equipment not found' });
    }

    // If not admin, verify ownership
    if (requesterRole !== 'admin') {
      const isOwner =
        existing.ownerEmail?.toLowerCase() === requesterEmail?.toLowerCase() ||
        existing.owner?.email?.toLowerCase() === requesterEmail?.toLowerCase();

      if (!isOwner) {
        return res.status(403).send({ message: 'Forbidden access: You can only delete your own equipment' });
      }
    }

    const result = await equipmentCollection.deleteOne(filter);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: 'Failed to delete equipment', error: error.message });
  }
});

module.exports = router;
