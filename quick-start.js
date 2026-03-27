const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Quick Start Delivery Tracking System\n');

// Function to install dependencies if needed
function installDependencies(servicePath) {
  const packageJsonPath = path.join(servicePath, 'package.json');
  const nodeModulesPath = path.join(servicePath, 'node_modules');
  
  if (fs.existsSync(packageJsonPath) && !fs.existsSync(nodeModulesPath)) {
    console.log(`📦 Installing dependencies for ${path.basename(servicePath)}...`);
    try {
      execSync('npm install', { cwd: servicePath, stdio: 'inherit' });
      console.log(`✅ Dependencies installed for ${path.basename(servicePath)}`);
    } catch (error) {
      console.log(`❌ Failed to install dependencies for ${path.basename(servicePath)}`);
      return false;
    }
  }
  return true;
}

// Install dependencies for all services
const services = ['auth', 'orders', 'drivers', 'analytics', 'notifications', 'gateway'];
let allInstalled = true;

for (const service of services) {
  const servicePath = path.join(__dirname, 'services', service);
  if (!installDependencies(servicePath)) {
    allInstalled = false;
  }
}

if (!allInstalled) {
  console.log('❌ Some dependencies failed to install');
  process.exit(1);
}

// Create logs directories
console.log('\n📁 Creating log directories...');
services.forEach(service => {
  const logDir = path.join(__dirname, 'services', service, 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
});

// Create basic .env if it doesn't exist
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.log('📝 Creating .env file...');
  const envContent = `
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=delivery_tracking
DB_USER=postgres
DB_PASSWORD=password

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Service Ports
GATEWAY_PORT=3000
AUTH_SERVICE_PORT=3001
ORDER_SERVICE_PORT=3002
DRIVER_SERVICE_PORT=3003
ANALYTICS_SERVICE_PORT=3004
NOTIFICATION_SERVICE_PORT=3005

# Service URLs
AUTH_SERVICE_URL=http://localhost:3001
ORDER_SERVICE_URL=http://localhost:3002
DRIVER_SERVICE_URL=http://localhost:3003
ANALYTICS_SERVICE_URL=http://localhost:3004
NOTIFICATION_SERVICE_URL=http://localhost:3005

# JWT Configuration
JWT_SECRET=demo-secret-key-for-testing-only

# Logging
LOG_LEVEL=info
`;
  fs.writeFileSync(envPath, envContent);
}

console.log('\n🎯 Starting essential services (Auth + Gateway)...');

// Start only Auth and Gateway for demo
const demoServices = [
  { name: 'auth', port: 3001, color: '\x1b[36m' },
  { name: 'gateway', port: 3000, color: '\x1b[31m' }
];

const processes = [];

demoServices.forEach((service, index) => {
  setTimeout(() => {
    console.log(`Starting ${service.name} service on port ${service.port}...`);
    
    const servicePath = path.join(__dirname, 'services', service.name);
    
    const child = spawn('node', ['src/index.js'], {
      cwd: servicePath,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, NODE_ENV: 'demo' }
    });

    child.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`${service.color}[${service.name.toUpperCase()}]${'\x1b[0m'} ${line}`);
        }
      });
    });

    child.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`${service.color}[${service.name.toUpperCase()}]${'\x1b[0m'} \x1b[31m${line}\x1b[0m`);
        }
      });
    });

    child.on('close', (code) => {
      console.log(`${service.color}[${service.name.toUpperCase()}]${'\x1b[0m'} Process exited with code ${code}`);
    });

    child.on('error', (error) => {
      console.log(`${service.color}[${service.name.toUpperCase()}]${'\x1b[0m'} \x1b[31mError: ${error.message}\x1b[0m`);
    });

    processes.push({ service: service.name, child, port: service.port });
  }, index * 3000); // 3 second delay between services
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down services...');
  
  processes.forEach(({ service, child }) => {
    console.log(`Stopping ${service} service...`);
    child.kill('SIGTERM');
  });
  
  setTimeout(() => {
    console.log('✅ All services stopped');
    process.exit(0);
  }, 5000);
});

// Show status after a delay
setTimeout(() => {
  console.log('\n🎉 Services are running!');
  console.log('\n📊 Available Services:');
  console.log('🔵 Auth Service: http://localhost:3001/health');
  console.log('🔴 API Gateway: http://localhost:3000/health');
  console.log('\n📚 API Documentation: http://localhost:3000/docs');
  console.log('\n🧪 Test Commands:');
  console.log('curl http://localhost:3000/health');
  console.log('curl http://localhost:3001/health');
  console.log('\n⏹️  Press Ctrl+C to stop all services');
  console.log('\n💡 Tip: Add PostgreSQL and Redis to enable full functionality');
}, 8000);
