const scheduledNotifications = require("./scheduledNotifications");
const exchangeRateService = require("./exchangeRateService");
const deviceManager = require("./deviceManager");
const expoPushNotifications = require("../utils/expoPushNotifications");

// 汇率更新服务配置
const UPDATER_CONFIG = {
  // 任务配置
  JOB_NAME: "exchange-rate-update",
  CRON_EXPRESSION: "0 */30 * * * *", // 每半小时（每个小时的0分和30分）

  // 消息配置
  NOTIFICATION_TITLE: "日元汇率更新",

  // 调试选项
  DEBUG: process.env.NODE_ENV === "development",
};

/**
 * 汇率更新服务类
 */
class ExchangeRateUpdater {
  constructor() {
    this.job = null;
    this._log("info", "Exchange rate updater service initialized");
  }

  /**
   * 启动汇率更新服务
   */
  async start() {
    try {
      // 确保服务可用
      await this._validateServices();

      // 获取所有活跃设备的推送令牌
      const tokens = await deviceManager.getActiveTokens();
      if (tokens.length === 0) {
        this._log("warn", "No active devices found for notifications");
        return;
      }

      // 创建定时任务
      this.job = scheduledNotifications.scheduleCustom(
        UPDATER_CONFIG.JOB_NAME,
        UPDATER_CONFIG.CRON_EXPRESSION,
        tokens,
        UPDATER_CONFIG.NOTIFICATION_TITLE,
        await this._getLatestRateMessage(),
        { type: "exchange_rate" }
      );

      this._log("info", "Exchange rate update service started", {
        tokens: tokens.length,
        interval: UPDATER_CONFIG.CRON_EXPRESSION,
      });
    } catch (error) {
      this._handleError("Failed to start exchange rate update service", error);
      throw error;
    }
  }

  /**
   * 获取最新汇率消息
   * @private
   * @returns {Promise<string>} 格式化的汇率消息
   */
  async _getLatestRateMessage() {
    try {
      const result = await exchangeRateService.getExchangeRates();
      if (!result.success) {
        return "无法获取最新汇率数据";
      }
      return exchangeRateService.formatRateMessage(result.rates);
    } catch (error) {
      this._handleError("Failed to get latest rate message", error);
      return "汇率数据更新失败";
    }
  }

  /**
   * 发送汇率更新通知
   * @private
   * @param {Array} tokens - 推送令牌列表
   */
  async _sendRateUpdateNotification(tokens) {
    try {
      const message = await this._getLatestRateMessage();
      const notifications = tokens.map((token) =>
        expoPushNotifications.createMessage(
          token,
          UPDATER_CONFIG.NOTIFICATION_TITLE,
          message,
          { type: "exchange_rate" }
        )
      );

      await expoPushNotifications.sendNotifications(notifications);
      this._log("info", "Rate update notification sent successfully");
    } catch (error) {
      this._handleError("Failed to send rate update notification", error);
    }
  }

  /**
   * 停止汇率更新服务
   */
  stop() {
    try {
      if (this.job) {
        scheduledNotifications.cancelJob(UPDATER_CONFIG.JOB_NAME);
        this.job = null;
        this._log("info", "Exchange rate update service stopped");
      }
    } catch (error) {
      this._handleError("Failed to stop exchange rate update service", error);
      throw error;
    }
  }

  /**
   * 重启汇率更新服务
   */
  async restart() {
    this._log("info", "Restarting exchange rate update service");
    this.stop();
    await this.start();
  }

  /**
   * 验证所需服务是否可用
   * @private
   */
  async _validateServices() {
    try {
      // 验证汇率服务
      const result = await exchangeRateService.getExchangeRates();
      if (!result.success || !result.rates.CNY) {
        throw new Error("Exchange rate service returned invalid data");
      }

      // 验证设备管理服务
      const devices = await deviceManager.getAllDevices();
      if (!Array.isArray(devices)) {
        throw new Error("Device manager service returned invalid data");
      }

      this._log("debug", "Services validation successful");
    } catch (error) {
      this._handleError("Services validation failed", error);
      throw error;
    }
  }

  /**
   * 日志输出
   * @private
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} [data] - 附加数据
   */
  _log(level, message, data = null) {
    if (!UPDATER_CONFIG.DEBUG && level === "debug") {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ExchangeRateUpdater] [${level.toUpperCase()}] ${message}`;

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
   * 错误处理
   * @private
   * @param {string} context - 错误上下文
   * @param {Error} error - 错误对象
   */
  _handleError(context, error) {
    this._log("error", `${context}:`);
    this._log("error", `Name: ${error.name}`);
    this._log("error", `Message: ${error.message}`);

    if (error.stack && UPDATER_CONFIG.DEBUG) {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new ExchangeRateUpdater();
