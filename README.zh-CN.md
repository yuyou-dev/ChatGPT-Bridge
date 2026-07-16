# ChatGPT Bridge

ChatGPT Bridge 是一个开源 Codex 插件。它通过 Codex 内置浏览器使用用户自己的 ChatGPT 网页会话进行单图或组图创作，并把原始图片导出到本地项目。

它不使用 OpenAI API Key，不收集账号密码，也不会复制浏览器 Cookie。登录只在内置浏览器打开的 `chatgpt.com` 页面中由用户本人完成。

## 安装

```bash
codex plugin marketplace add yuyou-dev/ChatGPT-Bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

安装后请新建一个 Codex 任务，让新插件被完整加载。

## 首次登录

向 Codex 提出：

```text
使用 ChatGPT Bridge 生成一张图片，并把原图保存到本地。
```

插件会在 Codex 内置浏览器中打开 ChatGPT，并检查输入框是否可用。如果尚未登录：

1. 在右侧内置浏览器中登录你自己的 ChatGPT 账号。
2. 密码、通行密钥、人机验证和双重验证都由你在网页中自行完成。
3. 完成后回到 Codex 告诉它“已经登录”。
4. 插件确认 ChatGPT 输入框可用后再继续生成。

不要把密码或验证码发送给 Codex。详细说明见 [登录与隐私](docs/LOGIN.md)。

## 核心能力

- 单图精细创作。
- 一次生成最多 9 张相互独立、风格统一的组图。
- 按预期数量等待，避免把 7/9 误判成完成。
- 导出网页原始图片资源，而不是屏幕截图。
- 校验真实尺寸、比例、SHA-256 和重复图片。
- 记录 manifest、内容审查状态和重生成队列。
- 区分“已生成、已导出、已测量、待审查、已批准”。

## 更新

```bash
codex plugin marketplace upgrade chatgpt-bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

更新后请新建 Codex 任务。

## 开发与发布

```bash
npm test
npm run validate
npm run package
```

GitHub Release 会同时提供纯插件 ZIP 和本地 marketplace ZIP。推荐直接通过 GitHub marketplace 命令安装。

## 说明

本项目为非官方开源项目，与 OpenAI 无隶属或背书关系。ChatGPT 的能力、额度、账号与订阅规则以 ChatGPT 当前产品为准。
