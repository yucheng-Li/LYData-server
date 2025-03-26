const axios = require("axios");

// 汇率服务配置
const EXCHANGE_RATE_CONFIG = {
  // API配置
  API_URL: "https://api.exchangerate-api.com/v4/latest/USD",
  TIMEOUT: 10000,
  RETRY_COUNT: 3,
  RETRY_DELAY: 1000,

  // 目标货币
  TARGET_CURRENCIES: ["CNY", "JPY"],

  // 缓存配置
  CACHE_DURATION: 30 * 60 * 1000, // 30分钟缓存

  // 调试选项
  DEBUG: process.env.NODE_ENV === "development",
};

/**
 * 汇率服务类
 */
class ExchangeRateService {
  constructor() {
    this.cache = {
      rates: null,
      timestamp: null,
    };
  }

  /**
   * 获取最新汇率
   * @returns {Promise<Object>} 汇率数据
   */
  async getExchangeRates() {
    try {
      // 检查缓存是否有效
      if (this._isCacheValid()) {
        this._log("debug", "Using cached exchange rates");
        return {
          success: true,
          rates: this.cache.rates,
          timestamp: this.cache.timestamp,
        };
      }

      // 获取新数据
      const response = await this._fetchWithRetry();
      const rates = {};

      // 保存CNY和JPY汇率
      if (response.data.rates.CNY && response.data.rates.JPY) {
        rates.CNY = response.data.rates.CNY;
        rates.JPY = response.data.rates.JPY;
        // 计算JPY/CNY汇率
        rates.JPY_CNY = this._calculateCrossRate(
          response.data.rates.CNY,
          response.data.rates.JPY
        );
      }

      // 更新缓存
      this.cache = {
        rates,
        timestamp: new Date().toISOString(),
      };

      this._log("info", "Exchange rates updated successfully", rates);
      return {
        success: true,
        rates,
        timestamp: this.cache.timestamp,
      };
    } catch (error) {
      this._handleError("Failed to get exchange rates", error);
      return {
        success: false,
        error: "Failed to fetch exchange rates",
      };
    }
  }

  /**
   * 计算交叉汇率
   * @private
   * @param {number} cnyRate - CNY/USD汇率
   * @param {number} jpyRate - JPY/USD汇率
   * @returns {number} JPY/CNY汇率
   */
  _calculateCrossRate(cnyRate, jpyRate) {
    // JPY/CNY = (CNY/USD) / (JPY/USD)
    return cnyRate / jpyRate;
  }

  /**
   * 格式化汇率消息
   * @param {Object} rates - 汇率数据
   * @returns {string} 格式化后的消息
   */
  formatRateMessage(rates) {
    if (!rates.JPY_CNY) {
      return "暂无日元兑人民币汇率数据";
    }

    const rate = this._formatRate(rates.JPY_CNY);
    return `当前日元兑人民币汇率：\n100 JPY = ${(rate * 100).toFixed(4)} CNY`;
  }

  /**
   * 格式化单个汇率
   * @private
   * @param {number} rate - 汇率值
   * @returns {string} 格式化后的汇率
   */
  _formatRate(rate) {
    return rate;
  }

  /**
   * 检查缓存是否有效
   * @private
   * @returns {boolean} 缓存是否有效
   */
  _isCacheValid() {
    if (!this.cache.rates || !this.cache.timestamp) {
      return false;
    }

    const now = new Date().getTime();
    const cacheTime = new Date(this.cache.timestamp).getTime();
    return now - cacheTime < EXCHANGE_RATE_CONFIG.CACHE_DURATION;
  }

  /**
   * 带重试的数据获取
   * @private
   * @returns {Promise<Object>} API响应
   */
  async _fetchWithRetry() {
    let lastError;

    for (let i = 0; i < EXCHANGE_RATE_CONFIG.RETRY_COUNT; i++) {
      try {
        return await axios.get(EXCHANGE_RATE_CONFIG.API_URL, {
          timeout: EXCHANGE_RATE_CONFIG.TIMEOUT,
        });
      } catch (error) {
        lastError = error;
        this._log("warn", `Fetch attempt ${i + 1} failed, retrying...`);
        await new Promise((resolve) =>
          setTimeout(resolve, EXCHANGE_RATE_CONFIG.RETRY_DELAY)
        );
      }
    }

    throw lastError;
  }

  /**
   * 日志输出
   * @private
   * @param {string} level - 日志级别
   * @param {string} message - 日志消息
   * @param {Object} [data] - 附加数据
   */
  _log(level, message, data = null) {
    if (!EXCHANGE_RATE_CONFIG.DEBUG && level === "debug") {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [ExchangeRate] [${level.toUpperCase()}] ${message}`;

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

    if (error.response) {
      this._log("error", "Response status:", error.response.status);
      this._log("error", "Response data:", error.response.data);
    }

    if (EXCHANGE_RATE_CONFIG.DEBUG) {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new ExchangeRateService();
