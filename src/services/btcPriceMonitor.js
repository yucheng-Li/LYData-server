const axios = require("axios");
const scheduledNotifications = require("./scheduledNotifications");
const deviceManager = require("./deviceManager");
const expoPushNotifications = require("../utils/expoPushNotifications");

// BTC价格监控服务配置
const BTC_MONITOR_CONFIG = {
  // API配置
  API_URL: "https://www.okx.com/api/v5/market/ticker",
  TIMEOUT: 10000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,

  // 监控配置
  CHECK_INTERVAL: "*/5 * * * *", // 每5分钟检查一次
  NOTIFICATION_INTERVAL: "0 */30 * * * *", // 每30分钟推送一次（整点和半点）
  PRICE_THRESHOLD: 80000, // 价格预警阈值（美元）
  TRADING_PAIR: "BTC-USDT",

  // 任务配置
  REGULAR_UPDATE_JOB: "btc-price-update",
  PRICE_ALERT_JOB: "btc-price-alert",

  // 调试选项
  DEBUG: process.env.NODE_ENV === "development",
};

/**
 * BTC价格监控服务类
 */
class BTCPriceMonitor {
  constructor() {
    this.regularJob = null;
    this.monitorJob = null;
    this.lastAlertPrice = null;
    this.lastAlertTime = null;
    this._log("info", "BTC price monitor service initialized");
  }

  /**
   * 启动服务
   */
  async start() {
    try {
      // 获取所有活跃设备的推送令牌
      const tokens = await deviceManager.getActiveTokens();
      if (tokens.length === 0) {
        this._log("warn", "No active devices found for notifications");
        return;
      }

      // 启动定时推送任务（每30分钟更新一次价格）
      this.regularJob = scheduledNotifications.scheduleCustom(
        BTC_MONITOR_CONFIG.REGULAR_UPDATE_JOB,
        BTC_MONITOR_CONFIG.NOTIFICATION_INTERVAL,
        tokens,
        "BTC价格更新",
        await this._getPriceMessage(),
        { type: "btc_price_update" }
      );

      // 启动价格监控（每5分钟检查一次）
      setInterval(async () => {
        await this._checkPriceAlert();
      }, 5 * 60 * 1000); // 5分钟

      this._log("info", "BTC price monitor service started", {
        tokens: tokens.length,
        checkInterval: "5 minutes",
        notificationInterval: "30 minutes",
      });
    } catch (error) {
      this._handleError("Failed to start BTC price monitor service", error);
      throw error;
    }
  }

  /**
   * 获取最新价格
   * @private
   * @returns {Promise<Object>} 价格数据
   */
  async _fetchPrice() {
    try {
      const response = await this._fetchWithRetry();
      if (response.data.code === "0" && response.data.data.length > 0) {
        const priceData = response.data.data[0];
        return {
          success: true,
          price: parseFloat(priceData.last),
          high24h: parseFloat(priceData.high24h),
          low24h: parseFloat(priceData.low24h),
          open24h: parseFloat(priceData.open24h),
          timestamp: new Date(parseInt(priceData.ts)).toISOString(),
        };
      }
      throw new Error("Invalid response format");
    } catch (error) {
      this._handleError("Failed to fetch BTC price", error);
      return {
        success: false,
        error: "Failed to fetch BTC price",
      };
    }
  }

  /**
   * 检查价格并发送预警
   * @private
   */
  async _checkPriceAlert() {
    try {
      const priceData = await this._fetchPrice();
      if (!priceData.success) return;

      const currentPrice = priceData.price;
      const now = new Date().getTime();

      this._log("debug", "Checking price alert", {
        currentPrice,
        threshold: BTC_MONITOR_CONFIG.PRICE_THRESHOLD,
        lastAlertTime: this.lastAlertTime
          ? new Date(this.lastAlertTime).toISOString()
          : null,
        lastAlertPrice: this.lastAlertPrice,
      });

      // 只在价格低于阈值时触发预警
      if (currentPrice < BTC_MONITOR_CONFIG.PRICE_THRESHOLD) {
        // 检查是否需要发送预警
        const shouldAlert =
          !this.lastAlertTime || // 首次预警
          now - this.lastAlertTime > 30 * 60 * 1000 || // 距离上次预警超过30分钟
          (this.lastAlertPrice && currentPrice < this.lastAlertPrice * 0.95); // 价格较上次预警又下跌了5%

        if (shouldAlert) {
          const tokens = await deviceManager.getActiveTokens();

          // 计算与阈值的差距百分比
          const thresholdDiff = (
            ((BTC_MONITOR_CONFIG.PRICE_THRESHOLD - currentPrice) /
              BTC_MONITOR_CONFIG.PRICE_THRESHOLD) *
            100
          ).toFixed(2);

          const message = `🔴 ⬇️ BTC价格预警！\n当前价格: ${currentPrice.toFixed(
            2
          )} USDT\n已跌破 ${
            BTC_MONITOR_CONFIG.PRICE_THRESHOLD
          } USDT\n低于阈值: ${thresholdDiff}%`;

          const notifications = tokens.map((token) =>
            expoPushNotifications.createMessage(token, "BTC价格预警", message, {
              type: "btc_price_alert",
            })
          );

          await expoPushNotifications.sendNotifications(notifications);
          this.lastAlertPrice = currentPrice;
          this.lastAlertTime = now;
          this._log("info", "Price alert notification sent", {
            price: currentPrice,
            threshold: BTC_MONITOR_CONFIG.PRICE_THRESHOLD,
          });
        }
      }
    } catch (error) {
      this._handleError("Failed to check price alert", error);
    }
  }

  /**
   * 获取价格消息
   * @private
   * @returns {Promise<string>} 格式化的价格消息
   */
  async _getPriceMessage() {
    try {
      const priceData = await this._fetchPrice();
      if (!priceData.success) {
        return "无法获取BTC价格数据";
      }

      // 计算24小时涨跌幅
      const priceChange = priceData.price - priceData.open24h;
      const priceChangePercent = (
        (priceChange / priceData.open24h) *
        100
      ).toFixed(2);

      // 根据涨跌选择颜色和图标
      const isPositive = priceChange >= 0;
      const colorIcon = isPositive ? "🟢" : "🔴";
      const directionIcon = isPositive ? "⬆️" : "⬇️";

      // 格式化价格变化
      const changeText = `${colorIcon} ${directionIcon} ${priceChangePercent}%`;

      return `BTC最新价格：${priceData.price.toFixed(
        2
      )} USDT\n24h高：${priceData.high24h.toFixed(
        2
      )}\n24h低：${priceData.low24h.toFixed(2)}\n24h涨跌：${changeText}`;
    } catch (error) {
      this._handleError("Failed to get price message", error);
      return "价格数据更新失败";
    }
  }

  /**
   * 带重试的数据获取
   * @private
   * @returns {Promise<Object>} API响应
   */
  async _fetchWithRetry() {
    let lastError;

    for (let i = 0; i < BTC_MONITOR_CONFIG.RETRY_COUNT; i++) {
      try {
        return await axios.get(BTC_MONITOR_CONFIG.API_URL, {
          params: { instId: BTC_MONITOR_CONFIG.TRADING_PAIR },
          timeout: BTC_MONITOR_CONFIG.TIMEOUT,
        });
      } catch (error) {
        lastError = error;
        this._log("warn", `Fetch attempt ${i + 1} failed, retrying...`);
        await new Promise((resolve) =>
          setTimeout(resolve, BTC_MONITOR_CONFIG.RETRY_DELAY)
        );
      }
    }

    throw lastError;
  }

  /**
   * 停止服务
   */
  stop() {
    try {
      if (this.regularJob) {
        scheduledNotifications.cancelJob(BTC_MONITOR_CONFIG.REGULAR_UPDATE_JOB);
        this.regularJob = null;
      }
      if (this.monitorJob) {
        scheduledNotifications.cancelJob(BTC_MONITOR_CONFIG.PRICE_ALERT_JOB);
        this.monitorJob = null;
      }
      this._log("info", "BTC price monitor service stopped");
    } catch (error) {
      this._handleError("Failed to stop BTC price monitor service", error);
      throw error;
    }
  }

  /**
   * 重启服务
   */
  async restart() {
    this._log("info", "Restarting BTC price monitor service");
    this.stop();
    await this.start();
  }

  /**
   * 日志输出
   * @private
   */
  _log(level, message, data = null) {
    if (!BTC_MONITOR_CONFIG.DEBUG && level === "debug") {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [BTCMonitor] [${level.toUpperCase()}] ${message}`;

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
   */
  _handleError(context, error) {
    this._log("error", `${context}:`);
    this._log("error", `Name: ${error.name}`);
    this._log("error", `Message: ${error.message}`);

    if (error.response) {
      this._log("error", "Response status:", error.response.status);
      this._log("error", "Response data:", error.response.data);
    }

    if (BTC_MONITOR_CONFIG.DEBUG) {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new BTCPriceMonitor();
