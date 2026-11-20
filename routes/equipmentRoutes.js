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
 * Normalizes an equipment document to ensure full consistency between
 * different frontend components (e.g. price vs rentalPrice, image vs equipmentImage)
 */
function normalizeEquipmentDoc(item) {
  if (!item) return null;
  const priceVal =
    item.rentalPrice !== undefined && item.rentalPrice !== null
      ? Number(item.rentalPrice)
      : item.price !== undefined && item.price !== null
      ? Number(item.price)
      : item.pricePerDay !== undefined && item.pricePerDay !== null
      ? Number(item.pricePerDay)
      : 0;

  const imageVal =
    item.image ||
    item.equipmentImage ||
    (Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : '');

  const nameVal = item.name || item.title || 'Equipment Item';
  const qtyVal =
    item.availableQuantity !== undefined && item.availableQuantity !== null
      ? Number(item.availableQuantity)
      : item.quantity !== undefined && item.quantity !== null
      ? Number(item.quantity)
      : 1;

  const isAvail =
    item.isAvailable !== undefined
      ? Boolean(item.isAvailable)
      : qtyVal > 0;

  return {
    ...item,
    _id: item._id,
    name: nameVal,
    title: nameVal,
    equipmentName: nameVal,
    rentalPrice: priceVal,
    price: priceVal,
    pricePerDay: priceVal,
    image: imageVal,
    equipmentImage: imageVal,
    images: Array.isArray(item.images) && item.images.length > 0 ? item.images : (imageVal ? [imageVal] : []),
    availableQuantity: qtyVal,
    quantity: qtyVal,
    isAvailable: isAvail,
    category: item.category || 'General',
    rentalType: item.rentalType || 'Daily',
    location: item.location || '',
    condition: item.condition || 'Excellent',
    status: item.status || 'Pending',
    rating: item.rating !== undefined ? Number(item.rating) : 5.0,
    reviewsCount: item.reviewsCount !== undefined ? Number(item.reviewsCount) : 0,
    ownerName: item.ownerName || item.owner?.name || 'Equipment Owner',
    ownerEmail: item.ownerEmail || item.owner?.email || '',
    owner: {
      name: item.ownerName || item.owner?.name || 'Equipment Owner',
      email: item.ownerEmail || item.owner?.email || '',
      avatar: item.owner?.avatar || item.ownerImage || '',
      company: item.owner?.company || (item.brand ? `${item.brand} Fleet` : 'Equipment Services'),
      rating: item.owner?.rating || 5.0,
      responseTime: item.owner?.responseTime || 'Within 1 hour',
      verified: item.owner?.verified !== undefined ? item.owner.verified : true,
      location: item.owner?.location || item.location || '',
      totalRentals: item.owner?.totalRentals || 0,
    },
    specs: item.specs || {},
    rentalTerms: item.rentalTerms || {},
  };
}

/**
 * GET /api/equipment/featured
 * Returns up to 6 Approved equipment items from MongoDB, sorted newest first
 */
router.get(
  ['/featured', '/api/equipment/featured', '/equipment/featured'],
  async (req, res) => {
    try {
      const items = await equipmentCollection
        .find({ status: 'Approved' })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

      const normalized = items.map(normalizeEquipmentDoc);
      res.send(normalized);
    } catch (error) {
      console.error('Error fetching featured equipment:', error);
      res.status(500).send({ message: 'Failed to fetch featured equipment', error: error.message });
    }
  }
);

/**
 * GET /api/equipment/owner/:email
 * Get all equipment listed by a specific owner (verifyToken, verifyOwner)
 * Sorted newest first
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
          { ownerEmail: { $regex: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') } },
          { 'owner.email': { $regex: new RegExp(`^${escapeRegex(normalizedEmail)}$`, 'i') } },
        ],
      };

      const items = await equipmentCollection.find(query).sort({ createdAt: -1 }).toArray();
      const normalized = items.map(normalizeEquipmentDoc);
      res.send(normalized);
    } catch (error) {
      console.error("Error fetching owner's equipment:", error);
      res.status(500).send({ message: "Failed to fetch owner's equipment", error: error.message });
    }
  }
);

/**
 * GET /api/admin/equipment
 * Admin gets all equipment across all statuses (verifyToken, verifyAdmin)
 */
router.get(
  ['/api/admin/equipment', '/admin/equipment'],
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const items = await equipmentCollection.find().sort({ createdAt: -1 }).toArray();
      const normalized = items.map(normalizeEquipmentDoc);
      res.send(normalized);
    } catch (error) {
      console.error('Error fetching admin equipment:', error);
      res.status(500).send({ message: 'Failed to fetch admin equipment list', error: error.message });
    }
  }
);

/**
 * PATCH /api/admin/equipment/status/:id
 * Admin updates equipment status (Approved, Rejected, Pending) (verifyToken, verifyAdmin)
 */
router.patch(
  [
    '/api/admin/equipment/status/:id',
    '/admin/equipment/status/:id',
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
          updatedAt: new Date(),
        },
      };

      const result = await equipmentCollection.updateOne(filter, updateDoc);
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'Equipment not found' });
      }

      const updated = await equipmentCollection.findOne(filter);
      res.send({ success: true, message: `Status updated to ${status}`, equipment: normalizeEquipmentDoc(updated) });
    } catch (error) {
      console.error('Error updating equipment status:', error);
      res.status(500).send({ message: 'Failed to update equipment status', error: error.message });
    }
  }
);

/**
 * GET /api/equipment
 * Public route returning Approved equipment supporting query params:
 * search, category, rentalType, minPrice, maxPrice, availability,
 * sort (price_asc, price_desc, newest), pagination (page, limit), and ownerEmail
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
      availableOnly,
      sort,
      page,
      limit,
      all,
      ownerEmail,
    } = req.query;

    const filter = {};

    // Only filter by Approved if 'all' is not true and not filtering by a specific owner
    if (all !== 'true' && all !== true && !ownerEmail) {
      filter.status = 'Approved';
    }

    if (ownerEmail && typeof ownerEmail === 'string' && ownerEmail.trim() !== '') {
      const normalizedOwner = ownerEmail.trim();
      filter.$or = [
        { ownerEmail: { $regex: new RegExp(`^${escapeRegex(normalizedOwner)}$`, 'i') } },
        { 'owner.email': { $regex: new RegExp(`^${escapeRegex(normalizedOwner)}$`, 'i') } },
      ];
    }

    // Search: regex on name, title, description, or location
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchRegex = { $regex: escapeRegex(search.trim()), $options: 'i' };
      const searchOr = [
        { name: searchRegex },
        { title: searchRegex },
        { description: searchRegex },
        { location: searchRegex },
        { brand: searchRegex },
      ];
      if (filter.$or) {
        filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
        delete filter.$or;
      } else {
        filter.$or = searchOr;
      }
    }

    // Category filter
    if (category && category !== 'all' && category !== 'All' && category !== 'All Categories') {
      filter.category = { $regex: `^${escapeRegex(category.trim())}$`, $options: 'i' };
    }

    // Rental Type filter
    if (rentalType && rentalType !== 'all' && rentalType !== 'All' && rentalType !== 'All Types') {
      filter.rentalType = { $regex: `^${escapeRegex(rentalType.trim())}$`, $options: 'i' };
    }

    // Price range filter
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    if (!isNaN(min) || !isNaN(max)) {
      const priceFilter = {};
      if (!isNaN(min)) priceFilter.$gte = min;
      if (!isNaN(max)) priceFilter.$lte = max;

      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ rentalPrice: priceFilter }, { price: priceFilter }, { pricePerDay: priceFilter }],
      });
    }

    // Availability filter
    if (
      availability === 'true' ||
      availability === true ||
      availability === 'available' ||
      availableOnly === 'true' ||
      availableOnly === true
    ) {
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [{ availableQuantity: { $gt: 0 } }, { quantity: { $gt: 0 } }, { isAvailable: true }],
      });
    }

    // Sort options
    let sortOption = { createdAt: -1 };
    if (sort === 'price_asc') {
      sortOption = { rentalPrice: 1, price: 1 };
    } else if (sort === 'price_desc') {
      sortOption = { rentalPrice: -1, price: -1 };
    } else if (sort === 'newest') {
      sortOption = { createdAt: -1 };
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 12);
    const skip = (pageNum - 1) * limitNum;

    const totalCount = await equipmentCollection.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limitNum) || (totalCount === 0 ? 0 : 1);

    const data = await equipmentCollection
      .find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const normalizedData = data.map(normalizeEquipmentDoc);

    res.send({
      data: normalizedData,
      equipment: normalizedData,
      items: normalizedData,
      totalCount,
      totalPages,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('Error fetching equipment list:', error);
    res.status(500).send({ message: 'Failed to fetch equipment', error: error.message });
  }
});

/**
 * GET /api/equipment/:id
 * Get single equipment details (supports ObjectId and string IDs)
 */
router.get(
  ['/:id', '/api/equipment/:id', '/equipment/:id'],
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).send({ message: 'Equipment ID is required' });
      }

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

      const normalized = normalizeEquipmentDoc(item);
      res.send({ ...normalized, equipment: normalized });
    } catch (error) {
      console.error('Error fetching equipment details:', error);
      res.status(500).send({ message: 'Failed to fetch equipment details', error: error.message });
    }
  }
);

/**
 * POST /api/equipment
 * Owner adds new equipment (verifyToken, verifyOwner)
 * Saves to MongoDB with ownerEmail, ownerName, status: 'Pending', and createdAt: new Date()
 */
router.post(
  ['/', '/api/equipment', '/equipment'],
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const authEmail = req.decoded?.email || req.user?.email;
      const {
        name,
        title,
        description,
        category,
        rentalType,
        price,
        rentalPrice,
        pricePerDay,
        availableQuantity,
        quantity,
        location,
        images,
        image,
        equipmentImage,
        condition,
        brand,
        model,
        rentalTerms,
        ownerName,
        ownerEmail,
        specs,
      } = req.body || {};

      const finalName = name || title;
      if (!finalName) {
        return res.status(400).send({ message: 'Equipment name is required' });
      }

      const parsedPrice =
        rentalPrice !== undefined && rentalPrice !== null
          ? parseFloat(rentalPrice)
          : price !== undefined && price !== null
          ? parseFloat(price)
          : pricePerDay !== undefined && pricePerDay !== null
          ? parseFloat(pricePerDay)
          : 0;

      const parsedQuantity =
        availableQuantity !== undefined && availableQuantity !== null
          ? parseInt(availableQuantity, 10)
          : quantity !== undefined && quantity !== null
          ? parseInt(quantity, 10)
          : 1;

      const finalImage = image || equipmentImage || (Array.isArray(images) && images.length > 0 ? images[0] : '');
      const finalOwnerEmail = ownerEmail || authEmail;
      const finalOwnerName = ownerName || req.currentUser?.name || 'Equipment Owner';

      const equipmentDoc = {
        name: finalName,
        title: finalName,
        equipmentName: finalName,
        description: description || '',
        category: category || 'General',
        rentalType: rentalType || 'Daily',
        rentalPrice: isNaN(parsedPrice) ? 0 : parsedPrice,
        price: isNaN(parsedPrice) ? 0 : parsedPrice,
        pricePerDay: isNaN(parsedPrice) ? 0 : parsedPrice,
        availableQuantity: isNaN(parsedQuantity) ? 1 : parsedQuantity,
        quantity: isNaN(parsedQuantity) ? 1 : parsedQuantity,
        isAvailable: parsedQuantity > 0,
        location: location || '',
        condition: condition || 'Excellent',
        brand: brand || '',
        model: model || '',
        image: finalImage,
        equipmentImage: finalImage,
        images: Array.isArray(images) && images.length > 0 ? images : (finalImage ? [finalImage] : []),
        rentalTerms: rentalTerms || '',
        specs: specs || {},
        // Required initial ownership & review fields
        ownerName: finalOwnerName,
        ownerEmail: finalOwnerEmail,
        owner: {
          name: finalOwnerName,
          email: finalOwnerEmail,
          company: brand ? `${brand} Fleet` : 'Equipment Owner LLC',
          rating: 5.0,
          responseTime: 'Within 1 hour',
          verified: true,
          location: location || '',
          totalRentals: 0,
        },
        status: 'Pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await equipmentCollection.insertOne(equipmentDoc);
      const inserted = await equipmentCollection.findOne({ _id: result.insertedId });

      res.status(201).send({
        success: true,
        message: 'Equipment listing created successfully with status Pending',
        insertedId: result.insertedId,
        _id: result.insertedId,
        equipment: normalizeEquipmentDoc(inserted),
      });
    } catch (error) {
      console.error('Error in POST /api/equipment:', error);
      res.status(500).send({ message: 'Failed to create equipment', error: error.message });
    }
  }
);

/**
 * PATCH /api/equipment/:id
 * Update equipment (verifyToken, owner or admin)
 */
router.patch(
  ['/:id', '/api/equipment/:id', '/equipment/:id'],
  verifyToken,
  verifyOwnerOrAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const requesterEmail = (req.decoded?.email || req.user?.email || '').toLowerCase();
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
        const ownerEmail = (existing.ownerEmail || existing.owner?.email || '').toLowerCase();
        if (ownerEmail !== requesterEmail) {
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

      if (updateData.price !== undefined || updateData.rentalPrice !== undefined) {
        const p = parseFloat(updateData.rentalPrice !== undefined ? updateData.rentalPrice : updateData.price);
        if (!isNaN(p)) {
          updateData.rentalPrice = p;
          updateData.price = p;
          updateData.pricePerDay = p;
        }
      }

      if (updateData.availableQuantity !== undefined || updateData.quantity !== undefined) {
        const q = parseInt(updateData.availableQuantity !== undefined ? updateData.availableQuantity : updateData.quantity, 10);
        if (!isNaN(q)) {
          updateData.availableQuantity = q;
          updateData.quantity = q;
          updateData.isAvailable = q > 0;
        }
      }

      if (updateData.name || updateData.title) {
        const n = updateData.name || updateData.title;
        updateData.name = n;
        updateData.title = n;
        updateData.equipmentName = n;
      }

      if (updateData.image || updateData.equipmentImage) {
        const img = updateData.image || updateData.equipmentImage;
        updateData.image = img;
        updateData.equipmentImage = img;
      }

      updateData.updatedAt = new Date();

      const result = await equipmentCollection.updateOne(filter, { $set: updateData });
      const updatedItem = await equipmentCollection.findOne(filter);

      res.send({
        success: true,
        message: 'Equipment updated successfully',
        result,
        equipment: normalizeEquipmentDoc(updatedItem),
      });
    } catch (error) {
      console.error('Error updating equipment:', error);
      res.status(500).send({ message: 'Failed to update equipment', error: error.message });
    }
  }
);

/**
 * DELETE /api/equipment/:id
 * Delete equipment (verifyToken, owner or admin)
 */
router.delete(
  ['/:id', '/api/equipment/:id', '/equipment/:id'],
  verifyToken,
  verifyOwnerOrAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const requesterEmail = (req.decoded?.email || req.user?.email || '').toLowerCase();
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
        const ownerEmail = (existing.ownerEmail || existing.owner?.email || '').toLowerCase();
        if (ownerEmail !== requesterEmail) {
          return res.status(403).send({ message: 'Forbidden access: You can only delete your own equipment' });
        }
      }

      const result = await equipmentCollection.deleteOne(filter);
      res.send({
        success: true,
        message: 'Equipment deleted successfully',
        deletedCount: result.deletedCount,
      });
    } catch (error) {
      console.error('Error deleting equipment:', error);
      res.status(500).send({ message: 'Failed to delete equipment', error: error.message });
    }
  }
);

module.exports = router;
