const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function seedDatabase() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'umbrela',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    console.log('Connected to database');

    const hashedPassword = await bcrypt.hash('password123', 10);

    console.log('Seeding companies...');
    const [company1Result] = await connection.execute(
      `INSERT INTO companies (name, email, phone, address) VALUES (?, ?, ?, ?)`,
      ['Fast Delivery Co', 'info@fastdelivery.com', '+1234567890', '123 Main St, City, State']
    );
    const company1Id = company1Result.insertId;

    const [company2Result] = await connection.execute(
      `INSERT INTO companies (name, email, phone, address) VALUES (?, ?, ?, ?)`,
      ['Quick Ship Inc', 'contact@quickship.com', '+0987654321', '456 Oak Ave, Town, State']
    );
    const company2Id = company2Result.insertId;

    console.log('Seeding users...');
    await connection.execute(
      `INSERT INTO users (email, password, name, role, company_id) VALUES
        (?, ?, 'System Admin', 'admin', NULL),
        (?, ?, 'Company Manager', 'company', ?),
        (?, ?, 'John Driver', 'driver', ?),
        (?, ?, 'Alice Customer', 'user', NULL),
        (?, ?, 'Quick Ship Manager', 'company', ?),
        (?, ?, 'Jane Driver', 'driver', ?)`,
      [
        'admin@delivery.com', hashedPassword,
        'company@fastdelivery.com', hashedPassword, company1Id,
        'driver1@fastdelivery.com', hashedPassword, company1Id,
        'user1@example.com', hashedPassword,
        'company@quickship.com', hashedPassword, company2Id,
        'driver2@quickship.com', hashedPassword, company2Id,
      ]
    );

    console.log('Seeding drivers...');
    const [driverUsers] = await connection.execute(
      `SELECT id, company_id, name FROM users WHERE role = 'driver'`
    );

    for (const u of driverUsers) {
      await connection.execute(
        `INSERT INTO drivers (user_id, company_id, name, phone, vehicle_type, license_plate, status)
         VALUES (?, ?, ?, '+1234567890', 'Van', 'ABC123', 'available')`,
        [u.id, u.company_id, u.name]
      );
    }

    console.log('Seeding sample orders...');
    const [userRow] = await connection.execute(`SELECT id FROM users WHERE email = 'user1@example.com'`);
    const userId = userRow[0].id;

    await connection.execute(
      `INSERT INTO orders (user_id, company_id, pickup_address, delivery_address, pickup_lat, pickup_lng, delivery_lat, delivery_lng, status)
       VALUES
         (?, ?, '123 Pickup St', '456 Delivery Ave', 40.7484, -73.9857, 40.7128, -74.0060, 'pending'),
         (?, ?, '789 Pickup Blvd', '321 Delivery Way', 40.7484, -73.9857, 40.7128, -74.0060, 'assigned')`,
      [userId, company1Id, userId, company1Id]
    );

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
