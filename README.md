# FlowCue AI 提词器

FlowCue 是一个纯静态、可部署到 GitHub Pages 的浏览器提词器。它支持电脑端和手机横屏，提供匀速滚动与 AI 语音跟读两种推进方式。

## 功能

- 匀速滚动：按 60–600 字/分钟调节，滚动中可随时改变速度。
- AI 跟读：调用硅基流动 `XingChenAGI/XingChenASR-V3.2-Ultra` 模型，每 3–10 秒识别一段语音。
- 连续匹配：只在当前位置之后的有限范围内做字符级模糊对齐，并对过远候选进行拦截。
- 手动校准：上下滑动讲稿后，视线引导线所在位置会成为新的提词进度。
- 本地保存：讲稿、进度和偏好保存在当前设备；API Key 默认只保留在当前浏览器会话。
- 演讲体验：支持全屏、保持屏幕唤醒、键盘快捷键与手机横屏底部控制条。

## 在本地打开

这是零构建项目。可直接打开 `index.html`，但麦克风在部分浏览器中要求安全来源，建议通过本地静态服务器访问：

```bash
python -m http.server 4173
```

然后打开 `http://127.0.0.1:4173`。

## 部署到 GitHub Pages

1. 将此目录提交并推送到 GitHub 仓库的 `main` 分支。
2. 在仓库 **Settings → Pages → Build and deployment** 中，将 Source 设为 **GitHub Actions**。
3. 工作流会自动部署，完成后可在 Actions 或 Pages 设置页找到 HTTPS 地址。

## API Key 与隐私

纯静态网页无法在服务端隐藏 API Key。Key 由使用者输入，并由浏览器直接发送到 `https://api.siliconflow.cn/v1/audio/transcriptions`（[官方接口文档](https://api-docs.siliconflow.cn/docs/api/audio-transcriptions-post)）。不勾选“在此设备保存 Key”时，Key 只写入 `sessionStorage`；勾选后才会写入 `localStorage`。

讲稿不会上传。AI 跟读开启后，短音频片段会发送给硅基流动用于语音转写。请勿在公共设备上保存 Key，也不要把真实 Key 提交到 Git 仓库。

如果浏览器报告跨域网络错误，需要由 API 服务允许当前 GitHub Pages 来源；纯静态页面本身无法绕过服务端的 CORS 策略。
