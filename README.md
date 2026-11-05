# DeepSeek Harness 插件精选合集 (dsh-plugins)

[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

专为 **DeepSeek Harness (DSH)** 打造的实用开源插件合集，解决日常使用中的交互与管理痛点。

---

## 💻 兼容性与运行环境

* **测试环境**：Windows 11 Pro 64-bit（已附端到端与 curl 实测记录，macOS / Linux 未在实体机实测）
* **Harness 版本**：DeepSeek Harness v0.2.1-rc.5
* **系统差异说明**：
  * `dsh-screenshot-button` 的「截图」按钮依赖 Windows 原生工具（非 Windows 环境自动隐藏该按钮，仅保留「贴图」）；
  * 「贴图」功能、`dsh-session-admin` 以及 `dsh-warm-sage-theme` 理论跨平台通用。

---

## 📦 插件列表 (Plugins Included)

### 1. 📷 对话框截图与贴图插件 (`dsh-screenshot-button`)
> 目录：`plugins/dsh-screenshot-button`

在对话框底栏新增快捷操作按钮：
* **原生自由截图**：点击「截图」唤起 Windows 原生自由框选截图（`Win + Shift + S` / SnippingTool），完成框选切回窗口自动插入图片。具备剪贴板三态探测（区分空/有图/读取失败）与 SHA-256 内容指纹防护，取消框选绝不插入旧图；
* **防重复与单轮锁定**：截图等待期间按钮锁定并支持新一轮彻底取消旧轮，防止连续点击插入多份图片；组件卸载自动清理监听与定时器；
* **一键贴图**：点击「贴图」一键读取系统剪贴板最近的截图并插入输入框，免去鼠标点击输入框再按 `Ctrl + V`；
* **会话身份鉴权**：接口基于 `connection.fetch` 注册，受宿主会话登录态保护（未授权调用直接返回 401 Unauthorized）；
* **原生风格设计**：无突兀边框，透明背景，字体与高度和原生工具栏无缝融合，支持双按钮独立悬停高亮。

### 2. 🗑️ 历史会话彻底删除插件 (`dsh-session-admin`)
> 目录：`plugins/dsh-session-admin`

解决官方默认只能“归档会话”无法彻底清理的痛点：
* **侧边栏一键删除**：在左侧会话历史的右键 / `...` 菜单中增加“彻底删除”选项；
* **深度物理清理**：同步清理会话登记信息 (Session Registry)、投影缓存、JSONL 磁盘会话日志与文件碎片；
* **存储布局启动与前置双重校验**：启动期与执行前严格校验 DSH 根目录、`sessions` 目录及 `session_projcache/sessions` 目录完整性，结构异常时日志警告并返回 `session-admin/storage-incompatible`，前端侧边栏菜单初始化即探测并显示为“当前 Harness 版本不支持”（若后续手动修复目录结构，需刷新页面恢复）；
* **内核安全保护**：具备二次确认框提示，自动识别活跃运行中会话并拒绝删除，会话 ID 严格做注入转码与安全路径校验，避免内核死锁与路径穿越。

### 3. 🌿 温润鼠尾草绿主题 (`dsh-warm-sage-theme`)
> 目录：`plugins/dsh-warm-sage-theme`

* 精心调配的温润护眼绿色系主题，针对长时间编码采用舒适柔和的低对比度微调，包含侧边栏、对话流与代码块样式。

---

## 🚀 安装方法 (Installation)

### 本地工作区直接引入（推荐）

1. 克隆本仓库到你的 Harness 工作区或任意本地目录：
   ```bash
   git clone https://github.com/ZIRAN456/dsh-plugins.git
   ```

2. 在当前 Harness 会话中，对 AI 发送指令即可安装指定插件：
   > “帮我安装这个插件：`<插件所在的绝对路径>`”
   
   例如：
   > “帮我安装这个插件：`C:/Users/<Username>/dsh-plugins/plugins/dsh-screenshot-button`”

3. Harness 将自动通过 `plugin_manager` 注册并热更新激活插件，无需重启。

---

## 🛠️ 技术规范 (Technical Architecture)

* **底层框架**：基于 Cordis 模块化架构；
* **插槽挂载**：严格遵循 DSH Client Slots 规范（如 `conversation.input.left`、`sidebar.workspaces.session.menu.item` 等）；
* **无侵入升级**：完全遵循宿主安全沙箱与主题 token（`--dsw-alias-*`），不污染宿主全局样式。

---

## 📄 开源许可 (License)

本项目遵循 [MIT License](LICENSE)。欢迎提交 Issue 或 Pull Request！
