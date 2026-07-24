# ChatGPT Bridge

ChatGPT Bridge 是一个开源 Codex 插件。它通过 Codex 内置浏览器使用用户自己的 ChatGPT 网页会话进行单图或组图创作，并把原始图片导出到本地项目。

它不使用 OpenAI API Key，不收集账号密码，也不会复制浏览器 Cookie。登录只在内置浏览器打开的 `chatgpt.com` 页面中由用户本人完成。

## 安装

```bash
codex plugin marketplace add yuyou-dev/ChatGPT-Bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

安装后先验证 marketplace 和插件是否可见：

```bash
codex plugin marketplace list
codex plugin list
```

输出中应包含 `chatgpt-bridge` marketplace 和
`chatgpt-bridge@chatgpt-bridge` 插件。随后新建一个 Codex 任务，让新插件被完整加载。

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
- 提供最多 9 张相互独立、风格统一的受指导组图工作流；实际数量和额度取决于账号及当前 ChatGPT 产品能力。
- 按预期数量等待，避免把 7/9 误判成完成。
- 导出网页原始图片资源，而不是屏幕截图。
- 校验真实尺寸、比例、SHA-256 和重复图片。
- 记录 manifest、内容审查状态和重生成队列。
- 区分“已生成、已导出、已测量、待审查、已批准”。
- 把受支持的一次性小型文本任务分流到 ChatGPT 临时对话。
- 图片、研究、组图和需要持续迭代的任务保留在标准对话。
- 识别 ChatGPT 的可重试错误，默认只恢复一次，不再死等到超时。

## 临时对话分流

插件会在上传或发送前判断对话动作：

- `new_temporary`：无需历史、一次完成的小型文本任务。
- `new_standard`：图片生成、研究、3-9 张组图、活动系列和多轮迭代。
- `reuse_current`：必须复用当前对话或附件，或执行一次机械重试。
- `blocked`：显式临时对话与旧上下文依赖或不支持的能力冲突。

普通图片请求会进入全新的标准对话。若用户明确要求“在临时对话中生成图片”，但当前页面不支持图片工具，插件会阻断并说明原因，不会静默切换模式。

自动选择临时对话但无法激活时，可以回退到干净的标准对话；显式指定临时对话时不会静默回退。临时对话是会变化的 ChatGPT 产品能力，最近一次页面实测日期为 `2026-07-24`。

开发者可以运行：

```bash
npm run benchmark:routing
```

## 第一次成功运行

临时文本任务：

```text
请使用 ChatGPT 临时对话，把这个商品标题改得更精炼，不需要保留历史。
```

标准图片任务：

```text
请生成一张 3:4 的编辑风格图片，导出原图，并报告实际尺寸。
```

## 输出

```text
generated-images/my-run/
  image-01.png
  image-02.png
  manifest.json
```

manifest 会记录数量、实际尺寸、比例校验、SHA-256、审查状态和重生成队列。默认不会保存完整提示词、对话 URL、绝对本地路径或临时图片 URL。

## 更新

```bash
codex plugin marketplace upgrade chatgpt-bridge
codex plugin add chatgpt-bridge@chatgpt-bridge
```

更新后请新建 Codex 任务。

卸载：

```bash
codex plugin remove chatgpt-bridge@chatgpt-bridge
codex plugin marketplace remove chatgpt-bridge
```

## 发布包

每个 GitHub Release 包含：

- `chatgpt-bridge-plugin-vX.Y.Z.zip`：独立插件目录。
- `chatgpt-bridge-marketplace-vX.Y.Z.zip`：可解压后用本地路径添加的 marketplace 包。

## 开发与发布

仓库开发需要 Node.js 20 或更高版本；本地构建发布包还需要 `zip` 命令。

```bash
npm test
npm run validate
npm run package
```

GitHub Release 会同时提供纯插件 ZIP 和本地 marketplace ZIP。推荐直接通过 GitHub marketplace 命令安装。

## 说明

- 提示词和用户明确选择的参考文件会发送给 ChatGPT，因为任务在 `chatgpt.com` 上执行。
- 插件不会读取密码、验证码、Cookie、本地存储或会话令牌。
- 详细信息见 [架构](docs/ARCHITECTURE.md)、[登录与隐私](docs/LOGIN.md)、[故障排查](docs/TROUBLESHOOTING.md)、[贡献指南](CONTRIBUTING.md) 和 [安全策略](SECURITY.md)。
- 本项目为非官方开源项目，与 OpenAI 无隶属或背书关系。ChatGPT 的能力、额度、账号与订阅规则以当前产品为准。
