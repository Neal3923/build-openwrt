/**
 * OpenWrt 智能编译向导 - 修复编译进度监控版本
 * 解决GitHub Actions编译进度实时监控问题
 */

class WizardManager {
    constructor() {
        this.currentStep = 1;
        this.totalSteps = 4;
        this.config = {
            source: '',
            repoBranch: '',
            device: 'x86_64',
            rootfsPartSize: 512,
            plugins: [],
            customSources: [],
            optimization: 'balanced'
        };

        this.isInitialized = false;

        // 延迟初始化，确保DOM加载完成
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            setTimeout(() => this.init(), 100);
        }
    }

    init() {
        if (this.isInitialized) return;

        console.log('🚀 初始化OpenWrt智能编译向导');

        try {
            this.loadConfigData();
            this.bindEvents();
            this.renderStep(1);
            this.checkTokenStatus();
            this.isInitialized = true;
            this.restoreBuildMonitoring();
            console.log('✅ 向导初始化完成');
        } catch (error) {
            console.error('❌ 向导初始化失败:', error);
            this.showInitError(error);
        }
    }

    /**
     * 显示初始化错误
     */
    showInitError(error) {
        const errorMessage = `
            <div class="init-error">
                <h3>⚠️ 初始化失败</h3>
                <p>向导初始化时出现错误：${error.message}</p>
                <button onclick="location.reload()" class="btn btn-primary">🔄 重新加载</button>
            </div>
        `;

        const container = document.querySelector('.wizard-content') || document.body;
        container.innerHTML = errorMessage;
    }

    /**
     * 检查Token配置状态
     */
    checkTokenStatus() {
        // 安全地获取DOM元素
        const statusContainer = document.getElementById('token-status') ||
            document.getElementById('token-status-indicator');

        if (!statusContainer) {
            console.warn('⚠️ Token状态容器未找到，跳过状态更新');
            return;
        }

        const token = this.getValidToken();

        if (token) {
            // 显示Token状态（隐藏敏感信息）
            const maskedToken = token.substring(0, 8) + '*'.repeat(12) + token.substring(token.length - 4);
            statusContainer.innerHTML = `
                <div class="token-status-card valid">
                    <span class="status-icon">✅</span>
                    <div class="status-info">
                        <div class="status-title">GitHub Token 已配置</div>
                        <div class="status-detail">${maskedToken}</div>
                    </div>
                    <button class="btn-clear-token" onclick="window.wizardManager.clearToken()">清除</button>
                </div>
            `;
        } else {
            statusContainer.innerHTML = `
                <div class="token-status-card invalid">
                    <span class="status-icon">⚠️</span>
                    <div class="status-info">
                        <div class="status-title">需要配置 GitHub Token</div>
                        <div class="status-detail">点击配置按钮设置Token以启用编译功能</div>
                    </div>
                    <button class="btn-config-token" onclick="window.tokenModal?.show()">配置Token</button>
                </div>
            `;
        }
    }

    /**
     * 获取有效的Token
     */
    getValidToken() {
        try {
            // 优先级：URL参数 > LocalStorage > 全局变量
            const urlParams = new URLSearchParams(window.location.search);
            const urlToken = urlParams.get('token');
            if (urlToken && this.isValidTokenFormat(urlToken)) {
                return urlToken;
            }

            const storedToken = localStorage.getItem('github_token');
            if (storedToken && this.isValidTokenFormat(storedToken)) {
                return storedToken;
            }

            if (window.GITHUB_TOKEN && this.isValidTokenFormat(window.GITHUB_TOKEN)) {
                return window.GITHUB_TOKEN;
            }
        } catch (error) {
            console.warn('获取Token时出错:', error);
        }

        return null;
    }

    /**
     * 验证Token格式
     */
    isValidTokenFormat(token) {
        return token && typeof token === 'string' &&
            (token.startsWith('ghp_') || token.startsWith('github_pat_'));
    }

    /**
     * Token配置完成回调
     */
    onTokenConfigured(token) {
        console.log('✅ Token配置完成');
        this.checkTokenStatus();
        window.buildMonitor?.updateToken(token);
        this.restoreBuildMonitoring();

        // 如果在编译步骤，重新启用编译按钮
        const buildBtn = document.getElementById('start-build-btn');
        if (buildBtn) {
            buildBtn.disabled = false;
            buildBtn.innerHTML = '🚀 开始编译';
        }
    }

    /**
     * 清除Token配置
     */
    clearToken() {
        if (confirm('确定要清除Token配置吗？清除后将无法进行编译。')) {
            try {
                localStorage.removeItem('github_token');
                delete window.GITHUB_TOKEN;

                // 从URL中移除token参数（如果存在）
                const url = new URL(window.location);
                if (url.searchParams.has('token')) {
                    url.searchParams.delete('token');
                    window.history.replaceState({}, document.title, url.toString());
                }

                this.checkTokenStatus();
                console.log('🗑️ Token配置已清除');
            } catch (error) {
                console.error('清除Token失败:', error);
            }
        }
    }

    /**
     * 加载配置数据
     */
    loadConfigData() {
        try {
            // 从全局变量加载配置数据
            this.sourceBranches = window.SOURCE_BRANCHES || this.getDefaultSourceBranches();
            this.deviceConfigs = window.DEVICE_CONFIGS || this.getDefaultDeviceConfigs();
            this.pluginConfigs = window.PLUGIN_CONFIGS || this.getDefaultPluginConfigs();
            console.log('📋 配置数据加载完成');
        } catch (error) {
            console.warn('配置数据加载失败，使用默认配置:', error);
            this.loadDefaultConfigs();
        }
    }

    /**
     * 获取默认源码分支配置
     */
    getDefaultSourceBranches() {
        return {
            'lede-master': {
                name: "Lean's LEDE",
                description: '国内热门源码，可选择 master 或历史稳定快照',
                repo: 'https://github.com/coolsnowwolf/lede',
                branch: 'master',
                defaultBranch: 'master',
                branches: [
                    { value: 'master', label: 'master（开发版）' },
                    { value: '20251001', label: '20251001（稳定快照）' },
                    { value: '20230609', label: '20230609（历史快照）' },
                    { value: '20221001', label: '20221001（历史快照）' }
                ],
                recommended: true,
                stability: '稳定',
                plugins: '丰富'
            },
            'openwrt-main': {
                name: 'OpenWrt 官方',
                description: '官方源码，可选择开发版或稳定版分支',
                repo: 'https://github.com/openwrt/openwrt',
                branch: 'main',
                defaultBranch: 'main',
                branches: [
                    { value: 'main', label: 'main（开发版）' },
                    { value: 'openwrt-25.12', label: '25.12（稳定版）' },
                    { value: 'openwrt-24.10', label: '24.10' },
                    { value: 'openwrt-23.05', label: '23.05' }
                ],
                recommended: true,
                stability: '高',
                plugins: '基础'
            },
            'immortalwrt-master': {
                name: 'ImmortalWrt',
                description: '增强版官方固件，可选择开发版或稳定版分支',
                repo: 'https://github.com/immortalwrt/immortalwrt',
                branch: 'master',
                defaultBranch: 'master',
                branches: [
                    { value: 'master', label: 'master（开发版）' },
                    { value: 'openwrt-25.12', label: '25.12（稳定版）' },
                    { value: 'openwrt-24.10', label: '24.10' },
                    { value: 'openwrt-23.05', label: '23.05' }
                ],
                recommended: false,
                stability: '中',
                plugins: '增强'
            },
            'Lienol-master': {
                name: "Lienol's OpenWrt",
                description: 'Lienol 源码，可选择多个稳定版分支',
                repo: 'https://github.com/Lienol/openwrt',
                branch: '25.12',
                defaultBranch: '25.12',
                branches: [
                    { value: '25.12', label: '25.12（默认）' },
                    { value: '24.10', label: '24.10' },
                    { value: '23.05', label: '23.05' },
                    { value: '19.07', label: '19.07' }
                ],
                recommended: false,
                stability: '中',
                plugins: '特色'
            }
        };
    }

    /**
     * 获取默认设备配置
     */
    getDefaultDeviceConfigs() {
        return {
            'x86_64': {
                name: 'X86 64位 (通用)',
                category: 'x86',
                arch: 'x86',
                target: 'x86/64',
                profile: 'generic',
                flash_size: '可变',
                ram_size: '可变',
                recommended: true,
                features: ['efi', 'legacy', 'kvm', 'docker']
            }
        };
    }

    /**
     * 获取默认插件配置
     */
    getDefaultPluginConfigs() {
        return {
            proxy: {
                name: '🔐 网络代理',
                plugins: {
                    'luci-app-ssr-plus': {
                        name: 'SSR Plus+',
                        description: 'ShadowsocksR代理工具',
                        size: '5M',
                        stability: 'stable'
                    },
                    'luci-app-passwall': {
                        name: 'PassWall',
                        description: '多协议代理，智能分流',
                        size: '8M',
                        stability: 'stable'
                    }
                }
            },
            system: {
                name: '⚙️ 系统管理',
                plugins: {
                    'luci-app-ttyd': {
                        name: 'TTYD终端',
                        description: 'Web终端访问',
                        size: '1M',
                        stability: 'stable'
                    },
                    'luci-app-upnp': {
                        name: 'UPnP',
                        description: '端口自动映射',
                        size: '0.5M',
                        stability: 'stable'
                    }
                }
            }
        };
    }

    /**
     * 加载默认配置（备用方案）
     */
    loadDefaultConfigs() {
        this.sourceBranches = this.getDefaultSourceBranches();
        this.deviceConfigs = this.getDefaultDeviceConfigs();
        this.pluginConfigs = this.getDefaultPluginConfigs();
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 使用事件委托避免元素不存在的问题
        document.addEventListener('click', (e) => {
            try {
                if (e.target.matches('.next-step-btn')) {
                    this.nextStep();
                } else if (e.target.matches('.prev-step-btn')) {
                    this.prevStep();
                } else if (e.target.matches('.source-option')) {
                    this.selectSource(e.target.dataset.source);
                } else if (e.target.matches('.device-option')) {
                    this.selectDevice(e.target.dataset.device);
                } else if (e.target.matches('.plugin-checkbox')) {
                    this.togglePlugin(e.target.dataset.plugin);
                } else if (e.target.matches('#start-build-btn')) {
                    this.startBuild();
                }
            } catch (error) {
                console.error('事件处理失败:', error);
            }
        });

        // 绑定搜索框事件
        document.addEventListener('input', (e) => {
            if (e.target.matches('.search-input')) {
                const filterType = e.target.dataset.filter;
                if (filterType) {
                    this.filterOptions(e.target.value, filterType);
                }
            } else if (e.target.matches('#rootfs-partsize-input')) {
                this.updateRootfsPartSize(e.target.value);
            }
        });
    }

    /**
     * 渲染步骤
     */
    renderStep(step) {
        this.currentStep = step;

        try {
            // 更新步骤指示器
            this.updateStepIndicator();

            // 显示对应步骤内容
            this.showStepContent(step);

            // 根据步骤渲染内容
            switch (step) {
                case 1:
                    this.renderSourceSelection();
                    break;
                case 2:
                    this.renderDeviceSelection();
                    break;
                case 3:
                    this.renderPluginSelection();
                    break;
                case 4:
                    this.renderConfigSummary();
                    break;
            }
        } catch (error) {
            console.error(`渲染步骤${step}失败:`, error);
        }
    }

    /**
     * 更新步骤指示器
     */
    updateStepIndicator() {
        const indicators = document.querySelectorAll('.step-indicator');
        indicators.forEach((indicator, index) => {
            const stepNum = index + 1;
            indicator.className = 'step-indicator';

            if (stepNum < this.currentStep) {
                indicator.classList.add('completed');
            } else if (stepNum === this.currentStep) {
                indicator.classList.add('active');
            }
        });
    }

    /**
     * 显示步骤内容
     */
    showStepContent(step) {
        // 隐藏所有步骤内容
        const stepContents = document.querySelectorAll('.step-content');
        stepContents.forEach(content => {
            content.style.display = 'none';
        });

        // 显示当前步骤
        const currentStepContent = document.getElementById(`step-${step}`);
        if (currentStepContent) {
            currentStepContent.style.display = 'block';
        } else {
            console.warn(`步骤${step}的内容容器未找到`);
        }
    }

    /**
     * 渲染源码选择
     */
    renderSourceSelection() {
        const container = document.getElementById('source-selection');
        if (!container) {
            console.warn('源码选择容器未找到');
            return;
        }

        let html = '<div class="options-grid source-options-grid">';

        Object.entries(this.sourceBranches).forEach(([key, source]) => {
            const isSelected = this.config.source === key;
            const recommendedBadge = source.recommended ? '<span class="recommended-badge">推荐</span>' : '';
            const branchOptions = this.getSourceBranchOptions(source);
            const selectedBranch = isSelected && this.config.repoBranch
                ? this.config.repoBranch
                : this.getDefaultRepoBranch(source);

            html += `
                <div class="source-option ${isSelected ? 'selected' : ''}" data-source="${key}">
                    ${recommendedBadge}
                    <div class="option-header">
                        <h3>${source.name}</h3>
                        <div class="option-meta">
                            <span class="stability-badge">${source.stability}</span>
                            <span class="plugins-badge">${source.plugins}</span>
                        </div>
                    </div>
                    <p class="option-description">${source.description}</p>
                    <div class="option-details">
                        <div class="detail-item">
                            <span class="detail-label">仓库:</span>
                            <span class="detail-value">${this.getRepoShortName(source.repo)}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">分支/版本:</span>
                            <select class="source-branch-select" data-source="${key}" aria-label="${source.name} 分支">
                                ${branchOptions.map(branch => `
                                    <option value="${branch.value}" ${branch.value === selectedBranch ? 'selected' : ''}>${branch.label}</option>
                                `).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        container.innerHTML = html;

        this.bindSourceOptionEvents();
    }

    /**
     * 绑定源码选项卡片事件
     */
    bindSourceOptionEvents() {
        document.querySelectorAll('.source-option').forEach(card => {
            card.addEventListener('click', (e) => {
                // 交互控件由各自的事件处理器负责，避免点击下拉框时切换分支。
                if (
                    e.target.tagName === 'A' ||
                    e.target.tagName === 'BUTTON' ||
                    e.target.tagName === 'INPUT' ||
                    e.target.tagName === 'SELECT' ||
                    e.target.tagName === 'OPTION' ||
                    e.target.tagName === 'LABEL'
                ) return;
                this.selectSource(card.dataset.source);
            });
            // 让input点击也能选中
            const input = card.querySelector('input[type="radio"]');
            if (input) {
                input.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectSource(card.dataset.source);
                });
            }

            const branchSelect = card.querySelector('.source-branch-select');
            if (branchSelect) {
                branchSelect.addEventListener('click', (e) => e.stopPropagation());
                branchSelect.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.config.source = branchSelect.dataset.source;
                    this.config.repoBranch = branchSelect.value;
                    this.renderSourceSelection();
                    console.log('✅ 选择源码和分支:', this.config.source, this.config.repoBranch);
                });
            }
        });
    }

    /**
     * 渲染设备选择
     */
    renderDeviceSelection() {
        const container = document.getElementById('device-selection');
        if (!container) {
            console.warn('设备选择容器未找到');
            return;
        }

        // 项目仅保留X86_64设备。
        const categories = {
            x86: '🖥️ X86设备'
        };

        let html = '';

        Object.entries(categories).forEach(([category, title]) => {
            const devices = Object.entries(this.deviceConfigs)
                .filter(([key, device]) => device.category === category);

            if (devices.length === 0) return;

            html += `
                <div class="device-category">
                    <h3 class="category-title">${title}</h3>
                    <div class="options-grid">
            `;

            devices.forEach(([key, device]) => {
                const isSelected = this.config.device === key;
                const recommendedBadge = device.recommended ? '<span class="recommended-badge">推荐</span>' : '';

                html += `
                    <div class="device-option ${isSelected ? 'selected' : ''}" data-device="${key}">
                        ${recommendedBadge}
                        <div class="option-header">
                            <h4>${device.name}</h4>
                            <div class="device-specs">
                                <span class="spec-item">Flash: ${device.flash_size}</span>
                                <span class="spec-item">RAM: ${device.ram_size}</span>
                            </div>
                        </div>
                        <div class="device-features">
                            ${device.features?.map(feature => `<span class="feature-tag">${feature}</span>`).join('') || ''}
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        });

        container.innerHTML = html;
        this.bindDeviceOptionEvents();
    }

    /**
     * 绑定设备选项卡片事件
     */
    bindDeviceOptionEvents() {
        document.querySelectorAll('.device-option').forEach(card => {
            card.addEventListener('click', (e) => {
                // 阻止 a、button、input 的默认行为
                if (
                    e.target.tagName === 'A' ||
                    e.target.tagName === 'BUTTON' ||
                    e.target.tagName === 'INPUT'
                ) return;
                this.selectDevice(card.dataset.device);
            });
            // 让input点击也能选中
            const input = card.querySelector('input[type="radio"]');
            if (input) {
                input.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.selectDevice(card.dataset.device);
                });
            }
        });
    }

    /**
     * 渲染插件选择
     */
    renderPluginSelection() {
        const container = document.getElementById('plugin-selection');
        if (!container) {
            console.warn('插件选择容器未找到');
            return;
        }

        let html = '';

        Object.entries(this.pluginConfigs).forEach(([categoryKey, category]) => {
            html += `
                <div class="plugin-category">
                    <h3 class="category-title">${category.name}</h3>
                    <div class="plugin-grid">
            `;

            Object.entries(category.plugins).forEach(([pluginKey, plugin]) => {
                const isSelected = this.config.plugins.includes(pluginKey);

                html += `
                    <div class="plugin-item ${isSelected ? 'selected' : ''}">
                        <label class="plugin-label">
                            <input type="checkbox" 
                                   class="plugin-checkbox" 
                                   data-plugin="${pluginKey}"
                                   ${isSelected ? 'checked' : ''}>
                            <div class="plugin-info">
                                <div class="plugin-header">
                                    <span class="plugin-name">${plugin.name}</span>
                                    <span class="plugin-size">${plugin.size || 'N/A'}</span>
                                </div>
                                <div class="plugin-description">${plugin.description}</div>
                            </div>
                        </label>
                    </div>
                `;
            });

            html += '</div></div>';
        });

        container.innerHTML = html;

        // 添加冲突检测面板
        this.renderConflictDetection();
    }

    /**
     * 渲染冲突检测
     */
    renderConflictDetection() {
        const container = document.getElementById('conflict-detection');
        if (!container) return;

        const conflicts = this.detectPluginConflicts();

        let html = '<div class="conflict-panel">';

        if (conflicts.length === 0) {
            html += `
                <div class="conflict-status success">
                    <span class="status-icon">✅</span>
                    <span class="status-text">配置检查通过，无冲突问题</span>
                </div>
            `;
        } else {
            html += `
                <div class="conflict-status error">
                    <span class="status-icon">⚠️</span>
                    <span class="status-text">发现 ${conflicts.length} 个配置问题</span>
                </div>
            `;

            conflicts.forEach(conflict => {
                html += `
                    <div class="conflict-item">
                        <div class="conflict-type">插件冲突</div>
                        <div class="conflict-message">${conflict.message}</div>
                    </div>
                `;
            });
        }

        html += '</div>';
        container.innerHTML = html;
    }

    /**
     * 渲染配置摘要
     */
    renderConfigSummary() {
        const container = document.getElementById('config-summary');
        if (!container) {
            console.warn('配置摘要容器未找到');
            return;
        }

        const sourceInfo = this.sourceBranches[this.config.source];
        const deviceInfo = this.deviceConfigs[this.config.device];

        let html = `
            <div class="summary-section">
                <h3>📋 配置摘要</h3>
                <div class="summary-grid">
                    <div class="summary-item">
                        <div class="summary-label">源码仓库 / 分支或版本</div>
                        <div class="summary-value">${sourceInfo?.name || '未选择'} / ${this.config.repoBranch || '未选择'}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">目标设备</div>
                        <div class="summary-value">${deviceInfo?.name || '未选择'}</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">根分区容量</div>
                        <div class="summary-value">${this.config.rootfsPartSize} MiB</div>
                    </div>
                    <div class="summary-item">
                        <div class="summary-label">选中插件</div>
                        <div class="summary-value">${this.config.plugins.length} 个</div>
                    </div>
                </div>
            </div>
            
            <div class="summary-section">
                <h3>🔧 插件列表</h3>
                <div class="plugin-summary">
                    ${this.config.plugins.length > 0 ?
                this.config.plugins.map(plugin => this.getPluginDisplayName(plugin)).join(', ') :
                '未选择插件'
            }
                </div>
            </div>
            
            <div class="summary-section">
                <h3>🚀 编译控制</h3>
                <div class="build-actions">
                    ${this.getValidToken() ? `
                        <button id="start-build-btn" class="btn btn-primary btn-large">
                            🚀 开始编译
                        </button>
                    ` : `
                        <button id="start-build-btn" class="btn btn-primary btn-large" disabled>
                            🔒 需要配置Token
                        </button>
                        <button class="btn btn-secondary" onclick="window.tokenModal?.show()">
                            ⚙️ 配置GitHub Token
                        </button>
                    `}
                </div>
            </div>
        `;

        container.innerHTML = html;
    }

    // === 选择操作方法 ===

    selectSource(sourceKey) {
        const source = this.sourceBranches[sourceKey];
        const availableBranches = this.getSourceBranchOptions(source).map(branch => branch.value);

        if (this.config.source !== sourceKey || !availableBranches.includes(this.config.repoBranch)) {
            this.config.repoBranch = this.getDefaultRepoBranch(source);
        }
        this.config.source = sourceKey;
        this.renderSourceSelection();
        console.log('✅ 选择源码:', sourceKey, this.config.repoBranch);
    }

    selectDevice(deviceKey) {
        this.config.device = deviceKey;
        this.renderDeviceSelection();
        console.log('✅ 选择设备:', deviceKey);
    }

    updateRootfsPartSize(rawValue) {
        const value = Number(rawValue);
        this.config.rootfsPartSize = Number.isInteger(value) ? value : 0;

        const input = document.getElementById('rootfs-partsize-input');
        const help = document.getElementById('rootfs-partsize-help');
        const isValid = this.isRootfsPartSizeValid();

        if (input) {
            input.classList.toggle('input-error', !isValid);
            input.setAttribute('aria-invalid', String(!isValid));
        }

        if (help) {
            help.classList.toggle('error', !isValid);
            help.textContent = isValid
                ? `将生成 ${this.config.rootfsPartSize} MiB 的根分区。`
                : '请输入 128–4096 之间的整数。';
        }
    }

    isRootfsPartSizeValid() {
        return Number.isInteger(this.config.rootfsPartSize) &&
            this.config.rootfsPartSize >= 128 &&
            this.config.rootfsPartSize <= 4096;
    }

    togglePlugin(pluginKey) {
        const index = this.config.plugins.indexOf(pluginKey);
        if (index > -1) {
            this.config.plugins.splice(index, 1);
        } else {
            const kvmAlternatives = {
                'kmod-kvm-intel': 'kmod-kvm-amd',
                'kmod-kvm-amd': 'kmod-kvm-intel'
            };
            const alternative = kvmAlternatives[pluginKey];
            if (alternative) {
                this.config.plugins = this.config.plugins.filter(plugin => plugin !== alternative);
            }
            this.config.plugins.push(pluginKey);
        }

        this.renderPluginSelection();
        console.log('🔧 插件状态更新:', pluginKey, index > -1 ? '移除' : '添加');
    }

    // === 编译相关方法 ===

    /**
     * 开始编译流程 - 增强版本
     */
    async startBuild() {
        try {
            // 验证配置完整性
            if (!this.config.source || !this.config.repoBranch) {
                alert('请先选择源码仓库和分支');
                return;
            }

            if (!this.config.device) {
                alert('请先选择目标设备');
                return;
            }

            if (!this.isRootfsPartSizeValid()) {
                alert('根分区容量必须是 128–4096 之间的整数');
                return;
            }

            // 验证Token
            const token = this.getValidToken();
            if (!token) {
                alert('请先配置GitHub Token');
                if (window.tokenModal) {
                    window.tokenModal.show();
                }
                return;
            }

            // 检查插件冲突
            const conflicts = this.detectPluginConflicts();
            if (conflicts.length > 0) {
                const proceed = confirm(`检测到 ${conflicts.length} 个插件冲突，是否继续？\n\n${conflicts.map(c => c.message).join('\n')}`);
                if (!proceed) return;
            }

            // 显示编译前确认信息
            const confirmMessage = this.generateBuildConfirmMessage();
            if (!confirm(confirmMessage)) {
                return;
            }

            // 生成编译配置
            const buildData = this.generateBuildConfig();
            console.log('🚀 开始智能编译，配置数据:', buildData);

            // 显示编译监控面板
            this.showBuildMonitor();

            // 添加初始日志
            this.addLogEntry('info', '🎯 正在启动智能编译工作流...');
            this.addLogEntry('info', `📋 源码: ${this.sourceBranches[this.config.source]?.name}`);
            this.addLogEntry('info', `🌿 分支: ${this.config.repoBranch}`);
            this.addLogEntry('info', `🔧 设备: ${this.deviceConfigs[this.config.device]?.name}`);
            this.addLogEntry('info', `💾 根分区: ${this.config.rootfsPartSize} MiB`);
            this.addLogEntry('info', `📦 插件: ${this.config.plugins.length}个`);

            // 触发GitHub Actions编译（仅智能编译工作流）
            const response = await this.triggerBuild(buildData, token);

            if (response.success) {
                this.showBuildSuccess();
                // 开始真实的进度监控
                this.startRealProgressMonitoring(token, buildData);
            } else {
                alert('编译启动失败: ' + response.message);
            }
        } catch (error) {
            console.error('编译启动失败:', error);
            this.addLogEntry('error', `❌ 编译启动失败: ${error.message}`);
            alert('编译启动失败: ' + error.message);
        }
    }

    /**
     * 生成编译配置
     */
    generateBuildConfig() {
        const timestamp = Date.now();

        // 确保只触发智能编译工作流
        return {
            source_branch: this.config.source,
            repo_branch: this.config.repoBranch,
            target_device: this.config.device,
            rootfs_partsize: this.config.rootfsPartSize,
            plugins: this.config.plugins.join(','), // 转换为逗号分隔的字符串
            description: '智能编译工具Web界面触发',
            timestamp,
            build_id: 'web_build_' + timestamp,
            // 明确指定使用智能编译工作流
            workflow_type: 'smart_build'
        };
    }

    /**
     * 触发GitHub Actions编译 - 仅触发smart-build.yml
     */
    async triggerBuild(buildData, token) {
        try {
            const repoUrl = window.GITHUB_REPO || 'your-username/your-repo';

            // 记录触发信息
            console.log('🚀 触发智能编译工作流:', {
                repository: repoUrl,
                workflow: 'smart-build.yml',
                config: buildData
            });

            // 确保只触发智能编译工作流的Repository Dispatch事件
            const response = await fetch(`https://api.github.com/repos/${repoUrl}/dispatches`, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'OpenWrt-Smart-Builder-Web'
                },
                body: JSON.stringify({
                    // 只触发智能编译工作流的特定事件类型
                    event_type: 'web_build',
                    client_payload: {
                        source_branch: buildData.source_branch,
                        repo_branch: buildData.repo_branch,
                        target_device: buildData.target_device,
                        rootfs_partsize: buildData.rootfs_partsize,
                        plugins: buildData.plugins,
                        description: buildData.description,
                        build_id: buildData.build_id,
                        trigger_method: 'web_interface',
                        workflow_preference: 'smart_build_only', // 明确指定只使用智能编译
                        disable_universal_build: true, // 禁用通用编译工作流
                        timestamp: new Date(buildData.timestamp).toISOString()
                    }
                })
            });

            if (response.ok) {
                // 记录成功触发
                console.log('✅ 智能编译工作流触发成功');

                // 添加日志条目
                this.addLogEntry('success', '🎯 已成功触发智能编译工作流 (smart-build.yml)');
                this.addLogEntry('info', '🚫 通用设备编译工作流已自动跳过');

                return {
                    success: true,
                    message: '智能编译任务已成功提交到GitHub Actions',
                    workflow: 'smart-build.yml',
                    run_id: null
                };
            } else {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
            }

        } catch (error) {
            console.error('触发编译失败:', error);
            if (error.name === 'TypeError' && error.message.includes('fetch')) {
                this.addLogEntry('error', '❌ 无法连接 GitHub，请检查网络后重试');
            }
            this.addLogEntry('error', `❌ 编译触发失败: ${error.message}`);
            throw new Error(`编译启动失败: ${error.message}`);
        }
    }

    /**
     * 开始以工作流实际步骤为依据的进度监控
     */
    startRealProgressMonitoring(token, buildData) {
        if (!window.buildMonitor) {
            this.addLogEntry('error', '❌ 编译监控模块加载失败，请刷新页面后重试');
            return;
        }

        const repoUrl = window.GITHUB_REPO || 'your-username/your-repo';
        window.buildMonitor.start({
            token,
            repoUrl,
            buildId: buildData.build_id,
            dispatchedAt: buildData.timestamp
        });
    }

    /**
     * 刷新页面后恢复尚未结束的任务监控
     */
    restoreBuildMonitoring() {
        if (!window.buildMonitor || window.buildMonitor.active || !window.buildMonitor.hasActiveBuild()) {
            return;
        }

        const token = this.getValidToken();
        if (!token) return;

        const repoUrl = window.GITHUB_REPO || 'your-username/your-repo';
        window.buildMonitor.resume({ token, repoUrl });
    }

    /**
     * 重置进度条；实际进度由 BuildMonitor 根据工作流步骤更新
     */
    updateProgressBar(progress) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');
        const progressStage = document.getElementById('progress-stage');
        const totalStages = (window.buildMonitor?.stageDefinitions?.length || 17) + 1;

        if (progressBar) {
            progressBar.style.width = `${progress}%`;
            progressBar.classList.remove('is-active', 'is-success', 'is-failed');
            progressBar.setAttribute('aria-valuenow', String(progress));
        }

        if (progressText) progressText.textContent = `阶段 0/${totalStages}`;
        if (progressStage) progressStage.textContent = '准备提交编译任务';
    }

    /**
     * 生成编译确认消息
     */
    generateBuildConfirmMessage() {
        const sourceInfo = this.sourceBranches[this.config.source];
        const deviceInfo = this.deviceConfigs[this.config.device];

        return `确认开始编译？\n\n` +
            `📋 编译配置:\n` +
            `源码仓库: ${sourceInfo?.name || '未知'}\n` +
            `实际分支/版本: ${this.config.repoBranch || '未知'}\n` +
            `目标设备: ${deviceInfo?.name || '未知'}\n` +
            `根分区容量: ${this.config.rootfsPartSize} MiB\n` +
            `选中插件: ${this.config.plugins.length}个\n` +
            `工作流类型: 智能编译 (smart-build.yml)\n\n` +
            `⚠️ 注意事项:\n` +
            `• 编译过程通常需要2-5小时，取决于源码和插件\n` +
            `• 将消耗GitHub Actions运行时间\n` +
            `• 只会执行智能编译工作流\n` +
            `• 通用设备编译工作流将被跳过`;
    }

    /**
     * 显示编译监控面板
     */
    showBuildMonitor() {
        const buildMonitor = document.getElementById('build-monitor');
        if (buildMonitor) {
            buildMonitor.style.display = 'block';
            buildMonitor.scrollIntoView({ behavior: 'smooth' });
        }

        // 清空之前的日志
        const logsContent = document.getElementById('logs-content');
        if (logsContent) {
            logsContent.innerHTML = '';
        }

        // 重置进度条
        this.updateProgressBar(0);
    }

    /**
     * 显示编译成功信息
     */
    showBuildSuccess() {
        this.addLogEntry('success', '🎉 智能编译工作流已成功启动！');
        this.addLogEntry('info', `📋 配置信息: ${this.sourceBranches[this.config.source]?.name} / ${this.config.repoBranch} - ${this.deviceConfigs[this.config.device]?.name}`);
        this.addLogEntry('info', `🔧 选中插件: ${this.config.plugins.length}个`);
        this.addLogEntry('info', `🕐 提交时间: ${new Date().toLocaleString()}`);
        this.addLogEntry('info', `📝 工作流: smart-build.yml (智能编译模式)`);

        // 添加访问链接
        const repoUrl = window.GITHUB_REPO || 'your-username/your-repo';
        this.addLogEntry('info', `🔗 监控地址: https://github.com/${repoUrl}/actions`);
    }

    /**
     * 添加日志条目 - 增强版本
     */
    addLogEntry(type, message) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;

        // 添加图标映射
        const iconMap = {
            'info': 'ℹ️',
            'success': '✅',
            'warning': '⚠️',
            'error': '❌'
        };

        const icon = iconMap[type] || 'ℹ️';

        logEntry.innerHTML = `
            <span class="log-timestamp">${timestamp}</span>
            <span class="log-icon">${icon}</span>
            <span class="log-message">${message}</span>
        `;

        logsContent.appendChild(logEntry);
        logsContent.scrollTop = logsContent.scrollHeight;

        // 控制台同步输出
        console.log(`[${timestamp}] ${type.toUpperCase()}: ${message}`);

        // 限制日志条目数量
        const maxLogEntries = 1000;
        const logEntries = logsContent.querySelectorAll('.log-entry');
        if (logEntries.length > maxLogEntries) {
            for (let i = 0; i < logEntries.length - maxLogEntries; i++) {
                logEntries[i].remove();
            }
        }
    }

    // === 工具方法 ===

    /**
     * 显示系统通知
     */
    showNotification(title, message, type = 'info') {
        // 检查浏览器通知权限
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(title, {
                body: message,
                icon: '/favicon.ico',
                badge: '/favicon.ico'
            });

            setTimeout(() => notification.close(), 5000);
        }

        // 备用：在页面上显示通知
        this.showInPageNotification(title, message, type);
    }

    /**
     * 页面内通知
     */
    showInPageNotification(title, message, type) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <h4>${title}</h4>
            <p>${message}</p>
            <button onclick="this.parentElement.remove()">×</button>
        `;

        // 添加样式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#ff9800'};
            color: white;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10000;
            max-width: 300px;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // 5秒后自动移除
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }

    getRepoShortName(repoUrl) {
        try {
            return repoUrl.split('/').slice(-2).join('/');
        } catch (error) {
            return repoUrl;
        }
    }

    getSourceBranchOptions(source) {
        if (!source) return [];

        const configuredBranches = Array.isArray(source.branches) && source.branches.length > 0
            ? source.branches
            : [source.branch || 'master'];

        return configuredBranches.map(branch => typeof branch === 'string'
            ? { value: branch, label: branch }
            : branch);
    }

    getDefaultRepoBranch(source) {
        const options = this.getSourceBranchOptions(source);
        return source?.defaultBranch || source?.branch || options[0]?.value || '';
    }

    getPluginDisplayName(pluginKey) {
        // 遍历所有插件配置，找到对应的显示名称
        for (const category of Object.values(this.pluginConfigs)) {
            if (category.plugins && category.plugins[pluginKey]) {
                return category.plugins[pluginKey].name;
            }
        }
        return pluginKey;
    }

    detectPluginConflicts() {
        const selectedPlugins = this.config.plugins;

        if (typeof window.detectPluginConflicts === 'function') {
            return window.detectPluginConflicts(selectedPlugins);
        }

        // config-data.js不可用时的基础回退检测
        const conflicts = [];

        const proxyPlugins = ['luci-app-ssr-plus', 'luci-app-passwall', 'luci-app-openclash'];
        const selectedProxy = selectedPlugins.filter(plugin => proxyPlugins.includes(plugin));

        if (selectedProxy.length > 1) {
            conflicts.push({
                type: 'mutual_exclusive',
                plugins: selectedProxy,
                message: `代理插件冲突：${selectedProxy.join(', ')} 不能同时选择`
            });
        }

        const kvmPlugins = ['kmod-kvm-intel', 'kmod-kvm-amd'];
        const selectedKvmPlugins = selectedPlugins.filter(plugin => kvmPlugins.includes(plugin));
        if (selectedKvmPlugins.length > 1) {
            conflicts.push({
                type: 'mutual_exclusive',
                plugins: selectedKvmPlugins,
                message: `KVM处理器模块冲突：${selectedKvmPlugins.join(', ')} 不能同时选择`
            });
        }

        return conflicts;
    }

    filterOptions(searchTerm, filterType) {
        const term = searchTerm.toLowerCase();
        let options = [];

        switch (filterType) {
            case 'source':
                options = document.querySelectorAll('.source-option');
                break;
            case 'device':
                options = document.querySelectorAll('.device-option');
                break;
            case 'plugin':
                options = document.querySelectorAll('.plugin-item');
                break;
        }

        options.forEach(option => {
            const text = option.textContent.toLowerCase();
            option.style.display = text.includes(term) ? 'block' : 'none';
        });
    }

    // === 步骤导航方法 ===

    nextStep() {
        if (this.currentStep < this.totalSteps) {
            if (this.validateCurrentStep()) {
                this.renderStep(this.currentStep + 1);
            }
        }
    }

    prevStep() {
        if (this.currentStep > 1) {
            this.renderStep(this.currentStep - 1);
        }
    }

    validateCurrentStep() {
        switch (this.currentStep) {
            case 1:
                if (!this.config.source || !this.config.repoBranch) {
                    alert('请选择源码仓库和分支');
                    return false;
                }
                break;
            case 2:
                if (!this.config.device) {
                    alert('请选择目标设备');
                    return false;
                }
                if (!this.isRootfsPartSizeValid()) {
                    alert('根分区容量必须是 128–4096 之间的整数');
                    return false;
                }
                break;
        }
        return true;
    }
}

// === 全局函数（供HTML调用）===

// Token配置完成回调
function onTokenConfigured(token) {
    if (window.wizardManager) {
        window.wizardManager.onTokenConfigured(token);
    }
}

// 页面加载完成后初始化向导
document.addEventListener('DOMContentLoaded', function () {
    console.log('🎯 页面加载完成，初始化编译向导');

    // 延迟初始化，确保所有资源加载完成
    setTimeout(() => {
        window.wizardManager = new WizardManager();
    }, 500);
});

// 导出向导管理器供调试使用
window.WizardManager = WizardManager;
