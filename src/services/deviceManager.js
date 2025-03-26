const fs = require("fs").promises;
const path = require("path");

// 设备管理配置
const DEVICE_CONFIG = {
  // 文件存储配置
  STORAGE_DIR: path.join(process.cwd(), "data"),
  DEVICES_FILE: "devices.json",

  // 设备配置
  SUPPORTED_PLATFORMS: ["ios", "android"],
  MAX_DEVICES_PER_USER: 5,
  TOKEN_EXPIRY_DAYS: 30,

  // 调试选项
  DEBUG: process.env.NODE_ENV === "development",
};

/**
 * 设备管理服务类
 */
class DeviceManager {
  constructor() {
    this.devices = new Map();
    this.initialized = false;
    this.initializeService();
  }

  /**
   * 初始化服务
   * @private
   */
  async initializeService() {
    try {
      await this._ensureStorageDirectory();
      await this._loadDevices();
      this.initialized = true;
      this._log("info", "Device manager initialized successfully");
    } catch (error) {
      this._handleError("Failed to initialize device manager", error);
      this.initialized = false;
    }
  }

  /**
   * 确保存储目录存在
   * @private
   */
  async _ensureStorageDirectory() {
    try {
      await fs.access(DEVICE_CONFIG.STORAGE_DIR);
    } catch {
      await fs.mkdir(DEVICE_CONFIG.STORAGE_DIR, { recursive: true });
      this._log(
        "info",
        `Created storage directory: ${DEVICE_CONFIG.STORAGE_DIR}`
      );
    }
  }

  /**
   * 加载设备数据
   * @private
   */
  async _loadDevices() {
    const filePath = path.join(
      DEVICE_CONFIG.STORAGE_DIR,
      DEVICE_CONFIG.DEVICES_FILE
    );
    try {
      const data = await fs.readFile(filePath, "utf8");
      const devices = JSON.parse(data);
      this.devices = new Map(Object.entries(devices));
      this._log("info", `Loaded ${this.devices.size} devices from storage`);
    } catch (error) {
      if (error.code === "ENOENT") {
        this._log("info", "No existing devices file found, starting fresh");
        await this._saveDevices();
      } else {
        throw new Error(`Failed to load devices: ${error.message}`);
      }
    }
  }

  /**
   * 保存设备数据
   * @private
   */
  async _saveDevices() {
    const filePath = path.join(
      DEVICE_CONFIG.STORAGE_DIR,
      DEVICE_CONFIG.DEVICES_FILE
    );
    try {
      const data = JSON.stringify(Object.fromEntries(this.devices), null, 2);
      await fs.writeFile(filePath, data, "utf8");
      this._log("debug", "Devices saved to storage");
    } catch (error) {
      throw new Error(`Failed to save devices: ${error.message}`);
    }
  }

  /**
   * 验证设备信息
   * @private
   * @param {Object} deviceInfo - 设备信息
   * @throws {Error} 验证失败时抛出错误
   */
  _validateDeviceInfo(deviceInfo) {
    if (!deviceInfo) {
      throw new Error("Device info is required");
    }

    const { platform, deviceName } = deviceInfo;

    if (
      !platform ||
      !DEVICE_CONFIG.SUPPORTED_PLATFORMS.includes(platform.toLowerCase())
    ) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    if (!deviceName || typeof deviceName !== "string") {
      throw new Error("Device name is required and must be a string");
    }
  }

  /**
   * 验证推送令牌
   * @private
   * @param {string} token - 推送令牌
   * @throws {Error} 验证失败时抛出错误
   */
  _validateToken(token) {
    if (!token || typeof token !== "string") {
      throw new Error("Push token is required and must be a string");
    }

    if (!token.startsWith("ExponentPushToken[") || !token.endsWith("]")) {
      throw new Error("Invalid Expo push token format");
    }
  }

  /**
   * 注册设备
   * @param {string} token - 推送令牌
   * @param {Object} deviceInfo - 设备信息
   * @returns {Promise<Object>} 注册结果
   */
  async registerDevice(token, deviceInfo) {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    try {
      this._validateToken(token);
      this._validateDeviceInfo(deviceInfo);

      const device = {
        token,
        deviceInfo,
        lastUpdated: new Date().toISOString(),
      };

      this.devices.set(token, device);
      await this._saveDevices();

      this._log(
        "info",
        `Device registered successfully: ${deviceInfo.deviceName}`
      );
      return device;
    } catch (error) {
      this._handleError("Failed to register device", error);
      throw error;
    }
  }

  /**
   * 更新设备信息
   * @param {string} token - 推送令牌
   * @param {Object} deviceInfo - 设备信息
   * @returns {Promise<Object>} 更新结果
   */
  async updateDevice(token, deviceInfo) {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    try {
      this._validateToken(token);
      this._validateDeviceInfo(deviceInfo);

      if (!this.devices.has(token)) {
        throw new Error("Device not found");
      }

      const device = {
        ...this.devices.get(token),
        deviceInfo,
        lastUpdated: new Date().toISOString(),
      };

      this.devices.set(token, device);
      await this._saveDevices();

      this._log(
        "info",
        `Device updated successfully: ${deviceInfo.deviceName}`
      );
      return device;
    } catch (error) {
      this._handleError("Failed to update device", error);
      throw error;
    }
  }

  /**
   * 删除设备
   * @param {string} token - 推送令牌
   * @returns {Promise<boolean>} 删除结果
   */
  async removeDevice(token) {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    try {
      this._validateToken(token);

      if (!this.devices.has(token)) {
        return false;
      }

      this.devices.delete(token);
      await this._saveDevices();

      this._log("info", `Device removed successfully: ${token}`);
      return true;
    } catch (error) {
      this._handleError("Failed to remove device", error);
      throw error;
    }
  }

  /**
   * 获取设备信息
   * @param {string} token - 推送令牌
   * @returns {Object|null} 设备信息
   */
  getDevice(token) {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    return this.devices.get(token) || null;
  }

  /**
   * 获取所有设备
   * @returns {Array} 设备列表
   */
  getAllDevices() {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    return Array.from(this.devices.values());
  }

  /**
   * 获取特定平台的设备
   * @param {string} platform - 平台类型
   * @returns {Array} 设备列表
   */
  getDevicesByPlatform(platform) {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    if (!DEVICE_CONFIG.SUPPORTED_PLATFORMS.includes(platform.toLowerCase())) {
      throw new Error(`Unsupported platform: ${platform}`);
    }

    return this.getAllDevices().filter(
      (device) =>
        device.deviceInfo.platform.toLowerCase() === platform.toLowerCase()
    );
  }

  /**
   * 获取活跃设备的令牌
   * @returns {Array} 令牌列表
   */
  getActiveTokens() {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    const now = new Date();
    const expiryTime = new Date(
      now.getTime() - DEVICE_CONFIG.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    );

    return this.getAllDevices()
      .filter((device) => new Date(device.lastUpdated) > expiryTime)
      .map((device) => device.token);
  }

  /**
   * 清理过期设备
   * @returns {Promise<number>} 清理的设备数量
   */
  async cleanupExpiredDevices() {
    if (!this.initialized) {
      throw new Error("Device manager is not initialized");
    }

    try {
      const now = new Date();
      const expiryTime = new Date(
        now.getTime() - DEVICE_CONFIG.TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000
      );
      let cleanupCount = 0;

      for (const [token, device] of this.devices.entries()) {
        if (new Date(device.lastUpdated) <= expiryTime) {
          this.devices.delete(token);
          cleanupCount++;
        }
      }

      if (cleanupCount > 0) {
        await this._saveDevices();
        this._log("info", `Cleaned up ${cleanupCount} expired devices`);
      }

      return cleanupCount;
    } catch (error) {
      this._handleError("Failed to cleanup expired devices", error);
      throw error;
    }
  }

  /**
   * 统一日志输出
   * @private
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} [data] - 附加数据
   */
  _log(level, message, data = null) {
    if (!DEVICE_CONFIG.DEBUG && level === "debug") {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [DeviceManager] [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case "error":
        console.error(logMessage);
        break;
      case "warn":
        console.warn(logMessage);
        break;
      case "debug":
        console.log(logMessage);
        if (data) console.log(JSON.stringify(data, null, 2));
        break;
      default:
        console.log(logMessage);
    }
  }

  /**
   * 统一错误处理
   * @private
   * @param {string} context - 错误上下文
   * @param {Error} error - 错误对象
   */
  _handleError(context, error) {
    this._log("error", `${context}:`);
    this._log("error", `Name: ${error.name}`);
    this._log("error", `Message: ${error.message}`);

    if (error.code) {
      this._log("error", `Code: ${error.code}`);
    }

    if (DEVICE_CONFIG.DEBUG) {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new DeviceManager();

module.exports = new DeviceManager();
