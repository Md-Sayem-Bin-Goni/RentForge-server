const express = require('express');
const router = express.Router();

const {
  usersCollection,
  equipmentCollection,
  bookingsCollection,
  paymentsCollection,
} = require('../config/db');

const {
  verifyToken,
  verifyOwner,
  verifyAdmin,
} = require('../middlewares/authMiddleware');

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * GET /api/analytics/admin
 * Admin overview analytics (verifyToken, verifyAdmin)
 * Returns: totalUsers, totalEquipment, totalBookings, pendingApprovals,
 * completedRentals, totalRevenue, and monthlyBookings array.
 */
router.get(
  ['/api/analytics/admin', '/analytics/admin', '/admin'],
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    try {
      // 1. Total counts
      const [
        totalUsers,
        totalEquipment,
        totalBookings,
        pendingApprovals,
        completedRentals,
      ] = await Promise.all([
        usersCollection.countDocuments(),
        equipmentCollection.countDocuments(),
        bookingsCollection.countDocuments(),
        equipmentCollection.countDocuments({ status: 'Pending' }),
        bookingsCollection.countDocuments({
          $or: [
            { bookingStatus: 'Completed' },
            { rentalStatus: 'Completed' },
            { bookingStatus: 'Confirmed' },
          ],
        }),
      ]);

      // 2. Total revenue from payments or paid bookings
      const payments = await paymentsCollection.find({ paymentStatus: 'Paid' }).toArray();
      let totalRevenue = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

      const allBookings = await bookingsCollection.find().toArray();
      if (totalRevenue === 0) {
        totalRevenue = allBookings
          .filter((b) => b.paymentStatus === 'Paid')
          .reduce((acc, b) => acc + (Number(b.totalPrice) || 0), 0);
      }

      // 3. Monthly bookings breakdown
      const monthlyMap = new Map();

      for (const b of allBookings) {
        const date = new Date(b.createdAt || Date.now());
        const monthKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
        const current = monthlyMap.get(monthKey) || {
          month: monthKey,
          name: monthNames[date.getMonth()],
          count: 0,
          bookings: 0,
          revenue: 0,
        };
        current.count += 1;
        current.bookings += 1;
        if (b.paymentStatus === 'Paid') {
          current.revenue += Number(b.totalPrice) || 0;
        }
        monthlyMap.set(monthKey, current);
      }

      const monthlyBookings = Array.from(monthlyMap.values());

      res.send({
        totalUsers,
        totalEquipment,
        totalBookings,
        pendingApprovals,
        completedRentals,
        totalRevenue,
        monthlyBookings,
      });
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch admin analytics', error: error.message });
    }
  }
);

/**
 * GET /api/analytics/owner/:email
 * Owner analytics (verifyToken, verifyOwner)
 * Returns: listedEquipment, completedRentals, totalEarnings, and monthlyEarnings array.
 */
router.get(
  ['/api/analytics/owner/:email', '/analytics/owner/:email', '/owner/:email'],
  verifyToken,
  verifyOwner,
  async (req, res) => {
    try {
      const { email } = req.params;
      if (!email) {
        return res.status(400).send({ message: 'Owner email is required' });
      }

      const normalizedEmail = email.trim();
      const ownerQuery = {
        $or: [
          { ownerEmail: normalizedEmail },
          { ownerEmail: normalizedEmail.toLowerCase() },
          { 'owner.email': normalizedEmail },
          { 'owner.email': normalizedEmail.toLowerCase() },
        ],
      };

      // 1. Listed Equipment count
      const listedEquipment = await equipmentCollection.countDocuments(ownerQuery);

      // 2. Completed rentals for this owner's equipment
      const completedRentals = await bookingsCollection.countDocuments({
        $and: [
          ownerQuery,
          {
            $or: [
              { bookingStatus: 'Completed' },
              { rentalStatus: 'Completed' },
              { bookingStatus: 'Confirmed' },
            ],
          },
        ],
      });

      // 3. Total earnings from payments
      const ownerPayments = await paymentsCollection
        .find({
          $and: [ownerQuery, { paymentStatus: 'Paid' }],
        })
        .toArray();

      let totalEarnings = ownerPayments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);

      const ownerBookings = await bookingsCollection.find(ownerQuery).toArray();
      if (totalEarnings === 0) {
        totalEarnings = ownerBookings
          .filter((b) => b.paymentStatus === 'Paid')
          .reduce((acc, b) => acc + (Number(b.totalPrice) || 0), 0);
      }

      // 4. Monthly earnings array
      const earningsMap = new Map();
      const records = ownerPayments.length > 0 ? ownerPayments : ownerBookings.filter((b) => b.paymentStatus === 'Paid');

      for (const r of records) {
        const date = new Date(r.paidAt || r.createdAt || Date.now());
        const monthKey = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
        const current = earningsMap.get(monthKey) || {
          month: monthKey,
          name: monthNames[date.getMonth()],
          earnings: 0,
          total: 0,
          count: 0,
        };
        const amount = Number(r.amount || r.totalPrice || 0);
        current.earnings += amount;
        current.total += amount;
        current.count += 1;
        earningsMap.set(monthKey, current);
      }

      const monthlyEarnings = Array.from(earningsMap.values());

      res.send({
        listedEquipment,
        completedRentals,
        totalEarnings,
        monthlyEarnings,
      });
    } catch (error) {
      res.status(500).send({ message: 'Failed to fetch owner analytics', error: error.message });
    }
  }
);

module.exports = router;
