# Speech 模块 (`app/module/speech/`)

## 定位

Speech 负责用户英语录音的私有 OSS 直传、阿里云异步 ASR、30 天原音生命周期和按消息授权播放。Agent 回复继续使用浏览器本地 TTS；服务端不提供 TTS 接口，也不访问历史 `speech_audio_assets`、`message_audios` 表。

## API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/uploads/sign` | 为 10 MB 以内的 WebM/Opus 或 MP4 创建 5 分钟上传签名 |
| POST | `/api/v1/speech/transcriptions` | 校验 OSS 对象并提交/刷新异步英语识别 |
| GET | `/api/v1/speech/transcriptions/:recordingId` | 获取识别状态和不可编辑 transcript |
| GET | `/api/v1/messages/:messageId/voice-recording` | 校验当前用户归属后签发 10 分钟播放 URL |

Conversation 流式接口接受互斥输入：文本 `{ content, clientRequestId }` 或语音 `{ voiceRecordingId, clientRequestId }`。语音消息正文只取数据库中的 transcript；创建消息和绑定录音在同一 MySQL 事务完成。

## 状态与保留

```text
uploading -> submitting -> processing -> completed -> expired
                 |              |
                 +----> failed <-+
                          |
                          +---- retry ----> submitting
```

- 只有 `completed` 且未到期的录音可以发送或播放。
- 同一录音最多绑定一条用户消息；同一 `clientRequestId` 使用 Conversation 幂等重放。
- 录音从创建起 30 天到期。清理任务先幂等删除 OSS 对象，成功后才标记数据库 `expired/deletedAt`；删除失败保留待重试记录。
- 到期后消息文字、AI 回复及学习数据继续保留，消息 DTO 返回 `voiceRecording.status = "expired"`。

## 配置

```dotenv
DASHSCOPE_API_KEY=
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com
DASHSCOPE_ASR_MODEL=paraformer-v2
OSS_REGION=oss-cn-beijing
OSS_BUCKET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=
OSS_ENDPOINT=
```

Bucket 必须为私有，生产只使用 HTTPS 短时签名。默认测试通过 Fake Repository、Fake Object Storage 和 Fake ASR Provider 运行，不访问真实阿里云；真实厂商契约测试需显式隔离凭证且不进入默认命令。
