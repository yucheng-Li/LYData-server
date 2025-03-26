const { Expo } = require("expo-server-sdk");
const deviceManager = require("../services/deviceManager");

// Expo 推送服务配置
const EXPO_CONFIG = {
  // 基础配置
  maxConcurrentRequests: 6,
  timeout: 15000, // 15 秒超时

  // 消息配置
  defaultTTL: 3600, // 消息过期时间（秒）
  defaultPriority: "high",
  defaultSound: "default",
  defaultBadge: 1,

  // Android 配置
  defaultChannelId: "default",

  // iOS 配置
  mutableContent: true,
};

/**
 * Expo 推送通知服务类
 */
class ExpoPushNotification {
  constructor() {
    this.serviceAvailable = false;
    this.initializeService();
  }

  /**
   * 初始化推送服务
   * @private
   */
  async initializeService() {
    try {
      const accessToken = process.env.EXPO_ACCESS_TOKEN;

      // 初始化 Expo 客户端
      this.expo = new Expo({
        accessToken,
        httpAgent: undefined,
        maxConcurrentRequests: EXPO_CONFIG.maxConcurrentRequests,
        timeout: EXPO_CONFIG.timeout,
      });

      // 验证配置
      this._validateConfiguration(accessToken);

      // 测试服务连接
      await this._testServiceConnection();

      this.serviceAvailable = true;
      this._log("info", "Push notification service initialized successfully");
    } catch (error) {
      this._handleError("Service initialization failed", error);
      this.serviceAvailable = false;
    }
  }

  /**
   * 验证服务配置
   * @private
   * @param {string} accessToken - Expo 访问令牌
   */
  _validateConfiguration(accessToken) {
    if (!accessToken) {
      this._log(
        "warn",
        "No access token configured - push notifications may be rate limited"
      );
    }

    if (
      !this.expo ||
      typeof this.expo.getPushNotificationReceiptsAsync !== "function"
    ) {
      throw new Error("Expo SDK not properly initialized");
    }
  }

  /**
   * 测试服务连接
   * @private
   */
  async _testServiceConnection() {
    try {
      this._log("info", "Testing Expo service connection...");
      await this.expo.getPushNotificationReceiptsAsync([]);
      this._log("info", "✓ Expo push service is available");
    } catch (error) {
      if (error.code === "PUSH_TOO_MANY_EXPERIENCE_IDS") {
        this._log("info", "✓ Expo push service is available (expected error)");
      } else {
        throw error;
      }
    }
  }

  /**
   * 验证推送令牌格式
   * @param {string} token - Expo 推送令牌
   * @returns {boolean} 令牌是否有效
   */
  isExpoPushToken(token) {
    if (!token) return false;
    try {
      const isValid = Expo.isExpoPushToken(token);
      this._log("debug", `Token validation result for ${token}: ${isValid}`);
      return isValid;
    } catch (error) {
      this._handleError(`Invalid push token: ${token}`, error);
      return false;
    }
  }

  /**
   * 创建推送消息
   * @param {string} pushToken - 推送令牌
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Object|null} 消息对象
   */
  createMessage(pushToken, title, body, data = {}) {
    if (!this.isExpoPushToken(pushToken)) {
      return null;
    }

    return {
      to: pushToken,
      title,
      body,
      data,
      sound: EXPO_CONFIG.defaultSound,
      priority: EXPO_CONFIG.defaultPriority,
      channelId: EXPO_CONFIG.defaultChannelId,
      ttl: EXPO_CONFIG.defaultTTL,
      badge: EXPO_CONFIG.defaultBadge,
      mutableContent: EXPO_CONFIG.mutableContent,
    };
  }

  /**
   * 发送推送通知给所有设备
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Promise<Array>} 发送结果
   */
  async sendNotificationToAll(title, body, data = {}) {
    const tokens = await deviceManager.getActiveTokens();
    const messages = tokens
      .map((token) => this.createMessage(token, title, body, data))
      .filter(Boolean);

    return this.sendNotifications(messages);
  }

  /**
   * 发送推送通知给特定设备
   * @param {string} token - 推送令牌
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Promise<Array>} 发送结果
   */
  async sendNotificationToDevice(token, title, body, data = {}) {
    const message = this.createMessage(token, title, body, data);
    return message ? this.sendNotifications([message]) : [];
  }

  /**
   * 发送推送通知给特定平台的设备
   * @param {string} platform - 平台类型 ('ios' 或 'android')
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Promise<Array>} 发送结果
   */
  async sendNotificationToPlatform(platform, title, body, data = {}) {
    const devices = deviceManager.getAllDevices();
    const platformTokens = devices
      .filter(
        (device) =>
          device.deviceInfo.platform.toLowerCase() === platform.toLowerCase()
      )
      .map((device) => device.token);

    const messages = platformTokens
      .map((token) => this.createMessage(token, title, body, data))
      .filter(Boolean);

    return this.sendNotifications(messages);
  }

  /**
   * 发送推送通知
   * @param {Array} messages - 消息数组
   * @returns {Promise<Array>} 发送结果
   */
  async sendNotifications(messages) {
    if (!this._validateNotifications(messages)) {
      return [];
    }

    try {
      const chunks = this.expo.chunkPushNotifications(messages);
      this._log("debug", "Sending message chunks:", chunks);

      const tickets = [];
      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          this._log("debug", "Chunk sent successfully:", ticketChunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          this._handleError("Failed to send notification chunk", error);
        }
      }

      this._log("info", "All notifications sent", {
        ticketCount: tickets.length,
      });
      return tickets;
    } catch (error) {
      this._handleError("Fatal error sending notifications", error);
      return [];
    }
  }

  /**
   * 获取推送通知的接收状态
   * @param {Array} tickets - 发送凭证数组
   * @returns {Promise<Array>} 接收状态
   */
  async getPushNotificationReceipts(tickets) {
    if (!tickets?.length) return [];

    try {
      const receiptIds = tickets
        .filter((ticket) => ticket.id)
        .map((ticket) => ticket.id);
      if (!receiptIds.length) return [];

      const chunks = this.expo.chunkPushNotificationReceiptIds(receiptIds);
      const receipts = [];

      for (const chunk of chunks) {
        try {
          const receipt = await this.expo.getPushNotificationReceiptsAsync(
            chunk
          );
          receipts.push(receipt);
        } catch (error) {
          this._handleError("Failed to get receipt for chunk", error);
        }
      }

      return receipts;
    } catch (error) {
      this._handleError("Failed to get notification receipts", error);
      return [];
    }
  }

  /**
   * 验证通知消息
   * @private
   * @param {Array} messages - 消息数组
   * @returns {boolean} 验证结果
   */
  _validateNotifications(messages) {
    if (!messages?.length) {
      this._log("warn", "No messages to send");
      return false;
    }

    if (!this.serviceAvailable) {
      this._log("error", "Push notification service is not available");
      return false;
    }

    return true;
  }

  /**
   * 统一日志输出
   * @private
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} [data] - 附加数据
   */
  _log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    switch (level) {
      case "error":
        console.error(logMessage);
        break;
      case "warn":
        console.warn(logMessage);
        break;
      case "debug":
        if (process.env.NODE_ENV === "development") {
          console.log(logMessage);
          if (data) console.log(JSON.stringify(data, null, 2));
        }
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

    if (error.response) {
      this._log("error", "Response status:", error.response.status);
      this._log("error", "Response data:", error.response.data);
    }

    if (process.env.NODE_ENV === "development") {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new ExpoPushNotification();
