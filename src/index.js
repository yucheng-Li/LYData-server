require("dotenv").config();
const express = require("express");
const scheduledNotifications = require("./services/scheduledNotifications");
const exchangeRateService = require("./services/exchangeRateService");
const deviceManager = require("./services/deviceManager");
const expoPushNotifications = require("./utils/expoPushNotifications");
const exchangeRateUpdater = require("./services/exchangeRateUpdater");
const btcPriceMonitor = require("./services/btcPriceMonitor");

const app = express();
app.use(express.json());

// 设备注册接口
app.post("/api/register-push-token", async (req, res) => {
  try {
    const { token, platform } = req.body;

    if (!token || !platform) {
      return res.status(400).json({
        success: false,
        error: "Token and platform are required",
      });
    }

    // 验证令牌格式
    if (!expoPushNotifications.isExpoPushToken(token)) {
      return res.status(400).json({
        success: false,
        error: "Invalid push token format",
      });
    }

    // 注册设备
    await deviceManager.registerDevice(token, platform);

    // 发送测试通知
    const message = expoPushNotifications.createMessage(
      token,
      "注册成功",
      "您已成功注册推送服务",
      { type: "registration" }
    );

    await expoPushNotifications.sendNotifications([message]);

    // 重启汇率更新服务以包含新设备
    await exchangeRateUpdater.restart();

    res.json({
      success: true,
      message: "Push token registered successfully",
    });
  } catch (error) {
    console.error("Error registering push token:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// 修改汇率更新的定时推送任务
app.post("/api/notifications/schedule/exchange-rate", async (req, res) => {
  const { name, cronExpression } = req.body;

  if (!name || !cronExpression) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    // 获取当前汇率
    const rateResult = await exchangeRateService.getExchangeRates();
    if (!rateResult.success) {
      return res.status(500).json({ error: "Failed to fetch exchange rates" });
    }

    // 使用设备管理器获取所有注册的设备
    const tokens = await deviceManager.getActiveTokens();
    if (tokens.length === 0) {
      return res.status(400).json({ error: "No registered devices found" });
    }

    const job = scheduledNotifications.scheduleCustom(
      name,
      cronExpression,
      tokens,
      "汇率更新提醒",
      exchangeRateService.formatRateMessage(rateResult.rates),
      { type: "exchange-rate-update", timestamp: rateResult.timestamp }
    );

    res.json({
      message: "Exchange rate notification scheduled successfully",
      nextInvocation: job.nextInvocation(),
      deviceCount: tokens.length,
    });
  } catch (error) {
    console.error("Error scheduling exchange rate notification:", error);
    res.status(500).json({ error: "Failed to schedule notification" });
  }
});

// 创建定时推送任务
app.post("/api/notifications/schedule/daily", (req, res) => {
  const { name, hour, minute, pushTokens, title, body, data } = req.body;

  if (
    !name ||
    !Array.isArray(pushTokens) ||
    pushTokens.length === 0 ||
    !title ||
    !body
  ) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const job = scheduledNotifications.scheduleDaily(
      name,
      hour,
      minute,
      pushTokens,
      title,
      body,
      data
    );

    res.json({
      message: "Daily notification scheduled successfully",
      nextInvocation: job.nextInvocation(),
    });
  } catch (error) {
    console.error("Error scheduling daily notification:", error);
    res.status(500).json({ error: "Failed to schedule notification" });
  }
});

// 创建自定义定时推送任务
app.post("/api/notifications/schedule/custom", (req, res) => {
  const { name, cronExpression, pushTokens, title, body, data } = req.body;

  if (
    !name ||
    !cronExpression ||
    !Array.isArray(pushTokens) ||
    pushTokens.length === 0 ||
    !title ||
    !body
  ) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const job = scheduledNotifications.scheduleCustom(
      name,
      cronExpression,
      pushTokens,
      title,
      body,
      data
    );

    res.json({
      message: "Custom notification scheduled successfully",
      nextInvocation: job.nextInvocation(),
    });
  } catch (error) {
    console.error("Error scheduling custom notification:", error);
    res.status(500).json({ error: "Failed to schedule notification" });
  }
});

// 取消定时推送任务
app.delete("/api/notifications/schedule/:name", (req, res) => {
  const { name } = req.params;

  const cancelled = scheduledNotifications.cancelJob(name);
  if (cancelled) {
    res.json({
      message: `Scheduled notification '${name}' cancelled successfully`,
    });
  } else {
    res
      .status(404)
      .json({ error: `No scheduled notification found with name '${name}'` });
  }
});

// 获取所有活动的定时任务
app.get("/api/notifications/schedule", (req, res) => {
  const activeJobs = scheduledNotifications.getActiveJobs();
  res.json(activeJobs);
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  try {
    console.log(`Server is running on port ${PORT}`);

    // 初始化汇率更新服务
    await exchangeRateUpdater.start();
    console.log("Exchange rate update service started");

    // 初始化BTC价格监控服务
    await btcPriceMonitor.start();
    console.log("BTC price monitor service started");
  } catch (error) {
    console.error("Failed to initialize services:", error);
    process.exit(1);
  }
});
