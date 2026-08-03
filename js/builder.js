/**
 * OpenWrt 编译控制器 - 修复版本
 * 移除未定义的依赖，添加必要的工具类
 */

// 工具类定义
class Utils {
    /**
     * 格式化时间
     */
    static formatTime(timestamp) {
        return new Date(timestamp).toLocaleString('zh-CN');
    }

    /**
     * 格式化文件大小
     */
    static formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 格式化持续时间
     */
    static formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}小时${minutes % 60}分钟`;
        } else if (minutes > 0) {
            return `${minutes}分钟${seconds % 60}秒`;
        } else {
            return `${seconds}秒`;
        }
    }

    /**
     * 延迟执行
     */
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 安全的JSON解析
     */
    static safeJsonParse(str, defaultValue = null) {
        try {
            return JSON.parse(str);
        } catch (error) {
            console.warn('JSON解析失败:', error);
            return defaultValue;
        }
    }

    /**
     * 生成UUID
     */
    static generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 深度克隆对象
     */
    static deepClone(obj) {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime());
        if (obj instanceof Array) return obj.map(item => Utils.deepClone(item));
        if (typeof obj === 'object') {
            const clonedObj = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    clonedObj[key] = Utils.deepClone(obj[key]);
                }
            }
            return clonedObj;
        }
    }

    /**
     * 防抖函数
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * 获取URL参数
     */
    static getUrlParams() {
        const params = {};
        const urlParams = new URLSearchParams(window.location.search);
        for (const [key, value] of urlParams.entries()) {
            params[key] = value;
        }
        return params;
    }
}

// 编译历史管理类
class BuildHistoryManager {
    constructor() {
        this.storageKey = 'openwrt_build_history';
        this.maxHistoryItems = 50;
    }

    /**
     * 获取编译历史
     */
    getHistory() {
        try {
            const history = localStorage.getItem(this.storageKey);
            return history ? JSON.parse(history) : [];
        } catch (error) {
            console.warn('获取编译历史失败:', error);
            return [];
        }
    }

    /**
     * 添加编译记录
     */
    addRecord(record) {
        try {
            const history = this.getHistory();
            const newRecord = {
                id: Utils.generateUUID(),
                timestamp: Date.now(),
                ...record
            };

            history.unshift(newRecord);

            // 限制历史记录数量
            if (history.length > this.maxHistoryItems) {
                history.splice(this.maxHistoryItems);
            }

            localStorage.setItem(this.storageKey, JSON.stringify(history));
            return newRecord;
        } catch (error) {
            console.error('添加编译记录失败:', error);
        }
    }

    /**
     * 更新编译记录
     */
    updateRecord(id, updates) {
        try {
            const history = this.getHistory();
            const index = history.findIndex(record => record.id === id);

            if (index !== -1) {
                history[index] = { ...history[index], ...updates };
                localStorage.setItem(this.storageKey, JSON.stringify(history));
                return history[index];
            }
        } catch (error) {
            console.error('更新编译记录失败:', error);
        }
    }

    /**
     * 删除编译记录
     */
    deleteRecord(id) {
        try {
            const history = this.getHistory();
            const filteredHistory = history.filter(record => record.id !== id);
            localStorage.setItem(this.storageKey, JSON.stringify(filteredHistory));
        } catch (error) {
            console.error('删除编译记录失败:', error);
        }
    }

    /**
     * 清空编译历史
     */
    clearHistory() {
        try {
            localStorage.removeItem(this.storageKey);
        } catch (error) {
            console.error('清空编译历史失败:', error);
        }
    }
}

// OpenWrt编译控制器主类
class OpenWrtBuilder {
    constructor() {
        this.isMonitoring = false;
        this.monitorInterval = null;
        this.currentBuildId = null;
        this.buildHistory = new BuildHistoryManager();

        this.init();
    }

    /**
     * 初始化编译控制器
     */
    init() {
        try {
            console.log('🔨 初始化OpenWrt编译控制器');
            this.bindEvents();
            this.loadBuildHistory();
            console.log('✅ 编译控制器初始化完成');
        } catch (error) {
            console.error('❌ 编译控制器初始化失败:', error);
        }
    }

    /**
     * 绑定事件监听器
     */
    bindEvents() {
        // 监听编译开始事件
        document.addEventListener('buildStarted', (event) => {
            this.onBuildStarted(event.detail);
        });

        // 监听编译完成事件
        document.addEventListener('buildCompleted', (event) => {
            this.onBuildCompleted(event.detail);
        });

        // 监听编译失败事件
        document.addEventListener('buildFailed', (event) => {
            this.onBuildFailed(event.detail);
        });

        // 监听页面卸载事件
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    /**
     * 加载编译历史
     */
    loadBuildHistory() {
        try {
            const history = this.buildHistory.getHistory();
            console.log(`📚 加载了 ${history.length} 条编译历史记录`);

            // 如果需要显示历史记录，可以在这里渲染
            this.renderBuildHistory(history);
        } catch (error) {
            console.error('加载编译历史失败:', error);
        }
    }

    /**
     * 渲染编译历史
     */
    renderBuildHistory(history) {
        const historyContainer = document.getElementById('build-history');
        if (!historyContainer || history.length === 0) return;

        let html = '<div class="build-history-list">';

        history.slice(0, 10).forEach(record => {
            const statusClass = this.getStatusClass(record.status);
            const timeAgo = this.getTimeAgo(record.timestamp);

            html += `
                <div class="history-item ${statusClass}">
                    <div class="history-header">
                        <span class="history-status">${this.getStatusIcon(record.status)}</span>
                        <span class="history-device">${record.device || '未知设备'}</span>
                        <span class="history-time">${timeAgo}</span>
                    </div>
                    <div class="history-details">
                        <span class="history-source">${record.source || '未知源码'}</span>
                        <span class="history-plugins">${record.plugins?.length || 0} 个插件</span>
                    </div>
                </div>
            `;
        });

        html += '</div>';
        historyContainer.innerHTML = html;
    }

    /**
     * 获取状态样式类
     */
    getStatusClass(status) {
        switch (status) {
            case 'success':
                return 'status-success';
            case 'failed':
                return 'status-failed';
            case 'running':
                return 'status-running';
            case 'queued':
                return 'status-queued';
            default:
                return 'status-unknown';
        }
    }

    /**
     * 获取状态图标
     */
    getStatusIcon(status) {
        switch (status) {
            case 'success':
                return '✅';
            case 'failed':
                return '❌';
            case 'running':
                return '🔄';
            case 'queued':
                return '⏳';
            default:
                return '❓';
        }
    }

    /**
     * 获取时间差描述
     */
    getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}天前`;
        } else if (hours > 0) {
            return `${hours}小时前`;
        } else if (minutes > 0) {
            return `${minutes}分钟前`;
        } else {
            return '刚刚';
        }
    }

    /**
     * 编译开始事件处理
     */
    onBuildStarted(buildData) {
        console.log('🚀 编译开始:', buildData);

        // 添加到编译历史
        const record = this.buildHistory.addRecord({
            status: 'running',
            source: buildData.source_branch,
            device: buildData.target_device,
            plugins: buildData.plugins,
            buildId: buildData.build_id
        });

        this.currentBuildId = record.id;

        // 开始监控
        this.startMonitoring(buildData);

        // 更新UI
        this.updateBuildStatus('running', '编译进行中...');
    }

    /**
     * 编译完成事件处理
     */
    onBuildCompleted(buildData) {
        console.log('✅ 编译完成:', buildData);

        // 更新历史记录
        if (this.currentBuildId) {
            this.buildHistory.updateRecord(this.currentBuildId, {
                status: 'success',
                completedAt: Date.now()
            });
        }

        // 停止监控
        this.stopMonitoring();

        // 更新UI
        this.updateBuildStatus('success', '编译成功完成！');

        // 显示下载链接
        if (buildData.downloadUrl) {
            this.showDownloadLinks(buildData.downloadUrl);
        }
    }

    /**
     * 编译失败事件处理
     */
    onBuildFailed(buildData) {
        console.log('❌ 编译失败:', buildData);

        // 更新历史记录
        if (this.currentBuildId) {
            this.buildHistory.updateRecord(this.currentBuildId, {
                status: 'failed',
                failedAt: Date.now(),
                error: buildData.error
            });
        }

        // 停止监控
        this.stopMonitoring();

        // 更新UI
        this.updateBuildStatus('failed', '编译失败');

        // 显示错误信息
        if (buildData.error) {
            this.showErrorDetails(buildData.error);
        }
    }

    /**
     * 开始监控编译进度
     */
    startMonitoring(buildData) {
        if (this.isMonitoring) {
            this.stopMonitoring();
        }

        this.isMonitoring = true;
        console.log('📊 开始监控编译进度');

        // 模拟进度更新（实际应该通过API获取）
        let progress = 0;
        this.monitorInterval = setInterval(() => {
            progress += Math.random() * 10;
            if (progress >= 100) {
                progress = 100;
                this.stopMonitoring();
            }

            this.updateProgressBar(Math.floor(progress));
        }, 2000);
    }

    /**
     * 停止监控
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        this.isMonitoring = false;
        console.log('🛑 停止编译监控');
    }

    /**
     * 更新进度条
     */
    updateProgressBar(progress) {
        const progressBar = document.getElementById('progress-bar');
        const progressText = document.getElementById('progress-text');

        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }

        if (progressText) {
            progressText.textContent = `${progress}%`;
        }
    }

    /**
     * 更新编译状态
     */
    updateBuildStatus(status, message) {
        const statusElement = document.getElementById('build-status');
        if (statusElement) {
            statusElement.className = `build-status ${this.getStatusClass(status)}`;
            statusElement.innerHTML = `
                <span class="status-icon">${this.getStatusIcon(status)}</span>
                <span class="status-message">${message}</span>
            `;
        }
    }

    /**
     * 显示下载链接
     */
    showDownloadLinks(downloadUrl) {
        const downloadContainer = document.getElementById('download-links');
        if (downloadContainer) {
            downloadContainer.innerHTML = `
                <div class="download-section">
                    <h3>📦 下载固件</h3>
                    <div class="download-buttons">
                        <a href="${downloadUrl}" class="btn btn-primary" target="_blank">
                            ⬇️ 下载固件
                        </a>
                        <button class="btn btn-secondary" onclick="this.showChecksums()">
                            🔒 查看校验
                        </button>
                    </div>
                </div>
            `;
            downloadContainer.style.display = 'block';
        }
    }

    /**
     * 显示错误详情
     */
    showErrorDetails(error) {
        const errorContainer = document.getElementById('error-details');
        if (errorContainer) {
            errorContainer.innerHTML = `
                <div class="error-section">
                    <h3>❌ 编译错误</h3>
                    <div class="error-message">
                        <pre>${error}</pre>
                    </div>
                    <div class="error-actions">
                        <button class="btn btn-secondary" onclick="this.retryBuild()">
                            🔄 重试编译
                        </button>
                        <button class="btn btn-secondary" onclick="this.reportIssue()">
                            📝 报告问题
                        </button>
                    </div>
                </div>
            `;
            errorContainer.style.display = 'block';
        }
    }

    /**
     * 重试编译
     */
    retryBuild() {
        if (window.wizardManager) {
            window.wizardManager.startBuild();
        }
    }

    /**
     * 报告问题
     */
    reportIssue() {
        const repoUrl = window.GITHUB_REPO || 'your-username/your-repo';
        const issueUrl = `https://github.com/${repoUrl}/issues/new?template=build_failure.md`;
        window.open(issueUrl, '_blank');
    }

    /**
     * 获取编译统计信息
     */
    getBuildStats() {
        const history = this.buildHistory.getHistory();
        const stats = {
            total: history.length,
            success: history.filter(r => r.status === 'success').length,
            failed: history.filter(r => r.status === 'failed').length,
            running: history.filter(r => r.status === 'running').length
        };

        stats.successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;

        return stats;
    }

    /**
     * 导出编译历史
     */
    exportHistory() {
        const history = this.buildHistory.getHistory();
        const dataStr = JSON.stringify(history, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = `openwrt_build_history_${new Date().toISOString().split('T')[0]}.json`;
        link.click();
    }

    /**
     * 清理资源
     */
    cleanup() {
        this.stopMonitoring();
        console.log('🧹 编译控制器资源清理完成');
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', function () {
    console.log('🔨 初始化编译控制器');
    window.openWrtBuilder = new OpenWrtBuilder();
});

// 导出类供外部使用
window.OpenWrtBuilder = OpenWrtBuilder;
window.Utils = Utils;
window.BuildHistoryManager = BuildHistoryManager;
