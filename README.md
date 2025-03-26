# Expo Push Notification Server

一个使用 Express 和 expo-server-sdk 实现的推送通知服务器，支持定时任务功能。

## 安装

```bash
npm install
```

## 配置

创建 `.env` 文件并设置以下环境变量：

```
PORT=3000
```

## 运行

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

## API 接口

### 1. 注册设备推送 Token

```http
POST /api/register-push-token
```

请求体：
```json
{
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "deviceInfo": {
        "platform": "ios",        // 或 "android"
        "deviceName": "iPhone 13",
        "systemVersion": "15.0"   // 可选
    }
}
```

响应：
```json
{
    "message": "Device registered successfully",
    "device": {
        "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
        "deviceInfo": {
            "platform": "ios",
            "deviceName": "iPhone 13"
        },
        "registeredAt": "2024-03-10T14:30:00.000Z",
        "lastUpdated": "2024-03-10T14:30:00.000Z"
    },
    "testNotification": "sent"
}
```

### 2. 创建汇率更新推送任务

```http
POST /api/notifications/schedule/exchange-rate
```

请求体：
```json
{
    "name": "jpy-exchange-rate",
    "cronExpression": "0 */4 * * *"
}
```

说明：
- 推送将发送给所有注册的设备
- `cronExpression`: 使用 cron 表达式设置更新频率
- 示例中的 "0 */4 * * *" 表示每4小时更新一次

### 3. 创建每日定时推送任务

```http
POST /api/notifications/schedule/daily
```

请求体：
```json
{
    "name": "daily-reminder",
    "hour": 9,
    "minute": 0,
    "pushTokens": ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"],
    "title": "每日提醒",
    "body": "该起床了！",
    "data": { "type": "daily-reminder" }
}
```

### 4. 创建自定义定时推送任务

```http
POST /api/notifications/schedule/custom
```

请求体：
```json
{
    "name": "custom-schedule",
    "cronExpression": "*/30 * * * *",
    "pushTokens": ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"],
    "title": "定时提醒",
    "body": "该喝水了！",
    "data": { "type": "water-reminder" }
}
```

### 5. 取消定时推送任务

```http
DELETE /api/notifications/schedule/:name
```

### 6. 获取所有活动的定时任务

```http
GET /api/notifications/schedule
```

## 注意事项

1. 确保提供的 Push Token 是有效的 Expo Push Token
2. 自定义定时任务使用 cron 表达式来设置时间
3. 每个定时任务都需要一个唯一的名称
4. 汇率数据来源于 exchangerate-api.com，更新频率建议不要太频繁
5. 设备注册信息存储在 `data/devices.json` 文件中
6. 支持 iOS 和 Android 平台的设备注册