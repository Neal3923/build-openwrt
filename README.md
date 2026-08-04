# 🛠️ OpenWrt 智能编译工具

> 支持 GitHub Actions 与本地服务器的可视化 OpenWrt 固件编译平台。


## ✨ 项目特色

- 🎯 **可视化配置** - 通过Web界面轻松选择设备和插件
- 🚀 **两种编译方式** - 可使用GitHub Actions，也可在自己的Ubuntu服务器编译
- 🔍 **冲突检测** - 自动检测插件冲突和依赖关系
- 📊 **实时监控** - 按 GitHub Actions 实际步骤显示阶段和耗时
- 🌐 **多源支持** - 支持官方OpenWrt、Lean's LEDE、ImmortalWrt等源码
- 📱 **响应式设计** - 完美适配桌面和移动设备

## 🚀 快速开始

### 步骤 1: Fork 项目

1. 点击本项目右上角的 **`Fork`** 按钮
2. 选择复制到你的 GitHub 账户
3. 等待项目复制完成

### 步骤 2: 配置 GITHUB_REPO

修改项目配置文件以指定你的仓库信息：

1. 在你 Fork 的项目中，编辑 `js/config-data.js` 文件
2. 找到以下行并修改为你的仓库信息：

```javascript
// 基础配置 - 请修改为你的GitHub仓库信息
const GITHUB_REPO = 'your-username/your-repo-name'; // 替换为你的仓库地址

// 示例：
// const GITHUB_REPO = 'zhang-san/openwrt-builder';
```

### 步骤 3: 获取 GitHub Token

为了能够触发编译任务，需要创建 GitHub Personal Access Token：

#### 3.1 创建 Token

1. 登录 GitHub，点击右上角头像 → **`Settings`**
2. 在左侧菜单中选择 **`Developer settings`**
3. 选择 **`Personal access tokens`** → **`Tokens (classic)`**
4. 点击 **`Generate new token`** → **`Generate new token (classic)`**
5. 填写 Token 信息：
   - **Note**: 填写描述，如 "OpenWrt Builder"
   - **Expiration**: 选择过期时间（建议30-90天）
   - **Select scopes**: 选择权限范围（必需项目如下）：

```bash
✅ repo                    # 仓库访问权限（必需）
  ✅ repo:status           # 访问提交状态
  ✅ repo_deployment       # 访问部署状态  
  ✅ public_repo           # 访问公共仓库
  ✅ repo:invite           # 访问仓库邀请

✅ workflow                # GitHub Actions权限（必需）

⚪ write:packages          # 包发布权限（可选）
⚪ read:packages           # 包读取权限（可选）
```

6. 点击 **`Generate token`** 生成 Token
7. ⚠️ **立即复制 Token**（离开页面后无法再次查看）

#### 3.2 Token 格式说明

- 新版 Token 格式：`github_pat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- 经典 Token 格式：`ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 步骤 4: 配置 GitHub Pages

启用 GitHub Pages 服务以便通过网页访问编译工具：

#### 4.1 启用 Pages 服务

1. 进入你 Fork 的项目
2. 点击 **`Settings`** 标签页
3. 在左侧菜单中找到 **`Pages`**
4. 在 **Source** 设置中：
   - 选择 **`Deploy from a branch`**
   - **Branch** 选择 **`main`** 或 **`master`**（根据你的默认分支）
   - **Folder** 选择 **`/ (root)`**
5. 点击 **`Save`** 保存设置

#### 4.2 访问编译工具

配置完成后，大约等待 1-2 分钟，你就可以通过以下地址访问：

```
https://your-username.github.io/your-repo-name
```

例如：`https://zhang-san.github.io/openwrt-builder`

### 步骤 5: 启用 GitHub Actions

1. 进入你 Fork 的项目
2. 点击 **`Actions`** 标签页
3. 如果提示启用工作流，点击 **`I understand my workflows, go ahead and enable them`**
4. 确认工作流已激活（应该能看到 "Smart Build" 工作流）

## 🖥️ 本地服务器编译（不经过Actions）

本地模式当前支持 **Ubuntu 24.04**。服务器账号不需要允许root登录，但必须可以使用`sudo`安装编译依赖。

### 首次安装

```bash
git clone https://github.com/Neal3923/build-openwrt.git "$HOME/build-openwrt"
cd "$HOME/build-openwrt"
sudo bash ./script/setup-local-builder.sh
```

安装脚本只安装OpenWrt编译依赖，不会卸载服务器已有软件。

### 从网页生成本次编译命令

1. 在网页中选择源码、版本、x86_64设备、根分区容量和插件。
2. 第4步选择 **“本地服务器”**。
3. 点击 **“复制并编译”**。
4. 把命令粘贴到服务器终端执行。

也可以直接运行：

```bash
cd "$HOME/build-openwrt"
git pull --ff-only
bash ./script/local-build.sh \
  --source openwrt-main \
  --branch openwrt-24.10 \
  --rootfs 1024 \
  --plugins "luci-app-passwall,luci-app-diskman"
```

本地编译目录默认为`$HOME/build-openwrt-local`：

- `runs/`：每次编译的源码与诊断日志；带安全标记且超过24小时后自动删除。
- `cache/`：下载缓存与ccache，不会自动删除。
- `output/`：最终固件、SHA256校验和完整日志，不会自动删除。

本地编译会自动使用`nproc`检测到的全部CPU线程。相同下载文件和编译缓存可以在后续任务中复用，但同一服务器同一时间只允许运行一个任务，避免缓存损坏或内存不足。

## 📖 使用指南

### 基本使用流程

1. **访问编译工具页面**
   - 打开你的 GitHub Pages 地址
   - 或者下载项目文件，本地打开 `index.html`

2. **配置 GitHub Token**（仅GitHub Actions方式需要）
   - 点击页面右上角的 "⚙️ 配置" 按钮
   - 在弹出的对话框中输入你的 GitHub Token
   - 确认后保存配置

3. **选择编译配置**
   - **源码分支**：选择 OpenWrt 源码版本
   - **目标设备**：选择你的路由器型号
   - **功能插件**：勾选需要的软件包

4. **选择编译方式并开始**
   - 检查配置信息
   - GitHub Actions方式点击“开始编译”，完成后从Releases下载
   - 本地服务器方式复制网页生成的命令，在服务器终端执行

5. **监控编译进度**
   - GitHub Actions方式可在网页查看实际工作流阶段、状态记录和已运行时间
   - 本地服务器方式直接在终端查看完整实时日志
   - Actions固件从Releases下载；本地固件保存在`$HOME/build-openwrt-local/output/`

### 支持的源码分支

| 源码分支 | 描述 | 稳定性 | 插件数量 | 推荐用途 |
|---------|------|--------|----------|----------|
| **OpenWrt 官方** | 最新稳定版本，兼容性最好 | 高 | 基础 | 新手用户、生产环境 |
| **Lean's LEDE** | 国内热门分支，集成大量插件 | 中 | 丰富 | 中国用户、功能需求高 |
| **ImmortalWrt** | 增强版官方固件，平衡稳定性和功能 | 中 | 增强 | 平衡用户、追求新功能 |

### 支持的设备类型

#### 🖥️ X86 平台
- **X86_64 软路由** - 高性能，支持虚拟化
- **虚拟机 (VMware/VirtualBox)** - 测试环境
- **工控机/迷你主机** - 企业级应用

### 功能插件说明

#### 🔐 网络代理
- **SSR Plus+** - ShadowsocksR 代理工具，科学上网
- **PassWall** - 多协议支持，智能分流规则
- **OpenClash** - Clash 客户端，支持规则订阅
- **WireGuard** - 现代化 VPN 协议，高性能
- **ZeroTier** - 虚拟局域网，远程办公

#### 🌐 网络工具
- **AdGuard Home** - DNS 级广告拦截，保护隐私
- **AdByby Plus+** - 网页广告过滤
- **动态DNS (DDNS)** - 动态域名解析服务
- **UPnP** - 端口自动映射
- **多线负载均衡** - 多 WAN 口支持

#### ⚙️ 系统管理
- **Docker CE** - 容器化服务平台
- **TTYD 终端** - Web 终端访问
- **网络唤醒 (WOL)** - 远程开机功能
- **带宽监控** - 实时流量统计
- **定时任务 (Crontab)** - 计划任务管理

#### 🎵 多媒体服务
- **Aria2** - 多线程下载工具
- **Transmission** - BitTorrent 下载
- **Samba** - Windows 文件共享
- **DLNA 服务器** - 媒体流服务
- **FTP 服务器** - 文件传输协议

## 🔍 智能冲突检测

系统会自动检测以下类型的冲突：

### 冲突类型

1. **功能冲突** - 相似功能的插件互斥
   ```
   ❌ SSR Plus+ 与 PassWall 不能同时选择
   ❌ AdGuard Home 与 AdByby Plus+ 功能重复
   ```

2. **依赖关系** - 插件间的依赖检查
   ```
   ✅ Docker 应用需要先安装 Docker CE
   ✅ OpenClash 需要 iptables 支持
   ```


4. **架构兼容性** - 当前构建固定为 X86_64

## 📊 编译进度监控

### 编译状态

- 🔄 **队列中** - 等待编译资源
- 🚀 **编译中** - 正在编译固件
- ✅ **编译成功** - 固件编译完成
- ❌ **编译失败** - 编译过程出错

### 实时监控

1. **阶段跟踪** - 根据 GitHub Actions 已完成的实际步骤计算阶段进度
2. **状态记录** - 仅在步骤开始、完成、跳过或失败时添加记录
3. **耗时统计** - 持续显示已经运行的时间
4. **断点恢复** - 刷新页面后继续监控同一次编译任务

### 下载固件

编译成功后，在仓库的 **Releases** 页面下载：

- `OpenWrt_*` - 对应设备和源码版本的固件文件
- `sha256sums.txt` - 固件 SHA256 校验信息

## 🛠️ 高级配置

### 自定义插件源

如需添加自定义 Git 插件源：

```bash
# 在 feeds.conf.default 中添加
src-git custom https://github.com/your-username/openwrt-packages
```

### 编译优化选项

```bash
# 体积优化 - 适合存储有限的设备
CONFIG_TARGET_OPTIMIZATION="-Os -pipe -march=native"
CONFIG_TARGET_ROOTFS_SQUASHFS=y

# 性能优化 - 适合高性能设备  
CONFIG_TARGET_OPTIMIZATION="-O2 -pipe -march=native"
CONFIG_KERNEL_BUILD_USER="OpenWrt"

# 调试版本 - 包含调试信息
CONFIG_KERNEL_DEBUG_FS=y
CONFIG_KERNEL_DEBUG_KERNEL=y
```

### 设备特定配置

```bash
# X86 设备配置
CONFIG_TARGET_IMAGES_GZIP=y          # 启用压缩镜像
CONFIG_GRUB_IMAGES=y                 # 启用 GRUB 引导
CONFIG_VDI_IMAGES=y                  # 生成 VDI 镜像
CONFIG_VMDK_IMAGES=y                 # 生成 VMDK 镜像
```

### GitHub Actions 配额

- **免费账户**: 每月 2000 分钟运行时间
- **Pro 账户**: 每月 3000 分钟运行时间  
- **单次编译**: 通常需要 60-180 分钟
- **建议**: 合理安排编译频率，避免浪费配额

## 📁 项目结构

```
openwrt-smart-builder/
├── index.html                    # 主页面入口
├── README.md                     # 项目说明文档  
├── css/
│   └── style.css                 # 主样式文件
├── js/
│   ├── config-data.js            # 配置数据文件 🔧
│   ├── wizard.js                 # 向导逻辑控制
│   ├── build-monitor.js          # GitHub Actions 阶段监控
│   └── token-modal.js            # Token 配置模块
├── components/
│   ├── token-modal.html          # Token 配置界面
│   └── device-selector.html      # 设备选择组件
├── .github/
│   └── workflows/
│       ├── smart-build.yml       # 智能编译工作流 🚀
│       └── 通用设备编译固件.yml    # 通用编译工作流
├── config/
│   ├── lede-master/              # Lean's LEDE 配置
│   ├── openwrt-main/             # OpenWrt 官方配置
│   └── immortalwrt-master/       # ImmortalWrt 配置
└── script/
    └── build-control.sh          # 编译控制脚本
```

## 🤝 贡献指南

### 贡献类型

我们欢迎以下类型的贡献：

- 🐛 **Bug 修复** - 修复已知问题
- ✨ **新功能** - 添加新的功能特性  
- 📚 **文档改进** - 完善使用文档
- 🎨 **界面优化** - 改进用户界面
- 🔧 **设备支持** - 添加新设备支持
- 📦 **插件集成** - 集成新的软件包

### 贡献流程

1. **Fork 项目** - 点击右上角 Fork 按钮
2. **创建分支** - 基于 main 分支创建功能分支
3. **开发改进** - 在分支中进行开发和测试
4. **提交变更** - 提交代码并编写清晰的提交信息
5. **发起 PR** - 向主项目提交 Pull Request
6. **代码审查** - 等待维护者审查和反馈
7. **合并代码** - 审查通过后合并到主分支

### 添加新插件支持

1. **插件信息定义**
   ```javascript
   // 在插件数据库中添加
   'plugin_id': {
     name: '插件名称',
     category: 'network',          // 插件分类
     description: '插件描述',
     package: 'luci-app-plugin',   // 软件包名
     depends: ['dependency'],      // 依赖关系
     conflicts: ['conflict'],      // 冲突检查
     size: '2M',                  // 大小估算
     arch_support: ['all'],        // 架构支持
     source_support: ['lede']      // 源码支持
   }
   ```

2. **冲突规则配置**
   ```javascript
   // 添加冲突检测规则
   const PLUGIN_CONFLICTS = {
     'plugin_group_1': ['plugin_a', 'plugin_b'],
     'plugin_group_2': ['plugin_c', 'plugin_d']
   };
   ```

3. **依赖关系管理**
   ```javascript
   // 配置依赖关系
   const PLUGIN_DEPENDENCIES = {
     'plugin_id': {
       requires: ['base_plugin'],    // 必需依赖
       suggests: ['optional_plugin'] // 建议依赖
     }
   };
   ```

## 📜 开源协议

本项目采用 [MIT 许可证](LICENSE) 开源。

```
MIT License

Copyright (c) 2024 OpenWrt Smart Builder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## 🙏 致谢

感谢以下开源项目和贡献者：

- **[OpenWrt](https://openwrt.org/)** - 开源路由器固件项目
- **[Lean's LEDE](https://github.com/coolsnowwolf/lede)** - 国内热门 OpenWrt 分支
- **[ImmortalWrt](https://github.com/immortalwrt/immortalwrt)** - OpenWrt 增强版
- **[GitHub Actions](https://github.com/features/actions)** - 自动化构建服务
- 感谢每一位提交代码和建议的开发者

### 常见问题 FAQ

**Q: 编译失败了怎么办？**
A: 首先检查插件冲突，然后减少插件数量，最后查看详细的编译日志找出具体错误原因。

**Q: 固件太大无法刷入设备？**
A: 启用体积优化选项，减少不必要的插件，或选择存储更大的设备型号。

**Q: 支持哪些设备？**
A: 当前仅支持 X86_64 软路由、工控机和虚拟机。

**Q: GitHub Actions 配额用完了？**
A: 免费账户每月有 2000 分钟，建议合理安排编译频率，或考虑升级到付费账户。

**Q: 如何刷入编译好的固件？**
A: 下载编译产物中的固件文件，使用设备官方刷机工具或第三方刷机软件刷入。

---

⭐ **如果这个项目对你有帮助，请给个 Star 支持一下！**

🔔 **Watch 本项目以获取最新更新通知**

🍴 **Fork 项目开始你的 OpenWrt 编译之旅**

---
