# 智能界面后续扩展：公开协议核验笔记

> Historical design record. For the current unified fence, SDK chat actions,
> resource policy and context behavior, see [Intelligent UI](intelligent-ui.md).
> Earlier names and local-only restrictions below are superseded.

核验日期：2026-10-10。本文为后续需求文档提供技术依据，未实现功能、启动服务或运行浏览器测试。只使用协议维护方、官方 SDK 与官方产品文档；公开资料不构成 ChatGPT Intelligent UI 内部实现的证明。

## 1. MCP Apps 的实施基线

建议后续 MCP Apps 专项以 `2026-01-26` 为待锁定基线：固定规范标记 Stable，SDK `LATEST_PROTOCOL_VERSION` 相同。部分 API 页面标题为 SDK v1.1.2，不代表 npm 最新版；实施时重新锁定依赖。[固定规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)、[SDK 协议版本](https://apps.extensions.modelcontextprotocol.io/api/variables/app.LATEST_PROTOCOL_VERSION.html)、[SDK 文档版本](https://apps.extensions.modelcontextprotocol.io/api/documents/Quickstart.html)

| 核验事项 | 官方事实                                                                                | 对项目的建议                                                               |
| -------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 资源关联 | 工具通过 `_meta.ui.resourceUri` 指向 `ui://` 资源，宿主通过 `resources/read` 读取并渲染 | 从现有 MCP 连接取得资源；不可将 URI 当普通 HTTP 链接加载                   |
| 内容类型 | HTML 资源使用 `text/html;profile=mcp-app`                                               | 明确校验返回 URI、MIME、内容及元数据；其他类型按不支持处理                 |
| 传输     | View 与 Host 使用 JSON-RPC 2.0 over `postMessage`，Host 负责代理 MCP 服务端调用         | 单独建立 MCP Apps transport adapter，不扩张现有 `neoUi` 消息类型来冒充协议 |
| 可选扩展 | 扩展标识为 `io.modelcontextprotocol/ui`，支持需要显式协商                               | 未完成扩展协商时保留普通工具结果和文字降级                                 |

结构与传输见[官方概览](https://modelcontextprotocol.io/extensions/apps/overview)，MIME 与协商见[官方 Python SDK 说明](https://py.sdk.modelcontextprotocol.io/advanced/apps/)。建议普通模型 HTML 与工具 UI 资源保留各自入口和能力边界。

## 2. 生命周期、能力和工具调用

握手为 `ui/initialize` → 宿主初始化结果 → `ui/notifications/initialized`；初始化前宿主不能向 View 发送业务消息。工具数据通过通知传入，清理使用 `ui/resource-teardown`。[生命周期规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#communication-protocol)、[清理接口](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiResourceTeardownRequest.html)

工具、资源、消息、上下文更新等能力与浏览器权限分别协商，声明应与真实 handler 一致。[Host capabilities](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiHostCapabilities.html)

`_meta.ui.visibility` 区分 `model` 与 `app`，默认同时可见；`app` 限同服务。可见性不等于用户授权。[工具元数据](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiToolMeta.html)

项目建议：首版声明最小能力；调用经过现有权限与确认流程，绑定连接、工具和实例身份；集中处理取消、重复调用与迟到响应。这些不是 SDK 自动提供的产品保证。

服务端的只读、破坏性、幂等 annotation 均为提示，不能据不可信提示直接决定调用。建议宿主维护可信分类与允许范围。[MCP 工具 schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/schema.mdx)

## 3. 沙箱与部署差异

Web Host 的规范要求使用与主应用不同 origin 的 Sandbox proxy；proxy 的 sandbox 包含 `allow-scripts` 和 `allow-same-origin`，并代理内层 View 通信。这里的 `allow-same-origin` 不能移植成对主应用同源内容开放权限。[Sandbox proxy 规范](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#sandbox-proxy)

因此，现有 `neo-html` runner 不能只更换桥接名称就视为 MCP Apps 宿主。建议专项解决独立 origin 部署、CSP、缓存与隔离；部署不满足要求时提供文字降级。

资源声明连接、静态资源、iframe、base URI 的域与申请权限；CSP/permissions 属于资源元数据，放在工具上会被忽略。申请不等于授予。[CSP 类型](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiResourceCsp.html)、[工具字段归属](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiToolMeta.html)、[资源元数据](https://apps.extensions.modelcontextprotocol.io/api/interfaces/app.McpUiResourceMeta.html)

项目建议：两条 HTML 来源采用独立政策，第三方 Apps 发布明确兼容矩阵。网络、导航及响应头需真实部署验收；不把 iframe CSP 宣称为 CPU、内存硬隔离。

## 4. 兼容与数据隐私中的文档差异

SDK 当前同时支持 nested 与已弃用 flat `_meta["ui/resourceUri"]`，nested 优先；规范仍有“GA 前移除”旧注释。建议新写入采用 nested，旧字段仅由兼容 adapter 接受，不宣称已全面移除。[SDK 兼容 helper](https://apps.extensions.modelcontextprotocol.io/api/functions/app-bridge.getToolUiResourceUri.html)

存在隐私资料冲突：固定规范 Data Passing 称 `structuredContent` 不进入模型；OpenAI 官方说明 `content`、`structuredContent` 均对模型和组件可见，`_meta` 为组件专属。建议本项目分别筛选模型、公开、日志和 App 投影，绝不把 `structuredContent` 当隐私容器。[规范原文](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx#data-passing)、[OpenAI Tool results](https://developers.openai.com/plugins/reference#tool-results)

建议分别记录标准 MCP Apps、pre-SEP MCP-UI 和 OpenAI 专属 API；不把某个桥接接口的成功当作全部宿主功能兼容。[标准宿主概览](https://modelcontextprotocol.io/extensions/apps/overview)、[OpenAI 专属 API](https://developers.openai.com/plugins/reference)

## 5. A2UI 可借鉴的设计

当前 A2UI **v0.9.1 为 Current Production，v1.0 为 Candidate**。个别概念 tab 仍标记 v0.9 Stable，实施应锁定 schema，不混用版本。[当前规范](https://a2ui.org/specification/v0.9.1-a2ui/)、[版本入口](https://a2ui.org/concepts/overview/)

其核心是可流式 JSON、声明式组件，以及 UI 结构与数据模型分离。结构和数据可单独更新，绑定路径支持局部响应更新。[概念](https://a2ui.org/concepts/overview/)、[绑定机制](https://a2ui.org/concepts/data-binding/)

v0.9.1 分别创建 surface、更新组件、更新数据及删除 surface；输入先改变本地数据，显式 action 再提交。全量 `sendDataModel` 默认关闭。[v0.9.1 数据与交互](https://a2ui.org/specification/v0.9.1-a2ui/)

项目建议：共同的数据版本与状态驱动表格、图表和计算，使用有限的类型化绑定及注册运算，继续选择性提交。无需先迁移完整协议或开放任意组件树。

## 6. 后续验收需要避免的宣称

- “有 iframe 和 MCP 工具调用，所以兼容 MCP Apps”：资源读取、协商、初始化、通知、能力拒绝、独立 origin 及清理均需要验证。
- “声明为只读，所以可以跳过权限”：服务端 annotation 不是授权证明。
- “structuredContent 不会进入模型”：存在明确相反的官方产品行为，必须以宿主投影实现为准。
- “所有第三方 App 都可运行”：应发布选定协议版本与支持矩阵，并覆盖拒绝路径。
- “借鉴 A2UI 即兼容 A2UI”或“这是 ChatGPT 的内部协议”：公开资料不能支持这些结论。

本次未运行互操作、真实供应商、浏览器隔离、导航或部署验证；以上内容是来源核验与设计建议。
