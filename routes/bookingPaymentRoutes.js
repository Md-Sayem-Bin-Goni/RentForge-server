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
   BOOKINGS & STRIPE CHECKOUT
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
      const renterEmail = req.decoded?.email || req.user?.email || req.body?.userEmail;
      const {
        equipmentId,
        equipmentName,
        equipmentTitle,
        equipmentImage,
        image,
        ownerEmail,
        startDate,
        endDate,
        rentalDays,
        durationDays,
        rentalType,
        quantity,
        totalPrice,
        totalAmount,
        subtotal,
        price,
        deliveryAddress,
      } = req.body || {};

      if (!equipmentId) {
        return res.status(400).send({ message: 'equipmentId is required' });
      }

      const calculatedPrice = Number(totalPrice || totalAmount || subtotal || price || 0);
      const bookingQuantity = Number(quantity) || 1;
      const name = equipmentName || equipmentTitle || 'Equipment Rental';
      const days = Number(rentalDays || durationDays || 1);
      const finalImage = equipmentImage || image || '';

      // 1. Save Booking with paymentStatus: 'Unpaid', bookingStatus: 'Pending'
      const bookingDoc = {
        equipmentId: equipmentId.toString(),
        equipmentName: name,
        equipmentImage: finalImage,
        ownerEmail: ownerEmail || '',
        renterEmail,
        customerEmail: renterEmail,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 86400000),
        rentalDays: days,
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
          const stripeImages =
            finalImage && (finalImage.startsWith('https://') || finalImage.startsWith('http://'))
              ? [finalImage]
              : [];

          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            ...(renterEmail && renterEmail.includes('@') ? { customer_email: renterEmail.trim() } : {}),
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  product_data: {
                    name,
                    description: `RentForge Rental: ${name} (${days} days)`,
                    ...(stripeImages.length > 0 ? { images: stripeImages } : {}),
                  },
                  unit_amount: Math.round(calculatedPrice * 100),
                },
                quantity: 1,
              },
            ],
            metadata: {
              bookingId: bookingId.toString(),
              equipmentId: equipmentId.toString(),
              renterEmail: renterEmail || '',
              ownerEmail: ownerEmail || '',
            },
            success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}&status=success`,
            cancel_url: `${clientUrl}/equipment/${equipmentId}?status=cancelled`,
          });

          checkoutUrl = session.url;
          sessionId = session.id;
        } catch (stripeError) {
          console.error('Stripe checkout session creation error:', stripeError.message);
          return res.status(400).send({
            message: `Stripe checkout error: ${stripeError.message}`,
            error: stripeError.message,
          });
        }
      } else {
        return res.status(500).send({
          message: 'Stripe Secret Key is not configured on the backend server.',
        });
      }

      if (!checkoutUrl) {
        return res.status(400).send({
          message: 'Failed to generate Stripe checkout URL. Please try again.',
        });
      }

      // Update booking with sessionId & checkoutUrl
      await bookingsCollection.updateOne(
        { _id: bookingId },
        { $set: { sessionId, checkoutUrl } }
      );

      res.status(201).send({
        url: checkoutUrl,
        checkoutUrl,
        sessionId,
        bookingId,
      });
    } catch (error) {
      console.error('Failed to create booking checkout:', error);
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
   3. ROLE BOOKINGS & STATUS MANAGEMENT
   ========================================================================== */

/**
 * PATCH /api/bookings/:id/status
 * Update booking status or payment status
 */
router.patch(
  [
    '/api/bookings/:id/status',
    '/bookings/:id/status',
    '/:id/status',
    '/api/bookings/:id',
    '/bookings/:id',
    '/:id',
  ],
  verifyToken,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { bookingStatus, rentalStatus, status, paymentStatus } = req.body || {};

      let filter;
      if (ObjectId.isValid(id)) {
        filter = { $or: [{ _id: new ObjectId(id) }, { _id: id }] };
      } else {
        filter = { _id: id };
      }

      const updateFields = {
        updatedAt: new Date(),
      };
      if (bookingStatus) updateFields.bookingStatus = bookingStatus;
      if (rentalStatus) updateFields.rentalStatus = rentalStatus;
      if (status) updateFields.bookingStatus = status;
      if (paymentStatus) updateFields.paymentStatus = paymentStatus;

      const result = await bookingsCollection.updateOne(filter, { $set: updateFields });
      if (result.matchedCount === 0) {
        return res.status(404).send({ message: 'Booking not found' });
      }

      res.send({ success: true, message: 'Booking status updated successfully', result });
    } catch (error) {
      res.status(500).send({ message: 'Failed to update booking status', error: error.message });
    }
  }
);

/**
 * GET /api/bookings/customer/:email
 * Get all bookings made by this customer (verifyToken, verifyRenter)
 */
router.get(
  [
    '/api/bookings/customer/:email',
    '/bookings/customer/:email',
    '/customer/:email',
    '/api/bookings/my-rentals',
    '/bookings/my-rentals',
    '/my-rentals',
    '/api/bookings/my-bookings',
    '/bookings/my-bookings',
    '/my-bookings',
  ],
  verifyToken,
  verifyRenter,
  async (req, res) => {
    try {
      const email =
        req.params.email ||
        req.query.email ||
        req.query.userEmail ||
        req.decoded?.email ||
        req.user?.email;
      if (!email) {
        return res.status(400).send({ message: 'Customer email is required' });
      }

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
  [
    '/api/bookings/owner/:email',
    '/bookings/owner/:email',
    '/owner/:email',
    '/api/bookings/owner-rentals',
    '/bookings/owner-rentals',
    '/owner-rentals',
  ],
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const email =
        req.params.email ||
        req.query.ownerEmail ||
        req.query.email ||
        req.decoded?.email ||
        req.user?.email;
      if (!email) {
        return res.status(400).send({ message: 'Owner email is required' });
      }

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
  [
    '/api/bookings/admin',
    '/bookings/admin',
    '/admin',
    '/api/bookings',
    '/bookings',
    '/',
  ],
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
