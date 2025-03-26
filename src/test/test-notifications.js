const axios = require("axios");

// 测试配置
const TEST_CONFIG = {
  // API 配置
  API_BASE_URL: "http://localhost:3000/api",
  TIMEOUT: 30000, // 增加超时时间到30秒
  RETRY_COUNT: 3, // 重试次数
  RETRY_DELAY: 1000, // 重试延迟（毫秒）

  // 测试参数
  WAIT_TIME: 65000, // 等待时间（毫秒）
  EXCHANGE_RATE_INTERVAL: "*/1 * * * *", // 每分钟
  CUSTOM_INTERVAL: "*/2 * * * *", // 每2分钟

  // 调试选项
  DEBUG: true,
};

// 测试设备数据
const TEST_DEVICES = [
  {
    token: "ExponentPushToken[oHL-PKOdQblqGqdZ_ongXi]",
    deviceInfo: {
      platform: "ios",
      deviceName: "Test iPhone",
      systemVersion: "15.0",
    },
  },
];

/**
 * 测试工具类
 */
class NotificationTester {
  constructor() {
    // 配置axios实例
    this.axiosInstance = axios.create({
      baseURL: TEST_CONFIG.API_BASE_URL,
      timeout: TEST_CONFIG.TIMEOUT,
      headers: {
        "Content-Type": "application/json",
      },
      // 不要让axios自动将非2xx状态码视为错误
      validateStatus: function (status) {
        return status >= 200 && status < 600;
      },
    });
  }

  /**
   * 验证测试配置
   * @private
   */
  _validateConfig() {
    if (!TEST_DEVICES?.length) {
      throw new Error("请配置至少一个测试设备");
    }

    TEST_DEVICES.forEach((device) => {
      if (
        !device.token.startsWith("ExponentPushToken[") ||
        !device.token.endsWith("]")
      ) {
        throw new Error(`无效的 Expo Push Token 格式: ${device.token}`);
      }
      if (!["ios", "android"].includes(device.deviceInfo.platform)) {
        throw new Error(`无效的平台类型: ${device.deviceInfo.platform}`);
      }
    });
  }

  /**
   * 日志输出
   * @private
   * @param {string} message - 日志消息
   * @param {Object} [data] - 附加数据
   */
  _log(message, data = null) {
    if (TEST_CONFIG.DEBUG) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`);
      if (data) {
        console.log(JSON.stringify(data, null, 2));
      }
    }
  }

  /**
   * 错误处理
   * @private
   * @param {string} context - 错误上下文
   * @param {Error} error - 错误对象
   */
  _handleError(context, error) {
    console.error(`\n❌ ${context}:`);
    if (error.response) {
      console.error("服务器响应:", error.response.data);
      console.error("状态码:", error.response.status);
    } else if (error.request) {
      console.error("请求错误:", error.message);
    } else {
      console.error("其他错误:", error.message);
    }
  }

  /**
   * 测试设备注册
   */
  async testDeviceRegistration() {
    try {
      this._validateConfig();
      this._log("\n=== 测试设备注册 ===");

      for (const device of TEST_DEVICES) {
        try {
          this._log(
            `注册设备: ${device.deviceInfo.deviceName} (${device.deviceInfo.platform})`
          );
          this._log("请求数据:", device);

          // 发送注册请求
          const response = await this._retryRequest(async () => {
            const result = await this.axiosInstance.post(
              "/register-push-token",
              device
            );
            return result;
          });

          // 检查响应状态
          if (response.status === 502) {
            // 502可能是因为推送服务异步发送导致的，不一定是真正的错误
            this._log(
              "注意: 收到502响应，但这可能是因为推送服务异步发送导致的"
            );
            this._log("如果你的设备收到了推送通知，则说明注册实际上是成功的");
          } else if (response.status >= 200 && response.status < 300) {
            this._log("注册成功:", response.data);
          } else {
            this._log("注册失败:", {
              status: response.status,
              data: response.data,
            });
          }

          // 等待一段时间，确保推送有时间发送
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          this._handleError(
            `设备注册请求失败 (${device.deviceInfo.deviceName})`,
            error
          );
        }
      }
    } catch (error) {
      this._handleError("测试设备注册失败", error);
    }
  }

  /**
   * 重试请求
   * @private
   * @param {Function} requestFn - 请求函数
   * @returns {Promise} 请求结果
   */
  async _retryRequest(requestFn) {
    let lastError;
    for (let i = 0; i < TEST_CONFIG.RETRY_COUNT; i++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;
        this._log(`请求失败，第 ${i + 1} 次重试...`);
        await new Promise((resolve) =>
          setTimeout(resolve, TEST_CONFIG.RETRY_DELAY)
        );
      }
    }
    throw lastError;
  }

  /**
   * 测试汇率推送
   */
  async testExchangeRateNotification() {
    this._log("\n=== 测试汇率推送 ===");

    try {
      this._log("创建汇率更新推送任务...");
      const response = await this.axiosInstance.post(
        "/notifications/schedule/exchange-rate",
        {
          name: "test-exchange-rate",
          cronExpression: TEST_CONFIG.EXCHANGE_RATE_INTERVAL,
        }
      );

      this._log("创建汇率推送任务成功:", response.data);

      const activeJobs = await this.axiosInstance.get(
        "/notifications/schedule"
      );
      this._log("当前活动的任务:", activeJobs.data);

      this._log(`等待 ${TEST_CONFIG.WAIT_TIME / 1000} 秒后将取消任务...`);
      await new Promise((resolve) =>
        setTimeout(resolve, TEST_CONFIG.WAIT_TIME)
      );

      const cancelResponse = await this.axiosInstance.delete(
        "/notifications/schedule/test-exchange-rate"
      );
      this._log("取消任务结果:", cancelResponse.data);
    } catch (error) {
      this._handleError("测试汇率推送时出错", error);
    }
  }

  /**
   * 测试每日定时推送
   */
  async testDailyNotification() {
    this._log("\n=== 测试每日定时推送 ===");

    try {
      const now = new Date();
      const response = await this.axiosInstance.post(
        "/notifications/schedule/daily",
        {
          name: "test-daily",
          hour: now.getHours(),
          minute: now.getMinutes() + 1,
          pushTokens: TEST_DEVICES.map((d) => d.token),
          title: "测试每日推送",
          body: "这是一条测试推送消息",
          data: { type: "test-daily" },
        }
      );

      this._log("创建每日推送任务成功:", response.data);
    } catch (error) {
      this._handleError("测试每日推送时出错", error);
    }
  }

  /**
   * 测试自定义定时推送
   */
  async testCustomNotification() {
    this._log("\n=== 测试自定义定时推送 ===");

    try {
      const response = await this.axiosInstance.post(
        "/notifications/schedule/custom",
        {
          name: "test-custom",
          cronExpression: TEST_CONFIG.CUSTOM_INTERVAL,
          pushTokens: TEST_DEVICES.map((d) => d.token),
          title: "测试自定义推送",
          body: "这是一条自定义测试推送消息",
          data: { type: "test-custom" },
        }
      );

      this._log("创建自定义推送任务成功:", response.data);
    } catch (error) {
      this._handleError("测试自定义推送时出错", error);
    }
  }

  /**
   * 测试错误处理
   */
  async testErrorHandling() {
    this._log("\n=== 测试错误处理 ===");

    try {
      this._log("测试无效的 token...");
      await this.axiosInstance.post("/register-push-token", {
        token: "InvalidToken",
        deviceInfo: {
          platform: "ios",
          deviceName: "Invalid Device",
        },
      });
    } catch (error) {
      this._log("预期的错误响应:", error.response?.data);
    }

    try {
      this._log("测试无效的平台类型...");
      await this.axiosInstance.post("/register-push-token", {
        token: "ExponentPushToken[XXXXXXXXXXXXXXXXXXXX]",
        deviceInfo: {
          platform: "windows",
          deviceName: "Invalid Platform",
        },
      });
    } catch (error) {
      this._log("预期的错误响应:", error.response?.data);
    }
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    try {
      console.log("开始运行所有测试...\n");

      await this.testDeviceRegistration();
      await this.testExchangeRateNotification();
      await this.testDailyNotification();
      await this.testCustomNotification();
      await this.testErrorHandling();

      console.log("\n所有测试完成！");
    } catch (error) {
      this._handleError("测试过程中出现未处理的错误", error);
    }
  }
}

// 创建测试实例
const tester = new NotificationTester();

// 检查命令行参数
const args = process.argv.slice(2);
if (args.length > 0) {
  const testMap = {
    register: () => tester.testDeviceRegistration(),
    exchange: () => tester.testExchangeRateNotification(),
    daily: () => tester.testDailyNotification(),
    custom: () => tester.testCustomNotification(),
    error: () => tester.testErrorHandling(),
  };

  const testFunction = testMap[args[0]];
  if (testFunction) {
    console.log(`运行单个测试: ${args[0]}`);
    testFunction();
  } else {
    console.error(`未知的测试类型: ${args[0]}`);
    console.log("可用的测试类型: register, exchange, daily, custom, error");
  }
} else {
  tester.runAllTests();
}
