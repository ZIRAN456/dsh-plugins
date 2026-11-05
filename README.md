# DeepSeek Harness 插件精选合集 (dsh-plugins)

[![Topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

专为 **DeepSeek Harness (DSH)** 打造的实用开源插件合集，解决日常使用中的交互与管理痛点。

---

## 📦 插件列表 (Plugins Included)

### 1. 📷 对话框截图与贴图插件 (`dsh-screenshot-button`)
> 目录：`plugins/dsh-screenshot-button`

在对话框底栏新增快捷操作按钮：
* **原生截图**：点击「截图」即刻唤起 Windows 原生自由框选截图（`Win + Shift + S` / SnippingTool），截取完成后切回窗口自动将图片作为附件插入草稿；
* **一键贴图**：点击「贴图」一键读取系统剪贴板最近的截图并插入输入框，无需手动点击输入框再按 `Ctrl + V`；
* **原生风格设计**：无突兀边框，透明背景，字体与高度和原生工具栏无缝融合，支持双按钮独立悬停触发。

### 2. 🗑️ 历史会话彻底删除插件 (`dsh-session-admin`)
> 目录：`plugins/dsh-session-admin`

解决官方默认只能“归档会话”无法彻底清理的问题：
* **侧边栏一键删除**：在左侧会话历史的右键 / `...` 菜单中增加“彻底删除”选项；
* **深度物理清理**：同步清理注册表状态、投影缓存、JSONL 磁盘会话日志与文件碎片；
* **安全保护**：自动识别活跃中会话并防误删，避免内核死锁。

### 3. 🌿 温润鼠尾草绿主题 (`dsh-warm-sage-theme`)
> 目录：`plugins/dsh-warm-sage-theme`

* 精心调配的温润护眼绿色系主题，包含侧边栏、对话流、代码块与高对比度微调。

---

## 🚀 安装方法 (Installation)

### 方式一：本地工作区直接引入（推荐）

1. 克隆本仓库到你的 Harness 工作区或任意本地目录：
   ```bash
   git clone https://github.com/YOUR_USERNAME/dsh-plugins.git
   ```

2. 在当前 Harness 会话中，对 AI 发送指令即可安装指定插件：
   > “帮我安装这个插件：`<插件所在的绝对路径>`”
   
   例如：
   > “帮我安装这个插件：`C:/Users/xxx/dsh-plugins/plugins/dsh-screenshot-button`”

3. Harness 将自动通过 `plugin_manager` 注册并热更新激活插件，无需重启。

---

## 🛠️ 技术规范 (Technical Architecture)

* **底层框架**：基于 Cordis 模块化架构；
* **插槽挂载**：严格遵循 DSH Client Slots 规范（如 `conversation.input.left`、`sidebar.workspaces.session.menu.item` 等）；
* **无侵入升级**：完全遵循宿主安全沙箱与主题 token（`--dsw-alias-*`），不污染宿主全局样式。

---

## 📄 开源许可 (License)

本项目遵循 [MIT License](LICENSE)。欢迎提交 Issue 或 Pull Request！
