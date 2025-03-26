const schedule = require("node-schedule");
const expoPushNotifications = require("../utils/expoPushNotifications");

// 定时任务配置
const SCHEDULE_CONFIG = {
  // 任务配置
  DEFAULT_TIMEZONE: "Asia/Shanghai",
  MAX_JOBS: 100,

  // 汇率更新配置
  EXCHANGE_RATE_INTERVAL: "*/30 * * * * *", // 每30秒

  // 调试选项
  DEBUG: process.env.NODE_ENV === "development",
};

/**
 * 定时任务服务类
 */
class ScheduledNotifications {
  constructor() {
    this.jobs = new Map();
    this._log("info", "Scheduled notifications service initialized");
  }

  /**
   * 调度每日推送
   * @param {string} name - 任务名称
   * @param {number} hour - 小时
   * @param {number} minute - 分钟
   * @param {Array} pushTokens - 推送令牌列表
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Object} 任务对象
   */
  scheduleDaily(name, hour, minute, pushTokens, title, body, data = {}) {
    this._validateJobName(name);
    this._validateTokens(pushTokens);

    const rule = new schedule.RecurrenceRule();
    rule.hour = hour;
    rule.minute = minute;
    rule.tz = SCHEDULE_CONFIG.DEFAULT_TIMEZONE;

    const job = schedule.scheduleJob(name, rule, async () => {
      try {
        await expoPushNotifications.sendNotifications(
          pushTokens.map((token) =>
            expoPushNotifications.createMessage(token, title, body, data)
          )
        );
        this._log("info", `Daily notification sent: ${name}`);
      } catch (error) {
        this._handleError(`Failed to send daily notification: ${name}`, error);
      }
    });

    this.jobs.set(name, job);
    this._log("info", `Daily notification scheduled: ${name}`, {
      hour,
      minute,
      tokens: pushTokens.length,
    });

    return job;
  }

  /**
   * 调度自定义推送
   * @param {string} name - 任务名称
   * @param {string} cronExpression - Cron表达式
   * @param {Array} pushTokens - 推送令牌列表
   * @param {string} title - 消息标题
   * @param {string} body - 消息内容
   * @param {Object} data - 附加数据
   * @returns {Object} 任务对象
   */
  scheduleCustom(name, cronExpression, pushTokens, title, body, data = {}) {
    this._validateJobName(name);
    this._validateTokens(pushTokens);
    this._validateCronExpression(cronExpression);

    const job = schedule.scheduleJob(name, cronExpression, async () => {
      try {
        await expoPushNotifications.sendNotifications(
          pushTokens.map((token) =>
            expoPushNotifications.createMessage(token, title, body, data)
          )
        );
        this._log("info", `Custom notification sent: ${name}`);
      } catch (error) {
        this._handleError(`Failed to send custom notification: ${name}`, error);
      }
    });

    this.jobs.set(name, job);
    this._log("info", `Custom notification scheduled: ${name}`, {
      cron: cronExpression,
      tokens: pushTokens.length,
    });

    return job;
  }

  /**
   * 取消任务
   * @param {string} name - 任务名称
   * @returns {boolean} 是否成功取消
   */
  cancelJob(name) {
    const job = this.jobs.get(name);
    if (job) {
      job.cancel();
      this.jobs.delete(name);
      this._log("info", `Job cancelled: ${name}`);
      return true;
    }
    return false;
  }

  /**
   * 获取活动的任务
   * @returns {Object} 活动任务列表
   */
  getActiveJobs() {
    const activeJobs = {};
    for (const [name, job] of this.jobs.entries()) {
      activeJobs[name] = {
        name,
        nextInvocation: job.nextInvocation(),
      };
    }
    return activeJobs;
  }

  /**
   * 验证任务名称
   * @private
   * @param {string} name - 任务名称
   * @throws {Error} 验证失败时抛出错误
   */
  _validateJobName(name) {
    if (!name || typeof name !== "string") {
      throw new Error("Job name is required and must be a string");
    }

    if (this.jobs.has(name)) {
      throw new Error(`Job with name '${name}' already exists`);
    }

    if (this.jobs.size >= SCHEDULE_CONFIG.MAX_JOBS) {
      throw new Error("Maximum number of jobs reached");
    }
  }

  /**
   * 验证推送令牌
   * @private
   * @param {Array} tokens - 推送令牌列表
   * @throws {Error} 验证失败时抛出错误
   */
  _validateTokens(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new Error("Push tokens must be a non-empty array");
    }

    tokens.forEach((token) => {
      if (!expoPushNotifications.isExpoPushToken(token)) {
        throw new Error(`Invalid push token: ${token}`);
      }
    });
  }

  /**
   * 验证Cron表达式
   * @private
   * @param {string} expression - Cron表达式
   * @throws {Error} 验证失败时抛出错误
   */
  _validateCronExpression(expression) {
    try {
      new schedule.RecurrenceRule(expression);
    } catch (error) {
      throw new Error(`Invalid cron expression: ${expression}`);
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
    if (!SCHEDULE_CONFIG.DEBUG && level === "debug") {
      return;
    }

    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [Schedule] [${level.toUpperCase()}] ${message}`;

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

    if (error.stack && SCHEDULE_CONFIG.DEBUG) {
      this._log("error", "Stack:", error.stack);
    }
  }
}

// 导出单例
module.exports = new ScheduledNotifications();
