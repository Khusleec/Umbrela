const path = require('path');
const fs = require('fs');

/**
 * Secure path utility to prevent path traversal attacks
 */
class PathSecurity {
  constructor(baseDir) {
    this.baseDir = path.resolve(baseDir);
  }

  /**
   * Validates and resolves a path safely
   * @param {string} inputPath - User-provided path
   * @returns {string|null} - Safe resolved path or null if invalid
   */
  resolvePath(inputPath) {
    if (typeof inputPath !== 'string') {
      return null;
    }

    // Reject null bytes and dangerous characters
    if (inputPath.includes('\0') || /[<>:"|?*]/.test(inputPath)) {
      return null;
    }

    // Normalize the input path
    const normalizedInput = path.normalize(inputPath);

    // Reject absolute paths (should be relative to base)
    if (path.isAbsolute(normalizedInput)) {
      return null;
    }

    // Reject path traversal attempts
    if (normalizedInput.includes('..') || normalizedInput.includes('~')) {
      return null;
    }

    // Resolve against base directory
    const resolvedPath = path.resolve(this.baseDir, normalizedInput);

    // Ensure the resolved path is still within base directory
    if (!resolvedPath.startsWith(this.baseDir)) {
      return null;
    }

    return resolvedPath;
  }

  /**
   * Validates a service name
   * @param {string} serviceName - Service name to validate
   * @returns {boolean} - True if valid
   */
  isValidService(serviceName) {
    const validServices = ['auth', 'orders', 'drivers', 'analytics', 'notifications', 'gateway', 'health'];
    return typeof serviceName === 'string' && 
           validServices.includes(serviceName) && 
           /^[a-zA-Z0-9_-]+$/.test(serviceName);
  }

  /**
   * Gets safe service path
   * @param {string} serviceName - Service name
   * @returns {string|null} - Safe path or null if invalid
   */
  getServicePath(serviceName) {
    if (!this.isValidService(serviceName)) {
      return null;
    }
    return this.resolvePath(`services/${serviceName}`);
  }

  /**
   * Creates directory safely
   * @param {string} dirPath - Directory path to create
   * @returns {boolean} - True if successful
   */
  safeMkdir(dirPath) {
    const safePath = this.resolvePath(dirPath);
    if (!safePath) {
      return false;
    }

    try {
      if (!fs.existsSync(safePath)) {
        fs.mkdirSync(safePath, { recursive: true });
      }
      return true;
    } catch (error) {
      console.error('Failed to create directory:', error.message);
      return false;
    }
  }
}

module.exports = PathSecurity;
