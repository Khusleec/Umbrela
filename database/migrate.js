const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function runMigrations() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    database: process.env.DB_NAME || 'umbrela',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
  });

  const migrations = [
    {
      name: 'create_companies_table',
      sql: `
        CREATE TABLE IF NOT EXISTS companies (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE,
          phone VARCHAR(50),
          address TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        );
      `
    },
    {
      name: 'create_users_table',
      sql: `
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          company_id INT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
          CONSTRAINT chk_role CHECK (role IN ('admin', 'company', 'driver', 'user'))
        );
      `
    },
    {
      name: 'create_drivers_table',
      sql: `
        CREATE TABLE IF NOT EXISTS drivers (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          company_id INT,
          name VARCHAR(255) NOT NULL,
          phone VARCHAR(50),
          vehicle_type VARCHAR(100),
          license_plate VARCHAR(50),
          status VARCHAR(50) DEFAULT 'available',
          current_lat DECIMAL(10, 8),
          current_lng DECIMAL(11, 8),
          last_location_update TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
          CONSTRAINT chk_driver_status CHECK (status IN ('available', 'busy', 'offline'))
        );
      `
    },
    {
      name: 'create_orders_table',
      sql: `
        CREATE TABLE IF NOT EXISTS orders (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          driver_id INT,
          company_id INT,
          pickup_address TEXT NOT NULL,
          delivery_address TEXT NOT NULL,
          pickup_lat DECIMAL(10, 8),
          pickup_lng DECIMAL(11, 8),
          delivery_lat DECIMAL(10, 8),
          delivery_lng DECIMAL(11, 8),
          status VARCHAR(50) DEFAULT 'pending',
          estimated_delivery_time TIMESTAMP NULL,
          actual_delivery_time TIMESTAMP NULL,
          notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
          FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
          CONSTRAINT chk_order_status CHECK (status IN ('pending', 'assigned', 'picked_up', 'on_the_way', 'delivered', 'cancelled'))
        );
      `
    },
    {
      name: 'create_notifications_table',
      sql: `
        CREATE TABLE IF NOT EXISTS notifications (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          order_id INT,
          type VARCHAR(50) NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          recipient VARCHAR(255) NOT NULL,
          subject VARCHAR(255),
          content TEXT NOT NULL,
          sent_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
          CONSTRAINT chk_notif_type CHECK (type IN ('sms', 'email', 'push')),
          CONSTRAINT chk_notif_status CHECK (status IN ('pending', 'sent', 'failed'))
        );
      `
    },
    {
      name: 'create_audit_logs_table',
      sql: `
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT,
          action VARCHAR(100) NOT NULL,
          table_name VARCHAR(100),
          record_id INT,
          old_values JSON,
          new_values JSON,
          ip_address VARCHAR(45),
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `
    },
    {
      name: 'create_indexes',
      sql: null,
      customFn: async (connection) => {
        const dbName = process.env.DB_NAME || 'umbrela';
        const indexes = [
          ['idx_users_email', 'users', 'email'],
          ['idx_users_role', 'users', 'role'],
          ['idx_users_company_id', 'users', 'company_id'],
          ['idx_drivers_company_id', 'drivers', 'company_id'],
          ['idx_drivers_status', 'drivers', 'status'],
          ['idx_orders_user_id', 'orders', 'user_id'],
          ['idx_orders_driver_id', 'orders', 'driver_id'],
          ['idx_orders_company_id', 'orders', 'company_id'],
          ['idx_orders_status', 'orders', 'status'],
          ['idx_orders_created_at', 'orders', 'created_at'],
          ['idx_notifications_user_id', 'notifications', 'user_id'],
          ['idx_notifications_order_id', 'notifications', 'order_id'],
          ['idx_audit_logs_user_id', 'audit_logs', 'user_id'],
          ['idx_audit_logs_created_at', 'audit_logs', 'created_at'],
        ];
        for (const [indexName, tableName, column] of indexes) {
          const [rows] = await connection.query(
            `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
            [dbName, tableName, indexName]
          );
          if (rows[0].cnt === 0) {
            await connection.query(`CREATE INDEX ${indexName} ON ${tableName}(${column})`);
          }
        }
      }
    }
  ];

  try {
    console.log('Connected to MySQL database');

    for (const migration of migrations) {
      console.log(`Running migration: ${migration.name}`);
      if (migration.customFn) {
        await migration.customFn(connection);
      } else {
        // Split by semicolons and run each statement individually
        const statements = migration.sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const stmt of statements) {
          await connection.query(stmt);
        }
      }
      console.log(`Migration ${migration.name} completed`);
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations };
