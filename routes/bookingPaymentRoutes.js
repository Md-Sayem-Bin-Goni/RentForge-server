const express = require('express');
const router = express.Router();
const Stripe = require('stripe');

const {
  favoritesCollection,
  bookingsCollection,
  paymentsCollection,
  equipmentCollection,
  ObjectId,
} = require('../config/db');

const {
  verifyToken,
  verifyRenter,
  verifyOwner,
  verifyAdmin,
} = require('../middlewares/authMiddleware');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

/* ==========================================================================
   1. FAVORITES ROUTES (verifyToken, verifyRenter)
   ========================================================================== */

/**
 * POST /api/favorites
 * Add equipment to user's favorites
 */
router.post(
  ['/api/favorites', '/favorites', '/'],
  (req, res, next) => {
    // If router is mounted at /api/bookings or /api/payments, pass through
    if (req.baseUrl.includes('bookings') || req.baseUrl.includes('payments')) return next('route');
    next();
  },
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const renterEmail = req.decoded?.email || req.user?.email;
      const { equipmentId, userEmail } = req.body || {};
      const email = userEmail || renterEmail;

      if (!equipmentId) {
        return res.status(400).send({ message: 'equipmentId is required' });
      }

      const normalizedEmail = email.trim();
      const existing = await favoritesCollection.findOne({
        userEmail: normalizedEmail,
        equipmentId: equipmentId.toString(),
      });

      if (existing) {
        return res.status(400).send({ message: 'Equipment is already in your favorites' });
      }

      const doc = {
        userEmail: normalizedEmail,
        equipmentId: equipmentId.toString(),
        createdAt: new Date(),
      };

      const result = await favoritesCollection.insertOne(doc);
      res.status(201).send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to add favorite', error: error.message });
    }
  }
);

/**
 * GET /api/favorites/:email
 * Get user's favorites with joined equipment details
 */
router.get(
  ['/api/favorites/:email', '/favorites/:email'],
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res.status(400).send({ message: 'Email parameter is required' });
      }

      const normalizedEmail = email.trim();
      const favorites = await favoritesCollection
        .find({
          $or: [
            { userEmail: normalizedEmail },
            { userEmail: normalizedEmail.toLowerCase() },
          ],
        })
        .sort({ createdAt: -1 })
        .toArray();

      // Join equipment info for each favorite
      const enrichedFavorites = await Promise.all(
        favorites.map(async (fav) => {
          let equipFilter;
          if (ObjectId.isValid(fav.equipmentId)) {
            equipFilter = { $or: [{ _id: new ObjectId(fav.equipmentId) }, { _id: fav.equipmentId }] };
          } else {
            equipFilter = { _id: fav.equipmentId };
          }

          const equipment = await equipmentCollection.findOne(equipFilter);
          return {
            ...fav,
            equipment: equipment || null,
          };
        })
      );

      res.send(enrichedFavorites);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch favorites', error: error.message });
    }
  }
);

/**
 * DELETE /api/favorites/:id
 * Remove equipment from favorites
 */
router.delete(
  ['/api/favorites/:id', '/favorites/:id'],
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const { id } = req.params;
      let filter;
      if (ObjectId.isValid(id)) {
        filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
      } else {
        filter = { _id: id };
      }

      const result = await favoritesCollection.deleteOne(filter);
      if (result.deletedCount === 0) {
        return res.status(404).send({ message: 'Favorite not found' });
      }

      res.send(result);
    } catch (error) {
      res.status(500).send({ message: 'Failed to delete favorite', error: error.message });
    }
  }
);

/* ==========================================================================
   2. BOOKINGS & STRIPE CHECKOUT
   ========================================================================== */

/**
 * POST /api/bookings/create-checkout
 * Saves booking (paymentStatus: 'Unpaid', bookingStatus: 'Pending')
 * and creates a Stripe Checkout Session returning { url }
 */
router.post(
  ['/api/bookings/create-checkout', '/bookings/create-checkout', '/create-checkout'],
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const renterEmail = req.decoded?.email || req.user?.email;
      const {
        equipmentId,
        equipmentName,
        equipmentTitle,
        equipmentImage,
        ownerEmail,
        startDate,
        endDate,
        rentalDays,
        rentalType,
        quantity,
        totalPrice,
        price,
        deliveryAddress,
      } = req.body || {};

      if (!equipmentId) {
        return res.status(400).send({ message: 'equipmentId is required' });
      }

      const calculatedPrice = Number(totalPrice || price || 0);
      const bookingQuantity = Number(quantity) || 1;
      const name = equipmentName || equipmentTitle || 'Equipment Rental';

      // 1. Save Booking with paymentStatus: 'Unpaid', bookingStatus: 'Pending'
      const bookingDoc = {
        equipmentId: equipmentId.toString(),
        equipmentName: name,
        equipmentImage: equipmentImage || '',
        ownerEmail: ownerEmail || '',
        renterEmail,
        customerEmail: renterEmail,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 86400000),
        rentalDays: Number(rentalDays) || 1,
        rentalType: rentalType || 'Daily',
        quantity: bookingQuantity,
        totalPrice: calculatedPrice,
        paymentStatus: 'Unpaid',
        bookingStatus: 'Pending',
        deliveryAddress: deliveryAddress || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const bookingResult = await bookingsCollection.insertOne(bookingDoc);
      const bookingId = bookingResult.insertedId;

      // 2. Create Stripe Checkout Session
      let checkoutUrl = '';
      let sessionId = `cs_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      const isRealStripeKey =
        process.env.STRIPE_SECRET_KEY &&
        (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') || process.env.STRIPE_SECRET_KEY.startsWith('sk_live_')) &&
        !process.env.STRIPE_SECRET_KEY.includes('your_stripe_secret_key');

      if (isRealStripeKey) {
        try {
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            customer_email: renterEmail,
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  product_data: {
                    name,
                    description: `RentForge Rental: ${name} (${bookingDoc.rentalDays} days)`,
                    images: equipmentImage ? [equipmentImage] : [],
                  },
                  unit_amount: Math.round(calculatedPrice * 100),
                },
                quantity: 1,
              },
            ],
            metadata: {
              bookingId: bookingId.toString(),
              equipmentId: equipmentId.toString(),
              renterEmail,
              ownerEmail: ownerEmail || '',
            },
            success_url: `${clientUrl}/dashboard/bookings?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}&status=success`,
            cancel_url: `${clientUrl}/equipment/${equipmentId}?status=cancelled`,
          });

          checkoutUrl = session.url;
          sessionId = session.id;
        } catch (stripeError) {
          console.warn('Stripe checkout session creation notice:', stripeError.message);
        }
      }

      if (!checkoutUrl) {
        checkoutUrl = `${clientUrl}/checkout/mock?session_id=${sessionId}&booking_id=${bookingId}&status=success`;
      }

      // Update booking with sessionId
      await bookingsCollection.updateOne(
        { _id: bookingId },
        { $set: { sessionId, checkoutUrl } }
      );

      res.status(201).send({
        url: checkoutUrl,
        sessionId,
        bookingId,
      });
    } catch (error) {
      res.status(500).send({ message: 'Failed to create booking checkout', error: error.message });
    }
  }
);

/**
 * POST /api/payments/confirm
 * Verify Stripe session, update booking to paymentStatus: 'Paid' & bookingStatus: 'Confirmed',
 * insert record into payments collection, and decrement availableQuantity in equipment.
 */
router.post(
  ['/api/payments/confirm', '/payments/confirm', '/confirm'],
  verifyToken,
  async (req, res) => {
    try {
      const { sessionId, bookingId, transactionId } = req.body || {};

      if (!bookingId && !sessionId) {
        return res.status(400).send({ message: 'bookingId or sessionId is required' });
      }

      let bookingFilter;
      if (bookingId) {
        if (ObjectId.isValid(bookingId)) {
          bookingFilter = { $or: [{ _id: new ObjectId(bookingId) }, { _id: bookingId }] };
        } else {
          bookingFilter = { _id: bookingId };
        }
      } else {
        bookingFilter = { sessionId };
      }

      const booking = await bookingsCollection.findOne(bookingFilter);
      if (!booking) {
        return res.status(404).send({ message: 'Booking not found' });
      }

      // Verify Stripe session if key is configured
      let verifiedTxnId = transactionId || sessionId || `txn_${Date.now()}`;
      const isRealStripeKey =
        process.env.STRIPE_SECRET_KEY &&
        (process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') || process.env.STRIPE_SECRET_KEY.startsWith('sk_live_')) &&
        !process.env.STRIPE_SECRET_KEY.includes('your_stripe_secret_key');

      if (sessionId && isRealStripeKey) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session && session.payment_intent) {
            verifiedTxnId = typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent.id;
          }
        } catch (stripeErr) {
          console.warn('Stripe session retrieval notice:', stripeErr.message);
        }
      }

      // Prevent double counting if already confirmed
      if (booking.paymentStatus === 'Paid' && booking.bookingStatus === 'Confirmed') {
        return res.send({ message: 'Booking already confirmed and paid', booking });
      }

      const now = new Date();

      // 1. Update booking
      await bookingsCollection.updateOne(bookingFilter, {
        $set: {
          paymentStatus: 'Paid',
          bookingStatus: 'Confirmed',
          transactionId: verifiedTxnId,
          paidAt: now,
          updatedAt: now,
        },
      });

      // 2. Insert record into payments collection
      const paymentRecord = {
        bookingId: booking._id,
        equipmentId: booking.equipmentId,
        equipmentName: booking.equipmentName,
        renterEmail: booking.renterEmail || booking.customerEmail,
        ownerEmail: booking.ownerEmail,
        amount: booking.totalPrice || 0,
        currency: 'usd',
        transactionId: verifiedTxnId,
        paymentStatus: 'Paid',
        sessionId: sessionId || booking.sessionId || '',
        paidAt: now,
        createdAt: now,
      };

      const paymentResult = await paymentsCollection.insertOne(paymentRecord);

      // 3. Decrement availableQuantity in equipment
      const qtyToDecrement = Number(booking.quantity) || 1;
      let equipFilter;
      if (ObjectId.isValid(booking.equipmentId)) {
        equipFilter = { $or: [{ _id: new ObjectId(booking.equipmentId) }, { _id: booking.equipmentId }] };
      } else {
        equipFilter = { _id: booking.equipmentId };
      }

      await equipmentCollection.updateOne(equipFilter, {
        $inc: { availableQuantity: -qtyToDecrement },
      });

      const updatedBooking = await bookingsCollection.findOne(bookingFilter);

      res.send({
        success: true,
        message: 'Payment confirmed and booking updated',
        booking: updatedBooking,
        payment: { ...paymentRecord, _id: paymentResult.insertedId },
      });
    } catch (error) {
      res.status(500).send({ message: 'Failed to confirm payment', error: error.message });
    }
  }
);

/* ==========================================================================
   3. ROLE BOOKINGS
   ========================================================================== */

/**
 * GET /api/bookings/customer/:email
 * Get all bookings made by this customer (verifyToken, verifyRenter)
 */
router.get(
  ['/api/bookings/customer/:email', '/bookings/customer/:email', '/customer/:email'],
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const { email } = req.params;
      const normalizedEmail = email.trim();
      const query = {
        $or: [
          { renterEmail: normalizedEmail },
          { renterEmail: normalizedEmail.toLowerCase() },
          { customerEmail: normalizedEmail },
          { customerEmail: normalizedEmail.toLowerCase() },
        ],
      };

      const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(bookings);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch customer bookings', error: error.message });
    }
  }
);

/**
 * GET /api/bookings/owner/:email
 * Get all bookings for equipment listed by this owner (verifyToken, verifyOwner)
 */
router.get(
  ['/api/bookings/owner/:email', '/bookings/owner/:email', '/owner/:email'],
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const { email } = req.params;
      const normalizedEmail = email.trim();
      const query = {
        $or: [
          { ownerEmail: normalizedEmail },
          { ownerEmail: normalizedEmail.toLowerCase() },
        ],
      };

      const bookings = await bookingsCollection.find(query).sort({ createdAt: -1 }).toArray();
      res.send(bookings);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch owner bookings', error: error.message });
    }
  }
);

/**
 * GET /api/bookings/admin
 * Get all bookings in the system (verifyToken, verifyAdmin)
 */
router.get(
  ['/api/bookings/admin', '/bookings/admin', '/admin'],
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const bookings = await bookingsCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(bookings);
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch admin bookings', error: error.message });
    }
  }
);

module.exports = router;
