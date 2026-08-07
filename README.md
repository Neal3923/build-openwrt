# OpenWrt 智能编译工具

一个面向 **x86_64 软路由、工控机和虚拟机** 的可视化 OpenWrt 固件编译项目。可以通过 GitHub Pages 选择源码、分支、根分区容量和插件，然后使用 GitHub Actions 编译；也可以在自己的 Ubuntu 服务器上直接编译，不经过 Actions。

## 主要功能

- 支持 GitHub Actions 和本地服务器两种编译方式。
- 支持 OpenWrt 官方、Lean's LEDE、ImmortalWrt 和 Lienol's OpenWrt。
- 每个源码均可选择项目已经验证并允许的分支或版本。
- 当前只构建 x86_64 Generic，避免网页选项与工作流目标不一致。
- 根分区容量可在网页中设置为 128–4096 MiB，默认 512 MiB。
- 自动检查代理插件冲突、Intel/AMD KVM 冲突及插件分支兼容性。
- Actions 编译完成后直接发布到 GitHub Releases，不再上传重复的 Artifact。
- 本地编译自动使用全部 CPU 线程，并复用下载缓存和 ccache。
- 对缺少 `rpcd-mod-rad3-enc` 的旧 LuCI 分支按需补充固定版本的官方模块。

## 固件默认设置

全新刷写或恢复出厂设置后：

| 项目 | 默认值 |
| --- | --- |
| 管理地址 | `10.0.0.1` |
| 用户名 | `root` |
| 密码 | `root` |

> `root/root` 仅适合首次登录。设备接入网络后请立即修改密码。初始化脚本检测到 root 已有密码时会保留当前管理地址和密码，避免保留配置升级时覆盖用户设置。

固件默认包含以下基础功能：

- LuCI 中文界面。
- Intel e1000/e1000e/igb 与 Realtek r8169 网卡驱动。
- `block-mount` 磁盘挂载支持。
- `kmod-wireguard` 和 `wireguard-tools`。

## 支持的源码与分支

| 源码 | 网页标识 | 可选分支/版本 | 默认值 |
| --- | --- | --- | --- |
| OpenWrt 官方 | `openwrt-main` | `main`、`openwrt-25.12`、`openwrt-24.10`、`openwrt-23.05` | `main` |
| Lean's LEDE | `lede-master` | `master`、`20251001`、`20230609`、`20221001` | `master` |
| ImmortalWrt | `immortalwrt-master` | `master`、`openwrt-25.12`、`openwrt-24.10`、`openwrt-23.05` | `master` |
| Lienol's OpenWrt | `Lienol-master` | `25.12`、`24.10`、`23.05`、`19.07` | `25.12` |

开发分支变化较快。需要稳定使用时，优先选择对应源码的稳定版分支；插件是否可选仍以网页即时检查结果为准。

## 可选插件

| 分类 | 插件 |
| --- | --- |
| 网络代理 | SSR Plus+、PassWall、OpenClash |
| 网络工具 | AdGuard Home、动态 DNS、UPnP、Bandix 流量监控 |
| 系统管理 | Docker CE、DiskMan、Intel KVM、AMD KVM、TTYD、网络唤醒 |
| 多媒体 | Aria2、Transmission、Samba4、MiniDLNA |
| 界面主题 | Argon 主题及其设置界面 |

重要兼容规则：

- SSR Plus+、PassWall 和 OpenClash 三者互斥。
- Intel KVM 与 AMD KVM 只能选择一个；工作流会同时启用通用 `kmod-kvm-x86`。
- PassWall 会自动加入简体中文语言包、Hysteria，并使用 `dnsmasq-full` 替换冲突的 dnsmasq 变体。
- Bandix 会自动关闭硬件流量卸载和 Turbo ACC，仅允许网页列出的兼容分支。
- Argon 会同时加入 `luci-app-argon-config`，不兼容的源码分支会在网页提示并被工作流拒绝。
- Radicale3 当前不是网页可选插件。兼容脚本只在源码自带 Radicale3 但缺少依赖时补充官方 `rpcd-mod-rad3-enc`，不会自动把 Radicale3 编入固件。

## 方法一：使用 GitHub Actions 编译

### 1. Fork 并修改仓库地址

1. Fork 本项目到自己的 GitHub 账户。
2. 编辑 `js/config-data.js`。
3. 将 `GITHUB_REPO` 改成自己的 `用户名/仓库名`：

```javascript
const GITHUB_REPO = 'your-username/build-openwrt';
```

不要把 Token 写入源码或提交到仓库。

### 2. 启用 Actions 和 Pages

1. 打开仓库的 **Actions** 页面，按提示启用 Fork 中的工作流。
2. 打开 **Settings → Pages**。
3. Source 选择 **Deploy from a branch**。
4. Branch 选择默认分支，Folder 选择 **/ (root)**，然后保存。
5. 部署完成后访问：

```text
https://你的用户名.github.io/仓库名/
```

### 3. 配置网页 Token

推荐创建只允许访问当前仓库的 fine-grained Personal Access Token：

- Repository access：只选择自己的编译仓库。
- Contents：Read and write，用于发送 `repository_dispatch` 编译请求。
- Actions：Read-only，用于读取工作流及编译状态。

在网页点击“配置 Token”并粘贴。只有在你确认保存时，Token 才会写入当前浏览器的本地存储；不要在公共电脑上保存。

不想在网页中使用 Token 时，也可以进入仓库 **Actions → OpenWrt 智能编译 → Run workflow**，手动填写同样的参数。

### 4. 选择配置并编译

1. 选择源码及其实际分支。
2. 目标设备固定为 x86_64 Generic。
3. 设置 EXT4 根分区容量，范围为 128–4096 MiB。
4. 选择插件；网页会显示冲突或分支不兼容原因。
5. 选择 GitHub Actions 编译方式并开始编译。

网页进度按 Actions 的实际步骤显示。完整 OpenWrt 编译可能持续数小时；只要 Actions 页面仍显示运行中且日志继续更新，就不属于网页监控超时。

### 5. 下载固件

编译成功后，前往仓库 **Releases** 下载固件及 `sha256sums.txt`。本项目不再保留相同内容的 Actions Artifact。

## 方法二：在本地服务器编译

本地模式当前支持 **Ubuntu 24.04**。安装环境时可以使用 root 或带 sudo 权限的普通账号，但正式编译必须使用普通账号；不要求创建名为 `actions` 的专用用户，也不要求允许 root 远程登录。

建议准备：

- 8 GB 或更多内存；内存较小时建议配置 swap。
- 40 GiB 以上可用磁盘空间，复杂配置建议预留更多。
- 稳定访问 GitHub 和 OpenWrt 下载站的网络。

### 1. 克隆项目并安装依赖

```bash
git clone https://github.com/Neal3923/build-openwrt.git "$HOME/build-openwrt"
cd "$HOME/build-openwrt"
sudo bash ./script/setup-local-builder.sh
```

Fork 用户可以把克隆地址替换为自己的仓库。如果当前账号执行 sudo 需要密码，按提示输入即可。安装脚本只安装 Ubuntu 编译依赖，不会卸载服务器已有软件。

### 2. 从网页复制编译命令

1. 在网页中完成源码、分支、根分区容量和插件选择。
2. 第 4 步选择“本地服务器”。
3. 点击“复制并编译”。
4. 使用普通账号把命令粘贴到服务器终端执行。

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

先验证参数而不下载源码：

```bash
bash ./script/local-build.sh \
  --source openwrt-main \
  --branch openwrt-24.10 \
  --rootfs 1024 \
  --plugins "luci-app-passwall,luci-app-diskman" \
  --dry-run
```

### 3. 本地目录与清理规则

默认工作目录为 `$HOME/build-openwrt-local`：

| 目录 | 用途 | 自动删除 |
| --- | --- | --- |
| `runs/` | 每次编译的独立源码和诊断日志 | 带安全标记且超过 24 小时后删除 |
| `cache/` | 下载缓存与 ccache | 否 |
| `output/` | 最终固件、SHA256 校验和完整日志 | 否 |

只执行安全清理：

```bash
bash ./script/local-build.sh --cleanup-only
```

本地编译使用 `nproc` 检测到的全部 CPU 线程。同一工作根目录同时只允许一个编译任务，避免缓存损坏或内存不足。

### 4. 更新项目

```bash
cd "$HOME/build-openwrt"
git pull --ff-only
sudo bash ./script/setup-local-builder.sh
```

重新运行环境安装器是安全的，已经安装的软件包会被保留。

## 常见问题

### 网页更新后仍显示旧选项

先等待 GitHub Pages 部署完成，再使用 `Ctrl+F5` 强制刷新；也可以用无痕窗口确认是否为浏览器缓存。

### 编译卡在更新 feeds 或下载依赖

通常是源码站、GitHub 或下载镜像连接缓慢。先检查日志是否仍有数据增长；长时间无网络流量时再取消任务并重试。不要在同一目录中同时启动第二个本地编译。

### `wget` 出现 SSL EOF 或 `unexpected end of file`

这通常是运行中设备访问软件源时的网络中断，不代表固件编译错误。重新执行软件包索引更新，并检查系统时间、DNS、网关和 HTTPS 连通性。

### 编译失败后应该查看哪里

- Actions：打开失败步骤的完整日志和失败报告。
- 本地服务器：查看终端提示的诊断目录及其中的 `build.log`。
- 首先定位第一条明确的 `ERROR` 或 `Error`，后面的错误经常只是连锁结果。

## 项目结构

```text
build-openwrt/
├── index.html                         # 可视化编译入口
├── README.md                          # 项目说明
├── README.html                        # 网页版使用教程
├── css/                               # 页面样式
├── js/
│   ├── config-data.js                 # 源码、设备和插件配置
│   ├── wizard.js                      # 配置向导与请求生成
│   └── build-monitor.js               # Actions 阶段监控
├── config/                            # 各源码的 feeds 与基础配置
├── script/
│   ├── setup-local-builder.sh         # Ubuntu 本地环境安装
│   ├── local-build.sh                 # 本地完整编译入口
│   ├── configure-x86-build.sh         # Actions/本地共用配置生成
│   ├── enable-kvm-host.sh             # Intel/AMD KVM 配置
│   └── install-radicale3-backport.sh  # Radicale3 缺失依赖兼容
└── .github/workflows/smart-build.yml  # GitHub Actions 工作流
```

## 安全提示

- 固件刷写有风险，请先备份原系统和重要配置。
- 根据 CPU 厂商选择正确的 KVM 模块。
- 不要把 GitHub Token、订阅地址或服务器密码提交到仓库。
- 默认密码为 `root`，首次登录后必须修改。

## 开源协议与致谢

本项目采用 [MIT License](LICENSE)。感谢 [OpenWrt](https://openwrt.org/)、[Lean's LEDE](https://github.com/coolsnowwolf/lede)、[ImmortalWrt](https://github.com/immortalwrt/immortalwrt)、[Lienol's OpenWrt](https://github.com/Lienol/openwrt) 以及相关插件项目的维护者。
