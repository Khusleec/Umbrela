const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');

dotenv.config();

const pgClient = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'delivery_tracking',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});

async function seedDatabase() {
  try {
    await pgClient.connect();
    console.log('Connected to database');

    const hashedPassword = await bcrypt.hash('password123', 10);

    console.log('Seeding companies...');
    const companyResult = await pgClient.query(`
      INSERT INTO companies (name, email, phone, address) 
      VALUES 
        ('Fast Delivery Co', 'info@fastdelivery.com', '+1234567890', '123 Main St, City, State'),
        ('Quick Ship Inc', 'contact@quickship.com', '+0987654321', '456 Oak Ave, Town, State')
      RETURNING id
    `);

    console.log('Seeding users...');
    await pgClient.query(`
      INSERT INTO users (email, password, name, role, company_id) 
      VALUES 
        ('admin@delivery.com', $1, 'System Admin', 'admin', NULL),
        ('company@fastdelivery.com', $1, 'Company Manager', 'company', $2),
        ('driver1@fastdelivery.com', $1, 'John Driver', 'driver', $2),
        ('user1@example.com', $1, 'Alice Customer', 'user', NULL),
        ('company@quickship.com', $1, 'Quick Ship Manager', 'company', $3),
        ('driver2@quickship.com', $1, 'Jane Driver', 'driver', $3)
    `, [hashedPassword, companyResult.rows[0].id, companyResult.rows[1].id]);

    console.log('Seeding drivers...');
    const driverResult = await pgClient.query(`
      INSERT INTO drivers (user_id, company_id, name, phone, vehicle_type, license_plate, status)
      SELECT u.id, u.company_id, u.name, '+1234567890', 'Van', 'ABC123', 'available'
      FROM users u 
      WHERE u.role = 'driver'
      RETURNING id
    `);

    console.log('Seeding sample orders...');
    await pgClient.query(`
      INSERT INTO orders (user_id, company_id, pickup_address, delivery_address, pickup_location, delivery_location, status)
      VALUES 
        (4, $1, '123 Pickup St', '456 Delivery Ave', POINT(-73.9857, 40.7484), POINT(-74.0060, 40.7128), 'pending'),
        (4, $1, '789 Pickup Blvd', '321 Delivery Way', POINT(-73.9857, 40.7484), POINT(-74.0060, 40.7128), 'assigned')
    `, [companyResult.rows[0].id]);

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

if (require.main === module) {
  seedDatabase();
}

module.exports = { seedDatabase };
